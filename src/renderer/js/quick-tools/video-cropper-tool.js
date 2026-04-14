// Kolbo Studio - Quick Tools: Media Cropper Tool
// Crop and resize videos AND images with aspect ratio presets

console.log('[MediaCropperTool] Loading...');

class VideoCropperTool {
  constructor(manager) {
    this.manager = manager;
    this.file = null;
    this.fileUrl = null;
    this.mediaWidth = 0;
    this.mediaHeight = 0;
    this.isProcessing = false;
    this.isImage = false; // true for images, false for videos

    // Crop state (in percentages 0-100 of the MEDIA, not container)
    this.cropRegion = { x: 0, y: 0, width: 100, height: 100 };
    this.selectedPreset = null;
    this.fillMode = 'crop'; // 'crop' or 'fit'

    // Aspect ratio presets
    this.presets = [
      { id: '16:9', ratio: 16/9, label: '16:9', desc: 'YouTube, Landscape' },
      { id: '9:16', ratio: 9/16, label: '9:16', desc: 'TikTok, Reels, Shorts' },
      { id: '1:1', ratio: 1, label: '1:1', desc: 'Instagram Square' },
      { id: '4:5', ratio: 4/5, label: '4:5', desc: 'Instagram Portrait' },
      { id: '4:3', ratio: 4/3, label: '4:3', desc: 'Standard' },
      { id: 'free', ratio: null, label: 'Free', desc: 'Custom crop' }
    ];

    // Drag state
    this.isDragging = false;
    this.dragMode = null; // 'move', 'nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'
    this.dragStart = { x: 0, y: 0 };
    this.cropStart = { x: 0, y: 0, width: 0, height: 0 };

    // Bound event handlers for cleanup
    this.boundDoDrag = this.doDrag.bind(this);
    this.boundEndDrag = this.endDrag.bind(this);
    this.boundResize = this.handleResize.bind(this);

    // DOM references
    this.dropzone = document.getElementById('qt-cropper-dropzone');
    this.workspace = document.getElementById('qt-cropper-workspace');
    this.mediaEl = null; // video or img element
    this.overlayEl = null;
    this.cropEl = null;
    this.wrapperEl = null;

    this.init();
  }

  init() {
    console.log('[MediaCropperTool] Initialized');
  }

  /**
   * Check if file is an image
   */
  checkIfImage(file) {
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'];
    const ext = this.manager.getFileExtension(file.name).toLowerCase();
    return imageExtensions.includes(ext);
  }

  /**
   * Load a file (video or image)
   */
  async loadFile(file) {
    console.log('[MediaCropperTool] Loading file:', file.name);

    // Clean up previous
    this.cleanup();

    this.file = file;
    this.fileUrl = URL.createObjectURL(file);
    this.isImage = this.checkIfImage(file);

    console.log('[MediaCropperTool] File type:', this.isImage ? 'Image' : 'Video');

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
    const mediaElement = this.isImage
      ? `<img id="qt-cropper-media" src="${this.fileUrl}" alt="Image to crop">`
      : `<video id="qt-cropper-media" src="${this.fileUrl}" loop muted></video>`;

    const playControls = this.isImage ? '' : `
      <div class="qt-frame-controls" style="margin-top: 12px;">
        <button class="qt-btn qt-btn-secondary" id="qt-cropper-clear-btn" style="padding: 8px 16px;">
          ${Icons.get('x', 16)}
          Clear
        </button>
        <button class="qt-btn qt-btn-secondary" id="qt-cropper-play-btn" style="padding: 8px 16px;">
          ${Icons.get('play', 16)}
          Preview
        </button>
        <span style="flex: 1;"></span>
        <button class="qt-btn qt-btn-secondary" id="qt-cropper-reset-btn" style="padding: 8px 16px;">
          Reset Crop
        </button>
      </div>
    `;

    const imageResetBtn = this.isImage ? `
      <div class="qt-frame-controls" style="margin-top: 12px;">
        <button class="qt-btn qt-btn-secondary" id="qt-cropper-clear-btn" style="padding: 8px 16px;">
          ${Icons.get('x', 16)}
          Clear
        </button>
        <span style="flex: 1;"></span>
        <button class="qt-btn qt-btn-secondary" id="qt-cropper-reset-btn" style="padding: 8px 16px;">
          Reset Crop
        </button>
      </div>
    ` : '';

    this.workspace.innerHTML = `
      <div class="qt-cropper-container">
        <div class="qt-cropper-preview-area">
          <div class="qt-cropper-video-wrapper" id="qt-cropper-video-wrapper">
            ${mediaElement}
            <div class="qt-cropper-overlay" id="qt-cropper-overlay">
              <div class="qt-crop-region" id="qt-crop-region">
                <!-- Corner handles -->
                <div class="qt-crop-handle qt-crop-handle-nw" data-handle="nw"></div>
                <div class="qt-crop-handle qt-crop-handle-ne" data-handle="ne"></div>
                <div class="qt-crop-handle qt-crop-handle-sw" data-handle="sw"></div>
                <div class="qt-crop-handle qt-crop-handle-se" data-handle="se"></div>
                <!-- Edge handles -->
                <div class="qt-crop-edge qt-crop-edge-n" data-handle="n"></div>
                <div class="qt-crop-edge qt-crop-edge-s" data-handle="s"></div>
                <div class="qt-crop-edge qt-crop-edge-e" data-handle="e"></div>
                <div class="qt-crop-edge qt-crop-edge-w" data-handle="w"></div>
              </div>
            </div>
          </div>

          ${this.isImage ? imageResetBtn : playControls}
        </div>

        <div class="qt-cropper-sidebar">
          <div class="qt-section-header" style="margin-bottom: 12px;">
            <span class="qt-section-title">Aspect Ratio</span>
          </div>

          <div class="qt-aspect-presets" id="qt-aspect-presets">
            ${this.presets.map(preset => `
              <button class="qt-aspect-btn" data-preset="${preset.id}">
                <span class="qt-aspect-btn-ratio">${preset.label}</span>
                <span class="qt-aspect-btn-label">${preset.desc}</span>
              </button>
            `).join('')}
          </div>

          <div class="qt-crop-dimensions">
            <div class="qt-crop-dimensions-label">Output Size</div>
            <div class="qt-crop-dimensions-value" id="qt-crop-output-size">--</div>
          </div>

          ${!this.isImage ? `
          <div class="qt-section-header" style="margin-bottom: 12px;">
            <span class="qt-section-title">Mode</span>
          </div>

          <div class="qt-fill-mode">
            <button class="qt-fill-btn active" data-mode="crop">
              ${Icons.get('crop', 16)}
              Crop
            </button>
            <button class="qt-fill-btn" data-mode="fit">
              ${Icons.get('crop', 16)}
              Fit (Letterbox)
            </button>
          </div>
          ` : ''}

          <div id="qt-cropper-progress" class="qt-progress-container hidden" style="margin-top: 16px;">
            <div class="qt-progress-header">
              <span class="qt-progress-label">Exporting...</span>
              <span class="qt-progress-percent" id="qt-cropper-progress-percent">0%</span>
            </div>
            <div class="qt-progress-bar">
              <div class="qt-progress-fill" id="qt-cropper-progress-fill" style="width: 0%;"></div>
            </div>
          </div>

          <div style="margin-top: auto; padding-top: 20px;">
            <button class="qt-btn qt-btn-secondary" id="qt-cropper-change-btn" style="width: 100%; margin-bottom: 8px;">
              Change ${this.isImage ? 'Image' : 'Video'}
            </button>
            <button class="qt-btn qt-btn-primary" id="qt-cropper-export-btn" style="width: 100%;">
              ${Icons.get('upload', 48, 1.5)}
              Export Cropped ${this.isImage ? 'Image' : 'Video'}
            </button>
          </div>
        </div>
      </div>
    `;

    // Get DOM references
    this.mediaEl = document.getElementById('qt-cropper-media');
    this.overlayEl = document.getElementById('qt-cropper-overlay');
    this.cropEl = document.getElementById('qt-crop-region');
    this.wrapperEl = document.getElementById('qt-cropper-video-wrapper');

    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    if (this.isImage) {
      // Image loaded
      this.mediaEl.addEventListener('load', () => {
        this.mediaWidth = this.mediaEl.naturalWidth;
        this.mediaHeight = this.mediaEl.naturalHeight;
        console.log('[MediaCropperTool] Image loaded:', this.mediaWidth, 'x', this.mediaHeight);

        // Initialize crop region to full image
        this.cropRegion = { x: 0, y: 0, width: 100, height: 100 };

        // Position overlay to match actual image display area
        this.positionOverlay();
        this.updateCropRegionUI();
        this.updateOutputSize();
      });
    } else {
      // Video loaded
      this.mediaEl.addEventListener('loadedmetadata', () => {
        this.mediaWidth = this.mediaEl.videoWidth;
        this.mediaHeight = this.mediaEl.videoHeight;
        console.log('[MediaCropperTool] Video loaded:', this.mediaWidth, 'x', this.mediaHeight);

        // Initialize crop region to full video
        this.cropRegion = { x: 0, y: 0, width: 100, height: 100 };

        // Position overlay to match actual video display area
        this.positionOverlay();
        this.updateCropRegionUI();
        this.updateOutputSize();
      });

      // Play/pause button
      document.getElementById('qt-cropper-play-btn')?.addEventListener('click', () => {
        if (this.mediaEl.paused) {
          this.mediaEl.play();
        } else {
          this.mediaEl.pause();
        }
      });
    }

    // Reposition overlay on window resize
    window.addEventListener('resize', this.boundResize);

    // Reset crop button
    document.getElementById('qt-cropper-reset-btn')?.addEventListener('click', () => {
      this.resetCrop();
    });

    // Aspect ratio presets
    document.querySelectorAll('.qt-aspect-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const presetId = btn.dataset.preset;
        this.selectPreset(presetId);

        // Update active state
        document.querySelectorAll('.qt-aspect-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Fill mode buttons (video only)
    document.querySelectorAll('.qt-fill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.fillMode = btn.dataset.mode;
        document.querySelectorAll('.qt-fill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.updateOutputSize();
      });
    });

    // Crop region drag
    this.setupCropDrag();

    // Clear button
    document.getElementById('qt-cropper-clear-btn')?.addEventListener('click', () => {
      this.reset();
    });

    // Change file button
    document.getElementById('qt-cropper-change-btn')?.addEventListener('click', () => {
      this.reset();
    });

    // Export button
    document.getElementById('qt-cropper-export-btn')?.addEventListener('click', () => {
      if (this.isImage) {
        this.exportCroppedImage();
      } else {
        this.exportCroppedVideo();
      }
    });
  }

  /**
   * Handle window resize
   */
  handleResize() {
    if (this.mediaWidth > 0) {
      this.positionOverlay();
      this.updateCropRegionUI();
    }
  }

  /**
   * Position the overlay to match the actual media display area
   * (accounts for letterboxing from object-fit: contain)
   */
  positionOverlay() {
    if (!this.overlayEl || !this.wrapperEl) return;

    const wrapper = this.wrapperEl;
    const wrapperRect = wrapper.getBoundingClientRect();

    const wrapperAspect = wrapperRect.width / wrapperRect.height;
    const mediaAspect = this.mediaWidth / this.mediaHeight;

    let displayWidth, displayHeight, offsetX, offsetY;

    if (mediaAspect > wrapperAspect) {
      // Media is wider - fits to width, letterboxed top/bottom
      displayWidth = wrapperRect.width;
      displayHeight = wrapperRect.width / mediaAspect;
      offsetX = 0;
      offsetY = (wrapperRect.height - displayHeight) / 2;
    } else {
      // Media is taller - fits to height, letterboxed left/right
      displayHeight = wrapperRect.height;
      displayWidth = wrapperRect.height * mediaAspect;
      offsetX = (wrapperRect.width - displayWidth) / 2;
      offsetY = 0;
    }

    // Position overlay to match media display area
    this.overlayEl.style.left = `${offsetX}px`;
    this.overlayEl.style.top = `${offsetY}px`;
    this.overlayEl.style.width = `${displayWidth}px`;
    this.overlayEl.style.height = `${displayHeight}px`;
    this.overlayEl.style.right = 'auto';
    this.overlayEl.style.bottom = 'auto';
  }

  /**
   * Get the media's actual displayed rect within the wrapper
   * (accounts for object-fit: contain letterboxing)
   */
  getMediaDisplayRect() {
    const wrapper = this.wrapperEl;
    const wrapperRect = wrapper.getBoundingClientRect();

    // The wrapper is always 16:9, but media might be different aspect ratio
    // Media uses object-fit: contain, so it's centered with letterboxing
    const wrapperAspect = wrapperRect.width / wrapperRect.height;
    const mediaAspect = this.mediaWidth / this.mediaHeight;

    let displayWidth, displayHeight, offsetX, offsetY;

    if (mediaAspect > wrapperAspect) {
      // Media is wider - fits to width, letterboxed top/bottom
      displayWidth = wrapperRect.width;
      displayHeight = wrapperRect.width / mediaAspect;
      offsetX = 0;
      offsetY = (wrapperRect.height - displayHeight) / 2;
    } else {
      // Media is taller - fits to height, letterboxed left/right
      displayHeight = wrapperRect.height;
      displayWidth = wrapperRect.height * mediaAspect;
      offsetX = (wrapperRect.width - displayWidth) / 2;
      offsetY = 0;
    }

    return {
      x: wrapperRect.left + offsetX,
      y: wrapperRect.top + offsetY,
      width: displayWidth,
      height: displayHeight
    };
  }

  /**
   * Setup crop region drag handling
   */
  setupCropDrag() {
    // Handle drag on crop region (move)
    this.cropEl.addEventListener('mousedown', (e) => {
      if (e.target === this.cropEl) {
        this.startDrag(e, 'move');
      }
    });

    // Handle drag on handles
    this.cropEl.querySelectorAll('[data-handle]').forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.startDrag(e, handle.dataset.handle);
      });
    });

    // Mouse move and up on document
    document.addEventListener('mousemove', this.boundDoDrag);
    document.addEventListener('mouseup', this.boundEndDrag);
  }

  /**
   * Start drag operation
   */
  startDrag(e, mode) {
    this.isDragging = true;
    this.dragMode = mode;
    this.dragStart = { x: e.clientX, y: e.clientY };
    this.cropStart = { ...this.cropRegion };
    e.preventDefault();
  }

  /**
   * Do drag operation
   */
  doDrag(e) {
    if (!this.isDragging) return;

    // Get the actual media display rect (not wrapper rect)
    const mediaRect = this.getMediaDisplayRect();

    // Calculate delta as percentage of the MEDIA display area
    const deltaX = ((e.clientX - this.dragStart.x) / mediaRect.width) * 100;
    const deltaY = ((e.clientY - this.dragStart.y) / mediaRect.height) * 100;

    const minSize = 10; // Minimum 10% size

    switch (this.dragMode) {
      case 'move':
        this.cropRegion.x = Math.max(0, Math.min(100 - this.cropStart.width, this.cropStart.x + deltaX));
        this.cropRegion.y = Math.max(0, Math.min(100 - this.cropStart.height, this.cropStart.y + deltaY));
        break;

      case 'nw':
        this.cropRegion.x = Math.max(0, Math.min(this.cropStart.x + this.cropStart.width - minSize, this.cropStart.x + deltaX));
        this.cropRegion.y = Math.max(0, Math.min(this.cropStart.y + this.cropStart.height - minSize, this.cropStart.y + deltaY));
        this.cropRegion.width = this.cropStart.width - (this.cropRegion.x - this.cropStart.x);
        this.cropRegion.height = this.cropStart.height - (this.cropRegion.y - this.cropStart.y);
        break;

      case 'ne':
        this.cropRegion.y = Math.max(0, Math.min(this.cropStart.y + this.cropStart.height - minSize, this.cropStart.y + deltaY));
        this.cropRegion.width = Math.max(minSize, Math.min(100 - this.cropStart.x, this.cropStart.width + deltaX));
        this.cropRegion.height = this.cropStart.height - (this.cropRegion.y - this.cropStart.y);
        break;

      case 'sw':
        this.cropRegion.x = Math.max(0, Math.min(this.cropStart.x + this.cropStart.width - minSize, this.cropStart.x + deltaX));
        this.cropRegion.width = this.cropStart.width - (this.cropRegion.x - this.cropStart.x);
        this.cropRegion.height = Math.max(minSize, Math.min(100 - this.cropStart.y, this.cropStart.height + deltaY));
        break;

      case 'se':
        this.cropRegion.width = Math.max(minSize, Math.min(100 - this.cropStart.x, this.cropStart.width + deltaX));
        this.cropRegion.height = Math.max(minSize, Math.min(100 - this.cropStart.y, this.cropStart.height + deltaY));
        break;

      case 'n':
        this.cropRegion.y = Math.max(0, Math.min(this.cropStart.y + this.cropStart.height - minSize, this.cropStart.y + deltaY));
        this.cropRegion.height = this.cropStart.height - (this.cropRegion.y - this.cropStart.y);
        break;

      case 's':
        this.cropRegion.height = Math.max(minSize, Math.min(100 - this.cropStart.y, this.cropStart.height + deltaY));
        break;

      case 'w':
        this.cropRegion.x = Math.max(0, Math.min(this.cropStart.x + this.cropStart.width - minSize, this.cropStart.x + deltaX));
        this.cropRegion.width = this.cropStart.width - (this.cropRegion.x - this.cropStart.x);
        break;

      case 'e':
        this.cropRegion.width = Math.max(minSize, Math.min(100 - this.cropStart.x, this.cropStart.width + deltaX));
        break;
    }

    // Apply aspect ratio constraint if a preset is selected
    if (this.selectedPreset && this.selectedPreset !== 'free') {
      this.constrainToAspectRatio();
    }

    this.updateCropRegionUI();
    this.updateOutputSize();
  }

  /**
   * End drag operation
   */
  endDrag() {
    this.isDragging = false;
    this.dragMode = null;
  }

  /**
   * Select an aspect ratio preset
   */
  selectPreset(presetId) {
    this.selectedPreset = presetId;

    if (presetId === 'free') {
      return; // No constraint
    }

    const preset = this.presets.find(p => p.id === presetId);
    if (!preset || !preset.ratio) return;

    // Calculate crop region that fits the aspect ratio centered in media
    const mediaRatio = this.mediaWidth / this.mediaHeight;
    const targetRatio = preset.ratio;

    let width, height;

    if (targetRatio > mediaRatio) {
      // Target is wider - fit to width
      width = 100;
      height = (mediaRatio / targetRatio) * 100;
    } else {
      // Target is taller - fit to height
      height = 100;
      width = (targetRatio / mediaRatio) * 100;
    }

    // Center the crop region
    this.cropRegion = {
      x: (100 - width) / 2,
      y: (100 - height) / 2,
      width: width,
      height: height
    };

    this.updateCropRegionUI();
    this.updateOutputSize();
  }

  /**
   * Constrain crop region to selected aspect ratio
   */
  constrainToAspectRatio() {
    const preset = this.presets.find(p => p.id === this.selectedPreset);
    if (!preset || !preset.ratio) return;

    const targetRatio = preset.ratio;

    // Current crop ratio in media pixels
    const cropWidthPx = this.cropRegion.width * this.mediaWidth / 100;
    const cropHeightPx = this.cropRegion.height * this.mediaHeight / 100;
    const currentRatio = cropWidthPx / cropHeightPx;

    if (Math.abs(currentRatio - targetRatio) < 0.01) return; // Close enough

    // Adjust height to match ratio while keeping width
    const newHeightPx = cropWidthPx / targetRatio;
    const newHeightPercent = (newHeightPx / this.mediaHeight) * 100;

    if (newHeightPercent <= 100 - this.cropRegion.y && newHeightPercent >= 10) {
      this.cropRegion.height = newHeightPercent;
    } else {
      // Adjust width instead
      const newWidthPx = this.cropRegion.height * this.mediaHeight / 100 * targetRatio;
      const newWidthPercent = (newWidthPx / this.mediaWidth) * 100;
      if (newWidthPercent <= 100 - this.cropRegion.x && newWidthPercent >= 10) {
        this.cropRegion.width = newWidthPercent;
      }
    }
  }

  /**
   * Reset crop to full media
   */
  resetCrop() {
    this.selectedPreset = null;
    this.cropRegion = { x: 0, y: 0, width: 100, height: 100 };

    document.querySelectorAll('.qt-aspect-btn').forEach(b => b.classList.remove('active'));

    this.updateCropRegionUI();
    this.updateOutputSize();
  }

  /**
   * Update crop region UI
   */
  updateCropRegionUI() {
    if (!this.cropEl) return;

    this.cropEl.style.left = `${this.cropRegion.x}%`;
    this.cropEl.style.top = `${this.cropRegion.y}%`;
    this.cropEl.style.width = `${this.cropRegion.width}%`;
    this.cropEl.style.height = `${this.cropRegion.height}%`;
  }

  /**
   * Update output size display
   */
  updateOutputSize() {
    const sizeEl = document.getElementById('qt-crop-output-size');
    if (!sizeEl) return;

    const cropWidth = Math.round(this.mediaWidth * this.cropRegion.width / 100);
    const cropHeight = Math.round(this.mediaHeight * this.cropRegion.height / 100);

    if (this.fillMode === 'fit' && !this.isImage) {
      // In fit mode, output size depends on selected aspect ratio
      if (this.selectedPreset && this.selectedPreset !== 'free') {
        const preset = this.presets.find(p => p.id === this.selectedPreset);
        if (preset && preset.ratio) {
          // Calculate fit dimensions
          const targetRatio = preset.ratio;
          let fitWidth, fitHeight;

          if (targetRatio > 1) {
            // Landscape
            fitWidth = Math.max(cropWidth, Math.round(cropHeight * targetRatio));
            fitHeight = Math.round(fitWidth / targetRatio);
          } else {
            // Portrait or square
            fitHeight = Math.max(cropHeight, Math.round(cropWidth / targetRatio));
            fitWidth = Math.round(fitHeight * targetRatio);
          }

          sizeEl.textContent = `${fitWidth} x ${fitHeight}`;
          return;
        }
      }
    }

    sizeEl.textContent = `${cropWidth} x ${cropHeight}`;
  }

  /**
   * Get crop parameters in pixels
   */
  getCropParams() {
    return {
      x: Math.round(this.mediaWidth * this.cropRegion.x / 100),
      y: Math.round(this.mediaHeight * this.cropRegion.y / 100),
      width: Math.round(this.mediaWidth * this.cropRegion.width / 100),
      height: Math.round(this.mediaHeight * this.cropRegion.height / 100)
    };
  }

  /**
   * Export cropped image (canvas-based)
   */
  async exportCroppedImage() {
    if (this.isProcessing) return;

    console.log('[MediaCropperTool] Exporting cropped image');
    this.isProcessing = true;

    const progressContainer = document.getElementById('qt-cropper-progress');
    const progressFill = document.getElementById('qt-cropper-progress-fill');
    const progressPercent = document.getElementById('qt-cropper-progress-percent');
    const exportBtn = document.getElementById('qt-cropper-export-btn');

    progressContainer?.classList.remove('hidden');
    if (exportBtn) exportBtn.disabled = true;

    try {
      const outputFolder = this.manager.getOutputFolder('cropper');
      const cropParams = this.getCropParams();

      // Update progress
      if (progressFill) progressFill.style.width = '30%';
      if (progressPercent) progressPercent.textContent = '30%';

      // Create canvas and crop
      const canvas = document.createElement('canvas');
      canvas.width = cropParams.width;
      canvas.height = cropParams.height;
      const ctx = canvas.getContext('2d');

      // Draw cropped portion of image
      ctx.drawImage(
        this.mediaEl,
        cropParams.x, cropParams.y, cropParams.width, cropParams.height,
        0, 0, cropParams.width, cropParams.height
      );

      if (progressFill) progressFill.style.width = '60%';
      if (progressPercent) progressPercent.textContent = '60%';

      // Determine output format based on original file
      const ext = this.manager.getFileExtension(this.file.name).toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
      const outputExt = ext === 'png' ? 'png' : (ext === 'webp' ? 'webp' : 'jpg');

      // Convert canvas to blob
      const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType, 0.95));

      if (progressFill) progressFill.style.width = '80%';
      if (progressPercent) progressPercent.textContent = '80%';

      // Generate filename
      const baseName = this.file.name.replace(/\.[^/.]+$/, '');
      const filename = `${baseName}_cropped.${outputExt}`;

      // Save file
      const outputPath = await window.kolboDesktop.quickTools.saveFrame({
        filename: filename,
        outputFolder: outputFolder || this.file.path.replace(/[^/\\]+$/, ''),
        blob: blob
      });

      if (progressFill) progressFill.style.width = '100%';
      if (progressPercent) progressPercent.textContent = '100%';

      this.isProcessing = false;
      progressContainer?.classList.add('hidden');
      if (exportBtn) exportBtn.disabled = false;

      this.manager.showToast('Image cropped successfully!', 'success');
      console.log('[MediaCropperTool] Image crop complete:', outputPath);

      // Reveal file in folder
      if (outputPath && window.kolboDesktop) {
        window.kolboDesktop.revealFileInFolder(outputPath);
      }

    } catch (error) {
      console.error('[MediaCropperTool] Image crop failed:', error);
      this.isProcessing = false;
      progressContainer?.classList.add('hidden');
      if (exportBtn) exportBtn.disabled = false;
      this.manager.showToast('Crop failed: ' + error.message, 'error');
    }
  }

  /**
   * Export cropped video
   */
  async exportCroppedVideo() {
    if (this.isProcessing) return;

    console.log('[MediaCropperTool] Exporting cropped video');
    this.isProcessing = true;

    const progressContainer = document.getElementById('qt-cropper-progress');
    const progressFill = document.getElementById('qt-cropper-progress-fill');
    const progressPercent = document.getElementById('qt-cropper-progress-percent');
    const exportBtn = document.getElementById('qt-cropper-export-btn');

    progressContainer?.classList.remove('hidden');
    if (exportBtn) exportBtn.disabled = true;

    try {
      const outputFolder = this.manager.getOutputFolder('cropper');
      const cropParams = this.getCropParams();
      const jobId = `crop-${Date.now()}`;

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

          this.manager.showToast('Video cropped successfully!', 'success');
          console.log('[MediaCropperTool] Crop complete:', data.outputPath);

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

          this.manager.showToast('Crop failed: ' + data.error, 'error');
          console.error('[MediaCropperTool] Crop error:', data.error);
        }
      };

      window.kolboDesktop.ffmpeg.onProgress(progressHandler);
      window.kolboDesktop.ffmpeg.onComplete(completeHandler);
      window.kolboDesktop.ffmpeg.onError(errorHandler);

      // Call crop API
      if (window.kolboDesktop.quickTools) {
        await window.kolboDesktop.quickTools.cropVideo({
          id: jobId,
          filePath: this.file.path,
          outputFolder: outputFolder || this.file.path.replace(/[^/\\]+$/, ''),
          crop: cropParams,
          fillMode: this.fillMode,
          aspectRatio: this.selectedPreset
        });
      } else {
        throw new Error('Quick Tools API not available');
      }

    } catch (error) {
      console.error('[MediaCropperTool] Crop failed:', error);
      this.isProcessing = false;
      progressContainer?.classList.add('hidden');
      if (exportBtn) exportBtn.disabled = false;
      this.manager.showToast('Crop failed: ' + error.message, 'error');
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
    // Remove event listeners
    document.removeEventListener('mousemove', this.boundDoDrag);
    document.removeEventListener('mouseup', this.boundEndDrag);
    window.removeEventListener('resize', this.boundResize);

    if (this.fileUrl) {
      URL.revokeObjectURL(this.fileUrl);
      this.fileUrl = null;
    }
    this.file = null;
    this.mediaEl = null;
    this.overlayEl = null;
    this.cropEl = null;
    this.wrapperEl = null;
    this.selectedPreset = null;
    this.cropRegion = { x: 0, y: 0, width: 100, height: 100 };
    this.isProcessing = false;
    this.isImage = false;
  }
}
