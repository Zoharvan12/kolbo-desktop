// Kolbo Studio - Video Trimmer Component
// Visual timeline trimmer for video files with thumbnail preview

console.log('[VideoTrimmer] Loading...');

class VideoTrimmer {
  constructor(videoFile, options = {}) {
    this.videoFile = videoFile;
    this.videoUrl = null; // Deferred to loadVideo() for safety

    // Options
    this.maxDuration = options.maxDuration || 300; // 5 minutes default
    this.minDuration = options.minDuration || 1; // 1 second minimum
    this.thumbnailCount = options.thumbnailCount || 10;

    // State
    this.duration = 0;
    this.trimPoints = [0, this.maxDuration]; // [start, end]
    this.originalTrimPoints = [0, this.maxDuration];
    this.currentTime = 0;
    this.isPlaying = false;
    this.thumbnails = [];
    this.isLoadingThumbnails = true;
    this.isLoading = false; // Guard against double-loading

    // DOM refs (will be set when rendered)
    this.videoElement = null;
    this.timelineElement = null;
    this.startHandleElement = null;
    this.endHandleElement = null;

    // Callbacks
    this.onReady = options.onReady || (() => {});
    this.onTrimChange = options.onTrimChange || (() => {});
    this.onError = options.onError || (() => {});
  }

  /**
   * Create the trimmer UI elements
   * @returns {HTMLElement} Container element
   */
  render() {
    const container = document.createElement('div');
    container.className = 'ff-video-trimmer';
    container.innerHTML = `
      <div class="ff-trimmer-video-container">
        <video class="ff-trimmer-video" preload="metadata"></video>
      </div>

      <div class="ff-trimmer-timeline">
        <div class="ff-trimmer-thumbnails"></div>
        <div class="ff-trimmer-selection">
          <div class="ff-trimmer-handle ff-trimmer-handle-start"></div>
          <div class="ff-trimmer-selection-bar"></div>
          <div class="ff-trimmer-handle ff-trimmer-handle-end"></div>
        </div>
        <div class="ff-trimmer-playhead"></div>
      </div>

      <div class="ff-trimmer-controls">
        <button class="ff-trimmer-btn ff-trimmer-btn-play">
          ${Icons.get('play', 16)}
        </button>

        <button class="ff-trimmer-btn ff-trimmer-btn-in" title="Set In Point (I)">
          <span class="ff-trimmer-btn-label">In</span>
        </button>

        <div class="ff-trimmer-time-display">
          <span class="ff-trimmer-time-start">0:00</span>
          <span class="ff-trimmer-time-separator"> - </span>
          <span class="ff-trimmer-time-end">0:00</span>
          <span class="ff-trimmer-time-duration"> (0:00)</span>
        </div>

        <button class="ff-trimmer-btn ff-trimmer-btn-out" title="Set Out Point (O)">
          <span class="ff-trimmer-btn-label">Out</span>
        </button>

        <button class="ff-trimmer-btn ff-trimmer-btn-reset" title="Reset to original">
          ${Icons.get('refresh-cw', 16)}
        </button>
      </div>
    `;

    // Store references
    this.videoElement = container.querySelector('.ff-trimmer-video');
    this.timelineElement = container.querySelector('.ff-trimmer-timeline');
    this.thumbnailsElement = container.querySelector('.ff-trimmer-thumbnails');
    this.selectionElement = container.querySelector('.ff-trimmer-selection');
    this.startHandleElement = container.querySelector('.ff-trimmer-handle-start');
    this.endHandleElement = container.querySelector('.ff-trimmer-handle-end');
    this.playheadElement = container.querySelector('.ff-trimmer-playhead');
    this.playButton = container.querySelector('.ff-trimmer-btn-play');
    this.inButton = container.querySelector('.ff-trimmer-btn-in');
    this.outButton = container.querySelector('.ff-trimmer-btn-out');
    this.resetButton = container.querySelector('.ff-trimmer-btn-reset');
    this.timeDisplays = {
      start: container.querySelector('.ff-trimmer-time-start'),
      end: container.querySelector('.ff-trimmer-time-end'),
      duration: container.querySelector('.ff-trimmer-time-duration')
    };

    // Setup event listeners
    this.setupEventListeners();

    // Note: loadVideo() should be called explicitly by the parent component
    // after render() to allow proper async handling

    return container;
  }

  /**
   * Load video and extract metadata
   */
  async loadVideo() {
    // Guard against double-loading
    if (this.isLoading) {
      console.warn('[VideoTrimmer] loadVideo() already in progress, skipping');
      return;
    }
    this.isLoading = true;

    try {
      // Validate file before loading
      if (!this.videoFile || this.videoFile.size === 0) {
        throw new Error('Empty or invalid video file');
      }

      // Check file size (max 2GB)
      const MAX_SIZE = 2 * 1024 * 1024 * 1024;
      if (this.videoFile.size > MAX_SIZE) {
        throw new Error('Video file is too large (max 2GB)');
      }

      // Try to get duration using FFprobe first (safer, avoids Chromium crashes)
      const filePath = this.videoFile.path;

      if (filePath && window.kolboDesktop?.ffmpeg?.probeFile) {
        console.log('[VideoTrimmer] Using FFprobe to get duration...');
        try {
          const result = await window.kolboDesktop.ffmpeg.probeFile(filePath);
          const metadata = result?.metadata; // IPC wraps result in { success, metadata }

          if (metadata?.format?.duration) {
            this.duration = parseFloat(metadata.format.duration);
            console.log('[VideoTrimmer] FFprobe duration:', this.duration);

            // Set initial trim points
            const maxEnd = Math.min(this.maxDuration, this.duration);
            this.trimPoints = [0, maxEnd];
            this.originalTrimPoints = [0, maxEnd];

            // Update UI
            this.updateTimelineSelection();
            this.updateTimeDisplays();

            // Create blob URL for video (but defer loading)
            try {
              this.videoUrl = URL.createObjectURL(this.videoFile);
              console.log('[VideoTrimmer] Created blob URL');
            } catch (e) {
              console.warn('[VideoTrimmer] Could not create blob URL');
            }

            // Now load video for thumbnails (with the video element)
            await this.loadVideoForThumbnails();
          } else {
            throw new Error('FFprobe returned no duration');
          }
        } catch (probeError) {
          console.warn('[VideoTrimmer] FFprobe failed, falling back to browser:', probeError);
          await this.loadVideoViaBrowser();
        }
      } else {
        // No file path available, use browser loading
        console.log('[VideoTrimmer] No file path, using browser to load...');
        await this.loadVideoViaBrowser();
      }

      // Mark as ready immediately — don't wait for thumbnails
      this.isLoadingThumbnails = false;
      this.onReady({
        duration: this.duration,
        trimPoints: this.trimPoints
      });

      // Generate thumbnails in the background (non-blocking)
      this.generateThumbnails().catch(err => {
        console.warn('[VideoTrimmer] Background thumbnail generation failed:', err);
      });

    } catch (error) {
      console.error('[VideoTrimmer] Failed to load video:', error);
      this.isLoading = false;
      this.onError(error);
    }
  }

  /**
   * Load video via browser (fallback when FFprobe not available)
   */
  async loadVideoViaBrowser() {
    console.log('[VideoTrimmer] Loading video via browser...');

    // Create blob URL
    try {
      this.videoUrl = URL.createObjectURL(this.videoFile);
    } catch (urlError) {
      throw new Error('Failed to create video URL');
    }

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 50));

    this.videoElement.src = this.videoUrl;

    // Wait for metadata
    await new Promise((resolve, reject) => {
      let resolved = false;

      const cleanup = () => {
        this.videoElement.onloadedmetadata = null;
        this.videoElement.onerror = null;
      };

      this.videoElement.onloadedmetadata = () => {
        if (resolved) return;
        resolved = true;
        cleanup();

        this.duration = this.videoElement.duration;

        if (!this.duration || !isFinite(this.duration) || this.duration <= 0) {
          reject(new Error('Invalid video duration'));
          return;
        }

        const maxEnd = Math.min(this.maxDuration, this.duration);
        this.trimPoints = [0, maxEnd];
        this.originalTrimPoints = [0, maxEnd];

        this.updateTimelineSelection();
        this.updateTimeDisplays();

        resolve();
      };

      this.videoElement.onerror = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new Error('Failed to load video file'));
      };

      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new Error('Video load timeout'));
      }, 15000);
    });
  }

  /**
   * Load video for thumbnail generation (after FFprobe got duration)
   */
  async loadVideoForThumbnails() {
    if (!this.videoUrl) return;

    console.log('[VideoTrimmer] Loading video for thumbnails...');

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 50));

    this.videoElement.src = this.videoUrl;

    // Wait for video to be ready enough for seeking
    await new Promise((resolve, reject) => {
      let resolved = false;

      const cleanup = () => {
        this.videoElement.onloadeddata = null;
        this.videoElement.onerror = null;
      };

      this.videoElement.onloadeddata = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve();
      };

      this.videoElement.onerror = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        console.warn('[VideoTrimmer] Video loading failed, thumbnails may not work');
        resolve(); // Don't reject - thumbnails are optional
      };

      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(); // Timeout is OK - thumbnails are optional
      }, 10000);
    });
  }

  /**
   * Generate thumbnail preview images
   */
  async generateThumbnails() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Set canvas size
    canvas.width = 160;
    canvas.height = 90;

    this.thumbnails = [];

    for (let i = 0; i < this.thumbnailCount; i++) {
      const time = (this.duration / this.thumbnailCount) * i;

      try {
        // Seek to time
        this.videoElement.currentTime = time;

        // Wait for seek
        await new Promise((resolve) => {
          this.videoElement.onseeked = resolve;
          setTimeout(resolve, 100); // Timeout fallback
        });

        // Draw frame to canvas
        ctx.drawImage(this.videoElement, 0, 0, canvas.width, canvas.height);

        // Convert to data URL
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        this.thumbnails.push(dataUrl);

        // Create thumbnail element
        const thumbEl = document.createElement('div');
        thumbEl.className = 'ff-trimmer-thumbnail';
        thumbEl.style.backgroundImage = `url(${dataUrl})`;
        thumbEl.style.flex = `1 1 ${100 / this.thumbnailCount}%`;
        this.thumbnailsElement.appendChild(thumbEl);

      } catch (error) {
        console.warn('[VideoTrimmer] Failed to generate thumbnail:', i, error);
      }
    }

    // Reset video to start
    this.videoElement.currentTime = 0;
  }

  /**
   * Setup all event listeners
   */
  setupEventListeners() {
    // Video playback events
    this.videoElement.addEventListener('play', () => {
      this.isPlaying = true;
      this.updatePlayButton();
    });

    this.videoElement.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayButton();
    });

    this.videoElement.addEventListener('timeupdate', () => {
      this.currentTime = this.videoElement.currentTime;
      this.updatePlayhead();

      // Keep playback within trim range (handles out-point and dragged in-point past current time)
      if (this.currentTime >= this.trimPoints[1] || this.currentTime < this.trimPoints[0]) {
        this.videoElement.pause();
        this.videoElement.currentTime = this.trimPoints[0];
      }
    });

    // Play button
    this.playButton.addEventListener('click', () => {
      this.togglePlay();
    });

    // In button - set start point at current time
    this.inButton.addEventListener('click', () => {
      this.setInPoint();
    });

    // Out button - set end point at current time
    this.outButton.addEventListener('click', () => {
      this.setOutPoint();
    });

    // Reset button
    this.resetButton.addEventListener('click', () => {
      this.resetTrimPoints();
    });

    // Keyboard shortcuts
    this.keyboardHandler = (e) => {
      // Only handle if trimmer is active and focus is not on an input element
      if (!this.videoElement) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        this.setInPoint();
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        this.setOutPoint();
      } else if (e.key === ' ') {
        e.preventDefault();
        this.togglePlay();
      }
    };
    document.addEventListener('keydown', this.keyboardHandler);

    // Timeline interaction
    this.setupTimelineInteraction();

    // Handle dragging
    this.setupHandleDragging();
  }

  /**
   * Setup timeline click/drag interaction
   */
  setupTimelineInteraction() {
    this.timelineElement.addEventListener('click', (e) => {
      // Don't trigger if clicking on handles
      if (e.target.classList.contains('ff-trimmer-handle')) return;

      const rect = this.timelineElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = x / rect.width;
      const rawTime = percent * this.duration;

      // Clamp seek position within in/out range
      const time = Math.max(this.trimPoints[0], Math.min(rawTime, this.trimPoints[1]));

      this.videoElement.currentTime = time;
    });
  }

  /**
   * Setup handle dragging functionality
   */
  setupHandleDragging() {
    let draggedHandle = null;

    const onMouseDown = (e, handle) => {
      e.preventDefault();
      e.stopPropagation();
      draggedHandle = handle;

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!draggedHandle) return;

      const rect = this.timelineElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let newPercent = x / rect.width;

      // Clamp to 0-1
      newPercent = Math.max(0, Math.min(1, newPercent));

      const newTime = newPercent * this.duration;

      if (draggedHandle === 'start') {
        // Don't allow start to go past end
        const maxStart = this.trimPoints[1] - this.minDuration;
        this.trimPoints[0] = Math.max(0, Math.min(newTime, maxStart));
      } else {
        // Don't allow end to go before start
        const minEnd = this.trimPoints[0] + this.minDuration;
        this.trimPoints[1] = Math.min(this.duration, Math.max(newTime, minEnd));
      }

      // Enforce max duration
      const duration = this.trimPoints[1] - this.trimPoints[0];
      if (duration > this.maxDuration) {
        if (draggedHandle === 'start') {
          this.trimPoints[0] = this.trimPoints[1] - this.maxDuration;
        } else {
          this.trimPoints[1] = this.trimPoints[0] + this.maxDuration;
        }
      }

      this.updateTimelineSelection();
      this.updateTimeDisplays();
      this.onTrimChange(this.trimPoints);
    };

    const onMouseUp = () => {
      draggedHandle = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    this.startHandleElement.addEventListener('mousedown', (e) => onMouseDown(e, 'start'));
    this.endHandleElement.addEventListener('mousedown', (e) => onMouseDown(e, 'end'));
  }

  /**
   * Update timeline selection visual
   */
  updateTimelineSelection() {
    const startPercent = (this.trimPoints[0] / this.duration) * 100;
    const endPercent = (this.trimPoints[1] / this.duration) * 100;

    this.selectionElement.style.left = `${startPercent}%`;
    this.selectionElement.style.width = `${endPercent - startPercent}%`;
  }

  /**
   * Update playhead position
   */
  updatePlayhead() {
    const percent = (this.currentTime / this.duration) * 100;
    this.playheadElement.style.left = `${percent}%`;
  }

  /**
   * Update time displays
   */
  updateTimeDisplays() {
    this.timeDisplays.start.textContent = this.formatTime(this.trimPoints[0]);
    this.timeDisplays.end.textContent = this.formatTime(this.trimPoints[1]);

    const duration = this.trimPoints[1] - this.trimPoints[0];
    this.timeDisplays.duration.textContent = ` (${this.formatTime(duration)})`;
  }

  /**
   * Update play button icon
   */
  updatePlayButton() {
    const icon = this.isPlaying
      ? '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>' // Pause icon
      : '<path d="M8 5v14l11-7z"/>'; // Play icon

    this.playButton.querySelector('svg').innerHTML = icon;
  }

  /**
   * Toggle play/pause
   */
  togglePlay() {
    if (this.isPlaying) {
      this.videoElement.pause();
    } else {
      // Only reset to in-point if current position is outside the trim range
      const ct = this.videoElement.currentTime;
      if (ct < this.trimPoints[0] || ct >= this.trimPoints[1]) {
        this.videoElement.currentTime = this.trimPoints[0];
      }
      this.videoElement.play();
    }
  }

  /**
   * Set In point (start) at current playback position
   */
  setInPoint() {
    const currentTime = this.videoElement.currentTime;

    // Don't allow start to go past end (minus minimum duration)
    const maxStart = this.trimPoints[1] - this.minDuration;
    this.trimPoints[0] = Math.min(currentTime, maxStart);

    // Update UI
    this.updateTimelineSelection();
    this.updateTimeDisplays();
    this.onTrimChange(this.trimPoints);

    // Visual feedback - flash the button
    this.flashButton(this.inButton);

    console.log('[VideoTrimmer] In point set to:', this.formatTime(this.trimPoints[0]));
  }

  /**
   * Set Out point (end) at current playback position
   */
  setOutPoint() {
    const currentTime = this.videoElement.currentTime;

    // Don't allow end to go before start (plus minimum duration)
    const minEnd = this.trimPoints[0] + this.minDuration;
    let newEnd = Math.max(currentTime, minEnd);

    // Enforce max duration
    const proposedDuration = newEnd - this.trimPoints[0];
    if (proposedDuration > this.maxDuration) {
      newEnd = this.trimPoints[0] + this.maxDuration;
    }

    this.trimPoints[1] = newEnd;

    // Update UI
    this.updateTimelineSelection();
    this.updateTimeDisplays();
    this.onTrimChange(this.trimPoints);

    // Visual feedback - flash the button
    this.flashButton(this.outButton);

    console.log('[VideoTrimmer] Out point set to:', this.formatTime(this.trimPoints[1]));
  }

  /**
   * Flash a button for visual feedback
   */
  flashButton(button) {
    button.classList.add('ff-trimmer-btn-flash');
    setTimeout(() => {
      button.classList.remove('ff-trimmer-btn-flash');
    }, 200);
  }

  /**
   * Reset trim points to original
   */
  resetTrimPoints() {
    this.trimPoints = [...this.originalTrimPoints];
    this.updateTimelineSelection();
    this.updateTimeDisplays();
    this.onTrimChange(this.trimPoints);
  }

  /**
   * Format time in seconds to MM:SS
   */
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * Get current trim points
   */
  getTrimPoints() {
    return this.trimPoints;
  }

  /**
   * Check if trim points have been modified
   */
  hasModified() {
    return this.trimPoints[0] !== this.originalTrimPoints[0] ||
           this.trimPoints[1] !== this.originalTrimPoints[1];
  }

  /**
   * Cleanup resources
   */
  destroy() {
    // Remove keyboard listener
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler);
      this.keyboardHandler = null;
    }

    // Clear thumbnails to release memory
    if (this.thumbnailsElement) {
      this.thumbnailsElement.innerHTML = '';
    }
    this.thumbnails = [];

    // Cleanup video element
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.removeAttribute('src');
      this.videoElement.load(); // Reset the element
    }

    // Revoke object URL
    if (this.videoUrl) {
      URL.revokeObjectURL(this.videoUrl);
      this.videoUrl = null;
    }

    // Null all DOM references to allow garbage collection
    this.videoElement = null;
    this.timelineElement = null;
    this.thumbnailsElement = null;
    this.selectionElement = null;
    this.startHandleElement = null;
    this.endHandleElement = null;
    this.playheadElement = null;
    this.playButton = null;
    this.inButton = null;
    this.outButton = null;
    this.resetButton = null;
    this.timeDisplays = null;
  }
}

console.log('[VideoTrimmer] Loaded successfully');

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoTrimmer;
}
