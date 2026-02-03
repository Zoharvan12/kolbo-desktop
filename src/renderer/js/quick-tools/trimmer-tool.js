// Kolbo Studio - Quick Tools: Trimmer Tool
// Standalone trimmer integrating existing VideoTrimmer and AudioTrimmer components

console.log('[TrimmerTool] Loading...');

class TrimmerTool {
  constructor(manager) {
    this.manager = manager;
    this.file = null;
    this.fileUrl = null;
    this.isVideo = false;
    this.trimmer = null; // VideoTrimmer or AudioTrimmer instance
    this.isProcessing = false;

    // DOM references
    this.dropzone = document.getElementById('qt-trimmer-dropzone');
    this.workspace = document.getElementById('qt-trimmer-workspace');

    this.init();
  }

  init() {
    console.log('[TrimmerTool] Initialized');
  }

  /**
   * Load a file for trimming
   */
  async loadFile(file) {
    console.log('[TrimmerTool] Loading file:', file.name);

    // Clean up previous
    this.cleanup();

    this.file = file;
    this.fileUrl = URL.createObjectURL(file);
    this.isVideo = this.manager.isVideoFile(file);

    // Hide dropzone, show workspace
    this.dropzone.classList.add('hidden');
    this.workspace.classList.remove('hidden');

    // Render the workspace
    this.renderWorkspace();

    // Create and load appropriate trimmer
    if (this.isVideo) {
      await this.loadVideoTrimmer();
    } else {
      await this.loadAudioTrimmer();
    }
  }

  /**
   * Render the workspace UI
   */
  renderWorkspace() {
    const typeBadge = this.isVideo ? 'video' : 'audio';
    const typeBadgeClass = this.isVideo ? '' : 'audio';

    this.workspace.innerHTML = `
      <div class="qt-trimmer-standalone">
        <div class="qt-trimmer-media-info">
          <span class="qt-trimmer-filename">${this.file.name}</span>
          <span class="qt-trimmer-type-badge ${typeBadgeClass}">${typeBadge}</span>
          <span style="flex: 1;"></span>
          <button class="qt-btn qt-btn-secondary" id="qt-trimmer-change-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Change File
          </button>
        </div>

        <div id="qt-trimmer-component"></div>

        <div id="qt-trimmer-progress" class="qt-progress-container hidden">
          <div class="qt-progress-header">
            <span class="qt-progress-label">Exporting trimmed ${typeBadge}...</span>
            <span class="qt-progress-percent" id="qt-trimmer-progress-percent">0%</span>
          </div>
          <div class="qt-progress-bar">
            <div class="qt-progress-fill" id="qt-trimmer-progress-fill" style="width: 0%;"></div>
          </div>
        </div>

        <div class="qt-action-bar">
          <div class="qt-action-bar-left">
            <button class="qt-btn qt-btn-secondary" id="qt-trimmer-reset-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 4v6h6M23 20v-6h-6"/>
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
              </svg>
              Reset
            </button>
          </div>
          <div class="qt-action-bar-right">
            <button class="qt-btn qt-btn-primary" id="qt-trimmer-export-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export Trimmed ${this.isVideo ? 'Video' : 'Audio'}
            </button>
          </div>
        </div>
      </div>
    `;

    // Setup button listeners
    document.getElementById('qt-trimmer-change-btn')?.addEventListener('click', () => {
      this.reset();
    });

    document.getElementById('qt-trimmer-reset-btn')?.addEventListener('click', () => {
      if (this.trimmer && this.trimmer.resetTrimPoints) {
        this.trimmer.resetTrimPoints();
      }
    });

    document.getElementById('qt-trimmer-export-btn')?.addEventListener('click', () => {
      this.exportTrimmed();
    });
  }

  /**
   * Load video trimmer component
   */
  async loadVideoTrimmer() {
    if (typeof VideoTrimmer === 'undefined') {
      console.error('[TrimmerTool] VideoTrimmer class not available');
      return;
    }

    const container = document.getElementById('qt-trimmer-component');
    if (!container) return;

    this.trimmer = new VideoTrimmer(this.file, {
      maxDuration: 3600, // 1 hour max
      minDuration: 1,
      thumbnailCount: 12,
      onReady: (data) => {
        console.log('[TrimmerTool] Video trimmer ready:', data);
      },
      onTrimChange: (points) => {
        console.log('[TrimmerTool] Trim points changed:', points);
      },
      onError: (error) => {
        console.error('[TrimmerTool] Video trimmer error:', error);
        this.manager.showToast('Failed to load video: ' + error.message, 'error');
      }
    });

    const trimmerEl = this.trimmer.render();
    container.appendChild(trimmerEl);

    // Load the video
    await this.trimmer.loadVideo();
  }

  /**
   * Load audio trimmer component
   */
  async loadAudioTrimmer() {
    if (typeof AudioTrimmer === 'undefined') {
      console.error('[TrimmerTool] AudioTrimmer class not available');
      return;
    }

    const container = document.getElementById('qt-trimmer-component');
    if (!container) return;

    this.trimmer = new AudioTrimmer(this.file, {
      maxDuration: 3600, // 1 hour max
      minDuration: 1,
      onReady: (data) => {
        console.log('[TrimmerTool] Audio trimmer ready:', data);
      },
      onTrimChange: (points) => {
        console.log('[TrimmerTool] Trim points changed:', points);
      },
      onError: (error) => {
        console.error('[TrimmerTool] Audio trimmer error:', error);
        this.manager.showToast('Failed to load audio: ' + error.message, 'error');
      }
    });

    const trimmerEl = this.trimmer.render();
    container.appendChild(trimmerEl);

    // Load the audio
    await this.trimmer.loadAudio();
  }

  /**
   * Export the trimmed file
   */
  async exportTrimmed() {
    if (!this.trimmer || this.isProcessing) return;

    const trimPoints = this.trimmer.getTrimPoints();
    if (!trimPoints || trimPoints[0] === trimPoints[1]) {
      this.manager.showToast('Please set trim points first', 'error');
      return;
    }

    console.log('[TrimmerTool] Exporting with trim points:', trimPoints);
    this.isProcessing = true;

    // Show progress
    const progressContainer = document.getElementById('qt-trimmer-progress');
    const progressFill = document.getElementById('qt-trimmer-progress-fill');
    const progressPercent = document.getElementById('qt-trimmer-progress-percent');
    progressContainer?.classList.remove('hidden');

    // Disable export button
    const exportBtn = document.getElementById('qt-trimmer-export-btn');
    if (exportBtn) exportBtn.disabled = true;

    try {
      // Get output folder
      const outputFolder = this.manager.getOutputFolder('trimmer');

      // Determine output format
      const ext = this.manager.getFileExtension(this.file.name);
      const outputFormat = this.isVideo ? (ext === 'mov' ? 'mov' : 'mp4') : (ext === 'wav' ? 'wav' : 'mp3');
      const outputType = this.isVideo ? 'video' : 'audio';

      // Generate job ID
      const jobId = `trim-${Date.now()}`;

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
          if (exportBtn) exportBtn.disabled = false;

          this.manager.showToast('Trimmed file exported successfully!', 'success');
          console.log('[TrimmerTool] Export complete:', data.outputPath);

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
          if (exportBtn) exportBtn.disabled = false;

          this.manager.showToast('Export failed: ' + data.error, 'error');
          console.error('[TrimmerTool] Export error:', data.error);
        }
      };

      window.kolboDesktop.ffmpeg.onProgress(progressHandler);
      window.kolboDesktop.ffmpeg.onComplete(completeHandler);
      window.kolboDesktop.ffmpeg.onError(errorHandler);

      // Start conversion with trim
      await window.kolboDesktop.ffmpeg.convertJob({
        id: jobId,
        filePath: this.file.path,
        outputFormat: outputFormat,
        outputType: outputType,
        outputFolder: outputFolder,
        trimStart: trimPoints[0],
        trimEnd: trimPoints[1],
        settings: this.isVideo ? {
          resolution: 'original'
        } : {
          audioBitrate: null // Source quality
        }
      });

    } catch (error) {
      console.error('[TrimmerTool] Export failed:', error);
      this.isProcessing = false;
      progressContainer?.classList.add('hidden');
      if (exportBtn) exportBtn.disabled = false;
      this.manager.showToast('Export failed: ' + error.message, 'error');
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

    if (this.trimmer && this.trimmer.destroy) {
      this.trimmer.destroy();
    }
    this.trimmer = null;
    this.file = null;
    this.isProcessing = false;
  }
}
