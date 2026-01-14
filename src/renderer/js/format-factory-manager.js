// Kolbo Studio - Format Factory Manager
// Handles UI logic for media format conversion

console.log('[Format Factory] Initializing...');

class FormatFactoryManager {
  constructor() {
    this.queue = [];
    this.selectedFormat = null;
    this.selectedType = null;
    this.outputFolder = null; // null = same as source
    this.outputMode = 'source'; // 'source' or 'custom'
    this.currentCategory = 'video'; // default active category
    this.thumbnailGenerating = new Set(); // Track thumbnails being generated
    this.updateTableDebounceTimer = null; // Debounce UI updates

    this.init();
  }

  async init() {
    console.log('[Format Factory] Setting up event listeners...');

    // Load saved settings
    await this.loadSettings();

    // Category accordion buttons
    this.setupCategoryAccordion();

    // Format tile buttons
    this.setupFormatTiles();

    // Drag & Drop
    this.setupDragDrop();

    // Add Files button
    this.setupAddFilesButton();

    // Toolbar buttons
    this.setupToolbarButtons();

    // FFmpeg event listeners
    this.setupFFmpegListeners();

    // Get GPU info
    this.getGPUInfo();

    console.log('[Format Factory] Initialized successfully');
  }

  async loadSettings() {
    try {
      // Load output mode
      const modeResult = await window.kolboDesktop.ffmpeg.getOutputMode();
      if (modeResult.success) {
        this.outputMode = modeResult.outputMode;
        console.log('[Format Factory] Output mode loaded:', this.outputMode);
      }

      // Load output folder
      const folderResult = await window.kolboDesktop.ffmpeg.getOutputFolder();
      if (folderResult.success && folderResult.outputFolder) {
        this.outputFolder = folderResult.outputFolder;
        console.log('[Format Factory] Output folder loaded:', this.outputFolder);
      }

      // Update UI to reflect current settings
      this.updateOutputFolderUI();
    } catch (error) {
      console.error('[Format Factory] Failed to load settings:', error);
    }
  }

  updateOutputFolderUI() {
    const customFolderCheckbox = document.getElementById('ff-use-custom-folder');
    const outputFolderBtn = document.querySelector('[data-action="output-folder"]');

    // Update checkbox state
    if (customFolderCheckbox) {
      customFolderCheckbox.checked = this.outputMode === 'custom';
    }

    // Update button state and text
    if (outputFolderBtn) {
      outputFolderBtn.disabled = this.outputMode !== 'custom';

      // Update button text to show selected folder
      if (this.outputMode === 'custom' && this.outputFolder) {
        const folderName = this.outputFolder.split(/[/\\]/).pop() || 'Custom Folder';
        outputFolderBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          ${folderName}
        `;
        outputFolderBtn.title = this.outputFolder; // Show full path on hover
      } else {
        outputFolderBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          Choose Output Folder
        `;
        outputFolderBtn.title = 'Choose where to save converted files';
      }
    }

    // Update status bar
    this.updateOutputPathDisplay();
  }

  updateOutputPathDisplay() {
    const pathDisplay = document.getElementById('ff-output-path-display');
    if (!pathDisplay) return;

    if (this.outputMode === 'custom' && this.outputFolder) {
      pathDisplay.textContent = this.outputFolder;
      pathDisplay.style.color = 'rgba(59, 130, 246, 0.9)';
    } else {
      pathDisplay.textContent = 'Same as source files';
      pathDisplay.style.color = 'rgba(255, 255, 255, 0.9)';
    }
  }

  setupCategoryAccordion() {
    const categoryButtons = document.querySelectorAll('.ff-category-btn');

    categoryButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const category = btn.dataset.category;
        console.log('[Format Factory] Category clicked:', category);

        // Toggle active state
        const wasActive = btn.classList.contains('active');

        // Close all categories
        document.querySelectorAll('.ff-category-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.ff-format-list').forEach(list => list.classList.remove('active'));

        // If it wasn't active, open it
        if (!wasActive) {
          btn.classList.add('active');
          const formatList = btn.closest('.ff-category-section').querySelector('.ff-format-list');
          if (formatList) {
            formatList.classList.add('active');
          }
          this.currentCategory = category;
        }
      });
    });
  }

  setupFormatTiles() {
    const formatTiles = document.querySelectorAll('.ff-format-tile');

    formatTiles.forEach(tile => {
      tile.addEventListener('click', () => {
        const format = tile.dataset.format;
        const type = tile.dataset.type;

        console.log('[Format Factory] Format tile clicked:', format, type);

        // Visual feedback
        document.querySelectorAll('.ff-format-tile').forEach(t => t.classList.remove('active'));
        tile.classList.add('active');

        // Store pre-selection (user chose format first, then will add files)
        this.preSelectedFormat = format;
        this.preSelectedType = type;

        // Open file picker with filter for this type
        this.openFilePicker(type);
      });
    });
  }

  setupDragDrop() {
    const dropZone = document.querySelector('.ff-drag-drop-zone');
    const mainArea = document.querySelector('.ff-main');

    if (!dropZone) {
      console.warn('[Format Factory] Drag drop zone not found');
      return;
    }

    // Make the entire main area a drop target
    const dropTargets = [dropZone, mainArea];

    dropTargets.forEach(target => {
      if (!target) return;

      // Prevent default drag behaviors
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        target.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
      });

      // Highlight drop zone when dragging over
      ['dragenter', 'dragover'].forEach(eventName => {
        target.addEventListener(eventName, () => {
          dropZone.classList.add('drag-over');
        });
      });

      ['dragleave', 'drop'].forEach(eventName => {
        target.addEventListener(eventName, () => {
          dropZone.classList.remove('drag-over');
        });
      });

      // Handle dropped files
      target.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        console.log('[Format Factory] Files dropped:', files.length);
        this.handleFiles(files);
      });
    });
  }

  setupAddFilesButton() {
    const addFilesBtn = document.querySelector('.ff-btn-add-files');

    if (addFilesBtn) {
      addFilesBtn.addEventListener('click', () => {
        console.log('[Format Factory] Add Files button clicked');
        this.openFilePicker();
      });
    }
  }

  setupToolbarButtons() {
    // Custom folder checkbox
    const customFolderCheckbox = document.getElementById('ff-use-custom-folder');
    const outputFolderBtn = document.querySelector('[data-action="output-folder"]');

    if (customFolderCheckbox) {
      customFolderCheckbox.addEventListener('change', async () => {
        if (customFolderCheckbox.checked) {
          // Enable custom folder mode
          this.outputMode = 'custom';
          if (outputFolderBtn) outputFolderBtn.disabled = false;

          // If no folder selected, prompt for one
          if (!this.outputFolder) {
            await this.changeOutputFolder();
            // If user canceled, uncheck the box
            if (!this.outputFolder) {
              customFolderCheckbox.checked = false;
              this.outputMode = 'source';
              if (outputFolderBtn) outputFolderBtn.disabled = true;
            }
          }

          await window.kolboDesktop.ffmpeg.setOutputMode('custom');
        } else {
          // Use source folder mode
          this.outputMode = 'source';
          if (outputFolderBtn) outputFolderBtn.disabled = true;
          await window.kolboDesktop.ffmpeg.setOutputMode('source');
        }

        this.updateOutputPathDisplay();
        this.updateOutputFolderUI();
      });
    }

    // Output Folder button
    if (outputFolderBtn) {
      outputFolderBtn.addEventListener('click', () => {
        this.changeOutputFolder();
      });
    }

    // Add Files button (toolbar)
    const addFilesToolbarBtn = document.querySelector('[data-action="add-files"]');
    if (addFilesToolbarBtn) {
      addFilesToolbarBtn.addEventListener('click', () => {
        this.openFilePicker();
      });
    }

    // Remove button
    const removeBtn = document.querySelector('[data-action="remove"]');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        this.removeSelected();
      });
    }

    // Clear List button
    const clearBtn = document.querySelector('[data-action="clear"]');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearQueue();
      });
    }

    // Stop button
    const stopBtn = document.querySelector('[data-action="stop"]');
    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        this.stopConversion();
      });
    }

    // Start button
    const startBtn = document.querySelector('[data-action="start"]');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        this.startQueue();
      });
    }

    // Reset button
    const resetBtn = document.querySelector('[data-action="reset"]');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.resetCompleted();
      });
    }
  }

  openFilePicker(filterType) {
    // Create hidden file input
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;

    // Set file type filters
    if (filterType === 'video') {
      input.accept = 'video/*';
    } else if (filterType === 'audio') {
      input.accept = 'audio/*';
    } else if (filterType === 'image') {
      input.accept = 'image/*';
    } else {
      // Accept all media types
      input.accept = 'video/*,audio/*,image/*';
    }

    input.addEventListener('change', (e) => {
      const files = e.target.files;
      console.log('[Format Factory] Files selected:', files.length);
      this.handleFiles(files);
    });

    input.click();
  }

  handleFiles(files) {
    if (!files || files.length === 0) return;

    console.log('[Format Factory] Files received:', files.length);

    // Store files temporarily
    this.pendingFiles = files;

    // If user pre-selected a format from sidebar, use it directly
    if (this.preSelectedFormat && this.preSelectedType) {
      console.log('[Format Factory] Using pre-selected format:', this.preSelectedFormat);
      this.selectedFormat = this.preSelectedFormat;
      this.selectedType = this.preSelectedType;

      // Add files to queue immediately
      Array.from(files).forEach(file => {
        this.addToQueue(file);
      });

      // Clear pre-selection
      this.preSelectedFormat = null;
      this.preSelectedType = null;
      this.pendingFiles = null;

      // Update UI
      this.updateTableUI();
    } else {
      // No pre-selection, show format selection modal
      this.showFormatSelectionModal(files);
    }
  }

  showFormatSelectionModal(files) {
    // Detect file types
    const fileTypes = new Set();
    let hasVideo = false;
    let hasAudio = false;
    let hasImage = false;

    Array.from(files).forEach(file => {
      if (file.type.startsWith('video/')) {
        fileTypes.add('video');
        hasVideo = true;
      } else if (file.type.startsWith('audio/')) {
        fileTypes.add('audio');
        hasAudio = true;
      } else if (file.type.startsWith('image/')) {
        fileTypes.add('image');
        hasImage = true;
      }
    });

    console.log('[Format Factory] File types detected:', Array.from(fileTypes));

    // Show modal
    this.createFormatSelectionModal(files, { hasVideo, hasAudio, hasImage });
  }

  createFormatSelectionModal(files, { hasVideo, hasAudio, hasImage }) {
    // Remove existing modal if any
    const existingModal = document.getElementById('ff-format-modal');
    if (existingModal) existingModal.remove();

    // Create modal overlay
    const modal = document.createElement('div');
    modal.id = 'ff-format-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      animation: fadeIn 0.2s ease;
    `;

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: #1a1a1a;
      border: 1px solid #474747;
      border-radius: 12px;
      padding: 24px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      animation: slideUp 0.3s ease;
    `;

    // Modal header
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #474747;
    `;

    // Create helpful hint for video files
    let hintText = `${files.length} file(s) selected`;
    if (hasVideo && !hasAudio && !hasImage) {
      hintText += ' • You can convert to video or extract audio';
    } else if (hasAudio && !hasVideo && !hasImage) {
      hintText += ' • Convert to any audio format';
    } else if (hasImage && !hasVideo && !hasAudio) {
      hintText += ' • Convert to any image format';
    }

    header.innerHTML = `
      <div>
        <h3 style="margin: 0 0 8px 0; color: #ffffff; font-size: 18px; font-weight: 600;">Select Output Format</h3>
        <p style="margin: 0; color: rgba(255, 255, 255, 0.6); font-size: 13px;">${hintText}</p>
      </div>
      <button id="ff-modal-close" style="background: transparent; border: none; color: rgba(255, 255, 255, 0.6); font-size: 24px; cursor: pointer; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 4px;">×</button>
    `;

    // Format options container
    const formatsContainer = document.createElement('div');
    formatsContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 16px;
    `;

    // Video formats - show if uploading video files OR no files yet (drag & drop zone)
    if (hasVideo || (!hasVideo && !hasAudio && !hasImage)) {
      const videoSection = this.createFormatSection('Video', 'video', [
        { format: 'mp4', label: 'MP4', icon: '🎬', desc: 'Universal format, best compatibility' },
        { format: 'mov', label: 'MOV', icon: '🎬', desc: 'Apple QuickTime format' },
        { format: 'avi', label: 'AVI', icon: '🎬', desc: 'Windows video format' },
        { format: 'mkv', label: 'MKV', icon: '🎬', desc: 'High quality, supports subtitles' },
        { format: 'webm', label: 'WEBM', icon: '🎬', desc: 'Web optimized format' }
      ]);
      formatsContainer.appendChild(videoSection);
    }

    // Audio formats - show if uploading audio OR video (extract audio) OR no files yet
    if (hasAudio || hasVideo || (!hasVideo && !hasAudio && !hasImage)) {
      const audioTitle = hasVideo && !hasAudio ? 'Audio (Extract from Video)' : 'Audio';
      const audioSection = this.createFormatSection(audioTitle, 'audio', [
        { format: 'mp3', label: 'MP3', icon: '🎵', desc: 'Universal audio format' },
        { format: 'wav', label: 'WAV', icon: '🎵', desc: 'Lossless audio quality' },
        { format: 'aac', label: 'AAC', icon: '🎵', desc: 'High quality, small size' },
        { format: 'flac', label: 'FLAC', icon: '🎵', desc: 'Lossless compression' }
      ]);
      formatsContainer.appendChild(audioSection);
    }

    // Image formats - show only if uploading images OR no files yet
    if (hasImage || (!hasVideo && !hasAudio && !hasImage)) {
      const imageSection = this.createFormatSection('Picture', 'image', [
        { format: 'jpg', label: 'JPG', icon: '🖼️', desc: 'Standard photo format' },
        { format: 'png', label: 'PNG', icon: '🖼️', desc: 'Lossless, supports transparency' },
        { format: 'webp', label: 'WEBP', icon: '🖼️', desc: 'Modern web format' },
        { format: 'gif', label: 'GIF', icon: '🖼️', desc: 'Animated images' }
      ]);
      formatsContainer.appendChild(imageSection);
    }

    // Assemble modal
    modalContent.appendChild(header);
    modalContent.appendChild(formatsContainer);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Close button handler
    const closeBtn = modal.querySelector('#ff-modal-close');
    closeBtn.addEventListener('click', () => {
      modal.remove();
      this.pendingFiles = null;
    });

    closeBtn.addEventListener('mouseenter', (e) => {
      e.target.style.background = 'rgba(255, 255, 255, 0.1)';
    });

    closeBtn.addEventListener('mouseleave', (e) => {
      e.target.style.background = 'transparent';
    });

    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        this.pendingFiles = null;
      }
    });

    // Add CSS animations
    if (!document.getElementById('ff-modal-animations')) {
      const style = document.createElement('style');
      style.id = 'ff-modal-animations';
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  createFormatSection(title, type, formats) {
    const section = document.createElement('div');
    section.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    const titleEl = document.createElement('h4');
    titleEl.textContent = title;
    titleEl.style.cssText = `
      margin: 0 0 8px 0;
      color: rgba(255, 255, 255, 0.8);
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    section.appendChild(titleEl);

    const grid = document.createElement('div');
    grid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
    `;

    formats.forEach(fmt => {
      const btn = document.createElement('button');
      btn.dataset.format = fmt.format;
      btn.dataset.type = type;
      btn.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        padding: 12px;
        background: #262626;
        border: 1px solid #474747;
        border-radius: 8px;
        color: #ffffff;
        cursor: pointer;
        transition: all 0.2s ease;
        text-align: left;
      `;

      btn.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; width: 100%;">
          <span style="font-size: 20px;">${fmt.icon}</span>
          <span style="font-size: 14px; font-weight: 600;">${fmt.label}</span>
        </div>
        <span style="font-size: 11px; color: rgba(255, 255, 255, 0.5); line-height: 1.3;">${fmt.desc}</span>
      `;

      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(59, 130, 246, 0.15)';
        btn.style.borderColor = '#3b82f6';
        btn.style.transform = 'translateY(-2px)';
        btn.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.2)';
      });

      btn.addEventListener('mouseleave', () => {
        btn.style.background = '#262626';
        btn.style.borderColor = '#474747';
        btn.style.transform = 'translateY(0)';
        btn.style.boxShadow = 'none';
      });

      btn.addEventListener('click', () => {
        this.onFormatSelected(fmt.format, type);
      });

      grid.appendChild(btn);
    });

    section.appendChild(grid);
    return section;
  }

  onFormatSelected(format, type) {
    console.log('[Format Factory] Format selected from modal:', format, type);

    // Check if we're editing an existing job
    if (this.editingJobId) {
      const job = this.queue.find(j => j.id === this.editingJobId);
      if (job) {
        console.log('[Format Factory] Updating job format:', job.fileName, '→', format);
        job.outputFormat = format;
        job.outputType = type;
        job.settings = this.getDefaultSettings(type, format);
        // Reset progress if job was partially processed
        if (job.status === 'processing' || job.status === 'completed') {
          job.status = 'pending';
          job.progress = 0;
        }
      }
      this.editingJobId = null;
    } else {
      // Adding new files
      this.selectedFormat = format;
      this.selectedType = type;

      // Add pending files to queue
      if (this.pendingFiles) {
        Array.from(this.pendingFiles).forEach(file => {
          this.addToQueue(file);
        });
        this.pendingFiles = null;
      }
    }

    // Close modal
    const modal = document.getElementById('ff-format-modal');
    if (modal) modal.remove();

    // Update UI
    this.updateTableUI();
  }

  addToQueue(file) {
    // Get the actual file path (Electron provides this)
    const filePath = file.path || file.webkitRelativePath || file.name;

    console.log('[Format Factory] File path:', filePath);

    const job = {
      id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file: file, // Keep reference for potential future use, but won't send via IPC
      fileName: file.name,
      filePath: filePath,
      fileSize: file.size,
      fileType: file.type,
      outputFormat: this.selectedFormat,
      outputType: this.selectedType,
      status: 'pending', // pending, processing, completed, failed
      progress: 0,
      settings: this.getDefaultSettings(this.selectedType, this.selectedFormat),
      // Trimmer properties
      trimStart: null,
      trimEnd: null,
      hasTrim: false
    };

    this.queue.push(job);
    console.log('[Format Factory] Added to queue:', job.fileName, '→', job.outputFormat, 'from:', filePath);
  }

  getDefaultSettings(type, format) {
    const settings = {};

    if (type === 'video') {
      // Use 'original' to maintain source properties
      settings.resolution = 'original';
      settings.bitrate = null; // Auto bitrate
      settings.framerate = null; // Original framerate
      settings.codec = format === 'mp4' ? 'h264' : 'auto';
    } else if (type === 'audio') {
      settings.audioBitrate = '192k';
      settings.sampleRate = 44100;
      settings.channels = 2;
    } else if (type === 'image') {
      settings.quality = 90;
      settings.maintainAspect = true;
    }

    return settings;
  }

  updateTableUI() {
    const tableBody = document.getElementById('ff-table-body');
    if (!tableBody) return;

    // Clear existing rows
    tableBody.innerHTML = '';

    // If queue is empty, show drag & drop zone
    if (this.queue.length === 0) {
      tableBody.innerHTML = `
        <tr class="ff-empty-state">
          <td colspan="4">
            <div class="ff-drag-drop-zone">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <p class="ff-drag-message">Drag & Drop files here</p>
              <p class="ff-drag-hint">or</p>
              <button class="ff-btn-add-files">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 5v14m-7-7h14"></path>
                </svg>
                Add Files
              </button>
              <p class="ff-file-types">Supported: Video, Audio, Images</p>
            </div>
          </td>
        </tr>
      `;
      // Re-setup drag drop and button after recreating the element
      this.setupDragDrop();
      this.setupAddFilesButton();
      return;
    }

    // Render each job as a table row
    this.queue.forEach((job, index) => {
      const row = document.createElement('tr');
      row.dataset.jobId = job.id;
      row.dataset.index = index;
      row.classList.add('ff-job-row', job.status);

      // Preview cell
      const previewCell = document.createElement('td');
      const thumbnailUrl = this.getThumbnailUrl(job);

      if (thumbnailUrl) {
        previewCell.innerHTML = `
          <div class="ff-preview">
            <img src="${thumbnailUrl}" class="ff-preview-thumbnail" alt="${job.fileName}">
          </div>
        `;
      } else {
        previewCell.innerHTML = `
          <div class="ff-preview">
            <div class="ff-preview-icon">${this.getFileIcon(job.fileType)}</div>
          </div>
        `;
      }
      row.appendChild(previewCell);

      // Source cell
      const sourceCell = document.createElement('td');
      sourceCell.innerHTML = `
        <div class="ff-source-info">
          <div class="ff-source-name">${this.truncateFileName(job.fileName, 40)}</div>
          <div class="ff-source-path">${this.formatFileSize(job.fileSize)}</div>
        </div>
      `;
      row.appendChild(sourceCell);

      // Output cell
      const outputCell = document.createElement('td');
      outputCell.innerHTML = `
        <div class="ff-output-info">
          <div class="ff-output-format">→ ${job.outputFormat.toUpperCase()}</div>
          <div class="ff-progress-container">
            <div class="ff-progress-bar">
              <div class="ff-progress-fill" style="width: ${job.progress}%"></div>
            </div>
            <div class="ff-progress-text">${this.getStatusText(job)}</div>
          </div>
        </div>
      `;
      row.appendChild(outputCell);

      // Actions cell
      const actionsCell = document.createElement('td');

      // Show different actions based on job status
      if (job.status === 'completed') {
        actionsCell.innerHTML = `
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button class="ff-btn ff-btn-success" data-action="open-folder" title="Open Output Folder">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
            </button>
            <button class="ff-btn" data-action="remove" title="Remove">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        `;
      } else {
        // Check if file is video or audio (trimmer supported)
        const canTrim = job.fileType.startsWith('video/') || job.fileType.startsWith('audio/');
        const trimIndicator = job.hasTrim ? ' style="color: #3b82f6;"' : '';

        actionsCell.innerHTML = `
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            ${canTrim ? `
            <button class="ff-btn" data-action="trim" title="${job.hasTrim ? 'Edit Trim' : 'Trim Media'}"${trimIndicator} ${job.status === 'processing' ? 'disabled' : ''}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="6" cy="6" r="3"/>
                <circle cx="6" cy="18" r="3"/>
                <line x1="20" y1="4" x2="8.12" y2="15.88"/>
                <line x1="14.47" y1="14.48" x2="20" y2="20"/>
                <line x1="8.12" y1="8.12" x2="12" y2="12"/>
              </svg>
            </button>
            ` : ''}
            <button class="ff-btn" data-action="settings" title="Change Format" ${job.status === 'processing' ? 'disabled' : ''}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
            <button class="ff-btn" data-action="remove" title="Remove" ${job.status === 'processing' ? 'disabled' : ''}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        `;
      }
      row.appendChild(actionsCell);

      // Event listeners for action buttons
      const openFolderBtn = actionsCell.querySelector('[data-action="open-folder"]');
      if (openFolderBtn) {
        openFolderBtn.addEventListener('click', () => this.openOutputFolder(job.outputPath));
      }

      const trimBtn = actionsCell.querySelector('[data-action="trim"]');
      if (trimBtn) {
        trimBtn.addEventListener('click', () => this.openTrimmer(job.id));
      }

      const settingsBtn = actionsCell.querySelector('[data-action="settings"]');
      if (settingsBtn) {
        settingsBtn.addEventListener('click', () => this.changeJobFormat(job.id));
      }

      const removeBtn = actionsCell.querySelector('[data-action="remove"]');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => this.removeFromQueue(job.id));
      }

      tableBody.appendChild(row);
    });

    // Update toolbar button states
    this.updateToolbarButtons();
  }

  updateToolbarButtons() {
    const startBtn = document.querySelector('[data-action="start"]');
    const stopBtn = document.querySelector('[data-action="stop"]');
    const clearBtn = document.querySelector('[data-action="clear"]');
    const removeBtn = document.querySelector('[data-action="remove"]');
    const resetBtn = document.querySelector('[data-action="reset"]');

    const hasJobs = this.queue.length > 0;
    const isProcessing = this.queue.some(j => j.status === 'processing');
    const hasCompletedOrFailed = this.queue.some(j => j.status === 'completed' || j.status === 'failed');

    if (startBtn) startBtn.disabled = !hasJobs || isProcessing;
    if (stopBtn) stopBtn.disabled = !isProcessing;
    if (clearBtn) clearBtn.disabled = !hasJobs;
    if (removeBtn) removeBtn.disabled = !hasJobs;
    if (resetBtn) resetBtn.disabled = !hasCompletedOrFailed;
  }

  getThumbnailUrl(job) {
    // For image files, directly use the file
    if (!job.file) return null;

    if (job.fileType.startsWith('image/')) {
      // Images can be shown directly
      return URL.createObjectURL(job.file);
    }

    // For videos, we'll generate thumbnail on-demand
    if (job.fileType.startsWith('video/')) {
      // Check if we already generated a thumbnail
      if (job.thumbnailUrl) {
        return job.thumbnailUrl;
      }

      // Check if already generating to prevent duplicates
      if (!this.thumbnailGenerating.has(job.id)) {
        this.generateVideoThumbnail(job);
      }
      return null; // Show icon until thumbnail is ready
    }

    return null;
  }

  async generateVideoThumbnail(job) {
    // Mark as generating
    this.thumbnailGenerating.add(job.id);

    let video = null;
    let videoUrl = null;

    try {
      // Create a hidden video element
      video = document.createElement('video');
      videoUrl = URL.createObjectURL(job.file);
      video.src = videoUrl;
      video.muted = true;
      video.preload = 'metadata'; // Only load metadata, not full video
      video.style.display = 'none';
      document.body.appendChild(video);

      // Wait for video to load metadata with timeout
      await Promise.race([
        new Promise((resolve, reject) => {
          video.onloadeddata = resolve;
          video.onerror = reject;
          video.currentTime = 1; // Seek to 1 second
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      ]);

      // Get video dimensions
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;

      // Validate dimensions
      if (!videoWidth || !videoHeight) {
        throw new Error('Invalid video dimensions');
      }

      // Calculate canvas size maintaining aspect ratio
      const targetWidth = 160;
      const aspectRatio = videoWidth / videoHeight;
      const canvasWidth = targetWidth;
      const canvasHeight = Math.round(targetWidth / aspectRatio);

      // Create canvas to capture frame
      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext('2d', { alpha: false }); // No alpha for better performance

      // Draw video frame to canvas
      ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);

      // Convert to blob URL (lower quality for smaller file size)
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.7));
      const thumbnailUrl = URL.createObjectURL(blob);

      // Store thumbnail URL in job
      job.thumbnailUrl = thumbnailUrl;

      // Debounced UI update (avoid too many re-renders)
      this.scheduleTableUpdate();

    } catch (error) {
      console.error('[Format Factory] Failed to generate video thumbnail:', error);
      // Keep showing icon if thumbnail generation fails
    } finally {
      // Cleanup
      this.thumbnailGenerating.delete(job.id);
      if (video && video.parentNode) {
        document.body.removeChild(video);
      }
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    }
  }

  scheduleTableUpdate() {
    // Debounce table updates to avoid excessive re-renders
    if (this.updateTableDebounceTimer) {
      clearTimeout(this.updateTableDebounceTimer);
    }
    this.updateTableDebounceTimer = setTimeout(() => {
      this.updateTableUI();
      this.updateTableDebounceTimer = null;
    }, 100);
  }

  getFileIcon(fileType) {
    if (fileType.startsWith('video/')) return '🎬';
    if (fileType.startsWith('audio/')) return '🎵';
    if (fileType.startsWith('image/')) return '🖼️';
    return '📄';
  }

  truncateFileName(fileName, maxLength) {
    if (fileName.length <= maxLength) return fileName;
    const ext = fileName.split('.').pop();
    const nameWithoutExt = fileName.substring(0, fileName.length - ext.length - 1);
    const truncated = nameWithoutExt.substring(0, maxLength - ext.length - 4) + '...';
    return truncated + '.' + ext;
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  getStatusText(job) {
    switch (job.status) {
      case 'pending':
        return 'Pending';
      case 'processing':
        return `${job.progress}%`;
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      default:
        return '';
    }
  }

  changeJobFormat(jobId) {
    const job = this.queue.find(j => j.id === jobId);
    if (!job) return;

    console.log('[Format Factory] Change format for:', job.fileName);

    // Store the job ID we're editing
    this.editingJobId = jobId;

    // Detect file type
    let hasVideo = false;
    let hasAudio = false;
    let hasImage = false;

    if (job.fileType.startsWith('video/')) hasVideo = true;
    else if (job.fileType.startsWith('audio/')) hasAudio = true;
    else if (job.fileType.startsWith('image/')) hasImage = true;

    // Show format selection modal
    this.createFormatSelectionModalForJob(job, { hasVideo, hasAudio, hasImage });
  }

  createFormatSelectionModalForJob(job, { hasVideo, hasAudio, hasImage }) {
    // Remove existing modal if any
    const existingModal = document.getElementById('ff-format-modal');
    if (existingModal) existingModal.remove();

    // Create modal overlay
    const modal = document.createElement('div');
    modal.id = 'ff-format-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      animation: fadeIn 0.2s ease;
    `;

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: #1a1a1a;
      border: 1px solid #474747;
      border-radius: 12px;
      padding: 24px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      animation: slideUp 0.3s ease;
    `;

    // Modal header
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #474747;
    `;

    let hintText = `Currently: ${job.outputFormat.toUpperCase()}`;
    if (hasVideo) {
      hintText += ' • Convert to video or extract audio';
    } else if (hasAudio) {
      hintText += ' • Convert to any audio format';
    } else if (hasImage) {
      hintText += ' • Convert to any image format';
    }

    header.innerHTML = `
      <div>
        <h3 style="margin: 0 0 4px 0; color: #ffffff; font-size: 18px; font-weight: 600;">Change Output Format</h3>
        <p style="margin: 0 0 4px 0; color: rgba(255, 255, 255, 0.8); font-size: 13px;">${this.truncateFileName(job.fileName, 50)}</p>
        <p style="margin: 0; color: rgba(255, 255, 255, 0.5); font-size: 12px;">${hintText}</p>
      </div>
      <button id="ff-modal-close" style="background: transparent; border: none; color: rgba(255, 255, 255, 0.6); font-size: 24px; cursor: pointer; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 4px;">×</button>
    `;

    // Format options container
    const formatsContainer = document.createElement('div');
    formatsContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 16px;
    `;

    // Video formats
    if (hasVideo) {
      const videoSection = this.createFormatSection('Video', 'video', [
        { format: 'mp4', label: 'MP4', icon: '🎬', desc: 'Universal format, best compatibility' },
        { format: 'mov', label: 'MOV', icon: '🎬', desc: 'Apple QuickTime format' },
        { format: 'avi', label: 'AVI', icon: '🎬', desc: 'Windows video format' },
        { format: 'mkv', label: 'MKV', icon: '🎬', desc: 'High quality, supports subtitles' },
        { format: 'webm', label: 'WEBM', icon: '🎬', desc: 'Web optimized format' }
      ]);
      formatsContainer.appendChild(videoSection);
    }

    // Audio formats
    if (hasAudio || hasVideo) {
      const audioTitle = hasVideo && !hasAudio ? 'Audio (Extract from Video)' : 'Audio';
      const audioSection = this.createFormatSection(audioTitle, 'audio', [
        { format: 'mp3', label: 'MP3', icon: '🎵', desc: 'Universal audio format' },
        { format: 'wav', label: 'WAV', icon: '🎵', desc: 'Lossless audio quality' },
        { format: 'aac', label: 'AAC', icon: '🎵', desc: 'High quality, small size' },
        { format: 'flac', label: 'FLAC', icon: '🎵', desc: 'Lossless compression' }
      ]);
      formatsContainer.appendChild(audioSection);
    }

    // Image formats
    if (hasImage) {
      const imageSection = this.createFormatSection('Picture', 'image', [
        { format: 'jpg', label: 'JPG', icon: '🖼️', desc: 'Standard photo format' },
        { format: 'png', label: 'PNG', icon: '🖼️', desc: 'Lossless, supports transparency' },
        { format: 'webp', label: 'WEBP', icon: '🖼️', desc: 'Modern web format' },
        { format: 'gif', label: 'GIF', icon: '🖼️', desc: 'Animated images' }
      ]);
      formatsContainer.appendChild(imageSection);
    }

    // Assemble modal
    modalContent.appendChild(header);
    modalContent.appendChild(formatsContainer);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Close button handler
    const closeBtn = modal.querySelector('#ff-modal-close');
    closeBtn.addEventListener('click', () => {
      modal.remove();
      this.editingJobId = null;
    });

    closeBtn.addEventListener('mouseenter', (e) => {
      e.target.style.background = 'rgba(255, 255, 255, 0.1)';
    });

    closeBtn.addEventListener('mouseleave', (e) => {
      e.target.style.background = 'transparent';
    });

    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        this.editingJobId = null;
      }
    });
  }

  async openTrimmer(jobId) {
    const job = this.queue.find(j => j.id === jobId);
    if (!job) return;

    console.log('[Format Factory] Opening trimmer for:', job.fileName);

    try {
      // Check if TrimmerModal is available
      if (!window.TrimmerModal) {
        console.error('[Format Factory] TrimmerModal not loaded');
        alert('Trimmer component not loaded. Please restart the application.');
        return;
      }

      // Determine file type
      const fileType = job.fileType.startsWith('video/') ? 'video' : 'audio';

      // Initialize modal if not exists
      if (!this.trimmerModal) {
        this.trimmerModal = new window.TrimmerModal();
      }

      // Open trimmer with current trim settings (if any)
      const options = {
        initialStart: job.trimStart,
        initialEnd: job.trimEnd
      };

      const trimPoints = await this.trimmerModal.open(job.file, fileType, options);

      if (trimPoints && trimPoints.start !== undefined && trimPoints.end !== undefined) {
        // Update job with trim settings
        job.trimStart = trimPoints.start;
        job.trimEnd = trimPoints.end;
        job.hasTrim = true;

        console.log('[Format Factory] Trim applied:', job.fileName,
          `${trimPoints.start.toFixed(2)}s - ${trimPoints.end.toFixed(2)}s`);

        // Update UI to show trim is applied
        this.updateTableUI();
      } else {
        console.log('[Format Factory] Trim cancelled or invalid:', trimPoints);
      }

    } catch (error) {
      console.error('[Format Factory] Trimmer error:', error);
      // User canceled or error occurred
    }
  }

  removeFromQueue(jobId) {
    const index = this.queue.findIndex(j => j.id === jobId);
    if (index === -1) return;

    const job = this.queue[index];
    console.log('[Format Factory] Removing from queue:', job.fileName);

    // Cleanup resources
    this.cleanupJobResources(job);

    this.queue.splice(index, 1);
    this.updateTableUI();
  }

  cleanupJobResources(job) {
    // Revoke thumbnail URL to free memory
    if (job.thumbnailUrl) {
      URL.revokeObjectURL(job.thumbnailUrl);
      job.thumbnailUrl = null;
    }

    // Clear file reference
    job.file = null;
  }

  openOutputFolder(outputPath) {
    if (!outputPath) {
      console.error('[Format Factory] No output path available');
      return;
    }

    console.log('[Format Factory] Opening folder for:', outputPath);

    // Reveal file in folder using Electron API
    window.kolboDesktop.revealFileInFolder(outputPath)
      .then(() => {
        console.log('[Format Factory] Folder opened successfully');
      })
      .catch(error => {
        console.error('[Format Factory] Failed to open folder:', error);
      });
  }

  removeSelected() {
    // TODO: Implement row selection and batch remove
    console.log('[Format Factory] Remove selected items');
    alert('Multi-select will be implemented in the next phase.\n\nFor now, use the remove button on each row.');
  }

  clearQueue() {
    if (this.queue.length === 0) return;

    const confirmed = confirm(`Clear all ${this.queue.length} file(s) from the queue?`);
    if (!confirmed) return;

    console.log('[Format Factory] Clearing queue');

    // Cleanup all resources before clearing
    this.queue.forEach(job => this.cleanupJobResources(job));

    this.queue = [];
    this.updateTableUI();
  }

  resetCompleted() {
    const completedOrFailed = this.queue.filter(j => j.status === 'completed' || j.status === 'failed');
    if (completedOrFailed.length === 0) {
      console.log('[Format Factory] No completed/failed jobs to reset');
      return;
    }

    console.log('[Format Factory] Resetting', completedOrFailed.length, 'completed/failed jobs to pending');

    // Reset each completed/failed job back to pending state
    this.queue.forEach(job => {
      if (job.status === 'completed' || job.status === 'failed') {
        job.status = 'pending';
        job.progress = 0;
        job.error = null;
        // Keep outputPath if it exists (in case user wants to overwrite)
      }
    });

    this.updateTableUI();
  }

  async startQueue() {
    if (this.queue.length === 0) {
      console.log('[Format Factory] Queue is empty, nothing to start');
      return;
    }

    console.log('[Format Factory] Starting queue:', this.queue.length, 'files');
    console.log('[Format Factory] Queue status:', this.queue.map(j => `${j.fileName}: ${j.status}`).join(', '));

    // Process jobs one at a time
    for (const job of this.queue) {
      if (job.status === 'pending') {
        await this.convertJob(job);
      } else {
        console.log('[Format Factory] Skipping job (not pending):', job.fileName, 'status:', job.status);
      }
    }

    console.log('[Format Factory] Queue finished');
  }

  async convertJob(job) {
    try {
      job.status = 'processing';
      job.progress = 0;
      this.updateTableUI();

      console.log('[Format Factory] Converting:', job.fileName);

      // Determine output folder based on mode
      let outputFolder = null;
      if (this.outputMode === 'custom' && this.outputFolder) {
        outputFolder = this.outputFolder;
        console.log('[Format Factory] Using custom output folder:', outputFolder);
      } else {
        console.log('[Format Factory] Using source file folder');
      }

      // Create serializable job object (remove File object, keep only path)
      const serializableJob = {
        id: job.id,
        filePath: job.filePath,
        fileName: job.fileName,
        fileSize: job.fileSize,
        fileType: job.fileType,
        outputFormat: job.outputFormat,
        outputType: job.outputType,
        settings: job.settings,
        outputFolder: outputFolder, // Pass output folder to backend
        // Include trim settings if applied
        trimStart: job.hasTrim ? job.trimStart : undefined,
        trimEnd: job.hasTrim ? job.trimEnd : undefined
      };

      // Call FFmpeg via IPC
      const result = await window.kolboDesktop.ffmpeg.convertJob(serializableJob);

      if (result.success) {
        console.log('[Format Factory] Conversion successful:', result.outputPath);
        job.status = 'completed';
        job.progress = 100;
        job.outputPath = result.outputPath;
      } else {
        console.error('[Format Factory] Conversion failed:', result.error);
        job.status = 'failed';
        job.error = result.error;
      }

      this.updateTableUI();

    } catch (error) {
      console.error('[Format Factory] Conversion error:', error);
      job.status = 'failed';
      job.error = error.message;
      this.updateTableUI();
    }
  }

  async stopConversion() {
    console.log('[Format Factory] Stopping all conversions');

    try {
      await window.kolboDesktop.ffmpeg.cancelAll();

      // Reset all processing jobs to pending
      this.queue.forEach(job => {
        if (job.status === 'processing') {
          job.status = 'pending';
          job.progress = 0;
        }
      });

      this.updateTableUI();
    } catch (error) {
      console.error('[Format Factory] Failed to stop conversions:', error);
    }
  }

  async changeOutputFolder() {
    console.log('[Format Factory] Change output folder');

    try {
      const result = await window.kolboDesktop.ffmpeg.selectOutputFolder();

      if (result.success && !result.canceled) {
        this.outputFolder = result.folderPath;
        this.outputMode = 'custom';

        // Save settings
        await window.kolboDesktop.ffmpeg.setOutputFolder(this.outputFolder);
        await window.kolboDesktop.ffmpeg.setOutputMode('custom');

        console.log('[Format Factory] Output folder set to:', this.outputFolder);

        // Update UI
        this.updateOutputFolderUI();
        this.updateOutputPathDisplay();
      }
    } catch (error) {
      console.error('[Format Factory] Failed to select folder:', error);
      alert('Failed to select output folder');
    }
  }

  setupFFmpegListeners() {
    console.log('[Format Factory] Setting up FFmpeg event listeners');

    // Progress updates
    window.kolboDesktop.ffmpeg.onProgress((data) => {
      const { jobId, progress } = data;
      const job = this.queue.find(j => j.id === jobId);

      if (job) {
        job.progress = Math.min(Math.max(progress, 0), 100);
        this.updateTableUI();
      }
    });

    // Job completion
    window.kolboDesktop.ffmpeg.onComplete((data) => {
      const { jobId, outputPath } = data;
      const job = this.queue.find(j => j.id === jobId);

      if (job) {
        job.status = 'completed';
        job.progress = 100;
        job.outputPath = outputPath;
        this.updateTableUI();
        console.log('[Format Factory] Job completed:', job.fileName);
      }
    });

    // Errors
    window.kolboDesktop.ffmpeg.onError((data) => {
      const { jobId, error } = data;
      const job = this.queue.find(j => j.id === jobId);

      if (job) {
        job.status = 'failed';
        job.error = error;
        this.updateTableUI();
        console.error('[Format Factory] Job failed:', job.fileName, error);
      }
    });

    // GPU info
    window.kolboDesktop.ffmpeg.onGPUInfo((gpuInfo) => {
      this.gpuInfo = gpuInfo;
      console.log('[Format Factory] GPU Info received:', gpuInfo);
    });
  }

  async getGPUInfo() {
    try {
      const result = await window.kolboDesktop.ffmpeg.getGPUInfo();

      if (result.success) {
        this.gpuInfo = result.gpuInfo;
        console.log('[Format Factory] GPU Info:', this.gpuInfo);

        if (this.gpuInfo.hasHardwareAcceleration) {
          console.log('[Format Factory] ✓ Hardware acceleration available');
        } else {
          console.log('[Format Factory] Using CPU encoding (no GPU acceleration)');
        }
      }
    } catch (error) {
      console.error('[Format Factory] Failed to get GPU info:', error);
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.formatFactoryManager = new FormatFactoryManager();
  });
} else {
  window.formatFactoryManager = new FormatFactoryManager();
}

console.log('[Format Factory] Script loaded');
