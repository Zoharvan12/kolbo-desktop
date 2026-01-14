// Kolbo Studio - Audio Trimmer Component
// Waveform-based trimmer for audio files with visual feedback

console.log('[AudioTrimmer] Loading...');

class AudioTrimmer {
  constructor(audioFile, options = {}) {
    this.audioFile = audioFile;
    this.audioUrl = URL.createObjectURL(audioFile);

    // Options
    this.maxDuration = options.maxDuration || 300; // 5 minutes default
    this.minDuration = options.minDuration || 1; // 1 second minimum
    this.waveformHeight = options.waveformHeight || 120;
    this.waveformSamples = options.waveformSamples || 500;

    // State
    this.duration = 0;
    this.trimPoints = [0, this.maxDuration]; // [start, end]
    this.originalTrimPoints = [0, this.maxDuration];
    this.currentTime = 0;
    this.isPlaying = false;
    this.audioBuffer = null;
    this.waveformData = [];
    this.isLoadingWaveform = true;

    // DOM refs (will be set when rendered)
    this.audioElement = null;
    this.waveformElement = null;
    this.canvasElement = null;
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
    container.className = 'ff-audio-trimmer';
    container.innerHTML = `
      <div class="ff-trimmer-waveform-container">
        <canvas class="ff-trimmer-waveform"></canvas>
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

      <audio style="display: none;"></audio>
    `;

    // Store references
    this.audioElement = container.querySelector('audio');
    this.waveformContainer = container.querySelector('.ff-trimmer-waveform-container');
    this.canvasElement = container.querySelector('.ff-trimmer-waveform');
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

    // Setup canvas size
    const rect = this.waveformContainer.getBoundingClientRect();
    this.canvasElement.width = rect.width || 600;
    this.canvasElement.height = this.waveformHeight;

    // Setup event listeners
    this.setupEventListeners();

    // Load audio
    this.loadAudio();

    return container;
  }

  /**
   * Load audio and process waveform
   */
  async loadAudio() {
    try {
      // Set audio source
      this.audioElement.src = this.audioUrl;

      // Wait for metadata
      await new Promise((resolve, reject) => {
        this.audioElement.onloadedmetadata = () => {
          this.duration = this.audioElement.duration;

          // Set initial trim points
          const maxEnd = Math.min(this.maxDuration, this.duration);
          this.trimPoints = [0, maxEnd];
          this.originalTrimPoints = [0, maxEnd];

          // Update UI
          this.updateTimelineSelection();
          this.updateTimeDisplays();

          resolve();
        };

        this.audioElement.onerror = (error) => {
          console.error('[AudioTrimmer] Audio load error:', error);
          this.onError(new Error('Failed to load audio'));
          reject(error);
        };

        // Timeout fallback
        setTimeout(() => reject(new Error('Audio load timeout')), 10000);
      });

      // Process audio buffer for waveform
      await this.processAudioBuffer();

      // Draw waveform
      this.drawWaveform();

      // Mark as ready
      this.isLoadingWaveform = false;
      this.onReady({
        duration: this.duration,
        trimPoints: this.trimPoints
      });

    } catch (error) {
      console.error('[AudioTrimmer] Failed to load audio:', error);
      this.onError(error);
    }
  }

  /**
   * Process audio file to extract waveform data
   */
  async processAudioBuffer() {
    try {
      // Read audio file as ArrayBuffer
      const arrayBuffer = await this.audioFile.arrayBuffer();

      // Create AudioContext
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();

      // Decode audio data
      this.audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Extract waveform data
      const rawData = this.audioBuffer.getChannelData(0); // Get first channel
      const samples = this.waveformSamples;
      const blockSize = Math.floor(rawData.length / samples);

      this.waveformData = [];

      for (let i = 0; i < samples; i++) {
        const start = blockSize * i;
        let sum = 0;

        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(rawData[start + j]);
        }

        this.waveformData.push(sum / blockSize);
      }

      // Normalize waveform data
      const max = Math.max(...this.waveformData);
      this.waveformData = this.waveformData.map(v => v / max);

      // Close audio context to free resources
      audioContext.close();

    } catch (error) {
      console.error('[AudioTrimmer] Failed to process audio buffer:', error);
      // Create dummy waveform data as fallback
      this.waveformData = new Array(this.waveformSamples).fill(0.5);
    }
  }

  /**
   * Draw waveform on canvas
   */
  drawWaveform() {
    const canvas = this.canvasElement;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    // Draw waveform
    const barWidth = width / this.waveformData.length;
    const middleY = height / 2;

    ctx.fillStyle = '#3b82f6';

    this.waveformData.forEach((value, index) => {
      const barHeight = value * middleY * 0.9;
      const x = index * barWidth;

      // Draw bar (symmetric around middle)
      ctx.fillRect(x, middleY - barHeight, barWidth - 1, barHeight * 2);
    });
  }

  /**
   * Setup all event listeners
   */
  setupEventListeners() {
    // Audio playback events
    this.audioElement.addEventListener('play', () => {
      this.isPlaying = true;
      this.updatePlayButton();
    });

    this.audioElement.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayButton();
    });

    this.audioElement.addEventListener('timeupdate', () => {
      this.currentTime = this.audioElement.currentTime;
      this.updatePlayhead();

      // Loop within trim range
      if (this.currentTime >= this.trimPoints[1]) {
        this.audioElement.pause();
        this.audioElement.currentTime = this.trimPoints[0];
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

    // Waveform interaction
    this.setupWaveformInteraction();

    // Handle dragging
    this.setupHandleDragging();
  }

  /**
   * Setup waveform click/drag interaction
   */
  setupWaveformInteraction() {
    this.waveformContainer.addEventListener('click', (e) => {
      // Don't trigger if clicking on handles
      if (e.target.classList.contains('ff-trimmer-handle')) return;

      const rect = this.waveformContainer.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = x / rect.width;
      const time = percent * this.duration;

      // Seek to clicked time
      this.audioElement.currentTime = time;
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

      const rect = this.waveformContainer.getBoundingClientRect();
      const handleX = handle === 'start'
        ? this.startHandleElement.offsetLeft
        : this.endHandleElement.offsetLeft;
      startPercent = handleX / rect.width;

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!draggedHandle) return;

      const rect = this.waveformContainer.getBoundingClientRect();
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
      this.audioElement.pause();
    } else {
      this.audioElement.currentTime = this.trimPoints[0];
      this.audioElement.play();
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
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = '';
    }

    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
    }
  }
}

console.log('[AudioTrimmer] Loaded successfully');

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioTrimmer;
}
