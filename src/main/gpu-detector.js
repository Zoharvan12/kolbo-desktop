// Kolbo Studio - GPU Detection for Hardware Acceleration
// Detects available GPU and determines optimal FFmpeg encoder

const si = require('systeminformation');
const { execSync } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

class GPUDetector {
  constructor() {
    this.gpuInfo = null;
    this.availableEncoders = null;
    this.detectionComplete = false;
  }

  /**
   * Detect GPU hardware and available FFmpeg encoders
   * @returns {Promise<Object>} GPU information and available encoders
   */
  async detect() {
    if (this.detectionComplete) {
      return this.getResult();
    }

    console.log('[GPU Detector] Starting hardware detection...');

    try {
      // Get GPU information
      this.gpuInfo = await si.graphics();
      console.log('[GPU Detector] GPU Info:', JSON.stringify(this.gpuInfo.controllers, null, 2));

      // Get available FFmpeg encoders
      this.availableEncoders = await this.detectFFmpegEncoders();
      console.log('[GPU Detector] Available encoders:', this.availableEncoders);

      this.detectionComplete = true;
      return this.getResult();
    } catch (error) {
      console.error('[GPU Detector] Detection failed:', error.message);
      return this.getFallbackResult();
    }
  }

  /**
   * Check which hardware encoders are available in FFmpeg
   * @returns {Promise<Object>} Object with available encoder flags
   */
  async detectFFmpegEncoders() {
    const encoders = {
      nvenc: false,      // NVIDIA
      amf: false,        // AMD
      qsv: false,        // Intel QuickSync
      videotoolbox: false, // macOS
      vaapi: false       // Linux VA-API
    };

    try {
      // Run ffmpeg -encoders to get list of available encoders
      const output = execSync(`"${ffmpegPath}" -encoders -hide_banner`, {
        encoding: 'utf8',
        timeout: 5000
      });

      // Check for hardware encoder support
      if (output.includes('h264_nvenc') || output.includes('hevc_nvenc')) {
        encoders.nvenc = true;
        console.log('[GPU Detector] ✓ NVIDIA NVENC detected');
      }

      if (output.includes('h264_amf') || output.includes('hevc_amf')) {
        encoders.amf = true;
        console.log('[GPU Detector] ✓ AMD AMF detected');
      }

      if (output.includes('h264_qsv') || output.includes('hevc_qsv')) {
        encoders.qsv = true;
        console.log('[GPU Detector] ✓ Intel QuickSync detected');
      }

      if (output.includes('h264_videotoolbox') || output.includes('hevc_videotoolbox')) {
        encoders.videotoolbox = true;
        console.log('[GPU Detector] ✓ macOS VideoToolbox detected');
      }

      if (output.includes('h264_vaapi') || output.includes('hevc_vaapi')) {
        encoders.vaapi = true;
        console.log('[GPU Detector] ✓ VA-API detected');
      }

    } catch (error) {
      console.error('[GPU Detector] Failed to detect encoders:', error.message);
    }

    return encoders;
  }

  /**
   * Get the best available encoder for video encoding
   * @param {string} codec - Desired codec ('h264' or 'h265')
   * @returns {string} FFmpeg encoder name
   */
  getBestEncoder(codec = 'h264') {
    if (!this.detectionComplete) {
      console.warn('[GPU Detector] Detection not complete, using CPU fallback');
      return codec === 'h265' ? 'libx265' : 'libx264';
    }

    const prefix = codec === 'h265' ? 'hevc' : 'h264';

    // Priority: NVENC > AMF > QSV > VideoToolbox > VA-API > CPU
    if (this.availableEncoders.nvenc) {
      return `${prefix}_nvenc`;
    }

    if (this.availableEncoders.amf) {
      return `${prefix}_amf`;
    }

    if (this.availableEncoders.qsv) {
      return `${prefix}_qsv`;
    }

    if (this.availableEncoders.videotoolbox) {
      return `${prefix}_videotoolbox`;
    }

    if (this.availableEncoders.vaapi) {
      return `${prefix}_vaapi`;
    }

    // Fallback to CPU software encoding
    console.log('[GPU Detector] No hardware encoder available, using CPU');
    return codec === 'h265' ? 'libx265' : 'libx264';
  }

  /**
   * Check if hardware acceleration is available
   * @returns {boolean}
   */
  hasHardwareAcceleration() {
    if (!this.detectionComplete) return false;

    return this.availableEncoders.nvenc ||
           this.availableEncoders.amf ||
           this.availableEncoders.qsv ||
           this.availableEncoders.videotoolbox ||
           this.availableEncoders.vaapi;
  }

  /**
   * Get GPU vendor (NVIDIA, AMD, Intel, Apple)
   * @returns {string}
   */
  getGPUVendor() {
    if (!this.gpuInfo || !this.gpuInfo.controllers || this.gpuInfo.controllers.length === 0) {
      return 'Unknown';
    }

    const vendor = this.gpuInfo.controllers[0].vendor.toLowerCase();

    if (vendor.includes('nvidia')) return 'NVIDIA';
    if (vendor.includes('amd') || vendor.includes('ati')) return 'AMD';
    if (vendor.includes('intel')) return 'Intel';
    if (vendor.includes('apple')) return 'Apple';

    return vendor;
  }

  /**
   * Get GPU model name
   * @returns {string}
   */
  getGPUModel() {
    if (!this.gpuInfo || !this.gpuInfo.controllers || this.gpuInfo.controllers.length === 0) {
      return 'Unknown';
    }

    return this.gpuInfo.controllers[0].model || 'Unknown';
  }

  /**
   * Get detection result
   * @returns {Object}
   */
  getResult() {
    return {
      vendor: this.getGPUVendor(),
      model: this.getGPUModel(),
      hasHardwareAcceleration: this.hasHardwareAcceleration(),
      encoders: this.availableEncoders,
      bestH264Encoder: this.getBestEncoder('h264'),
      bestH265Encoder: this.getBestEncoder('h265')
    };
  }

  /**
   * Get fallback result if detection fails
   * @returns {Object}
   */
  getFallbackResult() {
    return {
      vendor: 'Unknown',
      model: 'Unknown',
      hasHardwareAcceleration: false,
      encoders: {
        nvenc: false,
        amf: false,
        qsv: false,
        videotoolbox: false,
        vaapi: false
      },
      bestH264Encoder: 'libx264',
      bestH265Encoder: 'libx265'
    };
  }
}

module.exports = GPUDetector;
