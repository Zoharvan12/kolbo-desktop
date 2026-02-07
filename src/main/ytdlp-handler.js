// Kolbo Studio - yt-dlp Download Handler
// Handles video/audio downloads from YouTube, Instagram, Twitter, TikTok, and 1000+ sites

const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
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
  soundcloud: /soundcloud\.com/i,
  wikimedia: /(?:upload\.wikimedia\.org|commons\.wikimedia\.org)/i
};

// Direct media file extensions that can be downloaded directly
const DIRECT_MEDIA_EXTENSIONS = /\.(mp4|webm|mkv|avi|mov|flv|wmv|m4v|mp3|m4a|wav|ogg|flac|aac)$/i;

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
  [ERROR_TYPES.PRIVATE_CONTENT]: 'This content requires sign-in or is age-restricted',
  [ERROR_TYPES.UNAVAILABLE]: 'This content is no longer available',
  [ERROR_TYPES.FORMAT_UNAVAILABLE]: 'Requested quality not available, downloading best alternative',
  [ERROR_TYPES.NETWORK_ERROR]: 'Connection failed. Please check your internet',
  [ERROR_TYPES.UNKNOWN]: 'An unexpected error occurred'
};

// YouTube-specific options to bypass restrictions
const YOUTUBE_EXTRACTOR_ARGS = [
  '--extractor-args', 'youtube:player_client=android,web',
  '--no-check-certificates',
  '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

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

        // Check if yt-dlp needs update (check once per day)
        this.checkForUpdate();
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
   * Check for yt-dlp updates (runs in background, doesn't block)
   */
  async checkForUpdate() {
    try {
      const lastCheckPath = path.join(app.getPath('userData'), 'ytdlp-last-update-check');
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      // Check if we already checked today
      if (fs.existsSync(lastCheckPath)) {
        const lastCheck = parseInt(fs.readFileSync(lastCheckPath, 'utf8'), 10);
        if (now - lastCheck < oneDay) {
          return; // Already checked today
        }
      }

      // Update timestamp
      fs.writeFileSync(lastCheckPath, now.toString());

      console.log('[yt-dlp Handler] Checking for updates...');

      // Run yt-dlp --update in background
      const binaryPath = this.getBinaryPath();
      const { spawn } = require('child_process');

      const updateProcess = spawn(binaryPath, ['--update'], {
        detached: true,
        stdio: 'ignore'
      });

      updateProcess.unref();
      console.log('[yt-dlp Handler] Update check started in background');
    } catch (error) {
      console.warn('[yt-dlp Handler] Failed to check for updates:', error.message);
      // Non-critical, continue anyway
    }
  }

  /**
   * Force update yt-dlp
   */
  async forceUpdate() {
    try {
      console.log('[yt-dlp Handler] Forcing yt-dlp update...');
      const binaryPath = this.getBinaryPath();

      // Delete existing binary and re-download
      if (fs.existsSync(binaryPath)) {
        fs.unlinkSync(binaryPath);
      }

      await this.YTDlpWrap.downloadFromGithub(binaryPath);
      this.ytdlp = new this.YTDlpWrap(binaryPath);

      console.log('[yt-dlp Handler] yt-dlp updated successfully');
      return true;
    } catch (error) {
      console.error('[yt-dlp Handler] Failed to update yt-dlp:', error);
      return false;
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
   * Check if URL is a direct media file
   */
  isDirectMediaUrl(url) {
    return DIRECT_MEDIA_EXTENSIONS.test(url);
  }

  /**
   * Get file extension from direct URL
   */
  getExtensionFromUrl(url) {
    const match = url.match(DIRECT_MEDIA_EXTENSIONS);
    return match ? match[1].toLowerCase() : null;
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
    // YouTube-specific auth/age errors
    if (msg.includes('private') || msg.includes('sign in') || msg.includes('login') ||
        msg.includes('authentication') || msg.includes('age') || msg.includes('confirm your age') ||
        msg.includes('members only') || msg.includes('join this channel')) {
      return ERROR_TYPES.PRIVATE_CONTENT;
    }
    if (msg.includes('deleted') || msg.includes('removed') || msg.includes('unavailable') ||
        msg.includes('does not exist') || msg.includes('video is unavailable')) {
      return ERROR_TYPES.UNAVAILABLE;
    }
    if (msg.includes('format') || msg.includes('quality')) {
      return ERROR_TYPES.FORMAT_UNAVAILABLE;
    }
    if (msg.includes('network') || msg.includes('connection') || msg.includes('timeout') ||
        msg.includes('unable to download') || msg.includes('urlopen error') || msg.includes('getaddrinfo')) {
      return ERROR_TYPES.NETWORK_ERROR;
    }

    return ERROR_TYPES.UNKNOWN;
  }

  /**
   * Get detailed error message with hints
   */
  getDetailedErrorMessage(errorMessage, url) {
    const errorType = this.classifyError(errorMessage);
    let baseMessage = this.getErrorMessage(errorType);

    // Add YouTube-specific hints
    if (this.detectPlatform(url) === 'youtube') {
      if (errorType === ERROR_TYPES.UNKNOWN) {
        // If unknown error on YouTube, likely needs yt-dlp update
        if (errorMessage.includes('unable to extract') || errorMessage.includes('no video formats') ||
            errorMessage.includes('nsig') || errorMessage.includes('signature')) {
          return 'YouTube extraction failed. The app will auto-update shortly, please try again.';
        }
      }
    }

    return baseMessage;
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
    console.log('[yt-dlp Handler] Fetching info for:', url);

    // For direct media URLs, we can provide basic info without yt-dlp
    if (this.isDirectMediaUrl(url)) {
      console.log('[yt-dlp Handler] Direct media URL detected, providing basic info');
      return this.getDirectMediaInfo(url);
    }

    if (!this.initialized || !this.ytdlp) {
      await this.initialize();
      if (!this.initialized || !this.ytdlp) {
        throw new Error('yt-dlp is not initialized');
      }
    }

    const platform = this.detectPlatform(url);

    try {
      let info;

      // Use custom options for YouTube to bypass restrictions
      if (platform === 'youtube') {
        console.log('[yt-dlp Handler] Using YouTube-specific options');
        info = await this.getVideoInfoWithOptions(url, YOUTUBE_EXTRACTOR_ARGS);
      } else {
        info = await this.ytdlp.getVideoInfo(url);
      }

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
        platform: platform,
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
      const errorMessage = error.message || error.toString();
      const errorType = this.classifyError(errorMessage);

      // If extraction failed, trigger yt-dlp update in background
      if (platform === 'youtube' && errorType === ERROR_TYPES.UNKNOWN) {
        console.log('[yt-dlp Handler] YouTube extraction failed, triggering update...');
        this.forceUpdate().catch(() => {}); // Run in background
      }

      throw {
        type: errorType,
        message: this.getDetailedErrorMessage(errorMessage, url),
        originalError: errorMessage
      };
    }
  }

  /**
   * Get video info with custom options (for YouTube, etc.)
   */
  async getVideoInfoWithOptions(url, extraOptions = []) {
    // Ensure yt-dlp is initialized
    if (!this.initialized || !this.ytdlp) {
      await this.initialize();
      if (!this.initialized || !this.ytdlp) {
        throw new Error('yt-dlp is not available');
      }
    }

    return new Promise((resolve, reject) => {
      const options = [
        '--dump-json',
        '--no-playlist',
        ...extraOptions,
        url
      ];

      let stdout = '';
      let stderr = '';

      const process = this.ytdlp.exec(options)
        .on('stdout', (data) => {
          stdout += data;
        })
        .on('stderr', (data) => {
          stderr += data;
        })
        .on('error', (error) => {
          console.error('[yt-dlp Handler] getVideoInfo error:', stderr || error.message);
          reject(new Error(stderr || error.message));
        })
        .on('close', () => {
          try {
            if (stdout.trim()) {
              const info = JSON.parse(stdout);
              resolve(info);
            } else {
              reject(new Error(stderr || 'No output from yt-dlp'));
            }
          } catch (parseError) {
            console.error('[yt-dlp Handler] JSON parse error:', parseError);
            reject(new Error(stderr || 'Failed to parse video info'));
          }
        });
    });
  }

  /**
   * Get basic media info for direct URLs (without yt-dlp)
   */
  getDirectMediaInfo(url) {
    try {
      const parsedUrl = new URL(url);
      const pathname = parsedUrl.pathname;
      const filename = path.basename(pathname);
      const ext = this.getExtensionFromUrl(url);

      // Extract title from filename (remove extension)
      const title = filename.replace(DIRECT_MEDIA_EXTENSIONS, '') || 'Direct Media';

      // Determine if it's audio or video based on extension
      const audioExtensions = ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac'];
      const isAudio = audioExtensions.includes(ext);

      return {
        id: Buffer.from(url).toString('base64').substring(0, 16),
        title: decodeURIComponent(title.replace(/_/g, ' ')),
        description: 'Direct media file',
        thumbnail: null,
        duration: 0,
        uploader: parsedUrl.hostname,
        uploadDate: null,
        viewCount: 0,
        platform: this.detectPlatform(url),
        url: url,
        originalUrl: url,
        formats: {
          videoFormats: isAudio ? [] : [{
            formatId: 'direct',
            quality: 'Original',
            height: 0,
            ext: ext || 'mp4',
            filesize: null,
            hasAudio: true
          }],
          audioFormats: isAudio ? [{
            formatId: 'direct',
            quality: 'Original',
            bitrate: 0,
            ext: ext || 'mp3',
            filesize: null
          }] : []
        },
        isLive: false,
        isDirectUrl: true
      };
    } catch (error) {
      console.error('[yt-dlp Handler] Error parsing direct URL:', error);
      throw {
        type: ERROR_TYPES.INVALID_URL,
        message: this.getErrorMessage(ERROR_TYPES.INVALID_URL),
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
    const { id, url, outputFormat, quality, outputFolder, title } = job;

    console.log('[yt-dlp Handler] Starting download:', {
      id,
      url,
      format: outputFormat,
      quality,
      outputFolder
    });

    // Check if this is a direct media URL - try direct download first for efficiency
    if (this.isDirectMediaUrl(url)) {
      console.log('[yt-dlp Handler] Direct media URL detected, using direct download');
      try {
        return await this.downloadDirectUrl(job);
      } catch (directError) {
        console.warn('[yt-dlp Handler] Direct download failed, falling back to yt-dlp:', directError.message);
        // Fall through to yt-dlp
      }
    }

    // Try yt-dlp
    if (!this.initialized || !this.ytdlp) {
      await this.initialize();
      if (!this.initialized || !this.ytdlp) {
        // If yt-dlp not available and it's a direct URL, try direct download
        if (this.isDirectMediaUrl(url)) {
          return this.downloadDirectUrl(job);
        }
        throw new Error('yt-dlp is not initialized');
      }
    }

    // Build output template
    const sanitizedTitle = title ? title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100) : '%(title)s';
    const outputTemplate = path.join(
      outputFolder,
      `${sanitizedTitle}.%(ext)s`
    );

    // Build yt-dlp options
    const options = this.buildDownloadOptions(outputFormat, quality, outputTemplate);

    // Add platform-specific options (YouTube needs special handling)
    const platform = this.detectPlatform(url);
    if (platform === 'youtube') {
      options.push(...YOUTUBE_EXTRACTOR_ARGS);
    }

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
          .on('error', async (error) => {
            if (downloadState.aborted) return;

            console.error('[yt-dlp Handler] Download error:', error);
            this.activeDownloads.delete(id);

            const errorType = this.classifyError(error.message || error.toString());

            // If yt-dlp fails and it's a direct URL, try direct download as fallback
            if (this.isDirectMediaUrl(url)) {
              console.log('[yt-dlp Handler] yt-dlp failed, trying direct download fallback');
              try {
                const result = await this.downloadDirectUrl(job);
                resolve(result);
                return;
              } catch (directError) {
                console.error('[yt-dlp Handler] Direct download fallback also failed:', directError);
              }
            }

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
        '--remux-video', 'mp4',
        '--embed-metadata',
        '--no-keep-video'  // Remove separate video file after merge (prevents leftover m4a)
      );

      // Build format string based on quality
      // Prefer H.264 (avc1) video and AAC (mp4a) audio for Premiere Pro compatibility
      // Fallback chain: specific resolution with preferred codec -> specific resolution any codec -> best available
      // This ensures if requested resolution isn't available, we still get the best possible quality
      let formatString = 'bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo+bestaudio/best';

      if (quality === 'best' || quality === 'Best Available' || quality === 'Best Available (Auto)') {
        // Best available quality - prefer combined formats first, then merge
        formatString = 'best[vcodec^=avc1]/best/bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo+bestaudio';
      } else if (quality === '4k' || quality === '2160' || quality === '4K (2160p)') {
        // Try specific resolution, fall back to best available if not found
        formatString = 'bestvideo[height<=2160][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=2160]+bestaudio/best[height<=2160]/bestvideo+bestaudio/best';
      } else if (quality === '1080' || quality === '1080p') {
        formatString = 'bestvideo[height<=1080][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/bestvideo+bestaudio/best';
      } else if (quality === '720' || quality === '720p') {
        formatString = 'bestvideo[height<=720][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/bestvideo+bestaudio/best';
      } else if (quality === '480' || quality === '480p') {
        formatString = 'bestvideo[height<=480][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/bestvideo+bestaudio/best';
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
        // Handle yt-dlp process
        if (download.process && download.process.ytDlpProcess) {
          download.process.ytDlpProcess.kill('SIGKILL');
        }

        // Handle direct download (http request)
        if (download.request) {
          download.request.destroy();
        }
        if (download.file) {
          download.file.close();
        }
        // Clean up partial file from direct download
        if (download.outputPath && fs.existsSync(download.outputPath)) {
          fs.unlinkSync(download.outputPath);
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

  /**
   * Download a direct media URL (fallback for URLs yt-dlp can't handle)
   */
  downloadDirectUrl(job) {
    const { id, url, outputFolder, title, outputFormat } = job;

    console.log('[yt-dlp Handler] Attempting direct download:', url);

    return new Promise((resolve, reject) => {
      try {
        // Determine extension from URL or use specified format
        const urlExt = this.getExtensionFromUrl(url);
        const ext = outputFormat === 'mp3' ? 'mp3' : (urlExt || 'mp4');

        // Build output path
        const sanitizedTitle = title ? title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100) : 'download';
        const outputPath = path.join(outputFolder, `${sanitizedTitle}.${ext}`);

        // Create write stream
        const file = fs.createWriteStream(outputPath);
        const downloadState = { aborted: false };

        // Choose http or https based on URL
        const httpModule = url.startsWith('https') ? https : http;

        const request = httpModule.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        }, (response) => {
          // Handle redirects
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            file.close();
            fs.unlinkSync(outputPath);
            // Retry with new URL
            this.downloadDirectUrl({
              ...job,
              url: response.headers.location
            }).then(resolve).catch(reject);
            return;
          }

          if (response.statusCode !== 200) {
            file.close();
            fs.unlinkSync(outputPath);
            reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
            return;
          }

          const totalSize = parseInt(response.headers['content-length'], 10) || 0;
          let downloadedSize = 0;

          response.on('data', (chunk) => {
            if (downloadState.aborted) return;

            downloadedSize += chunk.length;
            const progress = totalSize > 0 ? (downloadedSize / totalSize) * 100 : 0;

            // Send progress
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('dl:progress', {
                jobId: id,
                progress: Math.round(progress),
                downloadedBytes: downloadedSize,
                totalBytes: totalSize
              });
            }
          });

          response.pipe(file);

          file.on('finish', () => {
            file.close();
            if (downloadState.aborted) {
              fs.unlinkSync(outputPath);
              return;
            }

            console.log('[yt-dlp Handler] Direct download complete:', outputPath);
            this.activeDownloads.delete(id);

            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('dl:complete', {
                jobId: id,
                outputPath: outputPath
              });
            }

            resolve(outputPath);
          });
        });

        request.on('error', (error) => {
          file.close();
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
          this.activeDownloads.delete(id);

          console.error('[yt-dlp Handler] Direct download error:', error);

          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('dl:error', {
              jobId: id,
              error: 'Failed to download file: ' + error.message,
              errorType: ERROR_TYPES.NETWORK_ERROR
            });
          }

          reject(error);
        });

        // Store reference for cancellation
        this.activeDownloads.set(id, {
          request: request,
          state: downloadState,
          file: file,
          outputPath: outputPath
        });

      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = YtdlpHandler;
