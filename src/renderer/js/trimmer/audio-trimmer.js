// Kolbo Studio - Audio Trimmer Component
// Waveform-based trimmer for audio files with visual feedback

console.log('[AudioTrimmer] Loading...');

class AudioTrimmer {
  constructor(audioFile, options = {}) {
    this.audioFile = audioFile;
    this.audioUrl = null; // Defer URL creation to loadAudio()

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
    this.isLoading = false; // Guard against double-loading

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
        <div class="ff-trimmer-waveform-bars">
          <!-- Waveform bars will be generated here -->
        </div>
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 4v6h6M23 20v-6h-6"/>
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
          </svg>
        </button>
      </div>

      <audio style="display: none;" preload="metadata"></audio>
    `;

    // Store references
    this.audioElement = container.querySelector('audio');
    this.waveformContainer = container.querySelector('.ff-trimmer-waveform-container');
    this.waveformBarsContainer = container.querySelector('.ff-trimmer-waveform-bars');
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

    // Note: loadAudio() should be called explicitly by the parent component
    // after render() to allow proper async handling and DOM attachment

    return container;
  }

  /**
   * Validate audio file before loading
   * Checks file size, type, and basic header
   */
  async validateAudioFile() {
    const file = this.audioFile;

    // Check if file exists and has content
    if (!file || file.size === 0) {
      throw new Error('Empty or invalid audio file');
    }

    // Check file size (max 500MB to prevent memory issues)
    const MAX_SIZE = 500 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      throw new Error('Audio file is too large (max 500MB)');
    }

    // Check MIME type
    const validTypes = [
      'audio/wav', 'audio/wave', 'audio/x-wav',
      'audio/mp3', 'audio/mpeg',
      'audio/ogg', 'audio/vorbis',
      'audio/aac', 'audio/mp4', 'audio/x-m4a',
      'audio/flac', 'audio/x-flac',
      'audio/webm'
    ];

    if (file.type && !validTypes.some(t => file.type.includes(t.split('/')[1]))) {
      console.warn('[AudioTrimmer] Unusual audio type:', file.type);
      // Don't reject, just warn - some files have incorrect MIME types
    }

    // Read first few bytes to check file header
    try {
      const header = await this.readFileHeader(file, 12);
      if (!this.isValidAudioHeader(header)) {
        console.warn('[AudioTrimmer] Unrecognized audio header, proceeding anyway');
      }
    } catch (headerError) {
      console.warn('[AudioTrimmer] Could not read file header:', headerError);
      // Don't reject - header check is optional
    }

    console.log('[AudioTrimmer] File validation passed:', file.name, file.size, file.type);
  }

  /**
   * Read first N bytes of file
   */
  async readFileHeader(file, bytes) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(new Uint8Array(reader.result));
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file.slice(0, bytes));
    });
  }

  /**
   * Check if file header matches known audio formats
   */
  isValidAudioHeader(header) {
    if (!header || header.length < 4) return false;

    // WAV: RIFF....WAVE
    if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
      return true; // RIFF header
    }

    // MP3: ID3 tag or frame sync
    if ((header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) || // ID3
        (header[0] === 0xFF && (header[1] & 0xE0) === 0xE0)) { // Frame sync
      return true;
    }

    // OGG: OggS
    if (header[0] === 0x4F && header[1] === 0x67 && header[2] === 0x67 && header[3] === 0x53) {
      return true;
    }

    // FLAC: fLaC
    if (header[0] === 0x66 && header[1] === 0x4C && header[2] === 0x61 && header[3] === 0x43) {
      return true;
    }

    // M4A/AAC: ftyp
    if (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) {
      return true;
    }

    return false;
  }

  /**
   * Load audio and process waveform
   */
  async loadAudio() {
    // Guard against double-loading
    if (this.isLoading) {
      console.warn('[AudioTrimmer] loadAudio() already in progress, skipping');
      return;
    }
    this.isLoading = true;

    try {
      // Pre-validate the audio file before loading
      await this.validateAudioFile();

      // Try to get duration using FFprobe (safer, avoids Chromium crashes)
      // This requires the file to have a path (Electron file objects do)
      const filePath = this.audioFile.path;

      if (filePath && window.kolboDesktop?.ffmpeg?.probeFile) {
        console.log('[AudioTrimmer] Using FFprobe to get duration...');
        try {
          const result = await window.kolboDesktop.ffmpeg.probeFile(filePath);
          const metadata = result?.metadata;

          if (metadata?.format?.duration) {
            this.duration = parseFloat(metadata.format.duration);
            console.log('[AudioTrimmer] FFprobe duration:', this.duration);

            // Set initial trim points
            const maxEnd = Math.min(this.maxDuration, this.duration);
            this.trimPoints = [0, maxEnd];
            this.originalTrimPoints = [0, maxEnd];

            // Update UI
            this.updateTimelineSelection();
            this.updateTimeDisplays();

            // Create blob URL for playback (but don't auto-load)
            try {
              this.audioUrl = URL.createObjectURL(this.audioFile);
              // Don't set src yet - let user click play first
              console.log('[AudioTrimmer] Created blob URL for playback');
            } catch (e) {
              console.warn('[AudioTrimmer] Could not create blob URL for playback');
            }
          } else {
            throw new Error('FFprobe returned no duration');
          }
        } catch (probeError) {
          console.warn('[AudioTrimmer] FFprobe failed, falling back to browser:', probeError);
          await this.loadAudioViaBrowser();
        }
      } else {
        // No file path available, use browser loading
        console.log('[AudioTrimmer] No file path, using browser to load...');
        await this.loadAudioViaBrowser();
      }

      // Draw placeholder waveform bars first (so UI is responsive)
      this.waveformData = this.generatePlaceholderWaveform(this.waveformSamples);
      this.renderWaveformBars();

      // Mark as ready immediately - waveform will update in background
      this.isLoadingWaveform = false;
      this.onReady({
        duration: this.duration,
        trimPoints: this.trimPoints
      });

      // Extract accurate waveform using FFmpeg (safe, runs in main process)
      if (filePath && window.kolboDesktop?.ffmpeg?.extractWaveform) {
        console.log('[AudioTrimmer] Extracting accurate waveform via FFmpeg...');
        try {
          const result = await window.kolboDesktop.ffmpeg.extractWaveform(filePath, this.waveformSamples);
          if (result?.success && result.waveformData) {
            this.waveformData = result.waveformData;
            this.renderWaveformBars();
            console.log('[AudioTrimmer] Accurate waveform rendered');
          } else {
            console.warn('[AudioTrimmer] Waveform extraction returned no data, keeping placeholder');
          }
        } catch (waveformError) {
          console.warn('[AudioTrimmer] Waveform extraction failed, keeping placeholder:', waveformError);
        }
      } else {
        console.log('[AudioTrimmer] Using placeholder waveform (FFmpeg not available)');
      }

    } catch (error) {
      console.error('[AudioTrimmer] Failed to load audio:', error);
      this.isLoading = false;
      this.onError(error);
    }
  }

  /**
   * Fallback: Load audio via browser (may crash on some files)
   */
  async loadAudioViaBrowser() {
    console.log('[AudioTrimmer] Loading audio via browser...');

    // Create blob URL
    try {
      this.audioUrl = URL.createObjectURL(this.audioFile);
    } catch (urlError) {
      console.error('[AudioTrimmer] Failed to create blob URL:', urlError);
      throw new Error('Failed to create audio URL');
    }

    // Small delay before loading
    await new Promise(resolve => setTimeout(resolve, 50));

    // Set audio source
    this.audioElement.src = this.audioUrl;

    // Wait for metadata
    await new Promise((resolve, reject) => {
      let resolved = false;

      const cleanup = () => {
        this.audioElement.onloadedmetadata = null;
        this.audioElement.onerror = null;
      };

      this.audioElement.onloadedmetadata = () => {
        if (resolved) return;
        resolved = true;
        cleanup();

        this.duration = this.audioElement.duration;

        if (!this.duration || !isFinite(this.duration) || this.duration <= 0) {
          reject(new Error('Invalid audio duration'));
          return;
        }

        const maxEnd = Math.min(this.maxDuration, this.duration);
        this.trimPoints = [0, maxEnd];
        this.originalTrimPoints = [0, maxEnd];

        this.updateTimelineSelection();
        this.updateTimeDisplays();

        resolve();
      };

      this.audioElement.onerror = (event) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new Error('Failed to load audio file'));
      };

      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new Error('Audio load timeout'));
      }, 15000);
    });
  }

  /**
   * Process audio buffer safely in the background
   * Uses a safer approach that won't crash the renderer
   */
  async processAudioBufferSafe() {
    try {
      await this.processAudioBuffer();
      this.drawWaveform();
    } catch (error) {
      console.warn('[AudioTrimmer] Waveform generation failed, using placeholder:', error.message);
      // Keep the placeholder waveform - trimmer still works fine
    }
  }

  /**
   * Process audio file to extract waveform data
   */
  async processAudioBuffer() {
    let audioContext = null;

    try {
      // Skip waveform generation for very large files (>50MB) to prevent crashes
      const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
      if (this.audioFile.size > MAX_FILE_SIZE) {
        console.log('[AudioTrimmer] File too large for waveform generation, using placeholder');
        throw new Error('File too large for waveform');
      }

      // Read audio file as ArrayBuffer
      const arrayBuffer = await this.audioFile.arrayBuffer();

      // Guard against empty or invalid files
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        throw new Error('Empty audio file');
      }

      // Create AudioContext
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('Web Audio API not supported');
      }
      audioContext = new AudioContextClass();

      // Use a callback-based approach for decodeAudioData (more compatible)
      this.audioBuffer = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Audio decode timeout'));
        }, 30000);

        // Create a copy of the buffer to avoid issues
        const bufferCopy = arrayBuffer.slice(0);

        audioContext.decodeAudioData(
          bufferCopy,
          (buffer) => {
            clearTimeout(timeoutId);
            resolve(buffer);
          },
          (error) => {
            clearTimeout(timeoutId);
            reject(error || new Error('Failed to decode audio'));
          }
        );
      });

      // Guard against invalid buffer
      if (!this.audioBuffer || this.audioBuffer.numberOfChannels === 0) {
        throw new Error('Invalid audio buffer');
      }

      // Extract waveform data
      const rawData = this.audioBuffer.getChannelData(0); // Get first channel
      const samples = this.waveformSamples;
      const blockSize = Math.max(1, Math.floor(rawData.length / samples));

      this.waveformData = [];

      for (let i = 0; i < samples; i++) {
        const start = blockSize * i;
        let sum = 0;
        const end = Math.min(start + blockSize, rawData.length);

        for (let j = start; j < end; j++) {
          sum += Math.abs(rawData[j]);
        }

        this.waveformData.push(sum / (end - start));
      }

      // Normalize waveform data (avoid spread operator for large arrays)
      let max = 0;
      for (let i = 0; i < this.waveformData.length; i++) {
        if (this.waveformData[i] > max) max = this.waveformData[i];
      }
      if (max > 0) {
        for (let i = 0; i < this.waveformData.length; i++) {
          this.waveformData[i] = this.waveformData[i] / max;
        }
      }

      // Release audio buffer memory
      this.audioBuffer = null;

    } catch (error) {
      console.error('[AudioTrimmer] Failed to process audio buffer:', error);
      // Create dummy waveform data as fallback
      this.waveformData = new Array(this.waveformSamples).fill(0.5);
    } finally {
      // Always close audio context to free resources
      if (audioContext) {
        try {
          audioContext.close();
        } catch (e) {
          // Ignore close errors
        }
        audioContext = null;
      }
    }
  }

  /**
   * Generate placeholder waveform data (visually appealing pattern)
   * Similar to the "my media" tab design
   */
  generatePlaceholderWaveform(count) {
    const data = [];
    for (let i = 0; i < count; i++) {
      // Create a wave pattern with some variation
      const baseHeight = Math.sin((i / count) * Math.PI) * 0.6 + 0.3;
      const variance = Math.sin(i * 0.5) * 0.1 + Math.cos(i * 0.8) * 0.08;
      const height = Math.max(0.15, Math.min(0.95, baseHeight + variance));
      data.push(height);
    }
    return data;
  }

  /**
   * Render waveform as HTML bars (like "my media" tab design)
   */
  renderWaveformBars() {
    if (!this.waveformBarsContainer) return;

    // Generate HTML for all bars
    const barsHtml = this.waveformData.map((value, index) => {
      // Scale value to percentage (15-95% range for visual appeal)
      const height = Math.max(15, Math.min(95, value * 80 + 15));
      return `<div class="ff-waveform-bar" data-index="${index}" style="height: ${height}%"></div>`;
    }).join('');

    this.waveformBarsContainer.innerHTML = barsHtml;
  }

  /**
   * Update waveform progress (highlight played portion)
   */
  updateWaveformProgress() {
    if (!this.waveformBarsContainer || !this.duration) return;

    const progress = this.currentTime / this.duration;
    const bars = this.waveformBarsContainer.querySelectorAll('.ff-waveform-bar');
    const playedCount = Math.floor(bars.length * progress);

    bars.forEach((bar, index) => {
      if (index < playedCount) {
        bar.classList.add('played');
      } else {
        bar.classList.remove('played');
      }
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
      // Add playing class for waveform animation
      if (this.waveformContainer) {
        this.waveformContainer.closest('.ff-audio-trimmer')?.classList.add('playing');
      }
    });

    this.audioElement.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayButton();
      // Remove playing class
      if (this.waveformContainer) {
        this.waveformContainer.closest('.ff-audio-trimmer')?.classList.remove('playing');
      }
    });

    this.audioElement.addEventListener('timeupdate', () => {
      this.currentTime = this.audioElement.currentTime;
      this.updatePlayhead();
      this.updateWaveformProgress();

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
      // Only handle if trimmer is active
      if (!this.audioElement) return;

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

    const onMouseDown = (e, handle) => {
      e.preventDefault();
      e.stopPropagation();
      draggedHandle = handle;

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!draggedHandle) return;

      const rect = this.waveformContainer.getBoundingClientRect();
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
      this.audioElement.pause();
    } else {
      // If audio hasn't been loaded yet (FFprobe was used), load it now
      if (!this.audioElement.src && this.audioUrl) {
        console.log('[AudioTrimmer] Loading audio for playback...');
        this.audioElement.src = this.audioUrl;
      }
      this.audioElement.currentTime = this.trimPoints[0];
      this.audioElement.play().catch(err => {
        console.error('[AudioTrimmer] Playback failed:', err);
      });
    }
  }

  /**
   * Set In point (start) at current playback position
   */
  setInPoint() {
    const currentTime = this.audioElement.currentTime;

    // Don't allow start to go past end (minus minimum duration)
    const maxStart = this.trimPoints[1] - this.minDuration;
    this.trimPoints[0] = Math.min(currentTime, maxStart);

    // Update UI
    this.updateTimelineSelection();
    this.updateTimeDisplays();
    this.onTrimChange(this.trimPoints);

    // Visual feedback - flash the button
    this.flashButton(this.inButton);

    console.log('[AudioTrimmer] In point set to:', this.formatTime(this.trimPoints[0]));
  }

  /**
   * Set Out point (end) at current playback position
   */
  setOutPoint() {
    const currentTime = this.audioElement.currentTime;

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

    console.log('[AudioTrimmer] Out point set to:', this.formatTime(this.trimPoints[1]));
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

    // Clear waveform bars
    if (this.waveformBarsContainer) {
      this.waveformBarsContainer.innerHTML = '';
    }

    // Clear waveform data
    this.waveformData = [];
    this.audioBuffer = null;

    // Cleanup audio element
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.removeAttribute('src');
      this.audioElement.load(); // Reset the element
    }

    // Revoke object URL
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }

    // Null all DOM references to allow garbage collection
    this.audioElement = null;
    this.waveformContainer = null;
    this.waveformBarsContainer = null;
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

console.log('[AudioTrimmer] Loaded successfully');

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioTrimmer;
}
