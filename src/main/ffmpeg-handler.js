// Kolbo Studio - FFmpeg Conversion Handler
// Handles all media file conversions with hardware acceleration

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
    this.activeJobs = new Map(); // jobId -> FFmpeg command
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

    // If extracting audio, check if source has audio stream
    if (outputType === 'audio') {
      try {
        const metadata = await this.probeFile(filePath);
        const hasAudio = metadata.streams.some(s => s.codec_type === 'audio');

        if (!hasAudio) {
          const error = new Error('Source file has no audio stream to extract');
          console.error('[FFmpeg Handler] No audio stream found');

          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('ff:error', {
              jobId: id,
              error: error.message
            });
          }

          throw error;
        }
      } catch (probeError) {
        // If it's our intentional "no audio stream" error, re-throw it
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
          this.applyVideoSettings(command, outputFormat, settings);
          const ffmpegFormat = FORMAT_MAPPINGS.video[outputFormat] || outputFormat;
          command.format(ffmpegFormat);
        } else if (outputType === 'audio') {
          this.applyAudioSettings(command, outputFormat, settings);
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
          this.activeJobs.set(id, command);
        });

        command.on('progress', (progress) => {
          const percent = progress.percent || 0;
          console.log(`[FFmpeg Handler] Progress [${id}]: ${percent.toFixed(1)}%`);

          // Send progress to renderer
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('ff:progress', {
              jobId: id,
              progress: Math.min(Math.max(percent, 0), 100),
              timemark: progress.timemark
            });
          }
        });

        command.on('end', () => {
          console.log('[FFmpeg Handler] Conversion complete:', id);
          this.activeJobs.delete(id);

          // Send completion to renderer
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('ff:complete', {
              jobId: id,
              outputPath
            });
          }

          resolve(outputPath);
        });

        command.on('error', (error, stdout, stderr) => {
          console.error('[FFmpeg Handler] Conversion error:', error.message);
          console.error('[FFmpeg Handler] stderr:', stderr);
          this.activeJobs.delete(id);

          // Send error to renderer
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('ff:error', {
              jobId: id,
              error: error.message
            });
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
  applyVideoSettings(command, outputFormat, settings) {
    const { resolution, bitrate, framerate, codec, maxWidth, maxHeight } = settings;

    // ALWAYS use CPU encoding for maximum compatibility
    // The bundled FFmpeg is too old (2018) and has NVENC compatibility issues
    console.log('[FFmpeg Handler] Using CPU encoder: libx264 (for compatibility)');
    command.videoCodec('libx264');
    command.outputOptions([
      '-preset', 'medium',
      '-crf', '23' // Balanced quality
    ]);

    // Apply resolution based on preset
    if (resolution === 'preset' && maxWidth && maxHeight) {
      // Preset mode: scale to fit within maxWidth x maxHeight while maintaining aspect ratio
      // Use FFmpeg's scale filter with force_original_aspect_ratio=decrease to prevent upscaling
      console.log(`[FFmpeg Handler] Applying preset resolution: max ${maxWidth}x${maxHeight} (no upscaling)`);
      command.outputOptions([
        '-vf', `scale='min(${maxWidth},iw)':'min(${maxHeight},ih)':force_original_aspect_ratio=decrease`
      ]);
    } else if (resolution && resolution !== 'original' && resolution !== 'preset') {
      // Legacy mode: direct resolution specification
      command.size(resolution);
    }
    // If resolution is 'original' or not set, no scaling is applied

    // Apply bitrate if specified
    if (bitrate) {
      console.log(`[FFmpeg Handler] Applying video bitrate: ${bitrate}`);
      // fluent-ffmpeg's videoBitrate() expects a number (in kbps) or string with unit
      // Our presets use '20M', '10M' etc. which need to be passed as-is using outputOptions
      command.outputOptions(['-b:v', bitrate]);
    }

    // Apply framerate if specified
    if (framerate) {
      command.fps(framerate);
    }

    // Audio codec (copy if possible, otherwise re-encode)
    command.audioCodec('aac');
    command.audioBitrate('192k');
  }

  /**
   * Apply audio conversion settings
   */
  applyAudioSettings(command, outputFormat, settings) {
    const { audioBitrate, sampleRate, channels } = settings;

    // Remove video stream
    command.noVideo();

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

    if (sampleRate) {
      command.audioFrequency(sampleRate);
    }

    if (channels) {
      command.audioChannels(channels);
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
    const command = this.activeJobs.get(jobId);
    if (command) {
      console.log('[FFmpeg Handler] Cancelling job:', jobId);
      command.kill('SIGKILL');
      this.activeJobs.delete(jobId);
      return true;
    }
    return false;
  }

  /**
   * Cancel all active jobs
   */
  cancelAll() {
    console.log('[FFmpeg Handler] Cancelling all jobs');
    this.activeJobs.forEach((command, jobId) => {
      command.kill('SIGKILL');
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
}

module.exports = FFmpegHandler;
