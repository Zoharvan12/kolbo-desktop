// Kolbo Studio - Quick Tools: Frame Grabber Tool
// Capture frames from video at specific timestamps

console.log('[FrameGrabberTool] Loading...');

class FrameGrabberTool {
  constructor(manager) {
    this.manager = manager;
    this.file = null;
    this.fileUrl = null;
    this.duration = 0;
    this.currentTime = 0;
    this.capturedFrames = []; // Array of { timestamp, dataUrl }
    this.isExporting = false;

    // Settings
    this.outputFormat = 'png';
    this.thumbnailCount = 12; // Number of thumbnails to generate

    // DOM references
    this.dropzone = document.getElementById('qt-frame-grabber-dropzone');
    this.workspace = document.getElementById('qt-frame-grabber-workspace');
    this.videoEl = null;
    this.timelineEl = null;
    this.playheadEl = null;
    this.isDragging = false;
    this.thumbnails = [];

    this.init();
  }

  init() {
    console.log('[FrameGrabberTool] Initialized');
    this.setupKeyboardShortcuts();
  }

  /**
   * Setup keyboard shortcuts
   */
  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Only handle if frame grabber is active
      if (!this.file || !this.videoEl) return;
      const content = document.getElementById('qt-frame-grabber-content');
      if (!content || !content.classList.contains('active')) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          this.stepFrame(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.stepFrame(1);
          break;
        case ' ':
          e.preventDefault();
          this.captureFrame();
          break;
      }
    });
  }

  /**
   * Load a video file
   */
  async loadFile(file) {
    console.log('[FrameGrabberTool] Loading file:', file.name);

    // Clean up previous
    this.cleanup();

    this.file = file;
    this.fileUrl = URL.createObjectURL(file);
    this.capturedFrames = [];

    // Hide dropzone, show workspace
    this.dropzone.classList.add('hidden');
    this.workspace.classList.remove('hidden');

    // Render the workspace
    this.renderWorkspace();
  }

  /**
   * Render the workspace UI
   */
  renderWorkspace() {
    this.workspace.innerHTML = `
      <div class="qt-frame-grabber">
        <div class="qt-video-preview">
          <video id="qt-fg-video" src="${this.fileUrl}" preload="metadata"></video>
        </div>

        <div class="qt-fg-timeline-container">
          <div class="qt-fg-timeline" id="qt-fg-timeline">
            <div class="qt-fg-thumbnails" id="qt-fg-thumbnails">
              <div class="qt-fg-thumbnails-loading">Generating thumbnails...</div>
            </div>
            <div class="qt-fg-playhead" id="qt-fg-playhead"></div>
          </div>
        </div>

        <div class="qt-fg-step-controls">
          <button class="qt-btn qt-btn-secondary" id="qt-fg-step-back" style="padding: 8px 12px; min-width: auto;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 19 2 12 11 5 11 19"></polygon>
              <polygon points="22 19 13 12 22 5 22 19"></polygon>
            </svg>
            <span style="margin-left: 6px;">Prev Frame</span>
          </button>
          <button class="qt-btn qt-btn-secondary" id="qt-fg-step-forward" style="padding: 8px 12px; min-width: auto;">
            <span style="margin-right: 6px;">Next Frame</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="13 19 22 12 13 5 13 19"></polygon>
              <polygon points="2 19 11 12 2 5 2 19"></polygon>
            </svg>
          </button>
        </div>

        <div class="qt-frame-controls">
          <span class="qt-frame-time" id="qt-fg-time">0:00.000</span>
          <span style="flex: 1;"></span>
          <div class="qt-form-group" style="margin: 0; min-width: 100px;">
            <select class="qt-select" id="qt-fg-format" style="padding: 6px 10px;">
              <option value="png" selected>PNG</option>
              <option value="jpg">JPG</option>
              <option value="webp">WEBP</option>
            </select>
          </div>
          <button class="qt-btn qt-btn-primary" id="qt-fg-capture-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            Capture Frame (Space)
          </button>
        </div>

        <div class="qt-section-header">
          <span class="qt-section-title">Captured Frames (<span id="qt-fg-count">0</span>)</span>
          <button class="qt-btn qt-btn-danger" id="qt-fg-clear-btn" style="padding: 6px 12px; font-size: 12px;" disabled>
            Clear All
          </button>
        </div>

        <div class="qt-captured-frames" id="qt-fg-frames">
          <div class="qt-frames-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect width="18" height="18" x="3" y="3" rx="2"></rect>
              <circle cx="9" cy="9" r="2"></circle>
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>
            </svg>
            <span>No frames captured yet</span>
            <span>Use Arrow keys to scrub, Space to capture</span>
          </div>
        </div>

        <div id="qt-fg-progress-container" class="qt-progress-container hidden">
          <div class="qt-progress-header">
            <span class="qt-progress-label">Exporting frames...</span>
            <span class="qt-progress-percent" id="qt-fg-export-progress">0%</span>
          </div>
          <div class="qt-progress-bar">
            <div class="qt-progress-fill" id="qt-fg-export-fill" style="width: 0%;"></div>
          </div>
        </div>

        <div class="qt-action-bar">
          <div class="qt-action-bar-left">
            <button class="qt-btn qt-btn-secondary" id="qt-fg-change-btn">
              Change Video
            </button>
          </div>
          <div class="qt-action-bar-right">
            <button class="qt-btn qt-btn-primary" id="qt-fg-export-btn" disabled>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export Frames
            </button>
          </div>
        </div>
      </div>
    `;

    // Get DOM references
    this.videoEl = document.getElementById('qt-fg-video');
    this.timelineEl = document.getElementById('qt-fg-timeline');
    this.playheadEl = document.getElementById('qt-fg-playhead');
    this.thumbnailsEl = document.getElementById('qt-fg-thumbnails');

    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Generate thumbnail preview images for the timeline
   */
  async generateThumbnails() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Set canvas size for thumbnails
    canvas.width = 160;
    canvas.height = 90;

    this.thumbnails = [];
    this.thumbnailsEl.innerHTML = '';

    for (let i = 0; i < this.thumbnailCount; i++) {
      const time = (this.duration / this.thumbnailCount) * i;

      try {
        // Seek to time
        this.videoEl.currentTime = time;

        // Wait for seek
        await new Promise((resolve) => {
          const onSeeked = () => {
            this.videoEl.removeEventListener('seeked', onSeeked);
            resolve();
          };
          this.videoEl.addEventListener('seeked', onSeeked);
          setTimeout(resolve, 500); // Timeout fallback
        });

        // Draw frame to canvas
        ctx.drawImage(this.videoEl, 0, 0, canvas.width, canvas.height);

        // Convert to data URL
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        this.thumbnails.push(dataUrl);

        // Create thumbnail element
        const thumbEl = document.createElement('div');
        thumbEl.className = 'qt-fg-thumbnail';
        thumbEl.style.backgroundImage = `url(${dataUrl})`;
        thumbEl.style.flex = `1 1 ${100 / this.thumbnailCount}%`;
        this.thumbnailsEl.appendChild(thumbEl);

      } catch (error) {
        console.warn('[FrameGrabberTool] Failed to generate thumbnail:', i, error);
      }
    }

    // Reset video to start
    this.videoEl.currentTime = 0;
    this.currentTime = 0;
    this.updatePlayheadUI(0);
    console.log('[FrameGrabberTool] Generated', this.thumbnails.length, 'thumbnails');
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Video loaded
    this.videoEl.addEventListener('loadedmetadata', async () => {
      this.duration = this.videoEl.duration;
      this.updateTimeDisplay();
      console.log('[FrameGrabberTool] Video loaded, duration:', this.duration);

      // Generate thumbnails for the timeline
      await this.generateThumbnails();
    });

    // Timeline interaction
    const timeline = this.timelineEl;

    const startDrag = (e) => {
      this.isDragging = true;
      this.updateTimelinePosition(e);
    };

    const doDrag = (e) => {
      if (!this.isDragging) return;
      this.updateTimelinePosition(e);
    };

    const endDrag = () => {
      this.isDragging = false;
    };

    timeline.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', endDrag);

    // Step buttons
    document.getElementById('qt-fg-step-back')?.addEventListener('click', () => this.stepFrame(-1));
    document.getElementById('qt-fg-step-forward')?.addEventListener('click', () => this.stepFrame(1));

    // Capture button
    document.getElementById('qt-fg-capture-btn')?.addEventListener('click', () => this.captureFrame());

    // Format change
    document.getElementById('qt-fg-format')?.addEventListener('change', (e) => {
      this.outputFormat = e.target.value;
    });

    // Clear button
    document.getElementById('qt-fg-clear-btn')?.addEventListener('click', () => this.clearFrames());

    // Change video button
    document.getElementById('qt-fg-change-btn')?.addEventListener('click', () => this.reset());

    // Export button
    document.getElementById('qt-fg-export-btn')?.addEventListener('click', () => this.exportFrames());
  }

  /**
   * Update timeline position from mouse event
   */
  updateTimelinePosition(e) {
    const rect = this.timelineEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percent = x / rect.width;

    this.currentTime = this.duration * percent;
    this.videoEl.currentTime = this.currentTime;

    this.updatePlayheadUI(percent);
    this.updateTimeDisplay();
  }

  /**
   * Update playhead UI position
   */
  updatePlayheadUI(percent) {
    if (this.playheadEl) {
      this.playheadEl.style.left = `${percent * 100}%`;
    }
  }

  /**
   * Update time display
   */
  updateTimeDisplay() {
    const timeEl = document.getElementById('qt-fg-time');
    if (timeEl) {
      timeEl.textContent = this.manager.formatTime(this.currentTime);
    }
  }

  /**
   * Step forward/backward by one frame (~1/30s)
   */
  stepFrame(direction) {
    const frameTime = 1 / 30; // Assuming 30fps
    this.currentTime = Math.max(0, Math.min(this.currentTime + (frameTime * direction), this.duration));
    this.videoEl.currentTime = this.currentTime;

    const percent = this.currentTime / this.duration;
    this.updatePlayheadUI(percent);
    this.updateTimeDisplay();
  }

  /**
   * Capture the current frame
   */
  captureFrame() {
    if (!this.videoEl) return;

    // Create canvas and capture frame
    const canvas = document.createElement('canvas');
    canvas.width = this.videoEl.videoWidth;
    canvas.height = this.videoEl.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(this.videoEl, 0, 0);

    // Get data URL
    const mimeType = this.outputFormat === 'jpg' ? 'image/jpeg' :
                     this.outputFormat === 'webp' ? 'image/webp' : 'image/png';
    const quality = this.outputFormat === 'jpg' || this.outputFormat === 'webp' ? 0.95 : undefined;
    const dataUrl = canvas.toDataURL(mimeType, quality);

    // Store frame
    this.capturedFrames.push({
      timestamp: this.currentTime,
      dataUrl: dataUrl,
      format: this.outputFormat
    });

    // Update UI
    this.updateFramesUI();

    // Flash effect on capture button
    const captureBtn = document.getElementById('qt-fg-capture-btn');
    if (captureBtn) {
      captureBtn.classList.add('qt-btn-flash');
      setTimeout(() => captureBtn.classList.remove('qt-btn-flash'), 200);
    }

    console.log('[FrameGrabberTool] Captured frame at', this.manager.formatTime(this.currentTime));
  }

  /**
   * Update captured frames UI
   */
  updateFramesUI() {
    const container = document.getElementById('qt-fg-frames');
    const countEl = document.getElementById('qt-fg-count');
    const clearBtn = document.getElementById('qt-fg-clear-btn');
    const exportBtn = document.getElementById('qt-fg-export-btn');

    if (countEl) countEl.textContent = this.capturedFrames.length;
    if (clearBtn) clearBtn.disabled = this.capturedFrames.length === 0;
    if (exportBtn) exportBtn.disabled = this.capturedFrames.length === 0;

    if (this.capturedFrames.length === 0) {
      container.innerHTML = `
        <div class="qt-frames-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect width="18" height="18" x="3" y="3" rx="2"></rect>
            <circle cx="9" cy="9" r="2"></circle>
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>
          </svg>
          <span>No frames captured yet</span>
          <span>Use Arrow keys to scrub, Space to capture</span>
        </div>
      `;
      return;
    }

    container.innerHTML = this.capturedFrames.map((frame, index) => `
      <div class="qt-captured-frame" data-index="${index}">
        <img src="${frame.dataUrl}" alt="Frame ${index + 1}">
        <span class="qt-captured-frame-time">${this.manager.formatTime(frame.timestamp)}</span>
        <button class="qt-captured-frame-remove" data-index="${index}" title="Remove frame">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    `).join('');

    // Add remove button listeners
    container.querySelectorAll('.qt-captured-frame-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.dataset.index);
        this.removeFrame(index);
      });
    });

    // Add click to seek listeners
    container.querySelectorAll('.qt-captured-frame').forEach(frame => {
      frame.addEventListener('click', () => {
        const index = parseInt(frame.dataset.index);
        const frameData = this.capturedFrames[index];
        if (frameData) {
          this.currentTime = frameData.timestamp;
          this.videoEl.currentTime = this.currentTime;
          const percent = this.currentTime / this.duration;
          this.updatePlayheadUI(percent);
          this.updateTimeDisplay();
        }
      });
    });
  }

  /**
   * Remove a captured frame
   */
  removeFrame(index) {
    this.capturedFrames.splice(index, 1);
    this.updateFramesUI();
  }

  /**
   * Clear all captured frames
   */
  clearFrames() {
    this.capturedFrames = [];
    this.updateFramesUI();
  }

  /**
   * Export captured frames
   */
  async exportFrames() {
    if (this.capturedFrames.length === 0 || this.isExporting) return;

    console.log('[FrameGrabberTool] Exporting', this.capturedFrames.length, 'frames');
    this.isExporting = true;

    const progressContainer = document.getElementById('qt-fg-progress-container');
    const progressFill = document.getElementById('qt-fg-export-fill');
    const progressPercent = document.getElementById('qt-fg-export-progress');
    const exportBtn = document.getElementById('qt-fg-export-btn');

    progressContainer?.classList.remove('hidden');
    if (exportBtn) exportBtn.disabled = true;

    try {
      const outputFolder = this.manager.getOutputFolder('frame-grabber');
      const baseName = this.file.name.replace(/\.[^.]+$/, '');
      let exported = 0;

      for (let i = 0; i < this.capturedFrames.length; i++) {
        const frame = this.capturedFrames[i];
        const timestamp = this.manager.formatTime(frame.timestamp).replace(/:/g, '-').replace(/\./g, '_');
        const filename = `${baseName}_frame_${timestamp}.${frame.format}`;

        // Convert data URL to blob and save
        const response = await fetch(frame.dataUrl);
        const blob = await response.blob();

        // Use quickTools API to save frame
        if (window.kolboDesktop.quickTools) {
          await window.kolboDesktop.quickTools.saveFrame({
            blob: blob,
            filename: filename,
            outputFolder: outputFolder || this.file.path.replace(/[^/\\]+$/, '')
          });
        }

        exported++;
        const percent = Math.round((exported / this.capturedFrames.length) * 100);
        if (progressFill) progressFill.style.width = `${percent}%`;
        if (progressPercent) progressPercent.textContent = `${percent}%`;
      }

      this.manager.showToast(`Exported ${exported} frames successfully!`, 'success');

      // Reveal folder
      const folder = outputFolder || this.file.path.replace(/[^/\\]+$/, '');
      if (window.kolboDesktop) {
        window.kolboDesktop.openFolder(folder);
      }

    } catch (error) {
      console.error('[FrameGrabberTool] Export failed:', error);
      this.manager.showToast('Export failed: ' + error.message, 'error');
    } finally {
      this.isExporting = false;
      progressContainer?.classList.add('hidden');
      if (exportBtn) exportBtn.disabled = false;
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
    this.videoEl = null;
    this.timelineEl = null;
    this.playheadEl = null;
    this.thumbnailsEl = null;
    this.capturedFrames = [];
    this.thumbnails = [];
    this.duration = 0;
    this.currentTime = 0;
    this.isExporting = false;
  }
}

// Add flash animation for capture button
const style = document.createElement('style');
style.textContent = `
  .qt-btn-flash {
    animation: qt-btn-flash 0.2s ease;
  }
  @keyframes qt-btn-flash {
    0% { transform: scale(1); }
    50% { transform: scale(1.1); box-shadow: 0 0 20px rgba(59, 130, 246, 0.6); }
    100% { transform: scale(1); }
  }
`;
document.head.appendChild(style);
