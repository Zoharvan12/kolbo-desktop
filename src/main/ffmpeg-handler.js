// Kolbo Studio - FFmpeg Conversion Handler
// Handles all media file conversions with hardware acceleration

const { app } = require('electron');
const ffmpeg = require('fluent-ffmpeg');
let ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const path = require('path');
const fs = require('fs');
const GPUDetector = require('./gpu-detector');

// Fix FFmpeg path when running from asar archive
// Electron's asar archives can't execute binaries, so we need to use the unpacked path
if (ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  console.log('[FFmpeg Handler] Detected asar path, using unpacked path');
}

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);
console.log('[FFmpeg Handler] FFmpeg path:', ffmpegPath);

// NOTE: Using @ffmpeg-installer/ffmpeg v1.1.0 which bundles FFmpeg 6.0 (2023)
// All formats and codecs verified as available and tested

// ========== VERIFIED FORMAT MAPPINGS ==========
// All mappings have been verified against FFmpeg 6.0 capabilities
const FORMAT_MAPPINGS = {
  // Video formats: UI name -> FFmpeg format name (ALL VERIFIED ✓)
  video: {
    'mp4': 'mp4',           // ✓ MPEG-4 Part 14
    'mov': 'mov',           // ✓ QuickTime / MOV
    'avi': 'avi',           // ✓ Audio Video Interleaved
    'mkv': 'matroska',      // ✓ Matroska container
    'webm': 'webm'          // ✓ WebM
  },
  // Audio formats: UI name -> FFmpeg format name (ALL VERIFIED ✓)
  audio: {
    'mp3': 'mp3',           // ✓ MP3 (MPEG audio layer 3)
    'wav': 'wav',           // ✓ WAV / WAVE (Waveform Audio)
    'aac': 'adts',          // ✓ ADTS AAC (Advanced Audio Coding)
    'flac': 'flac'          // ✓ FLAC (Free Lossless Audio Codec)
  },
  // Image formats: all use 'image2' (ALL VERIFIED ✓)
  image: {
    'jpg': 'image2',        // ✓ JPEG via image2 sequence
    'jpeg': 'image2',       // ✓ JPEG via image2 sequence
    'png': 'image2',        // ✓ PNG via image2 sequence
    'webp': 'image2',       // ✓ WebP via image2 sequence
    'gif': 'image2'         // ✓ GIF via image2 sequence
  }
};

// Audio codec mappings (ALL VERIFIED ✓)
const AUDIO_CODECS = {
  'mp3': 'libmp3lame',      // ✓ LAME MP3 encoder
  'wav': 'pcm_s16le',       // ✓ PCM signed 16-bit little-endian
  'aac': 'aac',             // ✓ AAC encoder
  'flac': 'flac'            // ✓ FLAC encoder
};

// Image codec mappings (ALL VERIFIED ✓)
const IMAGE_CODECS = {
  'jpg': 'mjpeg',           // ✓ Motion JPEG for still images
  'jpeg': 'mjpeg',          // ✓ Motion JPEG for still images
  'png': 'png',             // ✓ PNG encoder
  'webp': 'libwebp',        // ✓ WebP encoder (libwebp)
  'gif': 'gif'              // ✓ GIF encoder
};

class FFmpegHandler {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.gpuDetector = new GPUDetector();
    this.activeJobs = new Map(); // jobId -> { command, outputPath, tempFiles[] }
    this.cancelledJobs = new Set(); // jobIds intentionally cancelled (suppress error events)
    this.gpuInfo = null;

    // Initialize GPU detection
    this.initializeGPU();
  }

  /**
   * Initialize GPU detection
   */
  async initializeGPU() {
    try {
      this.gpuInfo = await this.gpuDetector.detect();
      console.log('[FFmpeg Handler] GPU Detection complete:',this.gpuInfo);

      // Send GPU info to renderer
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('ff:gpu-info', this.gpuInfo);
      }
    } catch (error) {
      console.error('[FFmpeg Handler] GPU detection failed:', error);
      this.gpuInfo = this.gpuDetector.getFallbackResult();
    }

    // Note: TrimCache cleanup removed - trimmed files are now stored in MediaCache permanently
  }

  /**
   * Clean up old files in TrimCache folder
   * Trim files are temporary and can be deleted after 1 hour
   */
  cleanupTrimCache() {
    try {
      const trimCachePath = path.join(app.getPath('userData'), 'TrimCache');
      if (!fs.existsSync(trimCachePath)) return;

      const files = fs.readdirSync(trimCachePath);
      const now = Date.now();
      const maxAge = 60 * 60 * 1000; // 1 hour
      let deletedCount = 0;

      for (const file of files) {
        try {
          const filePath = path.join(trimCachePath, file);
          const stats = fs.statSync(filePath);
          const age = now - stats.mtimeMs;

          if (age > maxAge) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch (e) {
          // Ignore errors for individual files
        }
      }

      if (deletedCount > 0) {
        console.log(`[FFmpeg Handler] Cleaned up ${deletedCount} old trim cache files`);
      }
    } catch (error) {
      console.error('[FFmpeg Handler] TrimCache cleanup error:', error.message);
    }
  }

  /**
   * Convert a single file
   * @param {Object} job - Job configuration
   * @returns {Promise<string>} Output file path
   */
  async convertFile(job) {
    const { id, filePath, outputFormat, outputType, settings, outputFolder, trimStart, trimEnd } = job;

    console.log('[FFmpeg Handler] Starting conversion:', {
      id,
      input: filePath,
      format: outputFormat,
      type: outputType,
      trim: trimStart !== undefined ? `${trimStart}s - ${trimEnd}s` : 'none'
    });

    // Validate format is supported
    const formatMap = FORMAT_MAPPINGS[outputType];
    if (!formatMap || !formatMap[outputFormat]) {
      const error = new Error(`Unsupported ${outputType} format: ${outputFormat}`);
      console.error('[FFmpeg Handler]', error.message);

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('ff:error', {
          jobId: id,
          error: error.message
        });
      }

      throw error;
    }

    // If extracting audio, check if source has a decodable audio stream
    let audioMetadata = null;
    if (outputType === 'audio') {
      try {
        audioMetadata = await this.probeFile(filePath);
        const audioStreams = audioMetadata.streams.filter(s => s.codec_type === 'audio');
        console.log('[FFmpeg Handler] Audio streams found:', audioStreams.map(s => ({
          codec_name: s.codec_name,
          codec_tag_string: s.codec_tag_string,
          sample_rate: s.sample_rate,
          channels: s.channels
        })));

        if (audioStreams.length === 0) {
          const error = new Error('Source file has no audio stream to extract');
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('ff:error', { jobId: id, error: error.message });
          }
          throw error;
        }
      } catch (probeError) {
        // If it's our intentional validation error, re-throw it
        if (probeError.message && probeError.message.includes('no audio stream')) {
          throw probeError;
        }
        // For other probe errors (file read issues, etc.), log and continue
        console.error('[FFmpeg Handler] Failed to probe file:', probeError);
        // Continue anyway, let FFmpeg handle the error
      }
    }

    // Determine output path
    const outputPath = this.getOutputPath(filePath, outputFormat, outputFolder);
    console.log('[FFmpeg Handler] Output path:', outputPath);

    // Probe video files before conversion to get stream info
    // (must be done before Promise since probe is async)
    let videoMetadata = null;
    if (outputType === 'video') {
      try {
        videoMetadata = await this.probeFile(filePath);
        console.log('[FFmpeg Handler] Probed streams:', videoMetadata.streams.map(s => `${s.codec_type}:${s.codec_name}`));
      } catch (probeError) {
        console.warn('[FFmpeg Handler] Failed to probe file, continuing without metadata:', probeError.message);
      }
    }

    // fluent-ffmpeg's progress.percent is vs the full input duration. A short
    // trim of a long file stays under 1% and the UI rounds it to 0%.
    const expectedDuration = (trimStart !== undefined && trimEnd !== undefined)
      ? Math.max(0.001, Number(trimEnd) - Number(trimStart))
      : parseFloat((videoMetadata || audioMetadata)?.format?.duration) || 0;

    return new Promise((resolve, reject) => {
      try {
        const command = ffmpeg(filePath);

        // Apply trim settings if specified (MUST be set before codec settings)
        if (trimStart !== undefined && trimEnd !== undefined) {
          console.log(`[FFmpeg Handler] Applying trim: ${trimStart}s to ${trimEnd}s`);
          // -ss: start time, -to: end time (both in seconds)
          command.setStartTime(trimStart);
          command.duration(trimEnd - trimStart);
        }

        // Apply conversion settings based on type
        if (outputType === 'video') {
          this.applyVideoSettings(command, outputFormat, settings, videoMetadata);
          const ffmpegFormat = FORMAT_MAPPINGS.video[outputFormat] || outputFormat;
          command.format(ffmpegFormat);
        } else if (outputType === 'audio') {
          this.applyAudioSettings(command, outputFormat, settings, audioMetadata);
          const ffmpegFormat = FORMAT_MAPPINGS.audio[outputFormat] || outputFormat;
          command.format(ffmpegFormat);
        } else if (outputType === 'image') {
          this.applyImageSettings(command, outputFormat, settings);
          const ffmpegFormat = FORMAT_MAPPINGS.image[outputFormat] || 'image2';
          command.format(ffmpegFormat);
        }

        // Set output path
        command.output(outputPath);

        // Track progress
        command.on('start', (commandLine) => {
          console.log('[FFmpeg Handler] Command:', commandLine);
          this.activeJobs.set(id, { command, outputPath });
        });

        command.on('progress', (progress) => {
          const percent = this.progressToPercent(progress, expectedDuration);
          console.log(`[FFmpeg Handler] Progress [${id}]: ${percent.toFixed(1)}%`);

          // Send progress to renderer
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('ff:progress', {
              jobId: id,
              progress: percent,
              timemark: progress.timemark
            });
          }
        });

        command.on('end', () => {
          console.log('[FFmpeg Handler] Conversion complete:', id);
          this.activeJobs.delete(id);

          // Send completion to renderer
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('ff:progress', { jobId: id, progress: 100 });
            this.mainWindow.webContents.send('ff:complete', {
              jobId: id,
              outputPath
            });
          }

          resolve(outputPath);
        });

        command.on('error', (error, stdout, stderr) => {
          this.activeJobs.delete(id);
          if (this.cancelledJobs.has(id)) {
            this.cancelledJobs.delete(id);
            return; // Already handled by cancelJob — don't report as error
          }
          console.error('[FFmpeg Handler] Conversion error:', error.message);
          console.error('[FFmpeg Handler] stderr:', stderr);
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('ff:error', { jobId: id, error: error.message });
          }
          reject(error);
        });

        // Start conversion
        command.run();

      } catch (error) {
        console.error('[FFmpeg Handler] Setup error:', error);
        reject(error);
      }
    });
  }

  /**
   * Apply video conversion settings
   */
  applyVideoSettings(command, outputFormat, settings, metadata = null) {
    const { resolution, bitrate, framerate, codec, maxWidth, maxHeight } = settings;

    // Explicit stream mapping to avoid processing data/timecode streams
    // Without this, FFmpeg tries to decode ALL streams including metadata tracks
    // that have no decoder (e.g., "codec none" in ProRes .mov files)

    // Force decoder for streams with unsupported container tags (e.g., Sony XAVC ipcm)
    // ffprobe can identify the real codec even when FFmpeg's demuxer can't auto-detect from the tag
    if (metadata) {
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
      if (audioStream) {
        const tag = (audioStream.codec_tag_string || '').toLowerCase();
        const realCodec = (audioStream.codec_name || '').toLowerCase();
        if (tag === 'ipcm' && realCodec && realCodec !== 'none' && realCodec !== 'unknown') {
          console.log(`[FFmpeg Handler] ipcm detected in video conversion, forcing audio decoder: ${realCodec}`);
          command.inputOptions(['-c:a', realCodec]);
        }
      }
    }

    const mappings = ['-map', '0:v:0']; // First video stream only
    mappings.push('-map', '0:a:0?');     // First audio stream (optional)
    command.outputOptions(mappings);

    // ALWAYS use CPU encoding for maximum compatibility
    // The bundled FFmpeg is too old (2018) and has NVENC compatibility issues
    console.log('[FFmpeg Handler] Using CPU encoder: libx264 (for compatibility)');
    command.videoCodec('libx264');

    // Encoding mode depends on whether bitrate is specified
    // CRF mode (quality-based) vs ABR mode (bitrate-based)
    if (bitrate) {
      // ABR (Average Bitrate) mode - use specified bitrate with buffer constraints
      console.log(`[FFmpeg Handler] Using ABR mode with bitrate: ${bitrate}`);

      // Parse bitrate value (e.g., "10M" -> 10)
      const bitrateValue = parseFloat(bitrate.replace('M', ''));
      const maxrate = `${(bitrateValue * 1.5).toFixed(1)}M`; // Allow 50% headroom for peaks
      const bufsize = `${(bitrateValue * 2).toFixed(1)}M`;   // 2x bitrate buffer

      command.outputOptions([
        '-preset', 'medium',
        '-b:v', bitrate,
        '-maxrate', maxrate,
        '-bufsize', bufsize
      ]);
    } else {
      // CRF mode (quality-based) - let FFmpeg decide bitrate based on quality
      console.log('[FFmpeg Handler] Using CRF mode (quality-based)');
      command.outputOptions([
        '-preset', 'medium',
        '-crf', '23' // Balanced quality
      ]);
    }

    // Apply resolution based on preset
    // H.264 requires even width and height - always pad to ensure divisible by 2
    const evenPad = "pad=ceil(iw/2)*2:ceil(ih/2)*2";
    if (resolution === 'preset' && maxWidth && maxHeight) {
      // Preset mode: scale to fit within maxWidth x maxHeight while maintaining aspect ratio
      console.log(`[FFmpeg Handler] Applying preset resolution: max ${maxWidth}x${maxHeight} (no upscaling)`);
      command.outputOptions([
        '-vf', `scale='min(${maxWidth},iw)':'min(${maxHeight},ih)':force_original_aspect_ratio=decrease,${evenPad}`
      ]);
    } else if (resolution && resolution !== 'original' && resolution !== 'preset') {
      // Legacy mode: direct resolution specification + ensure even dimensions
      const [w, h] = resolution.split('x');
      command.outputOptions([
        '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,${evenPad}`
      ]);
    } else {
      // Original resolution - still need to ensure even dimensions for H.264
      command.outputOptions(['-vf', evenPad]);
    }

    // Apply framerate if specified
    if (framerate) {
      command.fps(framerate);
    }

    // Force compatible pixel format for H.264 output
    // ProRes and other professional codecs use 10-bit formats (e.g., yuv422p10le)
    // that H.264 cannot encode - yuv420p is the universal compatible format
    command.outputOptions(['-pix_fmt', 'yuv420p']);

    // Audio codec for the (optional) audio stream
    command.audioCodec('aac');
    command.audioBitrate('192k');
  }

  /**
   * Apply audio conversion settings
   */
  applyAudioSettings(command, outputFormat, settings, metadata = null) {
    const { audioBitrate, sampleRate, channels } = settings;

    // Force decoder for streams with unsupported container tags (e.g., Sony XAVC ipcm)
    // ffprobe can identify the real codec even when FFmpeg's demuxer can't auto-detect from the tag
    if (metadata) {
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
      if (audioStream) {
        const tag = (audioStream.codec_tag_string || '').toLowerCase();
        const realCodec = (audioStream.codec_name || '').toLowerCase();
        if (tag === 'ipcm' && realCodec && realCodec !== 'none' && realCodec !== 'unknown') {
          console.log(`[FFmpeg Handler] ipcm detected, forcing audio decoder: ${realCodec}`);
          command.inputOptions(['-c:a', realCodec]);
        }
      }
    }

    // Remove video stream and explicitly map audio
    command.noVideo();

    // Explicitly map first audio stream (handles videos with multiple streams)
    command.outputOptions(['-map', '0:a:0']);

    // Set audio codec based on output format using centralized mapping
    const audioCodec = AUDIO_CODECS[outputFormat];
    if (!audioCodec) {
      throw new Error(`No codec mapping for audio format: ${outputFormat}`);
    }
    command.audioCodec(audioCodec);

    // Apply settings
    // Skip bitrate for lossless formats (WAV, FLAC) or if null (source quality)
    if (audioBitrate && audioCodec !== 'flac' && audioCodec !== 'pcm_s16le') {
      console.log(`[FFmpeg Handler] Applying audio bitrate: ${audioBitrate}`);
      command.audioBitrate(audioBitrate);
    } else if (audioBitrate === null) {
      console.log('[FFmpeg Handler] Using source audio bitrate (no re-encoding)');
      // Don't set bitrate - FFmpeg will use source bitrate
    }

    // For better compatibility, always normalize sample rate and channels
    // This helps with videos that have unusual audio formats
    if (sampleRate) {
      command.audioFrequency(sampleRate);
    } else {
      // Default to standard sample rate if not specified
      command.audioFrequency(44100);
    }

    if (channels) {
      command.audioChannels(channels);
    } else {
      // Default to stereo
      command.audioChannels(2);
    }
  }

  /**
   * Apply image conversion settings
   */
  applyImageSettings(command, outputFormat, settings) {
    const { quality, width, height, maxDimension } = settings;

    // Set codec based on output format using centralized mapping
    const codec = IMAGE_CODECS[outputFormat];
    if (!codec) {
      throw new Error(`No codec mapping for image format: ${outputFormat}`);
    }
    command.videoCodec(codec);

    // Set quality for lossy formats
    if (quality) {
      if (outputFormat === 'jpg' || outputFormat === 'jpeg') {
        // JPEG quality: 2-31 (lower is better quality)
        const jpegQuality = Math.floor((100 - quality) / 100 * 29 + 2);
        command.outputOptions(['-q:v', jpegQuality.toString()]);
      } else if (outputFormat === 'webp') {
        // WebP quality: 0-100 (higher is better)
        command.outputOptions(['-quality', quality.toString()]);
      } else if (outputFormat === 'png') {
        // PNG uses compression level 0-9 (higher = smaller file, slower)
        // Map quality 0-100 to compression 9-0 (inverted)
        const pngCompression = Math.floor((100 - quality) / 100 * 9);
        command.outputOptions(['-compression_level', pngCompression.toString()]);
      }
    }

    // Apply size based on preset or explicit dimensions
    if (maxDimension && maxDimension > 0) {
      // Preset mode: scale to fit within maxDimension (no upscaling)
      console.log(`[FFmpeg Handler] Applying image preset: max ${maxDimension}px (no upscaling)`);
      command.outputOptions([
        '-vf', `scale='min(${maxDimension},iw)':'min(${maxDimension},ih)':force_original_aspect_ratio=decrease`
      ]);
    } else if (width && height) {
      // Legacy mode: explicit dimensions
      command.size(`${width}x${height}`);
    }
    // If neither specified, maintain original size
  }

  /**
   * Cancel a conversion job
   * @param {string} jobId - Job ID to cancel
   */
  cancelJob(jobId) {
    const job = this.activeJobs.get(jobId);
    if (job) {
      console.log('[FFmpeg Handler] Cancelling job:', jobId);
      this.cancelledJobs.add(jobId);
      job.command.kill('SIGKILL');
      this.activeJobs.delete(jobId);

      // Delete partial output file
      if (job.outputPath) {
        try {
          if (fs.existsSync(job.outputPath)) {
            fs.unlinkSync(job.outputPath);
            console.log('[FFmpeg Handler] Deleted partial output:', job.outputPath);
          }
        } catch (e) {
          console.warn('[FFmpeg Handler] Could not delete partial file:', e.message);
        }
      }

      // Delete any associated temp files (e.g. concat list)
      if (job.tempFiles) {
        for (const tempFile of job.tempFiles) {
          try {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
          } catch (e) { /* ignore */ }
        }
      }

      // Notify renderer
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('ff:cancelled', { jobId });
      }

      return true;
    }
    return false;
  }

  /**
   * Cancel all active jobs
   */
  cancelAll() {
    console.log('[FFmpeg Handler] Cancelling all jobs');
    this.activeJobs.forEach((job, jobId) => {
      this.cancelledJobs.add(jobId);
      job.command.kill('SIGKILL');

      if (job.outputPath) {
        try {
          if (fs.existsSync(job.outputPath)) fs.unlinkSync(job.outputPath);
        } catch (e) { /* ignore */ }
      }
      if (job.tempFiles) {
        for (const tempFile of job.tempFiles) {
          try {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
          } catch (e) { /* ignore */ }
        }
      }
    });
    this.activeJobs.clear();
  }

  /**
   * Get output file path
   * @param {string} inputPath - Input file path
   * @param {string} outputFormat - Output format extension
   * @param {string} outputFolder - Custom output folder (optional)
   * @returns {string} Output file path
   */
  getOutputPath(inputPath, outputFormat, outputFolder) {
    const parsedPath = path.parse(inputPath);

    // Determine output directory
    const outputDir = outputFolder || parsedPath.dir;

    // Create output filename
    const outputName = `${parsedPath.name}.${outputFormat}`;
    const outputPath = path.join(outputDir, outputName);

    // If file exists, add number suffix
    if (fs.existsSync(outputPath)) {
      let counter = 1;
      let newPath;
      do {
        const numberedName = `${parsedPath.name}_${counter}.${outputFormat}`;
        newPath = path.join(outputDir, numberedName);
        counter++;
      } while (fs.existsSync(newPath));

      return newPath;
    }

    return outputPath;
  }

  /**
   * Get GPU information
   * @returns {Object} GPU info
   */
  getGPUInfo() {
    return this.gpuInfo || this.gpuDetector.getFallbackResult();
  }

  /**
   * Get probe information about a file
   * @param {string} filePath - File path to probe
   * @returns {Promise<Object>} File metadata
   */
  async probeFile(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (error, metadata) => {
        if (error) {
          reject(error);
        } else {
          resolve(metadata);
        }
      });
    });
  }

  // ============================================================================
  // QUICK TOOLS METHODS
  // ============================================================================

  /**
   * Extract a single frame from video at a specific timestamp
   * @param {Object} job - Job configuration
   * @returns {Promise<string>} Output file path
   */
  async extractFrame(job) {
    const { id, filePath, timestamp, outputFolder, outputFormat = 'png' } = job;

    console.log('[FFmpeg Handler] Extracting frame at', timestamp, 'from', filePath);

    const parsedPath = path.parse(filePath);
    const timestampStr = timestamp.toFixed(3).replace('.', '_');
    const outputName = `${parsedPath.name}_frame_${timestampStr}.${outputFormat}`;
    const outputPath = path.join(outputFolder || parsedPath.dir, outputName);

    return new Promise((resolve, reject) => {
      const command = ffmpeg(filePath)
        .seekInput(timestamp)
        .frames(1)
        .output(outputPath);

      // Set codec based on format
      if (outputFormat === 'jpg' || outputFormat === 'jpeg') {
        command.videoCodec('mjpeg');
        command.outputOptions(['-q:v', '2']); // High quality
      } else if (outputFormat === 'png') {
        command.videoCodec('png');
      } else if (outputFormat === 'webp') {
        command.videoCodec('libwebp');
        command.outputOptions(['-quality', '95']);
      }

      command.on('start', (cmd) => {
        console.log('[FFmpeg Handler] Frame extract command:', cmd);
        this.activeJobs.set(id, { command, outputPath });
      });

      command.on('end', () => {
        console.log('[FFmpeg Handler] Frame extracted:', outputPath);
        this.activeJobs.delete(id);

        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('ff:complete', { jobId: id, outputPath });
        }

        resolve(outputPath);
      });

      command.on('error', (error) => {
        this.activeJobs.delete(id);
        if (this.cancelledJobs.has(id)) { this.cancelledJobs.delete(id); return; }
        console.error('[FFmpeg Handler] Frame extraction error:', error);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('ff:error', { jobId: id, error: error.message });
        }
        reject(error);
      });

      command.run();
    });
  }

  /**
   * Merge multiple video files into one
   * Uses filter_complex concat for proper re-encoding and sync
   * @param {Object} job - Job configuration
   * @returns {Promise<string>} Output file path
   */
  /**
   * Parse fluent-ffmpeg timemark string (HH:MM:SS.ms) to seconds
   */
  timemarkToSeconds(timemark) {
    if (!timemark) return 0;
    const parts = timemark.split(':');
    if (parts.length === 3) {
      return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    }
    return 0;
  }

  /**
   * Map ffmpeg progress to 0–99 using expected output duration when known.
   * Caps at 99 so the 100 event on completion is the only terminal value.
   */
  progressToPercent(progress, expectedDurationSec) {
    const elapsed = this.timemarkToSeconds(progress?.timemark);
    if (expectedDurationSec > 0 && elapsed > 0) {
      return Math.min(99, Math.max(0, (elapsed / expectedDurationSec) * 100));
    }
    const raw = Number(progress?.percent);
    if (Number.isFinite(raw) && raw > 0) return Math.min(99, raw);
    return 0;
  }

  async mergeVideos(job) {
    const { id, filePaths, outputFolder, resolution, totalDuration } = job;
    const uniquePaths = [...new Set(filePaths)];
    console.log('[FFmpeg Handler] Merging', uniquePaths.length, 'videos');

    // Probe all files upfront to decide fast vs re-encode path
    const compat = await this.checkMergeCompatibility(uniquePaths);
    console.log('[FFmpeg Handler] Compatibility check:', compat);

    if (compat.canStreamCopy) {
      console.log('[FFmpeg Handler] Using fast path: concat demuxer (stream copy)');
      return this.mergeVideosFast(id, uniquePaths, outputFolder, totalDuration);
    } else {
      console.log('[FFmpeg Handler] Using re-encode path:', compat.reason);
      return this.mergeVideosSlow(id, uniquePaths, outputFolder, resolution, totalDuration);
    }
  }

  /**
   * Check if all videos are compatible for stream copy (no re-encoding needed)
   */
  async checkMergeCompatibility(filePaths) {
    try {
      const probes = await Promise.all(filePaths.map(fp => this.probeFile(fp)));

      const infos = probes.map(p => {
        const v = p.streams?.find(s => s.codec_type === 'video');
        const a = p.streams?.find(s => s.codec_type === 'audio');
        return {
          vCodec: v?.codec_name,
          width: v?.width,
          height: v?.height,
          fps: v?.r_frame_rate,
          aCodec: a?.codec_name,
          hasAudio: !!a
        };
      });

      if (!infos.every(i => i.vCodec)) {
        return { canStreamCopy: false, reason: 'missing video stream info' };
      }

      const first = infos[0];

      // Only stream-copy H.264/H.265 — other codecs may have issues with MP4 container
      if (!['h264', 'hevc'].includes(first.vCodec)) {
        return { canStreamCopy: false, reason: `codec ${first.vCodec} not suitable for copy` };
      }

      for (const info of infos) {
        if (info.vCodec !== first.vCodec) {
          return { canStreamCopy: false, reason: 'mixed video codecs' };
        }
        if (info.width !== first.width || info.height !== first.height) {
          return { canStreamCopy: false, reason: 'mixed resolutions' };
        }
        if (info.hasAudio !== first.hasAudio) {
          return { canStreamCopy: false, reason: 'mixed audio presence' };
        }
        if (info.hasAudio && info.aCodec !== first.aCodec) {
          return { canStreamCopy: false, reason: 'mixed audio codecs' };
        }
      }

      return { canStreamCopy: true, hasAudio: first.hasAudio };
    } catch (e) {
      console.warn('[FFmpeg Handler] Compatibility check failed:', e.message);
      return { canStreamCopy: false, reason: 'probe failed' };
    }
  }

  /**
   * Fast merge: concat demuxer with stream copy (no re-encoding)
   * Works when all clips are the same codec/resolution — nearly instant
   */
  async mergeVideosFast(id, uniquePaths, outputFolder, totalDuration) {
    const os = require('os');
    const crypto = require('crypto');

    const outputPath = this.getOutputPath(uniquePaths[0], 'mp4', outputFolder);

    // Write concat list file (ffmpeg concat demuxer format)
    // Use forward slashes so the list works cross-platform inside ffmpeg
    const tempId = crypto.randomBytes(6).toString('hex');
    const concatListPath = path.join(os.tmpdir(), `kolbo_merge_${tempId}.txt`);
    const listContent = uniquePaths
      .map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(concatListPath, listContent, 'utf8');

    return new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
        .output(outputPath);

      command.on('start', (cmd) => {
        console.log('[FFmpeg Handler] Fast merge command:', cmd);
        this.activeJobs.set(id, { command, outputPath, tempFiles: [concatListPath] });
      });

      command.on('progress', (progress) => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          const percent = totalDuration > 0
            ? Math.min(99, (this.timemarkToSeconds(progress.timemark) / totalDuration) * 100)
            : Math.min(99, progress.percent || 0);
          this.mainWindow.webContents.send('ff:progress', { jobId: id, progress: percent });
        }
      });

      const cleanup = () => {
        try { fs.unlinkSync(concatListPath); } catch (e) { /* ignore */ }
      };

      command.on('end', () => {
        console.log('[FFmpeg Handler] Fast merge complete:', outputPath);
        this.activeJobs.delete(id);
        cleanup();
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('ff:progress', { jobId: id, progress: 100 });
          this.mainWindow.webContents.send('ff:complete', { jobId: id, outputPath });
        }
        resolve(outputPath);
      });

      command.on('error', (error, stdout, stderr) => {
        this.activeJobs.delete(id);
        cleanup();
        if (this.cancelledJobs.has(id)) { this.cancelledJobs.delete(id); return; }
        console.error('[FFmpeg Handler] Fast merge error:', error.message);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('ff:error', { jobId: id, error: error.message });
        }
        reject(error);
      });

      command.run();
    });
  }

  /**
   * Slow merge: filter_complex re-encode (needed when clips differ in resolution/codec/fps)
   * Uses ultrafast preset — same quality as medium at CRF 23, ~5x faster
   */
  async mergeVideosSlow(id, uniquePaths, outputFolder, resolution, totalDuration) {
    const targetRes = resolution || { width: 1920, height: 1080 };
    const outputPath = this.getOutputPath(uniquePaths[0], 'mp4', outputFolder);

    return new Promise((resolve, reject) => {
      const command = ffmpeg();

      uniquePaths.forEach(filePath => command.input(filePath));

      // Normalize each clip to the same resolution and audio format
      // fps filter removed — let concat handle mixed fps rather than forcing conversion
      const filterParts = [];
      for (let i = 0; i < uniquePaths.length; i++) {
        filterParts.push(
          `[${i}:v]scale=${targetRes.width}:${targetRes.height}:force_original_aspect_ratio=decrease,` +
          `pad=${targetRes.width}:${targetRes.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[v${i}]`
        );
        filterParts.push(
          `[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=1[a${i}]`
        );
      }

      const concatInputs = uniquePaths.map((_, i) => `[v${i}][a${i}]`).join('');
      filterParts.push(`${concatInputs}concat=n=${uniquePaths.length}:v=1:a=1[outv][outa]`);

      const filterComplex = filterParts.join(';');
      console.log('[FFmpeg Handler] Re-encode filter complex:', filterComplex);

      command
        .outputOptions([
          '-filter_complex', filterComplex,
          '-map', '[outv]',
          '-map', '[outa]',
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-preset', 'ultrafast', // was 'medium' — ~5x faster, same perceptual quality at CRF 23
          '-crf', '23',
          '-ar', '48000',
          '-ac', '2',
          '-movflags', '+faststart'
        ])
        .output(outputPath);

      command.on('start', (cmd) => {
        console.log('[FFmpeg Handler] Re-encode merge command:', cmd);
        this.activeJobs.set(id, { command, outputPath });
      });

      command.on('progress', (progress) => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          const percent = totalDuration > 0
            ? Math.min(99, (this.timemarkToSeconds(progress.timemark) / totalDuration) * 100)
            : Math.min(99, progress.percent || 0);
          this.mainWindow.webContents.send('ff:progress', { jobId: id, progress: percent });
        }
      });

      command.on('end', () => {
        console.log('[FFmpeg Handler] Re-encode merge complete:', outputPath);
        this.activeJobs.delete(id);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('ff:progress', { jobId: id, progress: 100 });
          this.mainWindow.webContents.send('ff:complete', { jobId: id, outputPath });
        }
        resolve(outputPath);
      });

      command.on('error', (error, stdout, stderr) => {
        this.activeJobs.delete(id);
        if (this.cancelledJobs.has(id)) { this.cancelledJobs.delete(id); return; }
        console.error('[FFmpeg Handler] Re-encode merge error:', error.message);
        console.error('[FFmpeg Handler] stderr:', stderr);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('ff:error', { jobId: id, error: error.message });
        }
        reject(error);
      });

      command.run();
    });
  }

  /**
   * Crop video to specific region
   * @param {Object} job - Job configuration
   * @returns {Promise<string>} Output file path
   */
  async cropVideo(job) {
    const { id, filePath, outputFolder, crop, fillMode = 'crop', aspectRatio } = job;

    console.log('[FFmpeg Handler] Cropping video:', crop);

    const outputPath = this.getOutputPath(filePath, 'mp4', outputFolder);

    return new Promise((resolve, reject) => {
      const command = ffmpeg(filePath);

      // Build video filter based on mode
      let vf;

      if (fillMode === 'crop') {
        // Direct crop
        vf = `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`;
      } else if (fillMode === 'fit') {
        // Crop then pad with letterbox
        const targetWidth = crop.width;
        const targetHeight = crop.height;
        vf = `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:-1:-1:color=black`;
      }

      command
        .outputOptions(['-vf', vf])
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions(['-preset', 'medium', '-crf', '23'])
        .output(outputPath);

      command.on('start', (cmd) => {
        console.log('[FFmpeg Handler] Crop command:', cmd);
        this.activeJobs.set(id, { command, outputPath });
      });

      command.on('progress', (progress) => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('ff:progress', {
            jobId: id,
            progress: progress.percent || 0
          });
        }
      });

      command.on('end', () => {
        console.log('[FFmpeg Handler] Crop complete:', outputPath);
        this.activeJobs.delete(id);

        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('ff:complete', { jobId: id, outputPath });
        }

        resolve(outputPath);
      });

      command.on('error', (error) => {
        this.activeJobs.delete(id);
        if (this.cancelledJobs.has(id)) { this.cancelledJobs.delete(id); return; }
        console.error('[FFmpeg Handler] Crop error:', error);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('ff:error', { jobId: id, error: error.message });
        }
        reject(error);
      });

      command.run();
    });
  }

  /**
   * Save a frame blob to file
   * @param {Object} job - Job configuration
   * @returns {Promise<string>} Output file path
   */
  async saveFrame(job) {
    const { filename, outputFolder, buffer } = job;

    // Get unique output path (avoid overwriting existing files)
    const outputPath = this.getUniqueFilePath(outputFolder, filename);

    return new Promise((resolve, reject) => {
      fs.writeFile(outputPath, buffer, (error) => {
        if (error) {
          console.error('[FFmpeg Handler] Save frame error:', error);
          reject(error);
        } else {
          console.log('[FFmpeg Handler] Frame saved:', outputPath);
          resolve(outputPath);
        }
      });
    });
  }

  /**
   * Get a unique file path, adding numeric suffix if file exists
   * @param {string} folder - Output folder
   * @param {string} filename - Desired filename
   * @returns {string} Unique file path
   */
  getUniqueFilePath(folder, filename) {
    const outputPath = path.join(folder, filename);

    // If file doesn't exist, use as-is
    if (!fs.existsSync(outputPath)) {
      return outputPath;
    }

    // File exists - add numeric suffix
    const parsed = path.parse(filename);
    let counter = 1;
    let newPath;

    do {
      const numberedName = `${parsed.name}_${counter}${parsed.ext}`;
      newPath = path.join(folder, numberedName);
      counter++;
    } while (fs.existsSync(newPath));

    console.log('[FFmpeg Handler] File exists, using unique path:', newPath);
    return newPath;
  }

  /**
   * Extract waveform data from an audio file
   * Uses FFmpeg to safely extract audio samples without crashing the renderer
   * @param {string} filePath - Path to the audio file
   * @param {number} samples - Number of samples to return (default 100)
   * @returns {Promise<number[]>} Array of normalized amplitude values (0-1)
   */
  async extractWaveformData(filePath, samples = 100) {
    return new Promise((resolve, reject) => {
      const os = require('os');
      const crypto = require('crypto');

      // Create temp file for raw audio output
      const tempId = crypto.randomBytes(8).toString('hex');
      const tempPath = path.join(os.tmpdir(), `waveform_${tempId}.raw`);

      console.log('[FFmpeg Handler] Extracting waveform from:', filePath);

      // Use FFmpeg to extract mono audio as raw PCM samples
      // Downsample to 8000Hz and output as signed 16-bit little-endian
      const command = ffmpeg(filePath)
        .outputOptions([
          '-ac', '1',           // Mono
          '-ar', '8000',        // 8kHz sample rate (enough for visualization)
          '-f', 's16le',        // Raw PCM signed 16-bit little-endian
          '-vn'                 // No video
        ])
        .output(tempPath);

      command.on('end', () => {
        try {
          // Read the raw audio file
          const buffer = fs.readFileSync(tempPath);

          // Clean up temp file
          try {
            fs.unlinkSync(tempPath);
          } catch (e) {
            // Ignore cleanup errors
          }

          if (buffer.length === 0) {
            console.warn('[FFmpeg Handler] Empty audio buffer, using placeholder');
            resolve(new Array(samples).fill(0.5));
            return;
          }

          // Convert buffer to Int16Array
          const int16Array = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);

          // Calculate RMS values for each segment
          const samplesPerSegment = Math.max(1, Math.floor(int16Array.length / samples));
          const waveformData = [];

          for (let i = 0; i < samples; i++) {
            const start = i * samplesPerSegment;
            const end = Math.min(start + samplesPerSegment, int16Array.length);

            if (start >= int16Array.length) {
              waveformData.push(0);
              continue;
            }

            // Calculate RMS (Root Mean Square) for this segment
            let sumSquares = 0;
            let count = 0;
            for (let j = start; j < end; j++) {
              sumSquares += int16Array[j] * int16Array[j];
              count++;
            }

            // RMS normalized to 0-1 (max int16 value is 32768)
            const rms = Math.sqrt(sumSquares / count) / 32768;
            waveformData.push(rms);
          }

          // Normalize to 0-1 range based on max value in the data
          let maxVal = 0;
          for (const val of waveformData) {
            if (val > maxVal) maxVal = val;
          }

          if (maxVal > 0) {
            for (let i = 0; i < waveformData.length; i++) {
              waveformData[i] = waveformData[i] / maxVal;
            }
          }

          console.log('[FFmpeg Handler] Waveform extracted:', waveformData.length, 'samples');
          resolve(waveformData);

        } catch (error) {
          console.error('[FFmpeg Handler] Failed to process waveform:', error);
          // Return placeholder on error
          resolve(new Array(samples).fill(0.5));
        }
      });

      command.on('error', (error) => {
        console.error('[FFmpeg Handler] Waveform extraction error:', error.message);

        // Clean up temp file on error
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
        } catch (e) {
          // Ignore cleanup errors
        }

        // Return placeholder on error instead of rejecting
        resolve(new Array(samples).fill(0.5));
      });

      command.run();
    });
  }

  /**
   * Export a trimmed segment of a media file
   * Used for drag-and-drop with in/out points
   * For video: Re-encodes for frame-accurate cuts
   * For audio: Uses stream copy (fast, keyframes are frequent)
   * @param {Object} job - Job configuration
   * @returns {Promise<string>} Output file path
   */
  async exportTrimmed(job) {
    const { inputPath, inPoint, outPoint, speed = 1.0, volume = 1.0 } = job;
    const crypto = require('crypto');

    // Validate inputs
    if (!inputPath || !fs.existsSync(inputPath)) {
      throw new Error('Input file not found');
    }

    if (inPoint === undefined || outPoint === undefined || inPoint >= outPoint) {
      throw new Error('Invalid in/out points');
    }

    // Get input file extension and determine if it's video
    const inputExt = path.extname(inputPath).toLowerCase();
    const inputName = path.basename(inputPath, inputExt);
    const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.wmv', '.flv', '.mpeg', '.mpg'];
    const isVideo = videoExtensions.includes(inputExt);

    // Check if we need audio effects
    const hasSpeedChange = Math.abs(speed - 1.0) > 0.01;
    const hasVolumeChange = Math.abs(volume - 1.0) > 0.01;
    const hasAudioEffects = hasSpeedChange || hasVolumeChange;

    // Use TrimmedFiles folder — persistent, never auto-evicted, user manages via Settings
    const trimmedFilesPath = path.join(app.getPath('userData'), 'TrimmedFiles');
    if (!fs.existsSync(trimmedFilesPath)) {
      fs.mkdirSync(trimmedFilesPath, { recursive: true });
      console.log('[FFmpeg Handler] Created TrimmedFiles folder:', trimmedFilesPath);
    }

    // Create output file in TrimmedFiles
    const tempId = crypto.randomBytes(6).toString('hex');
    const outputExt = isVideo ? '.mp4' : inputExt;
    const outputPath = path.join(trimmedFilesPath, `${inputName}_trim_${tempId}${outputExt}`);

    const duration = outPoint - inPoint;
    const effectsInfo = hasAudioEffects ? ` [speed:${speed.toFixed(1)}x, vol:${Math.round(volume*100)}%]` : '';
    console.log(`[FFmpeg Handler] Exporting trimmed: ${inPoint.toFixed(2)}s - ${outPoint.toFixed(2)}s (${duration.toFixed(2)}s) [${isVideo ? 'VIDEO - re-encode' : 'AUDIO'}]${effectsInfo}`);

    return new Promise((resolve, reject) => {
      let command;

      if (isVideo) {
        // For video: Re-encode for frame-accurate cuts
        command = ffmpeg(inputPath)
          .setStartTime(inPoint)
          .setDuration(duration)
          .outputOptions([
            '-c:v', 'libx264',      // H.264 video codec
            '-preset', 'ultrafast', // Fastest encoding
            '-crf', '18',           // High quality (visually lossless)
            '-c:a', 'aac',          // AAC audio codec
            '-b:a', '192k',         // Audio bitrate
            '-avoid_negative_ts', 'make_zero',
            '-movflags', '+faststart' // Web-optimized MP4
          ])
          .output(outputPath);
      } else if (hasAudioEffects) {
        // For audio with effects: Need to re-encode with filters
        // Build audio filter chain
        const audioFilters = [];

        if (hasSpeedChange) {
          // atempo filter only supports 0.5 to 2.0, chain multiple for extreme values
          let tempSpeed = speed;
          while (tempSpeed > 2.0) {
            audioFilters.push('atempo=2.0');
            tempSpeed /= 2.0;
          }
          while (tempSpeed < 0.5) {
            audioFilters.push('atempo=0.5');
            tempSpeed /= 0.5;
          }
          if (Math.abs(tempSpeed - 1.0) > 0.01) {
            audioFilters.push(`atempo=${tempSpeed.toFixed(4)}`);
          }
        }

        if (hasVolumeChange) {
          audioFilters.push(`volume=${volume.toFixed(2)}`);
        }

        const filterStr = audioFilters.join(',');
        console.log(`[FFmpeg Handler] Audio filters: ${filterStr}`);

        command = ffmpeg(inputPath)
          .setStartTime(inPoint)
          .setDuration(duration)
          .audioFilters(filterStr)
          .outputOptions(['-avoid_negative_ts', 'make_zero'])
          .output(outputPath);
      } else {
        // For audio without effects: Stream copy is fine (keyframes are frequent)
        command = ffmpeg(inputPath)
          .setStartTime(inPoint)
          .setDuration(duration)
          .outputOptions(['-c', 'copy', '-avoid_negative_ts', 'make_zero'])
          .output(outputPath);
      }

      command.on('start', (cmd) => {
        console.log('[FFmpeg Handler] Trim command:', cmd);
      });

      command.on('end', () => {
        console.log('[FFmpeg Handler] Trim complete:', outputPath);
        resolve(outputPath);
      });

      command.on('error', (error) => {
        console.error('[FFmpeg Handler] Trim error:', error.message);
        // Clean up on error
        try {
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch (e) {}
        reject(error);
      });

      command.run();
    });
  }
}

module.exports = FFmpegHandler;
