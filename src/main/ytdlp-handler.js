// Kolbo Studio - yt-dlp Download Handler
// Handles video/audio downloads from YouTube, Instagram, Twitter, TikTok, and 1000+ sites

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Platform detection mappings
const PLATFORM_PATTERNS = {
  youtube: /(?:youtube\.com|youtu\.be)/i,
  instagram: /instagram\.com/i,
  twitter: /(?:twitter\.com|x\.com)/i,
  tiktok: /tiktok\.com/i,
  facebook: /facebook\.com/i,
  linkedin: /linkedin\.com/i,
  vimeo: /vimeo\.com/i,
  twitch: /twitch\.tv/i,
  dailymotion: /dailymotion\.com/i,
  soundcloud: /soundcloud\.com/i
};

// Error classification
const ERROR_TYPES = {
  INVALID_URL: 'invalid_url',
  GEO_RESTRICTED: 'geo_restricted',
  PRIVATE_CONTENT: 'private_content',
  UNAVAILABLE: 'unavailable',
  FORMAT_UNAVAILABLE: 'format_unavailable',
  NETWORK_ERROR: 'network_error',
  UNKNOWN: 'unknown'
};

// User-friendly error messages
const ERROR_MESSAGES = {
  [ERROR_TYPES.INVALID_URL]: 'Please enter a valid video URL',
  [ERROR_TYPES.GEO_RESTRICTED]: 'This content is not available in your region',
  [ERROR_TYPES.PRIVATE_CONTENT]: 'This content requires authentication (not supported)',
  [ERROR_TYPES.UNAVAILABLE]: 'This content is no longer available',
  [ERROR_TYPES.FORMAT_UNAVAILABLE]: 'Requested quality not available, downloading best alternative',
  [ERROR_TYPES.NETWORK_ERROR]: 'Connection failed. Please check your internet',
  [ERROR_TYPES.UNKNOWN]: 'An unexpected error occurred'
};

class YtdlpHandler {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.activeDownloads = new Map(); // id -> { process, aborted }
    this.YTDlpWrap = null;
    this.ytdlp = null;
    this.initialized = false;

    // Initialize yt-dlp
    this.initialize();
  }

  /**
   * Initialize yt-dlp binary
   */
  async initialize() {
    try {
      const YTDlpWrap = require('yt-dlp-wrap').default;
      this.YTDlpWrap = YTDlpWrap;

      // Get binary path - prefer bundled, fallback to download
      const binaryPath = this.getBinaryPath();

      if (fs.existsSync(binaryPath)) {
        console.log('[yt-dlp Handler] Using existing binary:', binaryPath);
        this.ytdlp = new YTDlpWrap(binaryPath);
      } else {
        console.log('[yt-dlp Handler] Binary not found, downloading...');
        await YTDlpWrap.downloadFromGithub(binaryPath);
        console.log('[yt-dlp Handler] Binary downloaded to:', binaryPath);
        this.ytdlp = new YTDlpWrap(binaryPath);
      }

      this.initialized = true;
      console.log('[yt-dlp Handler] Initialized successfully');
    } catch (error) {
      console.error('[yt-dlp Handler] Initialization failed:', error);
      this.initialized = false;
    }
  }

  /**
   * Get yt-dlp binary path
   */
  getBinaryPath() {
    const isWin = process.platform === 'win32';
    const binaryName = isWin ? 'yt-dlp.exe' : 'yt-dlp';

    // Store in app's user data directory
    const userDataPath = app.getPath('userData');
    const binariesPath = path.join(userDataPath, 'binaries');

    // Ensure directory exists
    if (!fs.existsSync(binariesPath)) {
      fs.mkdirSync(binariesPath, { recursive: true });
    }

    return path.join(binariesPath, binaryName);
  }

  /**
   * Detect platform from URL
   */
  detectPlatform(url) {
    for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
      if (pattern.test(url)) {
        return platform;
      }
    }
    return 'other';
  }

  /**
   * Classify error type from yt-dlp error message
   */
  classifyError(errorMessage) {
    const msg = errorMessage.toLowerCase();

    if (msg.includes('is not a valid url') || msg.includes('unsupported url')) {
      return ERROR_TYPES.INVALID_URL;
    }
    if (msg.includes('geo') || msg.includes('not available in your country') || msg.includes('blocked')) {
      return ERROR_TYPES.GEO_RESTRICTED;
    }
    if (msg.includes('private') || msg.includes('sign in') || msg.includes('login') || msg.includes('authentication')) {
      return ERROR_TYPES.PRIVATE_CONTENT;
    }
    if (msg.includes('deleted') || msg.includes('removed') || msg.includes('unavailable') || msg.includes('does not exist')) {
      return ERROR_TYPES.UNAVAILABLE;
    }
    if (msg.includes('format') || msg.includes('quality')) {
      return ERROR_TYPES.FORMAT_UNAVAILABLE;
    }
    if (msg.includes('network') || msg.includes('connection') || msg.includes('timeout') || msg.includes('unable to download')) {
      return ERROR_TYPES.NETWORK_ERROR;
    }

    return ERROR_TYPES.UNKNOWN;
  }

  /**
   * Get user-friendly error message
   */
  getErrorMessage(errorType) {
    return ERROR_MESSAGES[errorType] || ERROR_MESSAGES[ERROR_TYPES.UNKNOWN];
  }

  /**
   * Fetch media information from URL
   */
  async getMediaInfo(url) {
    if (!this.initialized) {
      await this.initialize();
      if (!this.initialized) {
        throw new Error('yt-dlp is not initialized');
      }
    }

    console.log('[yt-dlp Handler] Fetching info for:', url);

    try {
      const info = await this.ytdlp.getVideoInfo(url);

      // Parse available formats
      const formats = this.parseFormats(info.formats || []);

      const mediaInfo = {
        id: info.id,
        title: info.title || 'Untitled',
        description: info.description || '',
        thumbnail: info.thumbnail || this.getBestThumbnail(info.thumbnails),
        duration: info.duration || 0,
        uploader: info.uploader || info.channel || 'Unknown',
        uploadDate: info.upload_date || null,
        viewCount: info.view_count || 0,
        platform: this.detectPlatform(url),
        url: url,
        originalUrl: info.original_url || url,
        formats: formats,
        isLive: info.is_live || false
      };

      console.log('[yt-dlp Handler] Media info fetched:', {
        title: mediaInfo.title,
        duration: mediaInfo.duration,
        platform: mediaInfo.platform,
        formatsCount: formats.videoFormats.length + formats.audioFormats.length
      });

      return mediaInfo;
    } catch (error) {
      console.error('[yt-dlp Handler] Failed to fetch info:', error);
      const errorType = this.classifyError(error.message || error.toString());
      throw {
        type: errorType,
        message: this.getErrorMessage(errorType),
        originalError: error.message
      };
    }
  }

  /**
   * Get best thumbnail from thumbnails array
   */
  getBestThumbnail(thumbnails) {
    if (!thumbnails || !thumbnails.length) return null;

    // Sort by preference (maxres > high > medium > default)
    const sorted = thumbnails.sort((a, b) => {
      const aSize = (a.width || 0) * (a.height || 0);
      const bSize = (b.width || 0) * (b.height || 0);
      return bSize - aSize;
    });

    return sorted[0]?.url || null;
  }

  /**
   * Parse available formats from yt-dlp
   */
  parseFormats(formats) {
    const videoFormats = [];
    const audioFormats = [];

    const seenVideoQualities = new Set();
    const seenAudioQualities = new Set();

    for (const format of formats) {
      // Skip formats without proper codec info
      if (!format.vcodec && !format.acodec) continue;

      const hasVideo = format.vcodec && format.vcodec !== 'none';
      const hasAudio = format.acodec && format.acodec !== 'none';

      if (hasVideo) {
        const height = format.height || 0;
        const quality = this.getVideoQualityLabel(height);

        // Only add unique quality levels
        if (quality && !seenVideoQualities.has(quality)) {
          seenVideoQualities.add(quality);
          videoFormats.push({
            formatId: format.format_id,
            quality: quality,
            height: height,
            ext: format.ext || 'mp4',
            filesize: format.filesize || format.filesize_approx || null,
            hasAudio: hasAudio
          });
        }
      }

      if (hasAudio && !hasVideo) {
        const abr = format.abr || format.tbr || 0;
        const quality = this.getAudioQualityLabel(abr);

        if (quality && !seenAudioQualities.has(quality)) {
          seenAudioQualities.add(quality);
          audioFormats.push({
            formatId: format.format_id,
            quality: quality,
            bitrate: abr,
            ext: format.ext || 'mp3',
            filesize: format.filesize || format.filesize_approx || null
          });
        }
      }
    }

    // Sort by quality (highest first)
    videoFormats.sort((a, b) => b.height - a.height);
    audioFormats.sort((a, b) => b.bitrate - a.bitrate);

    return {
      videoFormats,
      audioFormats
    };
  }

  /**
   * Get video quality label
   */
  getVideoQualityLabel(height) {
    if (height >= 2160) return '4K (2160p)';
    if (height >= 1440) return '1440p';
    if (height >= 1080) return '1080p';
    if (height >= 720) return '720p';
    if (height >= 480) return '480p';
    if (height >= 360) return '360p';
    if (height > 0) return `${height}p`;
    return null;
  }

  /**
   * Get audio quality label
   */
  getAudioQualityLabel(bitrate) {
    if (bitrate >= 256) return 'High (320kbps)';
    if (bitrate >= 160) return 'Standard (192kbps)';
    if (bitrate >= 96) return 'Low (128kbps)';
    if (bitrate > 0) return `${Math.round(bitrate)}kbps`;
    return null;
  }

  /**
   * Download media
   */
  async downloadMedia(job) {
    if (!this.initialized) {
      await this.initialize();
      if (!this.initialized) {
        throw new Error('yt-dlp is not initialized');
      }
    }

    const { id, url, outputFormat, quality, outputFolder, title } = job;

    console.log('[yt-dlp Handler] Starting download:', {
      id,
      url,
      format: outputFormat,
      quality,
      outputFolder
    });

    // Build output template
    const sanitizedTitle = title ? title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100) : '%(title)s';
    const outputTemplate = path.join(
      outputFolder,
      `${sanitizedTitle}.%(ext)s`
    );

    // Build yt-dlp options
    const options = this.buildDownloadOptions(outputFormat, quality, outputTemplate);

    return new Promise((resolve, reject) => {
      try {
        // Track the download
        const downloadState = { aborted: false };

        const downloadProcess = this.ytdlp.exec([url, ...options])
          .on('progress', (progress) => {
            if (downloadState.aborted) return;

            console.log(`[yt-dlp Handler] Progress [${id}]: ${progress.percent}%`);

            // Send progress to renderer
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('dl:progress', {
                jobId: id,
                progress: progress.percent || 0,
                downloadedBytes: this.parseSize(progress.totalSize),
                speed: progress.currentSpeed || null,
                eta: progress.eta || null
              });
            }
          })
          .on('ytDlpEvent', (eventType, eventData) => {
            console.log(`[yt-dlp Handler] Event [${id}]:`, eventType, eventData);
          })
          .on('error', (error) => {
            if (downloadState.aborted) return;

            console.error('[yt-dlp Handler] Download error:', error);
            this.activeDownloads.delete(id);

            const errorType = this.classifyError(error.message || error.toString());

            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('dl:error', {
                jobId: id,
                error: this.getErrorMessage(errorType),
                errorType: errorType
              });
            }

            reject({
              type: errorType,
              message: this.getErrorMessage(errorType),
              originalError: error.message
            });
          })
          .on('close', () => {
            if (downloadState.aborted) return;

            console.log('[yt-dlp Handler] Download complete:', id);
            this.activeDownloads.delete(id);

            // Find the actual output file
            const outputPath = this.findOutputFile(outputFolder, sanitizedTitle, outputFormat);

            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('dl:complete', {
                jobId: id,
                outputPath: outputPath
              });
            }

            resolve(outputPath);
          });

        // Store reference for cancellation
        this.activeDownloads.set(id, {
          process: downloadProcess,
          state: downloadState
        });

      } catch (error) {
        console.error('[yt-dlp Handler] Setup error:', error);
        reject(error);
      }
    });
  }

  /**
   * Build download options based on format and quality
   */
  buildDownloadOptions(outputFormat, quality, outputTemplate) {
    const options = [
      '-o', outputTemplate,
      '--no-playlist',
      '--no-mtime',
      '--progress'
    ];

    if (outputFormat === 'mp3') {
      // Audio extraction
      options.push(
        '-x',  // Extract audio
        '--audio-format', 'mp3'
      );

      // Set audio quality based on selection
      if (quality === 'high' || quality === '320') {
        options.push('--audio-quality', '0'); // Best quality
      } else if (quality === 'standard' || quality === '192') {
        options.push('--audio-quality', '5'); // Medium quality
      } else if (quality === 'low' || quality === '128') {
        options.push('--audio-quality', '9'); // Lower quality
      } else {
        options.push('--audio-quality', '0'); // Default to best
      }
    } else {
      // Video download
      options.push(
        '--merge-output-format', 'mp4',
        '--remux-video', 'mp4'
      );

      // Build format string based on quality
      // Prefer H.264 (avc1) video and AAC (mp4a) audio for Premiere Pro compatibility
      // Fallback to any codec if H.264/AAC not available
      let formatString = 'bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo+bestaudio/best';

      if (quality === 'best' || quality === 'Best Available') {
        formatString = 'bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo+bestaudio/best';
      } else if (quality === '4k' || quality === '2160' || quality === '4K (2160p)') {
        formatString = 'bestvideo[height<=2160][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=2160]+bestaudio/best[height<=2160]';
      } else if (quality === '1080' || quality === '1080p') {
        formatString = 'bestvideo[height<=1080][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]';
      } else if (quality === '720' || quality === '720p') {
        formatString = 'bestvideo[height<=720][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=720]+bestaudio/best[height<=720]';
      } else if (quality === '480' || quality === '480p') {
        formatString = 'bestvideo[height<=480][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=480]+bestaudio/best[height<=480]';
      }

      options.push('-f', formatString);
    }

    return options;
  }

  /**
   * Parse size string to bytes
   */
  parseSize(sizeStr) {
    if (!sizeStr) return null;
    if (typeof sizeStr === 'number') return sizeStr;

    const match = sizeStr.match(/^([\d.]+)\s*(KiB|MiB|GiB|B)?$/i);
    if (!match) return null;

    const value = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();

    switch (unit) {
      case 'GIB': return value * 1024 * 1024 * 1024;
      case 'MIB': return value * 1024 * 1024;
      case 'KIB': return value * 1024;
      default: return value;
    }
  }

  /**
   * Find the actual output file after download
   */
  findOutputFile(folder, baseName, format) {
    const ext = format === 'mp3' ? 'mp3' : 'mp4';
    const expectedPath = path.join(folder, `${baseName}.${ext}`);

    if (fs.existsSync(expectedPath)) {
      return expectedPath;
    }

    // Try to find matching file
    try {
      const files = fs.readdirSync(folder);
      const matching = files.find(f =>
        f.startsWith(baseName.substring(0, 50)) && f.endsWith(`.${ext}`)
      );
      if (matching) {
        return path.join(folder, matching);
      }
    } catch (error) {
      console.error('[yt-dlp Handler] Error finding output file:', error);
    }

    return expectedPath; // Return expected path even if not found
  }

  /**
   * Cancel a download
   */
  cancelDownload(id) {
    const download = this.activeDownloads.get(id);
    if (download) {
      console.log('[yt-dlp Handler] Cancelling download:', id);
      download.state.aborted = true;

      try {
        if (download.process && download.process.ytDlpProcess) {
          download.process.ytDlpProcess.kill('SIGKILL');
        }
      } catch (error) {
        console.error('[yt-dlp Handler] Error killing process:', error);
      }

      this.activeDownloads.delete(id);

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('dl:cancelled', { jobId: id });
      }

      return true;
    }
    return false;
  }

  /**
   * Cancel all active downloads
   */
  cancelAll() {
    console.log('[yt-dlp Handler] Cancelling all downloads');

    const ids = Array.from(this.activeDownloads.keys());
    ids.forEach(id => this.cancelDownload(id));

    return ids.length;
  }

  /**
   * Get list of active downloads
   */
  getActiveDownloads() {
    return Array.from(this.activeDownloads.keys());
  }
}

module.exports = YtdlpHandler;
