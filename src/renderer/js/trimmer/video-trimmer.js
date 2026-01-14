// Kolbo Studio - Video Trimmer Component
// Visual timeline trimmer for video files with thumbnail preview

console.log('[VideoTrimmer] Loading...');

class VideoTrimmer {
  constructor(videoFile, options = {}) {
    this.videoFile = videoFile;
    this.videoUrl = URL.createObjectURL(videoFile);

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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </button>

        <div class="ff-trimmer-time-display">
          <span class="ff-trimmer-time-start">0:00</span>
          <span class="ff-trimmer-time-separator"> - </span>
          <span class="ff-trimmer-time-end">0:00</span>
          <span class="ff-trimmer-time-duration"> (0:00)</span>
        </div>

        <button class="ff-trimmer-btn ff-trimmer-btn-reset" title="Reset to original">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 4v6h6M23 20v-6h-6"/>
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
          </svg>
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
    try {
      this.videoElement.src = this.videoUrl;

      // Wait for metadata
      await new Promise((resolve, reject) => {
        this.videoElement.onloadedmetadata = () => {
          this.duration = this.videoElement.duration;

          // Set initial trim points
          const maxEnd = Math.min(this.maxDuration, this.duration);
          this.trimPoints = [0, maxEnd];
          this.originalTrimPoints = [0, maxEnd];

          // Update UI
          this.updateTimelineSelection();
          this.updateTimeDisplays();

          resolve();
        };

        this.videoElement.onerror = (error) => {
          console.error('[VideoTrimmer] Video load error:', error);
          this.onError(new Error('Failed to load video'));
          reject(error);
        };

        // Timeout fallback
        setTimeout(() => reject(new Error('Video load timeout')), 10000);
      });

      // Generate thumbnails
      await this.generateThumbnails();

      // Mark as ready
      this.isLoadingThumbnails = false;
      this.onReady({
        duration: this.duration,
        trimPoints: this.trimPoints
      });

    } catch (error) {
      console.error('[VideoTrimmer] Failed to load video:', error);
      this.onError(error);
    }
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
          setTimeout(resolve, 500); // Timeout fallback
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

      // Loop within trim range
      if (this.currentTime >= this.trimPoints[1]) {
        this.videoElement.pause();
        this.videoElement.currentTime = this.trimPoints[0];
      }
    });

    // Play button
    this.playButton.addEventListener('click', () => {
      this.togglePlay();
    });

    // Reset button
    this.resetButton.addEventListener('click', () => {
      this.resetTrimPoints();
    });

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
      const time = percent * this.duration;

      // Seek to clicked time
      this.videoElement.currentTime = time;
    });
  }

  /**
   * Setup handle dragging functionality
   */
  setupHandleDragging() {
    let draggedHandle = null;
    let startX = 0;
    let startPercent = 0;

    const onMouseDown = (e, handle) => {
      e.preventDefault();
      draggedHandle = handle;
      startX = e.clientX;

      const rect = this.timelineElement.getBoundingClientRect();
      const handleX = handle === 'start'
        ? this.startHandleElement.offsetLeft
        : this.endHandleElement.offsetLeft;
      startPercent = handleX / rect.width;

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!draggedHandle) return;

      const rect = this.timelineElement.getBoundingClientRect();
      const deltaX = e.clientX - startX;
      const deltaPercent = deltaX / rect.width;
      let newPercent = startPercent + deltaPercent;

      // Clamp to 0-1
      newPercent = Math.max(0, Math.min(1, newPercent));

      const newTime = newPercent * this.duration;

      if (draggedHandle === 'start') {
        // Don't allow start to go past end
        const maxStart = this.trimPoints[1] - this.minDuration;
        this.trimPoints[0] = Math.min(newTime, maxStart);
      } else {
        // Don't allow end to go before start
        const minEnd = this.trimPoints[0] + this.minDuration;
        this.trimPoints[1] = Math.max(newTime, minEnd);
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
      this.videoElement.currentTime = this.trimPoints[0];
      this.videoElement.play();
    }
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
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
    }

    if (this.videoUrl) {
      URL.revokeObjectURL(this.videoUrl);
    }
  }
}

console.log('[VideoTrimmer] Loaded successfully');

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoTrimmer;
}
