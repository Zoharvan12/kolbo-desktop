// Kolbo Studio - Quick Tools Manager
// Main controller for Quick Tools tab with 5 media utilities

console.log('[Quick Tools] Initializing...');

class QuickToolsManager {
  constructor() {
    // Current state
    this.currentTool = 'trimmer';
    this.outputFolders = {
      trimmer: null,
      extractor: null,
      'frame-grabber': null,
      merger: null,
      cropper: null
    };

    // Tool instances
    this.tools = {
      trimmer: null,
      extractor: null,
      'frame-grabber': null,
      merger: null,
      cropper: null
    };

    // File input elements
    this.fileInputs = {};

    this.init();
  }

  init() {
    console.log('[Quick Tools] Setting up...');
    this.setupToolSelector();
    this.setupOutputFolders();
    this.setupDropzones();
    this.setupBrowseButtons();
    this.initializeTools();
    console.log('[Quick Tools] Initialized successfully');
  }

  /**
   * Setup tool selector card clicks
   */
  setupToolSelector() {
    const toolCards = document.querySelectorAll('.qt-tool-card');
    toolCards.forEach(card => {
      card.addEventListener('click', () => {
        const tool = card.dataset.tool;
        this.switchTool(tool);
      });
    });
  }

  /**
   * Switch to a different tool
   */
  switchTool(toolId) {
    console.log('[Quick Tools] Switching to:', toolId);
    this.currentTool = toolId;

    // Update card states
    document.querySelectorAll('.qt-tool-card').forEach(card => {
      card.classList.toggle('active', card.dataset.tool === toolId);
    });

    // Update content visibility
    document.querySelectorAll('.qt-tool-content').forEach(content => {
      content.classList.toggle('active', content.dataset.tool === toolId);
    });
  }

  /**
   * Setup output folder buttons
   */
  setupOutputFolders() {
    const tools = ['trimmer', 'extractor', 'frame-grabber', 'merger', 'cropper'];

    tools.forEach(tool => {
      const btn = document.getElementById(`qt-${tool}-output-btn`);
      if (btn) {
        btn.addEventListener('click', () => this.selectOutputFolder(tool));
      }
    });
  }

  /**
   * Select output folder for a tool
   */
  async selectOutputFolder(toolId) {
    try {
      const result = await window.kolboDesktop.pickFolder();
      if (result.success && result.folderPath) {
        this.outputFolders[toolId] = result.folderPath;
        this.updateOutputPathDisplay(toolId);
        console.log(`[Quick Tools] Output folder for ${toolId}:`, result.folderPath);
      }
    } catch (error) {
      console.error('[Quick Tools] Failed to select folder:', error);
    }
  }

  /**
   * Update output path display
   */
  updateOutputPathDisplay(toolId) {
    const pathEl = document.getElementById(`qt-${toolId}-output-path`);
    if (pathEl) {
      const folderPath = this.outputFolders[toolId];
      if (folderPath) {
        // Show just the folder name with tooltip for full path
        const folderName = folderPath.split(/[/\\]/).pop();
        pathEl.textContent = folderName;
        pathEl.title = folderPath;
        pathEl.style.color = '#3b82f6';
      } else {
        pathEl.textContent = toolId === 'merger' ? 'Same as first file' : 'Same as source';
        pathEl.title = '';
        pathEl.style.color = '';
      }
    }
  }

  /**
   * Get output folder for a tool (or null for same as source)
   */
  getOutputFolder(toolId) {
    return this.outputFolders[toolId] || null;
  }

  /**
   * Setup drag and drop zones
   */
  setupDropzones() {
    const tools = ['trimmer', 'extractor', 'frame-grabber', 'merger', 'cropper'];

    tools.forEach(tool => {
      const dropzone = document.getElementById(`qt-${tool}-dropzone`);
      if (!dropzone) return;

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');

        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
          this.handleFilesDropped(tool, files);
        }
      });
    });
  }

  /**
   * Setup browse buttons with hidden file inputs
   */
  setupBrowseButtons() {
    const tools = ['trimmer', 'extractor', 'frame-grabber', 'merger', 'cropper'];

    tools.forEach(tool => {
      const browseBtn = document.getElementById(`qt-${tool}-browse-btn`);
      if (!browseBtn) return;

      // Create hidden file input
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.style.display = 'none';
      fileInput.accept = this.getAcceptTypes(tool);
      fileInput.multiple = tool === 'merger';
      document.body.appendChild(fileInput);
      this.fileInputs[tool] = fileInput;

      // Browse button click
      browseBtn.addEventListener('click', () => {
        fileInput.click();
      });

      // File selection
      fileInput.addEventListener('change', () => {
        const files = Array.from(fileInput.files);
        if (files.length > 0) {
          this.handleFilesDropped(tool, files);
        }
        fileInput.value = ''; // Reset for re-selection
      });
    });
  }

  /**
   * Get accepted file types for each tool
   */
  getAcceptTypes(toolId) {
    switch (toolId) {
      case 'trimmer':
        return 'video/*,audio/*';
      case 'extractor':
      case 'frame-grabber':
      case 'merger':
        return 'video/*';
      case 'cropper':
        return 'video/*,image/*'; // Cropper supports both video and images
      default:
        return '*/*';
    }
  }

  /**
   * Handle files dropped or selected
   */
  handleFilesDropped(toolId, files) {
    console.log(`[Quick Tools] Files received for ${toolId}:`, files.length);

    // Validate file types
    const validFiles = files.filter(file => this.isValidFile(toolId, file));
    if (validFiles.length === 0) {
      this.showToast('Invalid file type for this tool', 'error');
      return;
    }

    // Route to appropriate tool
    switch (toolId) {
      case 'trimmer':
        if (this.tools.trimmer) {
          this.tools.trimmer.loadFile(validFiles[0]);
        }
        break;
      case 'extractor':
        if (this.tools.extractor) {
          this.tools.extractor.loadFile(validFiles[0]);
        }
        break;
      case 'frame-grabber':
        if (this.tools['frame-grabber']) {
          this.tools['frame-grabber'].loadFile(validFiles[0]);
        }
        break;
      case 'merger':
        if (this.tools.merger) {
          this.tools.merger.addFiles(validFiles);
        }
        break;
      case 'cropper':
        if (this.tools.cropper) {
          this.tools.cropper.loadFile(validFiles[0]);
        }
        break;
    }
  }

  /**
   * Validate file type for tool
   */
  isValidFile(toolId, file) {
    const type = file.type;
    const name = file.name.toLowerCase();

    // Check by extension for files without MIME type
    const videoExts = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'];
    const audioExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'];
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];

    const isVideo = type.startsWith('video/') || videoExts.some(ext => name.endsWith(ext));
    const isAudio = type.startsWith('audio/') || audioExts.some(ext => name.endsWith(ext));
    const isImage = type.startsWith('image/') || imageExts.some(ext => name.endsWith(ext));

    switch (toolId) {
      case 'trimmer':
        return isVideo || isAudio;
      case 'extractor':
      case 'frame-grabber':
      case 'merger':
        return isVideo;
      case 'cropper':
        return isVideo || isImage; // Cropper supports both video and images
      default:
        return true;
    }
  }

  /**
   * Initialize tool instances
   */
  initializeTools() {
    // Initialize each tool with a reference to this manager
    if (typeof TrimmerTool !== 'undefined') {
      this.tools.trimmer = new TrimmerTool(this);
    }
    if (typeof ExtractorTool !== 'undefined') {
      this.tools.extractor = new ExtractorTool(this);
    }
    if (typeof FrameGrabberTool !== 'undefined') {
      this.tools['frame-grabber'] = new FrameGrabberTool(this);
    }
    if (typeof VideoMergerTool !== 'undefined') {
      this.tools.merger = new VideoMergerTool(this);
    }
    if (typeof VideoCropperTool !== 'undefined') {
      this.tools.cropper = new VideoCropperTool(this);
    }
  }

  /**
   * Show toast notification
   */
  showToast(message, type = 'info') {
    const toast = document.getElementById('toast-notification');
    if (!toast) return;

    const messageEl = toast.querySelector('.toast-message');
    const iconEl = toast.querySelector('.toast-icon');

    if (messageEl) messageEl.textContent = message;

    // Update icon color based on type
    if (iconEl) {
      iconEl.style.stroke = type === 'error' ? '#ef4444' :
                           type === 'success' ? '#22c55e' : '#3b82f6';
    }

    // Show toast
    toast.classList.add('show');

    // Hide after 3 seconds
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  /**
   * Format time as MM:SS.mmm
   */
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }

  /**
   * Format time as MM:SS
   */
  formatTimeShort(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Format file size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get file extension
   */
  getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
  }

  /**
   * Check if file is video
   */
  isVideoFile(file) {
    const type = file.type;
    const name = file.name.toLowerCase();
    const videoExts = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'];
    return type.startsWith('video/') || videoExts.some(ext => name.endsWith(ext));
  }

  /**
   * Check if file is audio
   */
  isAudioFile(file) {
    const type = file.type;
    const name = file.name.toLowerCase();
    const audioExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'];
    return type.startsWith('audio/') || audioExts.some(ext => name.endsWith(ext));
  }
}

// Initialize on DOM ready
let quickToolsManager = null;

document.addEventListener('DOMContentLoaded', () => {
  // Delay initialization to ensure all tool classes are loaded
  setTimeout(() => {
    quickToolsManager = new QuickToolsManager();
    console.log('[Quick Tools] Manager created');
  }, 100);
});
