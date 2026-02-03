// Kolbo Studio - Quick Tools: Video Merger Tool
// Combine multiple video clips into one

console.log('[VideoMergerTool] Loading...');

class VideoMergerTool {
  constructor(manager) {
    this.manager = manager;
    this.clips = []; // Array of { file, path, thumbnail, duration, resolution }
    this.isProcessing = false;

    // Settings
    this.resolutionMode = 'first'; // 'first', 'largest', 'custom'
    this.customResolution = { width: 1920, height: 1080 };

    // DOM references
    this.dropzone = document.getElementById('qt-merger-dropzone');
    this.workspace = document.getElementById('qt-merger-workspace');

    // Drag state
    this.draggedIndex = null;

    this.init();
  }

  init() {
    console.log('[VideoMergerTool] Initialized');
  }

  /**
   * Add files to the merger
   */
  async addFiles(files) {
    console.log('[VideoMergerTool] Adding files:', files.length);

    for (const file of files) {
      // Check for duplicates - skip if file already added
      const isDuplicate = this.clips.some(clip => clip.path === file.path);
      if (isDuplicate) {
        console.log('[VideoMergerTool] Skipping duplicate file:', file.name);
        continue;
      }

      // Get metadata
      let metadata = null;
      try {
        metadata = await window.kolboDesktop.ffmpeg.probeFile(file.path);
      } catch (error) {
        console.error('[VideoMergerTool] Failed to probe file:', file.name, error);
      }

      // Get video stream info
      const videoStream = metadata?.streams?.find(s => s.codec_type === 'video');
      const duration = metadata?.format?.duration || 0;

      // Generate thumbnail
      const thumbnail = await this.generateThumbnail(file);

      this.clips.push({
        file: file,
        path: file.path,
        name: file.name,
        thumbnail: thumbnail,
        duration: parseFloat(duration),
        resolution: videoStream ? {
          width: videoStream.width,
          height: videoStream.height
        } : null
      });
    }

    // Show workspace if first clips
    if (this.clips.length > 0 && this.dropzone && !this.dropzone.classList.contains('hidden')) {
      this.dropzone.classList.add('hidden');
      this.workspace.classList.remove('hidden');
      this.renderWorkspace();
    } else {
      this.updateClipsList();
    }
  }

  /**
   * Generate thumbnail for a video file
   */
  async generateThumbnail(file) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      video.preload = 'metadata';
      video.src = URL.createObjectURL(file);

      video.onloadedmetadata = () => {
        video.currentTime = video.duration / 2;
      };

      video.onseeked = () => {
        canvas.width = 160;
        canvas.height = 90;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        URL.revokeObjectURL(video.src);
        resolve(dataUrl);
      };

      video.onerror = () => {
        URL.revokeObjectURL(video.src);
        resolve(null);
      };

      // Timeout fallback
      setTimeout(() => {
        if (!video.onseeked) return;
        URL.revokeObjectURL(video.src);
        resolve(null);
      }, 5000);
    });
  }

  /**
   * Render the workspace UI
   */
  renderWorkspace() {
    const totalDuration = this.clips.reduce((sum, clip) => sum + clip.duration, 0);

    this.workspace.innerHTML = `
      <div class="qt-section-header">
        <span class="qt-section-title">Video Clips (<span id="qt-merger-count">${this.clips.length}</span>)</span>
        <span style="color: rgba(255,255,255,0.5); font-size: 13px;">
          Total: ${this.manager.formatTimeShort(totalDuration)}
        </span>
      </div>

      <div class="qt-merger-clips" id="qt-merger-clips">
        <!-- Clips will be rendered here -->
      </div>

      <div class="qt-merger-settings">
        <div class="qt-form-group">
          <label class="qt-label">Resolution</label>
          <select class="qt-select" id="qt-merger-resolution">
            <option value="first" selected>Match first clip</option>
            <option value="largest">Match largest clip</option>
            <option value="1080p">1080p (1920x1080)</option>
            <option value="720p">720p (1280x720)</option>
          </select>
        </div>
        <div class="qt-form-group">
          <button class="qt-btn qt-btn-secondary" id="qt-merger-add-more" style="margin-top: 24px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Add More Clips
          </button>
        </div>
      </div>

      <div id="qt-merger-progress" class="qt-progress-container hidden">
        <div class="qt-progress-header">
          <span class="qt-progress-label">Merging videos...</span>
          <span class="qt-progress-percent" id="qt-merger-progress-percent">0%</span>
        </div>
        <div class="qt-progress-bar">
          <div class="qt-progress-fill" id="qt-merger-progress-fill" style="width: 0%;"></div>
        </div>
      </div>

      <div class="qt-action-bar">
        <div class="qt-action-bar-left">
          <button class="qt-btn qt-btn-secondary" id="qt-merger-clear-btn">
            Clear All
          </button>
        </div>
        <div class="qt-action-bar-right">
          <button class="qt-btn qt-btn-primary" id="qt-merger-merge-btn" ${this.clips.length < 2 ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="2" width="8" height="8" rx="1"></rect>
              <rect x="14" y="2" width="8" height="8" rx="1"></rect>
              <rect x="8" y="14" width="8" height="8" rx="1"></rect>
              <path d="M6 10v4M18 10v4M10 6h4M10 18h4"></path>
            </svg>
            Merge Videos
          </button>
        </div>
      </div>
    `;

    this.updateClipsList();
    this.setupEventListeners();
  }

  /**
   * Update clips list UI
   */
  updateClipsList() {
    const container = document.getElementById('qt-merger-clips');
    const countEl = document.getElementById('qt-merger-count');
    const mergeBtn = document.getElementById('qt-merger-merge-btn');

    if (countEl) countEl.textContent = this.clips.length;
    if (mergeBtn) mergeBtn.disabled = this.clips.length < 2;

    if (!container) return;

    if (this.clips.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: rgba(255,255,255,0.4);">
          No clips added yet
        </div>
      `;
      return;
    }

    container.innerHTML = this.clips.map((clip, index) => `
      <div class="qt-merger-clip" data-index="${index}" draggable="true">
        <div class="qt-merger-drag-handle">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="5" r="1"></circle>
            <circle cx="9" cy="12" r="1"></circle>
            <circle cx="9" cy="19" r="1"></circle>
            <circle cx="15" cy="5" r="1"></circle>
            <circle cx="15" cy="12" r="1"></circle>
            <circle cx="15" cy="19" r="1"></circle>
          </svg>
        </div>
        <div class="qt-merger-clip-thumbnail">
          ${clip.thumbnail ? `<img src="${clip.thumbnail}" alt="">` : '<span style="color: rgba(255,255,255,0.3);">No preview</span>'}
        </div>
        <div class="qt-merger-clip-info">
          <div class="qt-merger-clip-name">${clip.name}</div>
          <div class="qt-merger-clip-meta">
            ${this.manager.formatTimeShort(clip.duration)}
            ${clip.resolution ? ` | ${clip.resolution.width}x${clip.resolution.height}` : ''}
          </div>
        </div>
        <div class="qt-merger-clip-actions">
          <button class="qt-merger-clip-btn" data-action="move-up" data-index="${index}" title="Move up" ${index === 0 ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 15l-6-6-6 6"/>
            </svg>
          </button>
          <button class="qt-merger-clip-btn" data-action="move-down" data-index="${index}" title="Move down" ${index === this.clips.length - 1 ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          <button class="qt-merger-clip-btn remove" data-action="remove" data-index="${index}" title="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>
    `).join('');

    // Setup drag and drop
    this.setupDragAndDrop();

    // Setup action buttons
    container.querySelectorAll('.qt-merger-clip-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = btn.dataset.action;
        const index = parseInt(btn.dataset.index);

        switch (action) {
          case 'move-up':
            this.moveClip(index, index - 1);
            break;
          case 'move-down':
            this.moveClip(index, index + 1);
            break;
          case 'remove':
            this.removeClip(index);
            break;
        }
      });
    });
  }

  /**
   * Setup drag and drop reordering
   */
  setupDragAndDrop() {
    const container = document.getElementById('qt-merger-clips');
    const clips = container.querySelectorAll('.qt-merger-clip');

    clips.forEach(clip => {
      clip.addEventListener('dragstart', (e) => {
        this.draggedIndex = parseInt(clip.dataset.index);
        clip.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      clip.addEventListener('dragend', () => {
        clip.classList.remove('dragging');
        this.draggedIndex = null;
      });

      clip.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });

      clip.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetIndex = parseInt(clip.dataset.index);
        if (this.draggedIndex !== null && this.draggedIndex !== targetIndex) {
          this.moveClip(this.draggedIndex, targetIndex);
        }
      });
    });
  }

  /**
   * Move clip from one index to another
   */
  moveClip(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= this.clips.length) return;

    const clip = this.clips.splice(fromIndex, 1)[0];
    this.clips.splice(toIndex, 0, clip);
    this.updateClipsList();
  }

  /**
   * Remove a clip
   */
  removeClip(index) {
    this.clips.splice(index, 1);

    if (this.clips.length === 0) {
      this.reset();
    } else {
      this.updateClipsList();
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Resolution change
    document.getElementById('qt-merger-resolution')?.addEventListener('change', (e) => {
      this.resolutionMode = e.target.value;
    });

    // Add more clips
    document.getElementById('qt-merger-add-more')?.addEventListener('click', () => {
      // Trigger file input from manager
      const fileInput = this.manager.fileInputs['merger'];
      if (fileInput) fileInput.click();
    });

    // Clear all
    document.getElementById('qt-merger-clear-btn')?.addEventListener('click', () => {
      this.reset();
    });

    // Merge
    document.getElementById('qt-merger-merge-btn')?.addEventListener('click', () => {
      this.mergeVideos();
    });
  }

  /**
   * Get target resolution based on settings
   */
  getTargetResolution() {
    switch (this.resolutionMode) {
      case 'first':
        return this.clips[0]?.resolution || { width: 1920, height: 1080 };

      case 'largest':
        let largest = { width: 0, height: 0 };
        for (const clip of this.clips) {
          if (clip.resolution && clip.resolution.width * clip.resolution.height > largest.width * largest.height) {
            largest = clip.resolution;
          }
        }
        return largest.width > 0 ? largest : { width: 1920, height: 1080 };

      case '1080p':
        return { width: 1920, height: 1080 };

      case '720p':
        return { width: 1280, height: 720 };

      default:
        return { width: 1920, height: 1080 };
    }
  }

  /**
   * Merge videos
   */
  async mergeVideos() {
    if (this.clips.length < 2 || this.isProcessing) return;

    console.log('[VideoMergerTool] Merging', this.clips.length, 'clips');
    this.isProcessing = true;

    const progressContainer = document.getElementById('qt-merger-progress');
    const progressFill = document.getElementById('qt-merger-progress-fill');
    const progressPercent = document.getElementById('qt-merger-progress-percent');
    const mergeBtn = document.getElementById('qt-merger-merge-btn');

    progressContainer?.classList.remove('hidden');
    if (mergeBtn) mergeBtn.disabled = true;

    try {
      const outputFolder = this.manager.getOutputFolder('merger');
      const targetResolution = this.getTargetResolution();
      const jobId = `merge-${Date.now()}`;

      // Get file paths
      const filePaths = this.clips.map(clip => clip.path);

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
          if (mergeBtn) mergeBtn.disabled = false;

          this.manager.showToast('Videos merged successfully!', 'success');
          console.log('[VideoMergerTool] Merge complete:', data.outputPath);

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
          if (mergeBtn) mergeBtn.disabled = false;

          this.manager.showToast('Merge failed: ' + data.error, 'error');
          console.error('[VideoMergerTool] Merge error:', data.error);
        }
      };

      window.kolboDesktop.ffmpeg.onProgress(progressHandler);
      window.kolboDesktop.ffmpeg.onComplete(completeHandler);
      window.kolboDesktop.ffmpeg.onError(errorHandler);

      // Call merge API
      if (window.kolboDesktop.quickTools) {
        await window.kolboDesktop.quickTools.mergeVideos({
          id: jobId,
          filePaths: filePaths,
          outputFolder: outputFolder || this.clips[0].path.replace(/[^/\\]+$/, ''),
          resolution: targetResolution
        });
      } else {
        throw new Error('Quick Tools API not available');
      }

    } catch (error) {
      console.error('[VideoMergerTool] Merge failed:', error);
      this.isProcessing = false;
      progressContainer?.classList.add('hidden');
      if (mergeBtn) mergeBtn.disabled = false;
      this.manager.showToast('Merge failed: ' + error.message, 'error');
    }
  }

  /**
   * Reset to initial state
   */
  reset() {
    this.clips = [];
    this.dropzone.classList.remove('hidden');
    this.workspace.classList.add('hidden');
    this.workspace.innerHTML = '';
  }
}
