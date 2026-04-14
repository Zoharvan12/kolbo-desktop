// Kolbo Studio - Quick Tools: Audio Extractor Tool
// Extract audio track from video files

console.log('[ExtractorTool] Loading...');

class ExtractorTool {
  constructor(manager) {
    this.manager = manager;
    this.file = null;
    this.fileUrl = null;
    this.metadata = null;
    this.isProcessing = false;

    // Settings
    this.outputFormat = 'mp3';
    this.quality = '320k';

    // DOM references
    this.dropzone = document.getElementById('qt-extractor-dropzone');
    this.workspace = document.getElementById('qt-extractor-workspace');

    this.init();
  }

  init() {
    console.log('[ExtractorTool] Initialized');
  }

  /**
   * Load a video file
   */
  async loadFile(file) {
    console.log('[ExtractorTool] Loading file:', file.name);

    // Clean up previous
    this.cleanup();

    this.file = file;
    this.fileUrl = URL.createObjectURL(file);

    // Probe file for metadata
    try {
      this.metadata = await window.kolboDesktop.ffmpeg.probeFile(file.path);
      console.log('[ExtractorTool] File metadata:', this.metadata);

      // Check if file has audio - be lenient, only block if we're SURE there's no audio
      if (this.metadata && this.metadata.streams && Array.isArray(this.metadata.streams)) {
        const hasAudio = this.metadata.streams.some(s =>
          s.codec_type === 'audio' ||
          (s.codec_name && s.codec_name.includes('aac')) ||
          (s.codec_name && s.codec_name.includes('mp3')) ||
          (s.codec_name && s.codec_name.includes('opus'))
        );
        if (!hasAudio && this.metadata.streams.length > 0) {
          // Only show warning if we have video streams but no audio
          const hasVideo = this.metadata.streams.some(s => s.codec_type === 'video');
          if (hasVideo) {
            console.warn('[ExtractorTool] No audio stream detected, but will try extraction anyway');
          }
        }
      }
    } catch (error) {
      console.error('[ExtractorTool] Failed to probe file:', error);
      // Continue anyway, FFmpeg will handle it - don't block the user
      this.metadata = null;
    }

    // Hide dropzone, show workspace
    this.dropzone.classList.add('hidden');
    this.workspace.classList.remove('hidden');

    // Render the workspace
    this.renderWorkspace();
  }

  /**
   * Get audio stream info from metadata
   */
  getAudioInfo() {
    if (!this.metadata || !this.metadata.streams) {
      return { codec: 'Unknown', channels: 2, sampleRate: 44100, bitrate: 'Unknown' };
    }

    const audioStream = this.metadata.streams.find(s => s.codec_type === 'audio');
    if (!audioStream) {
      return { codec: 'Unknown', channels: 2, sampleRate: 44100, bitrate: 'Unknown' };
    }

    return {
      codec: audioStream.codec_name?.toUpperCase() || 'Unknown',
      channels: audioStream.channels || 2,
      sampleRate: audioStream.sample_rate || 44100,
      bitrate: audioStream.bit_rate ? Math.round(audioStream.bit_rate / 1000) + ' kbps' : 'Unknown'
    };
  }

  /**
   * Get video duration
   */
  getDuration() {
    if (!this.metadata || !this.metadata.format) {
      return 0;
    }
    return parseFloat(this.metadata.format.duration) || 0;
  }

  /**
   * Estimate output file size
   */
  estimateOutputSize() {
    const duration = this.getDuration();
    const bitrate = parseInt(this.quality) || 192;
    const bytes = (bitrate * 1000 / 8) * duration;
    return this.manager.formatFileSize(bytes);
  }

  /**
   * Render the workspace UI
   */
  renderWorkspace() {
    const audioInfo = this.getAudioInfo();
    const duration = this.getDuration();
    const durationStr = this.manager.formatTimeShort(duration);

    this.workspace.innerHTML = `
      <div class="qt-extractor-preview">
        <div class="qt-extractor-thumbnail">
          <video src="${this.fileUrl}" muted></video>
        </div>
        <div class="qt-extractor-info">
          <div class="qt-extractor-filename">${this.file.name}</div>
          <div class="qt-extractor-meta">
            <span>Duration: ${durationStr}</span>
            <span style="margin: 0 8px;">|</span>
            <span>Audio: ${audioInfo.codec}, ${audioInfo.channels}ch, ${audioInfo.sampleRate}Hz</span>
          </div>
          <div class="qt-extractor-options">
            <div class="qt-form-group">
              <label class="qt-label">Output Format</label>
              <select class="qt-select" id="qt-extractor-format">
                <option value="mp3" selected>MP3</option>
                <option value="wav">WAV (Lossless)</option>
                <option value="aac">AAC</option>
                <option value="flac">FLAC (Lossless)</option>
              </select>
            </div>
            <div class="qt-form-group" id="qt-extractor-quality-group">
              <label class="qt-label">Quality</label>
              <select class="qt-select" id="qt-extractor-quality">
                <option value="320k" selected>320 kbps (Best)</option>
                <option value="256k">256 kbps</option>
                <option value="192k">192 kbps</option>
                <option value="128k">128 kbps</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="qt-output-section">
        <div class="qt-output-label">
          ${Icons.get('music', 16)}
          <span>Estimated size:</span>
        </div>
        <span id="qt-extractor-size" style="color: rgba(255,255,255,0.8);">${this.estimateOutputSize()}</span>
      </div>

      <div id="qt-extractor-progress" class="qt-progress-container hidden">
        <div class="qt-progress-header">
          <span class="qt-progress-label">Extracting audio...</span>
          <span class="qt-progress-percent" id="qt-extractor-progress-percent">0%</span>
        </div>
        <div class="qt-progress-bar">
          <div class="qt-progress-fill" id="qt-extractor-progress-fill" style="width: 0%;"></div>
        </div>
      </div>

      <div class="qt-action-bar">
        <div class="qt-action-bar-left">
          <button class="qt-btn qt-btn-secondary" id="qt-extractor-change-btn">
            ${Icons.get('upload', 16)}
            Change Video
          </button>
        </div>
        <div class="qt-action-bar-right">
          <button class="qt-btn qt-btn-primary" id="qt-extractor-extract-btn">
            ${Icons.get('music', 16)}
            Extract Audio
          </button>
        </div>
      </div>
    `;

    // Seek video to middle for thumbnail
    const video = this.workspace.querySelector('video');
    if (video) {
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = video.duration / 2;
      });
    }

    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Format change
    const formatSelect = document.getElementById('qt-extractor-format');
    formatSelect?.addEventListener('change', (e) => {
      this.outputFormat = e.target.value;
      this.updateQualityVisibility();
      this.updateEstimatedSize();
    });

    // Quality change
    const qualitySelect = document.getElementById('qt-extractor-quality');
    qualitySelect?.addEventListener('change', (e) => {
      this.quality = e.target.value;
      this.updateEstimatedSize();
    });

    // Change video button
    document.getElementById('qt-extractor-change-btn')?.addEventListener('click', () => {
      this.reset();
    });

    // Extract button
    document.getElementById('qt-extractor-extract-btn')?.addEventListener('click', () => {
      this.extractAudio();
    });
  }

  /**
   * Update quality selector visibility (hide for lossless formats)
   */
  updateQualityVisibility() {
    const qualityGroup = document.getElementById('qt-extractor-quality-group');
    if (qualityGroup) {
      const isLossless = this.outputFormat === 'wav' || this.outputFormat === 'flac';
      qualityGroup.style.display = isLossless ? 'none' : '';
    }
  }

  /**
   * Update estimated file size
   */
  updateEstimatedSize() {
    const sizeEl = document.getElementById('qt-extractor-size');
    if (sizeEl) {
      if (this.outputFormat === 'wav') {
        // WAV is uncompressed - calculate from sample rate and duration
        const duration = this.getDuration();
        const audioInfo = this.getAudioInfo();
        const bytes = (audioInfo.sampleRate * 2 * audioInfo.channels) * duration; // 16-bit audio
        sizeEl.textContent = this.manager.formatFileSize(bytes);
      } else if (this.outputFormat === 'flac') {
        // FLAC is roughly 50-60% of WAV
        const duration = this.getDuration();
        const audioInfo = this.getAudioInfo();
        const wavBytes = (audioInfo.sampleRate * 2 * audioInfo.channels) * duration;
        sizeEl.textContent = '~' + this.manager.formatFileSize(wavBytes * 0.55);
      } else {
        sizeEl.textContent = this.estimateOutputSize();
      }
    }
  }

  /**
   * Extract audio from video
   */
  async extractAudio() {
    if (this.isProcessing) return;

    console.log('[ExtractorTool] Extracting audio:', this.outputFormat, this.quality);
    this.isProcessing = true;

    // Show progress
    const progressContainer = document.getElementById('qt-extractor-progress');
    const progressFill = document.getElementById('qt-extractor-progress-fill');
    const progressPercent = document.getElementById('qt-extractor-progress-percent');
    progressContainer?.classList.remove('hidden');

    // Disable extract button
    const extractBtn = document.getElementById('qt-extractor-extract-btn');
    if (extractBtn) extractBtn.disabled = true;

    try {
      // Get output folder
      const outputFolder = this.manager.getOutputFolder('extractor');

      // Generate job ID
      const jobId = `extract-${Date.now()}`;

      // Determine bitrate (null for lossless)
      const isLossless = this.outputFormat === 'wav' || this.outputFormat === 'flac';
      const audioBitrate = isLossless ? null : this.quality;

      // Setup progress listener
      const progressHandler = (data) => {
        if (data.jobId === jobId) {
          const percent = Math.round(data.progress);
          if (progressFill) progressFill.style.width = `${percent}%`;
          if (progressPercent) progressPercent.textContent = `${percent}%`;
        }
      };

      const completeHandler = (data) => {
        if (data.jobId === jobId) {
          this.isProcessing = false;
          progressContainer?.classList.add('hidden');
          if (extractBtn) extractBtn.disabled = false;

          this.manager.showToast('Audio extracted successfully!', 'success');
          console.log('[ExtractorTool] Extraction complete:', data.outputPath);

          // Reveal file in folder
          if (data.outputPath && window.kolboDesktop) {
            window.kolboDesktop.revealFileInFolder(data.outputPath);
          }
        }
      };

      const errorHandler = (data) => {
        if (data.jobId === jobId) {
          this.isProcessing = false;
          progressContainer?.classList.add('hidden');
          if (extractBtn) extractBtn.disabled = false;

          this.manager.showToast('Extraction failed: ' + data.error, 'error');
          console.error('[ExtractorTool] Extraction error:', data.error);
        }
      };

      window.kolboDesktop.ffmpeg.onProgress(progressHandler);
      window.kolboDesktop.ffmpeg.onComplete(completeHandler);
      window.kolboDesktop.ffmpeg.onError(errorHandler);

      // Start audio extraction (using existing convertJob with audio output type)
      await window.kolboDesktop.ffmpeg.convertJob({
        id: jobId,
        filePath: this.file.path,
        outputFormat: this.outputFormat,
        outputType: 'audio',
        outputFolder: outputFolder,
        settings: {
          audioBitrate: audioBitrate
        }
      });

    } catch (error) {
      console.error('[ExtractorTool] Extraction failed:', error);
      this.isProcessing = false;
      progressContainer?.classList.add('hidden');
      if (extractBtn) extractBtn.disabled = false;
      this.manager.showToast('Extraction failed: ' + error.message, 'error');
    }
  }

  /**
   * Reset to initial state
   */
  reset() {
    this.cleanup();
    this.dropzone.classList.remove('hidden');
    this.workspace.classList.add('hidden');
    this.workspace.innerHTML = '';
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.fileUrl) {
      URL.revokeObjectURL(this.fileUrl);
      this.fileUrl = null;
    }
    this.file = null;
    this.metadata = null;
    this.isProcessing = false;
  }
}
