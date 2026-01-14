// Kolbo Studio - Trimmer Modal
// Unified modal dialog for video and audio trimming

console.log('[TrimmerModal] Loading...');

class TrimmerModal {
  constructor() {
    this.isOpen = false;
    this.currentTrimmer = null;
    this.currentFile = null;
    this.fileType = null; // 'video' or 'audio'
    this.onApply = null;
    this.modalElement = null;
    this.trimmerContainer = null;
  }

  /**
   * Open the trimmer modal
   * @param {File} file - Video or audio file to trim
   * @param {string} fileType - 'video' or 'audio'
   * @param {object} options - Trimmer options (maxDuration, minDuration, etc.)
   * @returns {Promise} Promise that resolves with trim points when user applies
   */
  open(file, fileType, options = {}) {
    return new Promise((resolve, reject) => {
      if (this.isOpen) {
        reject(new Error('Modal is already open'));
        return;
      }

      this.currentFile = file;
      this.fileType = fileType;
      this.isOpen = true;

      // Store resolve/reject for later
      this.onApply = (trimPoints) => {
        resolve(trimPoints);
        this.close();
      };

      this.onCancel = () => {
        resolve(null); // null indicates user cancelled
        this.close();
      };

      // Create modal UI
      this.createModal(options);

      // Create appropriate trimmer
      if (fileType === 'video') {
        this.createVideoTrimmer(file, options);
      } else if (fileType === 'audio') {
        this.createAudioTrimmer(file, options);
      } else {
        reject(new Error(`Unsupported file type: ${fileType}`));
        this.close();
      }
    });
  }

  /**
   * Create the modal structure
   */
  createModal(options) {
    // Remove existing modal if any
    const existingModal = document.getElementById('ff-trimmer-modal');
    if (existingModal) existingModal.remove();

    // Create modal overlay
    this.modalElement = document.createElement('div');
    this.modalElement.id = 'ff-trimmer-modal';
    this.modalElement.className = 'ff-trimmer-modal';
    this.modalElement.innerHTML = `
      <div class="ff-trimmer-modal-overlay"></div>
      <div class="ff-trimmer-modal-content">
        <div class="ff-trimmer-modal-header">
          <h3 class="ff-trimmer-modal-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 4 L12 8 L20 12 M20 12 L12 16 L20 20"/>
              <path d="M4 4 L12 8 L4 12 M4 12 L12 16 L4 20"/>
            </svg>
            Trim ${this.fileType === 'video' ? 'Video' : 'Audio'}
          </h3>
          <button class="ff-trimmer-modal-close" title="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div class="ff-trimmer-modal-description">
          ${this.getDescription(options)}
        </div>

        <div class="ff-trimmer-modal-body">
          <!-- Trimmer will be inserted here -->
        </div>

        <div class="ff-trimmer-modal-footer">
          <button class="ff-trimmer-modal-btn ff-trimmer-modal-btn-cancel">
            Cancel
          </button>
          <button class="ff-trimmer-modal-btn ff-trimmer-modal-btn-skip">
            Skip Trim
          </button>
          <button class="ff-trimmer-modal-btn ff-trimmer-modal-btn-apply">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 4 L12 8 L20 12 M20 12 L12 16 L20 20"/>
              <path d="M4 4 L12 8 L4 12 M4 12 L12 16 L4 20"/>
            </svg>
            Apply Trim
          </button>
        </div>
      </div>
    `;

    // Get references
    this.trimmerContainer = this.modalElement.querySelector('.ff-trimmer-modal-body');
    const closeBtn = this.modalElement.querySelector('.ff-trimmer-modal-close');
    const cancelBtn = this.modalElement.querySelector('.ff-trimmer-modal-btn-cancel');
    const skipBtn = this.modalElement.querySelector('.ff-trimmer-modal-btn-skip');
    const applyBtn = this.modalElement.querySelector('.ff-trimmer-modal-btn-apply');
    const overlay = this.modalElement.querySelector('.ff-trimmer-modal-overlay');

    // Event listeners
    closeBtn.addEventListener('click', () => this.onCancel());
    cancelBtn.addEventListener('click', () => this.onCancel());
    skipBtn.addEventListener('click', () => this.handleSkipTrim());
    applyBtn.addEventListener('click', () => this.handleApplyTrim());
    overlay.addEventListener('click', () => this.onCancel());

    // Append to body
    document.body.appendChild(this.modalElement);

    // Trigger animation
    requestAnimationFrame(() => {
      this.modalElement.classList.add('ff-trimmer-modal-open');
    });
  }

  /**
   * Create video trimmer
   */
  async createVideoTrimmer(file, options) {
    // Show loading state
    this.trimmerContainer.innerHTML = `
      <div class="ff-trimmer-loading">
        <div class="ff-trimmer-spinner"></div>
        <p>Loading video...</p>
      </div>
    `;

    // Create video trimmer instance
    this.currentTrimmer = new VideoTrimmer(file, {
      ...options,
      onReady: (data) => {
        console.log('[TrimmerModal] Video trimmer ready:', data);
      },
      onError: (error) => {
        console.error('[TrimmerModal] Video trimmer error:', error);
        this.showError('Failed to load video. Please try again.');
      },
      onTrimChange: (trimPoints) => {
        console.log('[TrimmerModal] Trim points changed:', trimPoints);
      }
    });

    // Render the UI first
    const trimmerElement = this.currentTrimmer.render();

    // Start loading video (this will trigger onReady when done)
    try {
      await this.currentTrimmer.loadVideo();
      // Clear loading state and show trimmer
      this.trimmerContainer.innerHTML = '';
      this.trimmerContainer.appendChild(trimmerElement);
    } catch (error) {
      console.error('[TrimmerModal] Failed to load video:', error);
      this.showError('Failed to load video. Please try again.');
    }
  }

  /**
   * Create audio trimmer
   */
  async createAudioTrimmer(file, options) {
    // Show loading state
    this.trimmerContainer.innerHTML = `
      <div class="ff-trimmer-loading">
        <div class="ff-trimmer-spinner"></div>
        <p>Processing audio...</p>
      </div>
    `;

    // Create audio trimmer instance
    this.currentTrimmer = new AudioTrimmer(file, {
      ...options,
      onReady: (data) => {
        console.log('[TrimmerModal] Audio trimmer ready:', data);
      },
      onError: (error) => {
        console.error('[TrimmerModal] Audio trimmer error:', error);
        this.showError('Failed to load audio. Please try again.');
      },
      onTrimChange: (trimPoints) => {
        console.log('[TrimmerModal] Trim points changed:', trimPoints);
      }
    });

    // Render the UI first
    const trimmerElement = this.currentTrimmer.render();

    // Start loading audio (this will trigger onReady when done)
    try {
      await this.currentTrimmer.loadAudio();
      // Clear loading state and show trimmer
      this.trimmerContainer.innerHTML = '';
      this.trimmerContainer.appendChild(trimmerElement);
    } catch (error) {
      console.error('[TrimmerModal] Failed to load audio:', error);
      this.showError('Failed to load audio. Please try again.');
    }
  }

  /**
   * Show error message in modal
   */
  showError(message) {
    this.trimmerContainer.innerHTML = `
      <div class="ff-trimmer-error">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4m0 4h.01"/>
        </svg>
        <p>${message}</p>
      </div>
    `;
  }

  /**
   * Get description text based on file type and options
   */
  getDescription(options) {
    const maxDuration = options.maxDuration || 300;
    const mins = Math.floor(maxDuration / 60);
    const secs = maxDuration % 60;
    const maxTime = `${mins}:${String(secs).padStart(2, '0')}`;

    if (this.fileType === 'video') {
      return `Select the portion of the video you want to keep (max ${maxTime}). The trimmed video will then be converted to your selected format.`;
    } else {
      return `Select the portion of the audio you want to keep (max ${maxTime}). The trimmed audio will then be converted to your selected format.`;
    }
  }

  /**
   * Handle skip trim - use original file without trimming
   */
  handleSkipTrim() {
    if (this.onApply) {
      // Return null to indicate no trimming
      this.onApply(null);
    }
  }

  /**
   * Handle apply trim - use trimmed version
   */
  handleApplyTrim() {
    if (!this.currentTrimmer) {
      console.error('[TrimmerModal] No trimmer instance available');
      return;
    }

    const trimPoints = this.currentTrimmer.getTrimPoints();
    console.log('[TrimmerModal] Applying trim:', trimPoints);

    // Convert array format [start, end] to object format {start, end}
    const trimData = Array.isArray(trimPoints)
      ? { start: trimPoints[0], end: trimPoints[1] }
      : trimPoints;

    if (this.onApply) {
      this.onApply(trimData);
    }
  }

  /**
   * Close the modal
   */
  close() {
    if (!this.isOpen) return;

    // Cleanup trimmer
    if (this.currentTrimmer) {
      // Cleanup trimmer resources
      if (this.currentTrimmer.destroy) {
        this.currentTrimmer.destroy();
      }

      // Revoke object URLs to free memory
      if (this.currentTrimmer.videoUrl) {
        URL.revokeObjectURL(this.currentTrimmer.videoUrl);
      }
      if (this.currentTrimmer.audioUrl) {
        URL.revokeObjectURL(this.currentTrimmer.audioUrl);
      }

      this.currentTrimmer = null;
    }

    // Animate out
    if (this.modalElement) {
      this.modalElement.classList.remove('ff-trimmer-modal-open');

      // Remove after animation
      setTimeout(() => {
        if (this.modalElement) {
          this.modalElement.remove();
          this.modalElement = null;
        }
      }, 300);
    }

    this.isOpen = false;
    this.currentFile = null;
    this.fileType = null;
    this.trimmerContainer = null;
  }

  /**
   * Check if modal is currently open
   */
  isModalOpen() {
    return this.isOpen;
  }
}

// Export class to global scope
window.TrimmerModal = TrimmerModal;

// Create global singleton instance
window.trimmerModal = new TrimmerModal();

console.log('[TrimmerModal] Loaded successfully');

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TrimmerModal;
}
