// Kolbo Studio - File Explorer Handler
// Handles local file system browsing for drag-and-drop to external apps

const { ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// File type definitions
const FILE_TYPES = {
  video: ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.wmv', '.flv', '.mpeg', '.mpg'],
  audio: ['.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a', '.wma', '.aiff', '.alac'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg', '.ico', '.heic', '.heif']
};

// Icon mappings for file types
const FILE_ICONS = {
  video: 'video',
  audio: 'audio',
  image: 'image',
  folder: 'folder',
  unknown: 'file'
};

class FileExplorerHandler {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.ffmpegHandler = null; // Will be set externally for metadata
  }

  /**
   * Set FFmpeg handler for metadata extraction
   */
  setFFmpegHandler(handler) {
    this.ffmpegHandler = handler;
  }

  /**
   * Register all IPC handlers
   */
  static setupHandlers(mainWindow) {
    const handler = new FileExplorerHandler(mainWindow);

    // List directory contents
    ipcMain.handle('fe:list-directory', async (event, dirPath) => {
      return handler.listDirectory(dirPath);
    });

    // List directory contents recursively (all media files from subfolders)
    ipcMain.handle('fe:list-directory-recursive', async (event, dirPath, maxDepth = 10) => {
      return handler.listDirectoryRecursive(dirPath, maxDepth);
    });

    // Get file metadata (duration, dimensions, etc.)
    ipcMain.handle('fe:get-metadata', async (event, filePath) => {
      return handler.getMetadata(filePath);
    });

    // Get available drives (Windows) or mount points (Mac/Linux)
    ipcMain.handle('fe:get-drives', async () => {
      return handler.getDrives();
    });

    // Get default locations (Documents, Downloads, etc.)
    ipcMain.handle('fe:get-default-locations', async () => {
      return handler.getDefaultLocations();
    });

    // Start native drag for local files (use 'on' for synchronous handling)
    ipcMain.on('fe:start-drag', (event, { filePaths, thumbnailPath }) => {
      handler.startDrag(event, filePaths, thumbnailPath);
    });

    // Open folder picker dialog
    ipcMain.handle('fe:pick-folder', async () => {
      return handler.pickFolder();
    });

    // Get home directory
    ipcMain.handle('fe:get-home', () => {
      return os.homedir();
    });

    // Analyze audio waveform using FFmpeg
    ipcMain.handle('fe:analyze-waveform', async (event, filePath, barCount = 100) => {
      return handler.analyzeWaveform(filePath, barCount);
    });

    console.log('[FileExplorerHandler] IPC handlers registered');
    return handler;
  }

  /**
   * List contents of a directory
   * @param {string} dirPath - Directory path to list
   * @returns {Object} - { success, files, error }
   */
  async listDirectory(dirPath) {
    try {
      // Normalize path
      const normalizedPath = path.normalize(dirPath);

      // Check if directory exists
      if (!fs.existsSync(normalizedPath)) {
        return { success: false, error: 'Directory does not exist' };
      }

      const stat = fs.statSync(normalizedPath);
      if (!stat.isDirectory()) {
        return { success: false, error: 'Path is not a directory' };
      }

      // Read directory contents
      const entries = fs.readdirSync(normalizedPath, { withFileTypes: true });

      const files = [];
      const folders = [];

      for (const entry of entries) {
        // Skip hidden files (starting with .)
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(normalizedPath, entry.name);

        try {
          const entryStat = fs.statSync(fullPath);

          if (entry.isDirectory()) {
            folders.push({
              name: entry.name,
              path: fullPath,
              isDirectory: true,
              icon: 'folder',
              modifiedAt: entryStat.mtime.toISOString()
            });
          } else {
            const ext = path.extname(entry.name).toLowerCase();
            const fileType = this.getFileType(ext);

            // Only include media files
            if (fileType !== 'unknown') {
              files.push({
                name: entry.name,
                path: fullPath,
                isDirectory: false,
                size: entryStat.size,
                sizeFormatted: this.formatFileSize(entryStat.size),
                extension: ext,
                type: fileType,
                icon: FILE_ICONS[fileType] || 'file',
                modifiedAt: entryStat.mtime.toISOString()
              });
            }
          }
        } catch (statError) {
          // Skip files we can't stat (permission issues, etc.)
          console.log('[FileExplorerHandler] Skipping inaccessible:', fullPath);
        }
      }

      // Sort: folders first (alphabetically), then files (alphabetically)
      folders.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));

      return {
        success: true,
        path: normalizedPath,
        parentPath: path.dirname(normalizedPath),
        folders,
        files,
        totalFolders: folders.length,
        totalFiles: files.length
      };

    } catch (error) {
      console.error('[FileExplorerHandler] listDirectory error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * List all media files recursively from a directory and all subdirectories
   * @param {string} dirPath - Directory path to list
   * @param {number} maxDepth - Maximum depth to recurse (default 10)
   * @returns {Object} - { success, files, error }
   */
  async listDirectoryRecursive(dirPath, maxDepth = 10) {
    const MAX_FILES = 2000; // Limit to prevent memory issues
    const MAX_FOLDERS_TO_SCAN = 500; // Limit folders to scan

    try {
      const normalizedPath = path.normalize(dirPath);

      if (!fs.existsSync(normalizedPath)) {
        return { success: false, error: 'Directory does not exist' };
      }

      const stat = fs.statSync(normalizedPath);
      if (!stat.isDirectory()) {
        return { success: false, error: 'Path is not a directory' };
      }

      const allFiles = [];
      const subfolders = []; // Track immediate subfolders for sidebar
      let truncated = false;
      let foldersScanned = 0;

      // Recursive function to collect files
      const collectFiles = (currentPath, depth, relativePath = '') => {
        // Check limits
        if (depth > maxDepth) return;
        if (allFiles.length >= MAX_FILES) {
          truncated = true;
          return;
        }
        if (foldersScanned >= MAX_FOLDERS_TO_SCAN) {
          truncated = true;
          return;
        }

        foldersScanned++;

        try {
          const entries = fs.readdirSync(currentPath, { withFileTypes: true });

          for (const entry of entries) {
            // Check file limit
            if (allFiles.length >= MAX_FILES) {
              truncated = true;
              return;
            }

            // Skip hidden files
            if (entry.name.startsWith('.')) continue;
            // Skip system folders
            if (['node_modules', '.git', '__pycache__', 'venv', '.vscode'].includes(entry.name)) continue;

            const fullPath = path.join(currentPath, entry.name);
            const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

            try {
              const entryStat = fs.statSync(fullPath);

              if (entry.isDirectory()) {
                // Track immediate subfolders (depth 0 only)
                if (depth === 0) {
                  subfolders.push({
                    name: entry.name,
                    path: fullPath,
                    isDirectory: true,
                    icon: 'folder',
                    modifiedAt: entryStat.mtime.toISOString()
                  });
                }
                // Recurse into subdirectory
                collectFiles(fullPath, depth + 1, relPath);
              } else {
                const ext = path.extname(entry.name).toLowerCase();
                const fileType = this.getFileType(ext);

                // Only include media files
                if (fileType !== 'unknown') {
                  allFiles.push({
                    name: entry.name,
                    path: fullPath,
                    relativePath: relPath,
                    folderPath: currentPath,
                    folderName: relativePath || path.basename(normalizedPath),
                    isDirectory: false,
                    size: entryStat.size,
                    sizeFormatted: this.formatFileSize(entryStat.size),
                    extension: ext,
                    type: fileType,
                    icon: FILE_ICONS[fileType] || 'file',
                    modifiedAt: entryStat.mtime.toISOString()
                  });
                }
              }
            } catch (statError) {
              // Skip inaccessible files
            }
          }
        } catch (readError) {
          // Skip inaccessible directories
          console.log('[FileExplorerHandler] Skipping inaccessible directory:', currentPath);
        }
      };

      // Start recursive collection
      console.log('[FileExplorerHandler] Starting recursive scan of:', normalizedPath);
      const startTime = Date.now();
      collectFiles(normalizedPath, 0);
      const elapsed = Date.now() - startTime;

      // Sort files by name
      allFiles.sort((a, b) => a.name.localeCompare(b.name));
      subfolders.sort((a, b) => a.name.localeCompare(b.name));

      console.log(`[FileExplorerHandler] Found ${allFiles.length} media files in ${foldersScanned} folders (${elapsed}ms)${truncated ? ' [TRUNCATED]' : ''}`);

      return {
        success: true,
        path: normalizedPath,
        parentPath: path.dirname(normalizedPath),
        folders: subfolders,
        files: allFiles,
        totalFolders: subfolders.length,
        totalFiles: allFiles.length,
        isRecursive: true,
        truncated,
        maxFiles: MAX_FILES,
        foldersScanned
      };

    } catch (error) {
      console.error('[FileExplorerHandler] listDirectoryRecursive error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get file metadata using FFprobe
   * @param {string} filePath - Path to file
   * @returns {Object} - Metadata object
   */
  async getMetadata(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File does not exist' };
      }

      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const fileType = this.getFileType(ext);

      const metadata = {
        success: true,
        name: path.basename(filePath),
        path: filePath,
        size: stat.size,
        sizeFormatted: this.formatFileSize(stat.size),
        type: fileType,
        extension: ext,
        modifiedAt: stat.mtime.toISOString(),
        createdAt: stat.birthtime.toISOString()
      };

      // For audio/video files, try to get duration using FFprobe
      if ((fileType === 'audio' || fileType === 'video') && this.ffmpegHandler) {
        try {
          const probeData = await this.ffmpegHandler.probeFile(filePath);
          if (probeData && probeData.format) {
            metadata.duration = parseFloat(probeData.format.duration) || 0;
            metadata.durationFormatted = this.formatDuration(metadata.duration);

            // Video-specific metadata
            const videoStream = probeData.streams?.find(s => s.codec_type === 'video');
            if (videoStream) {
              metadata.width = videoStream.width;
              metadata.height = videoStream.height;
              metadata.codec = videoStream.codec_name;
              metadata.fps = this.parseFrameRate(videoStream.r_frame_rate);
            }

            // Audio-specific metadata
            const audioStream = probeData.streams?.find(s => s.codec_type === 'audio');
            if (audioStream) {
              metadata.audioCodec = audioStream.codec_name;
              metadata.sampleRate = audioStream.sample_rate;
              metadata.channels = audioStream.channels;
              metadata.bitrate = probeData.format.bit_rate ?
                Math.round(probeData.format.bit_rate / 1000) + ' kbps' : null;
            }
          }
        } catch (probeError) {
          console.log('[FileExplorerHandler] FFprobe failed for:', filePath, probeError.message);
          // Continue without probe data
        }
      }

      // For images, get dimensions
      if (fileType === 'image') {
        try {
          const img = nativeImage.createFromPath(filePath);
          if (!img.isEmpty()) {
            const size = img.getSize();
            metadata.width = size.width;
            metadata.height = size.height;
          }
        } catch (imgError) {
          console.log('[FileExplorerHandler] Could not read image dimensions:', filePath);
        }
      }

      return metadata;

    } catch (error) {
      console.error('[FileExplorerHandler] getMetadata error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get available drives/mount points
   * @returns {Object} - { success, drives }
   */
  async getDrives() {
    try {
      const drives = [];

      if (process.platform === 'win32') {
        // Windows: Get drives with volume labels using wmic
        const { execSync } = require('child_process');

        try {
          // Get volume information using wmic
          const wmicOutput = execSync('wmic logicaldisk get caption,volumename', {
            encoding: 'utf8',
            timeout: 5000
          });

          const lines = wmicOutput.trim().split('\n').slice(1); // Skip header

          for (const line of lines) {
            const parts = line.trim().split(/\s{2,}/); // Split by 2+ spaces
            if (parts.length >= 1 && parts[0].match(/^[A-Z]:$/i)) {
              const letter = parts[0];
              const volumeName = parts[1] || '';
              const drivePath = `${letter}\\`;

              try {
                if (fs.existsSync(drivePath)) {
                  // Format: "Volume Name (C:)" or "Local Disk (C:)" if no name
                  const displayName = volumeName
                    ? `${volumeName} (${letter})`
                    : `Local Disk (${letter})`;

                  drives.push({
                    name: displayName,
                    path: drivePath,
                    type: 'drive',
                    letter: letter
                  });
                }
              } catch {
                // Drive not accessible
              }
            }
          }
        } catch (wmicError) {
          console.log('[FileExplorerHandler] wmic failed, falling back to basic drive detection');
          // Fallback: Check all possible drive letters
          const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
          for (const letter of letters) {
            const drivePath = `${letter}:\\`;
            try {
              if (fs.existsSync(drivePath)) {
                const stat = fs.statSync(drivePath);
                if (stat.isDirectory()) {
                  drives.push({
                    name: `Local Disk (${letter}:)`,
                    path: drivePath,
                    type: 'drive',
                    letter: `${letter}:`
                  });
                }
              }
            } catch {
              // Drive doesn't exist or is not accessible
            }
          }
        }
      } else {
        // macOS/Linux: List /Volumes (Mac) or /mnt, /media (Linux)
        const mountPaths = process.platform === 'darwin'
          ? ['/Volumes']
          : ['/mnt', '/media', `/media/${os.userInfo().username}`];

        for (const mountPath of mountPaths) {
          try {
            if (fs.existsSync(mountPath)) {
              const entries = fs.readdirSync(mountPath);
              for (const entry of entries) {
                const fullPath = path.join(mountPath, entry);
                try {
                  const stat = fs.statSync(fullPath);
                  if (stat.isDirectory()) {
                    drives.push({
                      name: entry,
                      path: fullPath,
                      type: 'volume'
                    });
                  }
                } catch {
                  // Skip inaccessible volumes
                }
              }
            }
          } catch {
            // Mount path doesn't exist
          }
        }

        // Add root on Unix-like systems
        drives.unshift({
          name: 'Root',
          path: '/',
          type: 'root'
        });
      }

      return { success: true, drives };

    } catch (error) {
      console.error('[FileExplorerHandler] getDrives error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get default user locations
   * @returns {Object} - Default folder paths
   */
  getDefaultLocations() {
    const home = os.homedir();

    const locations = [
      { name: 'Home', path: home, icon: 'home' },
      { name: 'Desktop', path: path.join(home, 'Desktop'), icon: 'desktop' },
      { name: 'Documents', path: path.join(home, 'Documents'), icon: 'folder' },
      { name: 'Downloads', path: path.join(home, 'Downloads'), icon: 'download' },
      { name: 'Pictures', path: path.join(home, 'Pictures'), icon: 'image' },
      { name: 'Music', path: path.join(home, 'Music'), icon: 'audio' },
      { name: 'Videos', path: path.join(home, 'Videos'), icon: 'video' }
    ];

    // Filter out non-existent paths
    return {
      success: true,
      locations: locations.filter(loc => {
        try {
          return fs.existsSync(loc.path);
        } catch {
          return false;
        }
      })
    };
  }

  /**
   * Start native OS drag for local files
   */
  startDrag(event, filePaths, thumbnailPath) {
    try {
      console.log(`[FileExplorerHandler] Starting drag for ${filePaths.length} file(s):`, filePaths);

      // Verify all files exist
      for (const filePath of filePaths) {
        if (!fs.existsSync(filePath)) {
          console.error('[FileExplorerHandler] File not found:', filePath);
          return;
        }
      }

      // Try to create icon from thumbnail path, or use empty (Electron will use default)
      let icon = nativeImage.createEmpty();
      if (thumbnailPath && fs.existsSync(thumbnailPath)) {
        try {
          const loadedIcon = nativeImage.createFromPath(thumbnailPath);
          if (!loadedIcon.isEmpty()) {
            icon = loadedIcon.resize({ width: 64, height: 64 });
          }
        } catch (e) {
          console.log('[FileExplorerHandler] Could not load icon:', e.message);
        }
      }

      // Start the drag operation
      console.log('[FileExplorerHandler] Calling startDrag...');

      if (filePaths.length === 1) {
        event.sender.startDrag({
          file: filePaths[0],
          icon: icon
        });
      } else {
        event.sender.startDrag({
          files: filePaths,
          icon: icon
        });
      }

      console.log('[FileExplorerHandler] Drag initiated');

    } catch (error) {
      console.error('[FileExplorerHandler] startDrag error:', error);
    }
  }

  /**
   * Open folder picker dialog
   */
  async pickFolder() {
    try {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Folder to Browse'
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      return { success: true, folderPath: result.filePaths[0] };

    } catch (error) {
      console.error('[FileExplorerHandler] pickFolder error:', error);
      return { success: false, error: error.message };
    }
  }

  // ============ Helper Methods ============

  /**
   * Determine file type from extension
   */
  getFileType(ext) {
    ext = ext.toLowerCase();
    if (FILE_TYPES.video.includes(ext)) return 'video';
    if (FILE_TYPES.audio.includes(ext)) return 'audio';
    if (FILE_TYPES.image.includes(ext)) return 'image';
    return 'unknown';
  }

  /**
   * Format file size to human readable
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Format duration in seconds to mm:ss or hh:mm:ss
   */
  formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '--:--';

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Parse frame rate string (e.g., "30000/1001" or "30")
   */
  parseFrameRate(fpsString) {
    if (!fpsString) return null;
    if (fpsString.includes('/')) {
      const [num, den] = fpsString.split('/').map(Number);
      return den ? Math.round((num / den) * 100) / 100 : null;
    }
    return parseFloat(fpsString);
  }

  /**
   * Analyze audio waveform using FFmpeg
   * Extracts raw PCM samples and calculates peaks for visualization
   * @param {string} filePath - Path to audio file
   * @param {number} barCount - Number of bars to generate
   * @returns {Object} - { success, peaks, error }
   */
  async analyzeWaveform(filePath, barCount = 100) {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' };
      }

      const ffmpeg = require('fluent-ffmpeg');
      const { spawn } = require('child_process');
      const ffmpegPath = this.ffmpegHandler?.ffmpegPath || 'ffmpeg';

      console.log('[FileExplorerHandler] Analyzing waveform for:', filePath);

      return new Promise((resolve) => {
        // Use FFmpeg to extract raw 8-bit mono PCM samples at low sample rate
        // This gives us amplitude data we can use for peaks
        const args = [
          '-i', filePath,
          '-ac', '1',           // Mono
          '-ar', '1000',        // 1000 samples per second (enough for visualization)
          '-f', 's16le',        // Signed 16-bit little-endian
          '-acodec', 'pcm_s16le',
          '-'                   // Output to stdout
        ];

        const ffmpegProcess = spawn(ffmpegPath, args);
        const chunks = [];

        ffmpegProcess.stdout.on('data', (chunk) => {
          chunks.push(chunk);
        });

        ffmpegProcess.stderr.on('data', (data) => {
          // FFmpeg outputs info to stderr, we can ignore it
        });

        ffmpegProcess.on('close', (code) => {
          if (chunks.length === 0) {
            console.log('[FileExplorerHandler] No audio data extracted, using fallback');
            const fallbackPeaks = this.generateFallbackPeaks(barCount);
            resolve({ success: true, peaks: fallbackPeaks });
            return;
          }

          // Combine chunks into a single buffer
          const buffer = Buffer.concat(chunks);
          const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);

          if (samples.length === 0) {
            const fallbackPeaks = this.generateFallbackPeaks(barCount);
            resolve({ success: true, peaks: fallbackPeaks });
            return;
          }

          // Calculate peaks for each bar
          const samplesPerBar = Math.max(1, Math.floor(samples.length / barCount));
          const peaks = [];

          for (let i = 0; i < barCount; i++) {
            const start = i * samplesPerBar;
            const end = Math.min(start + samplesPerBar, samples.length);
            let maxAmp = 0;

            for (let j = start; j < end; j++) {
              const amp = Math.abs(samples[j]);
              if (amp > maxAmp) maxAmp = amp;
            }

            // Normalize to 0-1 (max int16 is 32767)
            peaks.push(maxAmp / 32767);
          }

          // Normalize peaks so the loudest is 1.0
          const maxPeak = Math.max(...peaks, 0.01);
          const normalizedPeaks = peaks.map(p => p / maxPeak);

          console.log('[FileExplorerHandler] Waveform analysis complete:', barCount, 'bars from', samples.length, 'samples');
          resolve({ success: true, peaks: normalizedPeaks });
        });

        ffmpegProcess.on('error', (err) => {
          console.error('[FileExplorerHandler] FFmpeg spawn error:', err.message);
          const fallbackPeaks = this.generateFallbackPeaks(barCount);
          resolve({ success: true, peaks: fallbackPeaks });
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          ffmpegProcess.kill();
        }, 10000);
      });
    } catch (err) {
      console.error('[FileExplorerHandler] Waveform analysis failed:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Generate fallback peaks when analysis fails
   */
  generateFallbackPeaks(barCount) {
    const peaks = [];
    for (let i = 0; i < barCount; i++) {
      // Create a wave-like pattern
      const position = i / barCount;
      const wave = Math.sin(position * Math.PI * 4) * 0.3;
      const noise = Math.random() * 0.4;
      peaks.push(0.3 + wave + noise);
    }
    return peaks;
  }
}

module.exports = FileExplorerHandler;
