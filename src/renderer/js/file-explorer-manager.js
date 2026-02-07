// Kolbo Studio - File Explorer Manager
// UI controller for local file browsing and drag-to-external-apps

console.log('[FileExplorer] Loading...');

class FileExplorerManager {
  constructor() {
    // Current state
    this.currentPath = '';
    this.files = [];
    this.folders = [];
    this.selectedFiles = new Set(); // Set of file paths
    this.lastSelectedPath = null; // For shift-click range selection
    this.sortBy = 'name';
    this.sortDirection = 'asc';
    this.isLoading = false;

    // View settings
    this.viewMode = localStorage.getItem('fe_view_mode') || 'list'; // 'list' or 'grid'
    this.iconSize = parseInt(localStorage.getItem('fe_icon_size')) || 2; // 1-4 scale

    // Default locations cache
    this.defaultLocations = [];
    this.drives = [];
    this.customFolders = this.loadCustomFolders();
    this.isTruncated = false;

    // Expanded folders in sidebar (path -> children)
    this.expandedFolders = new Map();

    // DOM references
    this.container = null;
    this.fileListEl = null;
    this.previewPanel = null;
    this.breadcrumbEl = null;
    this.sidebarList = null;

    // Drag state
    this.isDragging = false;
    this.dragPreviewEl = null;

    // Metadata cache (path -> metadata)
    this.metadataCache = new Map();

    // Thumbnail cache (path -> data URL or file URL)
    this.thumbnailCache = new Map();

    // Preview state
    this.previewFile = null;
    this.previewMediaEl = null;
    this.previewDuration = 0;
    this.previewInPoint = 0;
    this.previewOutPoint = 0;
    this.isPreviewPlaying = false;
    this.previewAnimationFrame = null;

    // Cached trimmed file for drag export
    this.cachedTrimmedPath = null;
    this.isTrimmedCacheReady = false;
    this.isExportingTrim = false;
    this._exportDebounceTimer = null;

    // Bound methods for event listeners
    this._handleKeyDown = this.handleKeyDown.bind(this);
    this._handleClickOutside = this.handleClickOutside.bind(this);

    console.log('[FileExplorer] Manager created');
  }

  /**
   * Initialize the file explorer
   * @param {HTMLElement} containerEl - Container element to render into
   */
  async init(containerEl) {
    console.log('[FileExplorer] Initializing...');

    if (!containerEl) {
      console.error('[FileExplorer] No container element provided');
      return;
    }

    this.container = containerEl;

    // Check if file explorer API is available
    if (!window.kolboDesktop || !window.kolboDesktop.fileExplorer) {
      console.error('[FileExplorer] File explorer API not available');
      this.container.innerHTML = `
        <div class="fe-empty-state" style="height: 100%; display: flex; align-items: center; justify-content: center;">
          <div style="text-align: center; color: rgb(var(--muted-foreground));">
            <p>File Bridge not available</p>
            <p style="font-size: 12px;">Please restart the app</p>
          </div>
        </div>`;
      return;
    }

    try {
      // Render the UI structure
      this.render();

      // Load default locations and drives
      await this.loadSidebarData();

      // Navigate to home directory by default
      const home = await window.kolboDesktop.fileExplorer.getHome();
      console.log('[FileExplorer] Home directory:', home);
      await this.navigateTo(home);

      // Setup global event listeners
      document.addEventListener('keydown', this._handleKeyDown);
      document.addEventListener('click', this._handleClickOutside);

      console.log('[FileExplorer] Initialized successfully');
    } catch (error) {
      console.error('[FileExplorer] Initialization error:', error);
      this.container.innerHTML = `
        <div class="fe-empty-state" style="height: 100%; display: flex; align-items: center; justify-content: center;">
          <div style="text-align: center; color: rgb(var(--muted-foreground));">
            <p>Error loading File Bridge</p>
            <p style="font-size: 12px;">${error.message}</p>
          </div>
        </div>`;
    }
  }

  /**
   * Clean up event listeners
   */
  destroy() {
    document.removeEventListener('keydown', this._handleKeyDown);
    document.removeEventListener('click', this._handleClickOutside);
    this.metadataCache.clear();
    console.log('[FileExplorer] Destroyed');
  }

  /**
   * Render the file explorer UI structure
   */
  render() {
    const sliderProgress = ((this.iconSize - 1) / 3) * 100;

    this.container.innerHTML = `
      <div class="file-explorer-container">
        <!-- Toolbar -->
        <div class="fe-toolbar">
          <div class="fe-breadcrumb" id="fe-breadcrumb">
            <!-- Breadcrumb items will be inserted here -->
          </div>
          <div class="fe-toolbar-actions">
            <button class="fe-toolbar-btn" id="fe-btn-up" title="Go Up (Backspace)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 11l-5-5-5 5M12 6v12"/>
              </svg>
            </button>
            <button class="fe-toolbar-btn" id="fe-btn-refresh" title="Refresh (F5)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
              </svg>
            </button>
            <button class="fe-toolbar-btn" id="fe-btn-folder" title="Open Folder...">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                <line x1="12" y1="11" x2="12" y2="17"/>
                <line x1="9" y1="14" x2="15" y2="14"/>
              </svg>
            </button>
            <div class="fe-toolbar-divider"></div>
            <div class="fe-view-toggle">
              <button class="fe-toolbar-btn fe-view-btn ${this.viewMode === 'list' ? 'active' : ''}" id="fe-btn-list" title="List View">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="8" y1="6" x2="21" y2="6"/>
                  <line x1="8" y1="12" x2="21" y2="12"/>
                  <line x1="8" y1="18" x2="21" y2="18"/>
                  <line x1="3" y1="6" x2="3.01" y2="6"/>
                  <line x1="3" y1="12" x2="3.01" y2="12"/>
                  <line x1="3" y1="18" x2="3.01" y2="18"/>
                </svg>
              </button>
              <button class="fe-toolbar-btn fe-view-btn ${this.viewMode === 'grid' ? 'active' : ''}" id="fe-btn-grid" title="Grid View">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="7" height="7"/>
                  <rect x="14" y="3" width="7" height="7"/>
                  <rect x="14" y="14" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/>
                </svg>
              </button>
            </div>
            <div class="fe-icon-size-control">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
              </svg>
              <div class="fe-slider-container" style="--slider-progress: ${sliderProgress}%">
                <input type="range" min="1" max="4" value="${this.iconSize}" class="fe-icon-slider" id="fe-icon-slider" title="Icon Size">
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
              </svg>
            </div>
            <div class="fe-toolbar-divider"></div>
            <select class="fe-sort-select" id="fe-sort-select">
              <option value="name">Sort by Name</option>
              <option value="date">Sort by Date</option>
              <option value="size">Sort by Size</option>
              <option value="type">Sort by Type</option>
            </select>
          </div>
        </div>

        <!-- Main content -->
        <div class="file-explorer-main">
          <!-- Folder sidebar -->
          <div class="fe-sidebar">
            <div class="fe-sidebar-list" id="fe-sidebar-list">
              <!-- Sidebar items will be inserted here -->
            </div>
          </div>

          <div class="fe-resize-handle" id="fe-resize-handle"></div>

          <!-- File list panel -->
          <div class="fe-file-panel">
            <!-- Column headers (list view only) -->
            <div class="fe-file-header" id="fe-file-header" style="${this.viewMode === 'grid' ? 'display: none;' : ''}">
              <div class="fe-file-header-col fe-col-name sorted" data-sort="name">
                Name
                <svg class="sort-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 5v14M5 12l7 7 7-7"/>
                </svg>
              </div>
              <div class="fe-file-header-col fe-col-folder" data-sort="folder">Folder</div>
              <div class="fe-file-header-col fe-col-type" data-sort="type">Type</div>
              <div class="fe-file-header-col fe-col-duration" data-sort="duration">Duration</div>
              <div class="fe-file-header-col fe-col-size" data-sort="size">Size</div>
              <div class="fe-file-header-col fe-col-date" data-sort="date">Modified</div>
            </div>

            <!-- File list -->
            <div class="fe-file-list ${this.viewMode === 'grid' ? 'fe-grid-view' : 'fe-list-view'} fe-icon-size-${this.iconSize}" id="fe-file-list">
              <!-- Files will be inserted here -->
            </div>
          </div>

        </div>

        <!-- Preview Panel (Bottom) -->
        <div class="fe-preview-bottom hidden" id="fe-preview-sidebar">
          <!-- Left: Media/Waveform Preview (draggable to export) -->
          <div class="fe-preview-media-section" id="fe-preview-drag-area" draggable="true" title="Drag to export selection to external app">
            <div class="fe-preview-player" id="fe-preview-player">
              <!-- Video/Image/Audio waveform will be inserted here -->
            </div>
            <div class="fe-preview-drag-overlay" id="fe-preview-drag-overlay">
              <div class="fe-drag-status-icon">
                <svg class="fe-drag-ready-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 5v14M5 12l7-7 7 7"/>
                </svg>
                <svg class="fe-drag-export-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
              </div>
              <span class="fe-drag-status-text">Drag to app</span>
            </div>
          </div>

          <!-- Center: Timeline with In/Out -->
          <div class="fe-preview-timeline-section">
            <div class="fe-preview-timeline" id="fe-preview-timeline">
              <div class="fe-preview-timeline-track" id="fe-preview-track">
                <!-- Waveform inside track (for audio files) -->
                <div class="fe-preview-waveform-container hidden" id="fe-waveform-container">
                  <div class="fe-preview-waveform-bars" id="fe-waveform-bars"></div>
                </div>
                <!-- Video thumbnails filmstrip (for video files) -->
                <div class="fe-preview-thumbnails-container hidden" id="fe-thumbnails-container">
                  <canvas id="fe-thumbnails-canvas"></canvas>
                </div>
                <!-- Selection, progress, playhead, handles -->
                <div class="fe-preview-timeline-selection" id="fe-preview-selection"></div>
                <div class="fe-preview-timeline-progress" id="fe-preview-progress"></div>
                <div class="fe-preview-playhead" id="fe-preview-playhead"></div>
                <div class="fe-preview-handle fe-preview-handle-in" id="fe-handle-in"></div>
                <div class="fe-preview-handle fe-preview-handle-out" id="fe-handle-out"></div>
              </div>
            </div>
            <!-- Time Display -->
            <div class="fe-preview-time-row">
              <span class="fe-preview-filename" id="fe-preview-title">No file selected</span>
              <span class="fe-preview-time-info">
                <span class="fe-preview-time-in" id="fe-time-in">0:00</span>
                <span class="fe-time-sep"> → </span>
                <span class="fe-preview-time-out" id="fe-time-out">0:00</span>
                <span class="fe-time-dur"> (<span id="fe-time-duration">0:00</span>)</span>
              </span>
            </div>
          </div>

          <!-- Right: Controls -->
          <div class="fe-preview-controls-section">
            <button class="fe-preview-io-btn in-btn" id="fe-btn-in" title="Set In Point (I)">IN</button>
            <button class="fe-preview-ctrl-btn" id="fe-btn-prev" title="Previous Frame">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
            </button>
            <button class="fe-preview-ctrl-btn play-btn" id="fe-btn-play" title="Play/Pause (Space)">
              <svg viewBox="0 0 24 24" fill="currentColor" id="fe-play-icon"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <button class="fe-preview-ctrl-btn" id="fe-btn-next" title="Next Frame">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
            </button>
            <button class="fe-preview-io-btn out-btn" id="fe-btn-out" title="Set Out Point (O)">OUT</button>
            <div class="fe-preview-divider"></div>
            <button class="fe-preview-close" id="fe-preview-close" title="Close Preview">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Selection bar (shown when multiple files are selected) -->
        <div class="fe-selection-bar hidden" id="fe-selection-bar">
          <div class="fe-selection-info" id="fe-selection-info">0 items selected</div>
          <div class="fe-selection-actions">
            <button class="fe-preview-btn" id="fe-btn-drag">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <path d="M14 2v6h6"/>
              </svg>
              Drag to App
            </button>
            <button class="fe-preview-btn secondary" id="fe-btn-clear">Clear Selection</button>
          </div>
        </div>
      </div>
    `;

    // Cache DOM references
    this.breadcrumbEl = this.container.querySelector('#fe-breadcrumb');
    this.sidebarList = this.container.querySelector('#fe-sidebar-list');
    this.fileListEl = this.container.querySelector('#fe-file-list');
    this.previewSidebar = this.container.querySelector('#fe-preview-sidebar');
    this.selectionBar = this.container.querySelector('#fe-selection-bar');

    // Preview player elements
    this.previewPlayer = this.container.querySelector('#fe-preview-player');
    this.previewTimeline = this.container.querySelector('#fe-preview-timeline');
    this.previewTrack = this.container.querySelector('#fe-preview-track');
    this.previewSelection = this.container.querySelector('#fe-preview-selection');
    this.previewProgress = this.container.querySelector('#fe-preview-progress');
    this.previewPlayhead = this.container.querySelector('#fe-preview-playhead');

    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Setup UI event listeners
   */
  setupEventListeners() {
    // Toolbar buttons
    this.container.querySelector('#fe-btn-up').addEventListener('click', () => this.goUp());
    this.container.querySelector('#fe-btn-refresh').addEventListener('click', () => this.refresh());
    this.container.querySelector('#fe-btn-folder').addEventListener('click', () => this.openFolderPicker());

    // Sort select
    this.container.querySelector('#fe-sort-select').addEventListener('change', (e) => {
      this.sortBy = e.target.value;
      this.sortFiles();
      this.renderFileList();
    });

    // View mode toggle
    this.container.querySelector('#fe-btn-list').addEventListener('click', () => this.setViewMode('list'));
    this.container.querySelector('#fe-btn-grid').addEventListener('click', () => this.setViewMode('grid'));

    // Icon size slider with progress update
    const iconSlider = this.container.querySelector('#fe-icon-slider');
    const sliderContainer = this.container.querySelector('.fe-slider-container');
    iconSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      this.setIconSize(value);
      // Update slider progress
      const progress = ((value - 1) / 3) * 100;
      sliderContainer.style.setProperty('--slider-progress', `${progress}%`);
    });

    // Column headers for sorting
    this.container.querySelectorAll('.fe-file-header-col').forEach(col => {
      col.addEventListener('click', () => {
        const sortField = col.dataset.sort;
        if (this.sortBy === sortField) {
          this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortBy = sortField;
          this.sortDirection = 'asc';
        }
        this.updateSortIndicators();
        this.sortFiles();
        this.renderFileList();
      });
    });

    // Selection bar buttons
    this.container.querySelector('#fe-btn-drag').addEventListener('click', () => this.startDragSelected());
    this.container.querySelector('#fe-btn-clear').addEventListener('click', () => this.clearSelection());

    // Preview sidebar controls
    this.container.querySelector('#fe-preview-close').addEventListener('click', () => this.closePreview());
    this.container.querySelector('#fe-btn-play').addEventListener('click', () => this.togglePreviewPlayback());
    this.container.querySelector('#fe-btn-prev').addEventListener('click', () => this.stepPreviewFrame(-1));
    this.container.querySelector('#fe-btn-next').addEventListener('click', () => this.stepPreviewFrame(1));
    this.container.querySelector('#fe-btn-in').addEventListener('click', () => this.setPreviewInPoint());
    this.container.querySelector('#fe-btn-out').addEventListener('click', () => this.setPreviewOutPoint());

    // Preview media area - click to export and drag
    this.setupPreviewDragEvents();

    // Timeline click/drag (for in/out selection only)
    this.setupTimelineEvents();

    // Sidebar resize handle
    const resizeHandle = this.container.querySelector('#fe-resize-handle');
    const sidebar = this.container.querySelector('.fe-sidebar');
    let isResizing = false;

    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const containerRect = this.container.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      if (newWidth >= 180 && newWidth <= 350) {
        sidebar.style.width = newWidth + 'px';
      }
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });

    // File list drag events for native drag
    this.fileListEl.addEventListener('dragstart', (e) => this.handleDragStart(e));
    this.fileListEl.addEventListener('dragend', (e) => this.handleDragEnd(e));
  }

  /**
   * Load sidebar data (locations and drives)
   */
  async loadSidebarData() {
    try {
      const [locationsResult, drivesResult] = await Promise.all([
        window.kolboDesktop.fileExplorer.getDefaultLocations(),
        window.kolboDesktop.fileExplorer.getDrives()
      ]);

      if (locationsResult.success) {
        this.defaultLocations = locationsResult.locations;
      }

      if (drivesResult.success) {
        this.drives = drivesResult.drives;
      }

      this.renderSidebar();
    } catch (error) {
      console.error('[FileExplorer] Failed to load sidebar data:', error);
    }
  }

  /**
   * Render the sidebar with locations and drives
   */
  renderSidebar() {
    let html = '';

    // Quick Access section
    if (this.defaultLocations.length > 0 || this.customFolders.length > 0) {
      html += `<div class="fe-sidebar-section">
        <div class="fe-sidebar-title">
          Quick Access
          <button class="fe-add-folder-btn" id="fe-add-folder-btn" title="Add Folder">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
        </div>`;

      // Default locations with expandable tree
      for (const loc of this.defaultLocations) {
        html += this.renderTreeItem(loc.path, loc.name, loc.icon);
      }

      // Custom folders with expandable tree and colors
      for (const folder of this.customFolders) {
        html += this.renderTreeItem(folder.path, folder.name, 'folder', true, folder.color);
      }

      html += `</div>`;
    }

    // Drives section
    if (this.drives.length > 0) {
      html += `<div class="fe-sidebar-section">
        <div class="fe-sidebar-title">Drives</div>`;

      for (const drive of this.drives) {
        html += this.renderTreeItem(drive.path, drive.name, 'drive');
      }
      html += `</div>`;
    }

    this.sidebarList.innerHTML = html;
    this.setupSidebarEventListeners();
  }

  /**
   * Render a tree item (folder with expandable children)
   */
  renderTreeItem(folderPath, name, iconType, isCustom = false, color = null) {
    const isExpanded = this.expandedFolders.has(folderPath);
    const children = this.expandedFolders.get(folderPath) || [];
    const isActive = this.currentPath === folderPath;

    // Color style for custom folders
    const colorStyle = color ? `style="color: ${color}"` : '';
    const colorDot = color ? `<span class="fe-folder-color-dot" style="background: ${color}"></span>` : '';

    let iconHtml;
    if (iconType === 'drive') {
      iconHtml = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="4" width="20" height="16" rx="2"/>
        <path d="M6 8h.01M2 12h20"/>
      </svg>`;
    } else {
      iconHtml = this.getLocationIcon(iconType);
    }

    let html = `
      <div class="fe-tree-item" data-path="${this.escapeHtml(folderPath)}">
        <div class="fe-tree-row${isActive ? ' active' : ''}${isCustom ? ' fe-custom-folder' : ''}" data-path="${this.escapeHtml(folderPath)}">
          <span class="fe-tree-toggle${isExpanded ? ' expanded' : ''}" data-toggle-path="${this.escapeHtml(folderPath)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </span>
          <span class="fe-tree-icon" ${colorStyle}>${iconHtml}</span>
          ${colorDot}
          <span class="fe-tree-name">${this.escapeHtml(name)}</span>
          ${isCustom ? `
            <span class="fe-edit-folder" data-edit-path="${this.escapeHtml(folderPath)}" title="Edit Folder">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </span>
            <span class="fe-remove-folder" data-remove-path="${this.escapeHtml(folderPath)}" title="Remove from Quick Access">×</span>
          ` : ''}
        </div>
        <div class="fe-tree-children${!isExpanded ? ' collapsed' : ''}">`;

    if (isExpanded && children.length > 0) {
      for (const child of children) {
        html += this.renderTreeItem(child.path, child.name, 'folder');
      }
    } else if (isExpanded) {
      html += `<div class="fe-tree-loading">Loading...</div>`;
    }

    html += `</div></div>`;
    return html;
  }

  /**
   * Setup sidebar event listeners
   */
  setupSidebarEventListeners() {
    // Add folder button
    const addFolderBtn = this.sidebarList.querySelector('#fe-add-folder-btn');
    if (addFolderBtn) {
      addFolderBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.addCustomFolder();
      });
    }

    // Edit folder button click listeners
    this.sidebarList.querySelectorAll('.fe-edit-folder').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const editPath = btn.dataset.editPath;
        if (editPath) {
          this.showFolderEditDialog(editPath);
        }
      });
    });

    // Tree toggle click listeners (expand/collapse)
    this.sidebarList.querySelectorAll('.fe-tree-toggle').forEach(toggle => {
      toggle.addEventListener('click', async (e) => {
        e.stopPropagation();
        const folderPath = toggle.dataset.togglePath;
        if (folderPath) {
          await this.toggleFolderExpand(folderPath);
        }
      });
    });

    // Tree row click listeners (navigate)
    this.sidebarList.querySelectorAll('.fe-tree-row').forEach(row => {
      row.addEventListener('click', (e) => {
        // Don't navigate if clicking on toggle or remove button
        if (e.target.closest('.fe-tree-toggle') || e.target.classList.contains('fe-remove-folder')) return;
        const path = row.dataset.path;
        if (path) {
          this.navigateTo(path);
        }
      });
    });

    // Remove folder button click listeners
    this.sidebarList.querySelectorAll('.fe-remove-folder').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const removePath = btn.dataset.removePath;
        if (removePath) {
          this.removeCustomFolder(removePath);
        }
      });
    });
  }

  /**
   * Toggle folder expansion in sidebar
   */
  async toggleFolderExpand(folderPath) {
    if (this.expandedFolders.has(folderPath)) {
      // Collapse
      this.expandedFolders.delete(folderPath);
    } else {
      // Expand - load children
      try {
        const result = await window.kolboDesktop.fileExplorer.listDirectory(folderPath);
        if (result.success) {
          this.expandedFolders.set(folderPath, result.folders);
        } else {
          this.expandedFolders.set(folderPath, []);
        }
      } catch (error) {
        console.error('[FileExplorer] Failed to load folder children:', error);
        this.expandedFolders.set(folderPath, []);
      }
    }
    this.renderSidebar();
  }

  /**
   * Navigate to a directory
   * @param {string} dirPath - Path to navigate to
   */
  async navigateTo(dirPath) {
    if (this.isLoading) return;
    this.isLoading = true;

    // Show loading state with scanning message
    this.fileListEl.innerHTML = `
      <div class="fe-loading">
        <div class="spinner"></div>
        <p>Scanning folder...</p>
      </div>`;

    try {
      // Use recursive listing to get ALL media files from subfolders
      const result = await window.kolboDesktop.fileExplorer.listDirectoryRecursive(dirPath);

      if (!result.success) {
        this.showError(result.error || 'Failed to load directory');
        this.isLoading = false;
        return;
      }

      this.currentPath = result.path;
      this.folders = result.folders; // Immediate subfolders only (for sidebar)
      this.files = result.files; // ALL media files from all subfolders
      this.isRecursiveView = true;
      this.isTruncated = result.truncated || false;

      // Clear selection when navigating
      this.clearSelection();

      // Update UI
      this.updateBreadcrumb();
      this.updateSidebarActive();
      this.sortFiles();
      this.renderFileList();

      console.log(`[FileExplorer] Loaded ${this.files.length} media files from "${dirPath}"`);

    } catch (error) {
      console.error('[FileExplorer] Navigation error:', error);
      this.showError(error.message);
    }

    this.isLoading = false;
  }


  /**
   * Refresh current directory
   */
  async refresh() {
    if (this.currentPath) {
      // Clear metadata cache on refresh
      this.metadataCache.clear();
      this.thumbnailCache.clear();
      await this.navigateTo(this.currentPath);
    }
  }

  /**
   * Set view mode (list or grid)
   */
  setViewMode(mode) {
    this.viewMode = mode;
    localStorage.setItem('fe_view_mode', mode);

    // Update toolbar buttons
    this.container.querySelector('#fe-btn-list').classList.toggle('active', mode === 'list');
    this.container.querySelector('#fe-btn-grid').classList.toggle('active', mode === 'grid');

    // Update file list classes
    this.fileListEl.classList.toggle('fe-list-view', mode === 'list');
    this.fileListEl.classList.toggle('fe-grid-view', mode === 'grid');

    // Show/hide column headers
    const header = this.container.querySelector('#fe-file-header');
    if (header) {
      header.style.display = mode === 'grid' ? 'none' : '';
    }

    // Re-render file list
    this.renderFileList();
  }

  /**
   * Set icon size
   */
  setIconSize(size) {
    this.iconSize = size;
    localStorage.setItem('fe_icon_size', size.toString());

    // Update file list class
    this.fileListEl.className = this.fileListEl.className.replace(/fe-icon-size-\d/g, '');
    this.fileListEl.classList.add(`fe-icon-size-${size}`);
  }

  /**
   * Go up one directory level
   */
  async goUp() {
    if (!this.currentPath) return;

    const parentPath = this.getParentPath(this.currentPath);
    if (parentPath && parentPath !== this.currentPath) {
      await this.navigateTo(parentPath);
    }
  }

  /**
   * Open folder picker dialog
   */
  async openFolderPicker() {
    const result = await window.kolboDesktop.fileExplorer.pickFolder();
    if (result.success && result.folderPath) {
      await this.navigateTo(result.folderPath);
    }
  }

  /**
   * Update breadcrumb navigation
   */
  updateBreadcrumb() {
    const parts = this.currentPath.split(/[/\\]/).filter(Boolean);
    let html = '';
    let currentPath = '';

    // On Windows, handle drive letter
    const platform = window.kolboDesktop?.platform || 'win32';
    if (platform === 'win32' || this.currentPath.match(/^[A-Z]:\\/i)) {
      if (parts.length > 0 && parts[0].match(/^[A-Z]:$/i)) {
        currentPath = parts[0] + '\\';
        html += `<button class="fe-breadcrumb-item" data-path="${this.escapeHtml(currentPath)}">
          ${this.escapeHtml(parts[0])}
        </button>`;
        parts.shift();
      }
    } else {
      // Unix root
      currentPath = '/';
      html += `<button class="fe-breadcrumb-item" data-path="/">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        </svg>
      </button>`;
    }

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const separator = this.currentPath.includes('\\') ? '\\' : '/';
      currentPath = currentPath + (currentPath.endsWith(separator) ? '' : separator) + part;

      html += `<span class="fe-breadcrumb-separator">›</span>`;
      html += `<button class="fe-breadcrumb-item${i === parts.length - 1 ? ' active' : ''}"
        data-path="${this.escapeHtml(currentPath)}">
        ${this.escapeHtml(part)}
      </button>`;
    }

    this.breadcrumbEl.innerHTML = html;

    // Add click listeners
    this.breadcrumbEl.querySelectorAll('.fe-breadcrumb-item').forEach(item => {
      item.addEventListener('click', () => {
        const path = item.dataset.path;
        this.navigateTo(path);
      });
    });
  }

  /**
   * Update sidebar active state
   */
  updateSidebarActive() {
    // Update tree row active states
    this.sidebarList.querySelectorAll('.fe-tree-row').forEach(row => {
      const path = row.dataset.path;
      if (path === this.currentPath) {
        row.classList.add('active');
      } else {
        row.classList.remove('active');
      }
    });
  }

  /**
   * Sort files array based on current sort settings
   */
  sortFiles() {
    const direction = this.sortDirection === 'asc' ? 1 : -1;

    const sortFn = (a, b) => {
      let valA, valB;

      switch (this.sortBy) {
        case 'name':
          return direction * a.name.localeCompare(b.name);
        case 'folder':
          valA = a.folderName || '';
          valB = b.folderName || '';
          return direction * valA.localeCompare(valB);
        case 'date':
          valA = new Date(a.modifiedAt).getTime();
          valB = new Date(b.modifiedAt).getTime();
          return direction * (valA - valB);
        case 'size':
          valA = a.size || 0;
          valB = b.size || 0;
          return direction * (valA - valB);
        case 'type':
          valA = a.type || '';
          valB = b.type || '';
          return direction * valA.localeCompare(valB);
        default:
          return 0;
      }
    };

    // Sort folders and files separately (folders always first)
    this.folders.sort((a, b) => direction * a.name.localeCompare(b.name));
    this.files.sort(sortFn);
  }

  /**
   * Update sort indicators in column headers
   */
  updateSortIndicators() {
    this.container.querySelectorAll('.fe-file-header-col').forEach(col => {
      col.classList.remove('sorted');
      const icon = col.querySelector('.sort-icon');
      if (icon) {
        icon.style.transform = '';
      }
    });

    const sortMap = { name: 'name', date: 'date', size: 'size', type: 'type', duration: 'duration' };
    const activeCol = this.container.querySelector(`.fe-file-header-col[data-sort="${this.sortBy}"]`);
    if (activeCol) {
      activeCol.classList.add('sorted');
      const icon = activeCol.querySelector('.sort-icon');
      if (icon && this.sortDirection === 'asc') {
        icon.style.transform = 'rotate(180deg)';
      }
    }
  }

  /**
   * Render the file list
   */
  renderFileList() {
    if (this.folders.length === 0 && this.files.length === 0) {
      this.fileListEl.innerHTML = `
        <div class="fe-empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <h3>No media files</h3>
          <p>This folder contains no video, audio, or image files</p>
        </div>`;
      return;
    }

    let html = '';

    // Render folders first
    for (const folder of this.folders) {
      html += this.renderFolderItem(folder);
    }

    // Render files
    for (const file of this.files) {
      html += this.renderFileItem(file);
    }

    this.fileListEl.innerHTML = html;

    // Setup click and drag handlers
    this.fileListEl.querySelectorAll('.fe-file-item').forEach(item => {
      const path = item.dataset.path;
      const isFolder = item.classList.contains('folder');

      // Click handler
      item.addEventListener('click', (e) => {
        if (isFolder) {
          this.navigateTo(path);
        } else {
          this.handleFileClick(e, path);
        }
      });

      // Double-click to open folder or reveal file
      item.addEventListener('dblclick', () => {
        if (!isFolder) {
          window.kolboDesktop.revealFileInFolder(path);
        }
      });

      // Make files draggable
      if (!isFolder) {
        item.draggable = true;
      }
    });

    // Lazy load metadata for visible files
    this.loadVisibleMetadata();
  }

  /**
   * Render a folder item
   */
  renderFolderItem(folder) {
    return `
      <div class="fe-file-item folder" data-path="${this.escapeHtml(folder.path)}">
        <div class="fe-file-icon folder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="fe-file-name">${this.escapeHtml(folder.name)}</div>
        <div class="fe-file-type">Folder</div>
        <div class="fe-file-duration">--</div>
        <div class="fe-file-size">--</div>
        <div class="fe-file-date">${this.formatDate(folder.modifiedAt)}</div>
      </div>`;
  }

  /**
   * Render a file item
   */
  renderFileItem(file) {
    const isSelected = this.selectedFiles.has(file.path);
    const cachedMeta = this.metadataCache.get(file.path);
    const duration = cachedMeta?.durationFormatted || '--:--';

    // Generate thumbnail content based on file type
    let thumbnailContent;
    if (file.type === 'image') {
      // For images, show the actual image as thumbnail
      const fileUrl = this.getFileUrl(file.path);
      thumbnailContent = `<img src="${fileUrl}" alt="${this.escapeHtml(file.name)}" loading="lazy">`;
    } else if (file.type === 'video') {
      // For videos, show a video element (first frame)
      const fileUrl = this.getFileUrl(file.path);
      thumbnailContent = `<video src="${fileUrl}" preload="metadata" muted></video>`;
    } else {
      // For other files, show the icon
      thumbnailContent = this.getFileTypeIcon(file.type);
    }

    // Show folder path if file is from a subfolder
    const folderDisplay = file.folderName ? `<div class="fe-file-folder" title="${this.escapeHtml(file.relativePath || '')}">${this.escapeHtml(file.folderName)}</div>` : '<div class="fe-file-folder">—</div>';

    return `
      <div class="fe-file-item${isSelected ? ' selected' : ''}"
           data-path="${this.escapeHtml(file.path)}"
           data-type="${file.type}">
        <div class="fe-file-icon ${file.type}">
          ${thumbnailContent}
        </div>
        <div class="fe-file-name">${this.escapeHtml(file.name)}</div>
        ${folderDisplay}
        <div class="fe-file-type">${file.type}</div>
        <div class="fe-file-duration" data-path="${this.escapeHtml(file.path)}">${duration}</div>
        <div class="fe-file-size">${file.sizeFormatted}</div>
        <div class="fe-file-date">${this.formatDate(file.modifiedAt)}</div>
      </div>`;
  }

  /**
   * Get file URL for displaying in img/video tags
   */
  getFileUrl(filePath) {
    // Handle Windows paths and encode special characters
    const normalizedPath = filePath.replace(/\\/g, '/');
    return `file:///${encodeURI(normalizedPath).replace(/#/g, '%23')}`;
  }

  /**
   * Handle file click for selection
   */
  handleFileClick(e, filePath) {
    if (e.ctrlKey || e.metaKey) {
      // Toggle selection
      if (this.selectedFiles.has(filePath)) {
        this.selectedFiles.delete(filePath);
      } else {
        this.selectedFiles.add(filePath);
      }
      this.lastSelectedPath = filePath;
    } else if (e.shiftKey && this.lastSelectedPath) {
      // Range selection
      this.selectRange(this.lastSelectedPath, filePath);
    } else {
      // Single selection
      this.selectedFiles.clear();
      this.selectedFiles.add(filePath);
      this.lastSelectedPath = filePath;
    }

    this.updateSelectionUI();
    this.updatePreviewPanel();
  }

  /**
   * Select a range of files
   */
  selectRange(startPath, endPath) {
    const allPaths = this.files.map(f => f.path);
    const startIdx = allPaths.indexOf(startPath);
    const endIdx = allPaths.indexOf(endPath);

    if (startIdx === -1 || endIdx === -1) return;

    const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];

    for (let i = from; i <= to; i++) {
      this.selectedFiles.add(allPaths[i]);
    }
  }

  /**
   * Clear all selections
   */
  clearSelection() {
    this.selectedFiles.clear();
    this.lastSelectedPath = null;
    this.updateSelectionUI();
    this.hidePreviewPanel();
  }

  /**
   * Update selection UI (highlight selected items, show/hide selection bar)
   */
  updateSelectionUI() {
    // Update item highlighting
    this.fileListEl.querySelectorAll('.fe-file-item').forEach(item => {
      const path = item.dataset.path;
      if (this.selectedFiles.has(path)) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    });

    // Update selection bar (show only for multiple selections)
    if (this.selectedFiles.size > 1) {
      this.selectionBar.classList.remove('hidden');
      const info = this.container.querySelector('#fe-selection-info');
      const count = this.selectedFiles.size;
      info.textContent = `${count} items selected`;
    } else {
      this.selectionBar.classList.add('hidden');
    }
  }

  /**
   * Update the preview sidebar with selected file info
   */
  async updatePreviewPanel() {
    if (this.selectedFiles.size !== 1) {
      // For multiple selections, just show selection bar
      this.closePreview();
      return;
    }

    const filePath = Array.from(this.selectedFiles)[0];
    const file = this.files.find(f => f.path === filePath);
    if (!file) return;

    // Stop any previous playback
    this.stopPreviewPlayback();

    // Clear cached trim from previous file
    this.cachedTrimmedPath = null;
    this.isTrimmedCacheReady = false;
    this.isExportingTrim = false;
    if (this._exportDebounceTimer) {
      clearTimeout(this._exportDebounceTimer);
      this._exportDebounceTimer = null;
    }

    this.previewFile = file;
    this.previewSidebar.classList.remove('hidden');

    // Get metadata
    let metadata = this.metadataCache.get(filePath);
    if (!metadata) {
      metadata = await window.kolboDesktop.fileExplorer.getMetadata(filePath);
      if (metadata.success) {
        this.metadataCache.set(filePath, metadata);
      }
    }

    // Update title
    this.container.querySelector('#fe-preview-title').textContent = metadata.name || file.name;

    // Setup media player based on type
    const fileUrl = this.getFileUrl(filePath);
    const playerEl = this.previewPlayer;
    const waveformContainer = this.container.querySelector('#fe-waveform-container');
    const waveformBars = this.container.querySelector('#fe-waveform-bars');

    if (file.type === 'video') {
      playerEl.innerHTML = `<video id="fe-media-el" src="${fileUrl}" preload="metadata"></video>`;
      this.previewMediaEl = playerEl.querySelector('#fe-media-el');
      this.setupMediaEvents();
      this.setupVideoThumbnails(); // Generate timeline thumbnails
      this.previewTimeline.style.display = '';
      // Hide waveform for video (thumbnails will show instead)
      if (waveformContainer) waveformContainer.classList.add('hidden');
    } else if (file.type === 'audio') {
      // Audio: show icon in preview, waveform spans timeline section
      playerEl.innerHTML = `
        <div class="fe-preview-icon-placeholder">
          ${this.getFileTypeIcon('audio')}
        </div>
        <audio id="fe-media-el" src="${fileUrl}" preload="metadata"></audio>
      `;
      this.previewMediaEl = playerEl.querySelector('#fe-media-el');
      this.setupMediaEvents();
      this.previewTimeline.style.display = '';

      // Hide video thumbnails
      const thumbnailsContainer = this.container.querySelector('#fe-thumbnails-container');
      if (thumbnailsContainer) thumbnailsContainer.classList.add('hidden');

      // Show waveform in timeline track (full width)
      if (waveformContainer && waveformBars) {
        waveformContainer.classList.remove('hidden');
        waveformBars.innerHTML = this.generateWaveformBars(100); // More bars for wider display
      }
    } else if (file.type === 'image') {
      playerEl.innerHTML = `<img src="${fileUrl}" alt="${this.escapeHtml(file.name)}">`;
      this.previewMediaEl = null;
      this.previewTimeline.style.display = 'none';
      // For images, in/out is just full image
      this.previewDuration = 0;
      this.previewInPoint = 0;
      this.previewOutPoint = 0;
      // Hide waveform and thumbnails for images
      if (waveformContainer) waveformContainer.classList.add('hidden');
      const thumbnailsContainer = this.container.querySelector('#fe-thumbnails-container');
      if (thumbnailsContainer) thumbnailsContainer.classList.add('hidden');
    } else {
      playerEl.innerHTML = `<div class="fe-preview-icon-placeholder">${this.getFileTypeIcon(file.type)}</div>`;
      this.previewMediaEl = null;
      this.previewTimeline.style.display = 'none';
      // Hide waveform and thumbnails for other types
      if (waveformContainer) waveformContainer.classList.add('hidden');
      const thumbnailsContainer = this.container.querySelector('#fe-thumbnails-container');
      if (thumbnailsContainer) thumbnailsContainer.classList.add('hidden');
    }

    // Update metadata display
    this.updatePreviewMetadata(metadata);
  }

  /**
   * Generate waveform bar elements with realistic wave pattern
   */
  generateWaveformBars(count) {
    let html = '';
    for (let i = 0; i < count; i++) {
      // Create a more natural waveform pattern using sine waves with noise
      const position = i / count;
      const wave1 = Math.sin(position * Math.PI * 4) * 0.3;
      const wave2 = Math.sin(position * Math.PI * 8 + 0.5) * 0.2;
      const noise = (Math.random() - 0.5) * 0.3;
      const baseHeight = 0.4;
      const height = Math.max(15, Math.min(95, (baseHeight + wave1 + wave2 + noise) * 100));
      html += `<div class="fe-waveform-bar" style="height: ${height}%"></div>`;
    }
    return html;
  }

  /**
   * Setup media element events
   */
  setupMediaEvents() {
    if (!this.previewMediaEl) return;

    this.previewMediaEl.addEventListener('loadedmetadata', () => {
      this.previewDuration = this.previewMediaEl.duration || 0;
      this.previewInPoint = 0;
      this.previewOutPoint = this.previewDuration;
      this.updatePreviewTimeDisplay();
      this.updatePreviewTimeline();
      this.updateWaveformSelection();

      // Generate video thumbnails after metadata loads
      if (this.previewFile?.type === 'video') {
        this.generateVideoThumbnails();
      }
    });

    this.previewMediaEl.addEventListener('timeupdate', () => {
      this.updatePreviewProgress();
      // Loop within in/out region
      if (this.previewMediaEl.currentTime >= this.previewOutPoint) {
        this.previewMediaEl.currentTime = this.previewInPoint;
        if (!this.isPreviewPlaying) {
          this.previewMediaEl.pause();
        }
      }
    });

    this.previewMediaEl.addEventListener('ended', () => {
      this.isPreviewPlaying = false;
      this.updatePlayButton();
    });
  }

  /**
   * Setup video thumbnails container
   */
  setupVideoThumbnails() {
    const thumbnailsContainer = this.container.querySelector('#fe-thumbnails-container');
    const waveformContainer = this.container.querySelector('#fe-waveform-container');

    // Hide waveform, show thumbnails container
    if (waveformContainer) waveformContainer.classList.add('hidden');
    if (thumbnailsContainer) thumbnailsContainer.classList.remove('hidden');
  }

  /**
   * Generate video thumbnail filmstrip
   */
  async generateVideoThumbnails() {
    const video = this.previewMediaEl;
    const container = this.container.querySelector('#fe-thumbnails-container');
    const canvas = this.container.querySelector('#fe-thumbnails-canvas');

    if (!video || !container || !canvas || !this.previewDuration) return;

    // Show the container
    container.classList.remove('hidden');

    const ctx = canvas.getContext('2d');
    const trackEl = this.previewTrack;
    if (!trackEl) return;

    // Get track dimensions
    const trackRect = trackEl.getBoundingClientRect();
    const trackWidth = trackRect.width;
    const trackHeight = trackRect.height - 4;

    if (trackWidth <= 0 || trackHeight <= 0) return;

    // Calculate thumbnail dimensions (maintain aspect ratio)
    const videoAspect = video.videoWidth / video.videoHeight || 16/9;
    const thumbHeight = trackHeight;
    const thumbWidth = Math.floor(thumbHeight * videoAspect);

    // Calculate number of thumbnails that fit
    const numThumbs = Math.max(1, Math.min(20, Math.ceil(trackWidth / thumbWidth)));
    const actualThumbWidth = trackWidth / numThumbs;

    // Set canvas size
    canvas.width = trackWidth;
    canvas.height = trackHeight;

    // Fill with dark background initially
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, trackWidth, trackHeight);

    // Store original time to restore later
    const originalTime = video.currentTime;
    const wasPlaying = !video.paused;
    if (wasPlaying) video.pause();

    // Generate thumbnails at intervals
    const interval = this.previewDuration / numThumbs;

    for (let i = 0; i < numThumbs; i++) {
      const time = i * interval + (interval / 2); // Center of each segment

      try {
        await this.seekVideoToTime(video, time);

        // Draw thumbnail
        const x = i * actualThumbWidth;
        ctx.drawImage(video, x, 0, actualThumbWidth, trackHeight);

        // Add subtle separator line
        if (i > 0) {
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, trackHeight);
          ctx.stroke();
        }
      } catch (e) {
        console.log('[FileExplorer] Thumbnail generation error:', e);
      }
    }

    // Restore original position
    video.currentTime = originalTime;
    if (wasPlaying) video.play();

    console.log(`[FileExplorer] Generated ${numThumbs} video thumbnails`);
  }

  /**
   * Seek video to specific time and wait for it to be ready
   */
  seekVideoToTime(video, time) {
    return new Promise((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = Math.min(Math.max(0, time), video.duration - 0.1);

      // Timeout fallback in case seeked event doesn't fire
      setTimeout(resolve, 200);
    });
  }

  /**
   * Update preview metadata section
   */
  updatePreviewMetadata(metadata) {
    const metaEl = this.container.querySelector('#fe-preview-meta .fe-preview-meta-grid');
    if (!metaEl) return;

    let metaHtml = '';

    if (metadata.type) {
      metaHtml += `<div class="fe-preview-meta-item">
        <span class="fe-preview-meta-label">Type</span>
        <span class="fe-preview-meta-value">${metadata.type}</span>
      </div>`;
    }

    if (metadata.sizeFormatted) {
      metaHtml += `<div class="fe-preview-meta-item">
        <span class="fe-preview-meta-label">Size</span>
        <span class="fe-preview-meta-value">${metadata.sizeFormatted}</span>
      </div>`;
    }

    if (metadata.width && metadata.height) {
      metaHtml += `<div class="fe-preview-meta-item">
        <span class="fe-preview-meta-label">Resolution</span>
        <span class="fe-preview-meta-value">${metadata.width}×${metadata.height}</span>
      </div>`;
    }

    if (metadata.codec) {
      metaHtml += `<div class="fe-preview-meta-item">
        <span class="fe-preview-meta-label">Codec</span>
        <span class="fe-preview-meta-value">${metadata.codec}</span>
      </div>`;
    }

    if (metadata.fps) {
      metaHtml += `<div class="fe-preview-meta-item">
        <span class="fe-preview-meta-label">FPS</span>
        <span class="fe-preview-meta-value">${metadata.fps}</span>
      </div>`;
    }

    if (metadata.bitrate) {
      metaHtml += `<div class="fe-preview-meta-item">
        <span class="fe-preview-meta-label">Bitrate</span>
        <span class="fe-preview-meta-value">${metadata.bitrate}</span>
      </div>`;
    }

    metaEl.innerHTML = metaHtml;
  }

  /**
   * Close the preview sidebar
   */
  closePreview() {
    this.stopPreviewPlayback();
    this.previewSidebar.classList.add('hidden');
    this.previewFile = null;
    this.previewMediaEl = null;
  }

  /**
   * Hide the preview panel (alias for closePreview)
   */
  hidePreviewPanel() {
    this.closePreview();
  }

  /**
   * Toggle preview playback
   */
  togglePreviewPlayback() {
    if (!this.previewMediaEl) return;

    if (this.isPreviewPlaying) {
      this.previewMediaEl.pause();
      this.isPreviewPlaying = false;
    } else {
      // Start from in point if at end
      if (this.previewMediaEl.currentTime >= this.previewOutPoint - 0.1) {
        this.previewMediaEl.currentTime = this.previewInPoint;
      }
      this.previewMediaEl.play();
      this.isPreviewPlaying = true;
    }
    this.updatePlayButton();
  }

  /**
   * Stop preview playback
   */
  stopPreviewPlayback() {
    if (this.previewMediaEl) {
      this.previewMediaEl.pause();
    }
    this.isPreviewPlaying = false;
    if (this.previewAnimationFrame) {
      cancelAnimationFrame(this.previewAnimationFrame);
    }
    this.updatePlayButton();
  }

  /**
   * Step preview by frames
   */
  stepPreviewFrame(direction) {
    if (!this.previewMediaEl) return;
    const frameTime = 1/30; // Assume 30fps
    this.previewMediaEl.currentTime = Math.max(
      this.previewInPoint,
      Math.min(this.previewOutPoint, this.previewMediaEl.currentTime + (direction * frameTime))
    );
  }

  /**
   * Set preview in point
   */
  setPreviewInPoint() {
    if (!this.previewMediaEl) return;
    this.previewInPoint = this.previewMediaEl.currentTime;
    if (this.previewInPoint >= this.previewOutPoint) {
      this.previewOutPoint = this.previewDuration;
    }
    this.updatePreviewTimeDisplay();
    this.updatePreviewTimeline();
    this.updateWaveformSelection();
    this.scheduleTrimExport();

    // Flash button
    const btn = this.container.querySelector('#fe-btn-in');
    btn.classList.add('ff-trimmer-btn-flash');
    setTimeout(() => btn.classList.remove('ff-trimmer-btn-flash'), 200);
  }

  /**
   * Set preview out point
   */
  setPreviewOutPoint() {
    if (!this.previewMediaEl) return;
    this.previewOutPoint = this.previewMediaEl.currentTime;
    if (this.previewOutPoint <= this.previewInPoint) {
      this.previewInPoint = 0;
    }
    this.updatePreviewTimeDisplay();
    this.updatePreviewTimeline();
    this.updateWaveformSelection();
    this.scheduleTrimExport();

    // Flash button
    const btn = this.container.querySelector('#fe-btn-out');
    btn.classList.add('ff-trimmer-btn-flash');
    setTimeout(() => btn.classList.remove('ff-trimmer-btn-flash'), 200);
  }

  /**
   * Update play button icon
   */
  updatePlayButton() {
    const playIcon = this.container.querySelector('#fe-play-icon');
    if (!playIcon) return;
    if (this.isPreviewPlaying) {
      playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
      // Add playing class for waveform animation
      this.previewSidebar.classList.add('playing');
    } else {
      playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
      // Remove playing class
      this.previewSidebar.classList.remove('playing');
    }
  }

  /**
   * Update preview time display
   */
  updatePreviewTimeDisplay() {
    const inEl = this.container.querySelector('#fe-time-in');
    const outEl = this.container.querySelector('#fe-time-out');
    const durEl = this.container.querySelector('#fe-time-duration');

    if (inEl) inEl.textContent = this.formatDuration(this.previewInPoint);
    if (outEl) outEl.textContent = this.formatDuration(this.previewOutPoint);
    if (durEl) durEl.textContent = this.formatDuration(this.previewOutPoint - this.previewInPoint);
  }

  /**
   * Update preview timeline visuals
   */
  updatePreviewTimeline() {
    if (!this.previewDuration || this.previewDuration === 0) return;

    const inPercent = (this.previewInPoint / this.previewDuration) * 100;
    const outPercent = (this.previewOutPoint / this.previewDuration) * 100;

    // Update selection area
    if (this.previewSelection) {
      this.previewSelection.style.left = `${inPercent}%`;
      this.previewSelection.style.width = `${outPercent - inPercent}%`;
    }

    // Update handles - use left percentage, CSS handles centering with transform
    const handleIn = this.container.querySelector('#fe-handle-in');
    const handleOut = this.container.querySelector('#fe-handle-out');
    if (handleIn) handleIn.style.left = `${inPercent}%`;
    if (handleOut) handleOut.style.left = `${outPercent}%`;
  }

  /**
   * Update preview progress position
   */
  updatePreviewProgress() {
    if (!this.previewMediaEl || !this.previewDuration) return;

    const currentTime = this.previewMediaEl.currentTime;
    const percent = (currentTime / this.previewDuration) * 100;

    if (this.previewProgress) {
      this.previewProgress.style.width = `${percent}%`;
    }
    if (this.previewPlayhead) {
      this.previewPlayhead.style.left = `${percent}%`;
    }

    // Update waveform bars for audio (played state)
    if (this.previewFile?.type === 'audio') {
      const waveformBars = this.container.querySelector('#fe-waveform-bars');
      if (waveformBars) {
        const bars = waveformBars.querySelectorAll('.fe-waveform-bar');
        bars.forEach((bar, i) => {
          const barPercent = (i / bars.length) * 100;
          if (barPercent <= percent) {
            bar.classList.add('played');
          } else {
            bar.classList.remove('played');
          }
        });
      }
    }
  }

  /**
   * Setup timeline click/drag events with optimized interaction
   */
  setupTimelineEvents() {
    const track = this.previewTrack;
    if (!track) return;

    let isDraggingHandle = false;
    let isDraggingSelection = false; // New: for dragging to create selection
    let isJustSeeking = false; // New: for single click seek
    let activeHandle = null;
    let handleInEl = null;
    let handleOutEl = null;
    let dragStartTime = null; // Track where drag started
    let hasMoved = false; // Track if mouse moved during drag

    // Calculate time from mouse position - cached rect for performance
    let cachedRect = null;
    const getTimeFromMouse = (e) => {
      if (!cachedRect) cachedRect = track.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (e.clientX - cachedRect.left) / cachedRect.width));
      return percent * this.previewDuration;
    };

    // Timeline mousedown - start potential selection or seek
    track.addEventListener('mousedown', (e) => {
      if (!this.previewMediaEl || !this.previewDuration) return;
      if (e.target.closest('.fe-preview-handle')) return;
      // Skip if clicking on the selection area (that's for dragging to export)
      if (e.target.closest('.fe-preview-timeline-selection')) return;

      cachedRect = track.getBoundingClientRect();
      const time = getTimeFromMouse(e);
      dragStartTime = time;
      hasMoved = false;

      // Start selection drag mode
      isDraggingSelection = true;
      isJustSeeking = true; // Assume it's a click until we detect movement

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'crosshair';

      // Immediately show playhead at click position
      this.previewMediaEl.currentTime = time;
    });

    // Make the selection area draggable for export (using mousedown, not HTML5 drag)
    const selectionEl = this.container.querySelector('#fe-preview-selection');
    if (selectionEl) {
      // Don't use HTML5 draggable - it conflicts with Electron's native drag
      selectionEl.draggable = false;

      let isSelectionDragging = false;

      selectionEl.addEventListener('mousedown', (e) => {
        e.stopPropagation(); // Prevent timeline from handling this
        e.preventDefault();

        if (!this.previewFile || isSelectionDragging) return;

        isSelectionDragging = true;
        console.log('[FileBridge] Starting drag from selection area');

        // Check if we have a trimmed selection
        const isFullDuration = this.previewInPoint <= 0.1 &&
                               this.previewOutPoint >= (this.previewDuration - 0.1);

        let fileToDrag = this.previewFile.path;

        // If trimmed and cache is ready, use the cached file
        if (!isFullDuration && this.isTrimmedCacheReady && this.cachedTrimmedPath) {
          fileToDrag = this.cachedTrimmedPath;
          console.log('[FileBridge] Using cached trimmed file:', fileToDrag);
        } else if (!isFullDuration && !this.isTrimmedCacheReady) {
          console.log('[FileBridge] Trim cache not ready, dragging original file');
        }

        // Start native OS drag using the same mechanism as My Media panel
        console.log('[FileBridge] Initiating native drag for:', fileToDrag);
        selectionEl.classList.add('dragging');

        window.kolboDesktop.startFileDrag([fileToDrag]);

        // Reset drag state after a short delay (native drag takes over)
        setTimeout(() => {
          isSelectionDragging = false;
          selectionEl.classList.remove('dragging');
          console.log('[FileBridge] Drag state reset');
        }, 100);
      });
    }

    // Handle dragging setup
    handleInEl = this.container.querySelector('#fe-handle-in');
    handleOutEl = this.container.querySelector('#fe-handle-out');

    const startHandleDrag = (e, handleType) => {
      e.stopPropagation();
      e.preventDefault();
      isDraggingHandle = true;
      activeHandle = handleType;
      cachedRect = track.getBoundingClientRect();
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ew-resize';

      // Add dragging class for visual feedback
      if (handleType === 'in' && handleInEl) handleInEl.classList.add('dragging');
      if (handleType === 'out' && handleOutEl) handleOutEl.classList.add('dragging');
    };

    if (handleInEl) {
      handleInEl.addEventListener('mousedown', (e) => startHandleDrag(e, 'in'));
    }
    if (handleOutEl) {
      handleOutEl.addEventListener('mousedown', (e) => startHandleDrag(e, 'out'));
    }

    // Unified mousemove handler - use requestAnimationFrame for smoothness
    let rafPending = false;
    document.addEventListener('mousemove', (e) => {
      if (!this.previewDuration) return;
      if (!isDraggingHandle && !isDraggingSelection) return;

      if (rafPending) return;
      rafPending = true;

      requestAnimationFrame(() => {
        rafPending = false;
        const time = getTimeFromMouse(e);

        if (isDraggingHandle && activeHandle) {
          // Dragging in/out handles
          if (activeHandle === 'in') {
            this.previewInPoint = Math.max(0, Math.min(time, this.previewOutPoint - 0.05));
            if (this.previewMediaEl) this.previewMediaEl.currentTime = this.previewInPoint;
          } else {
            this.previewOutPoint = Math.min(this.previewDuration, Math.max(time, this.previewInPoint + 0.05));
          }
          this.updatePreviewTimeDisplay();
          this.updatePreviewTimeline();
          this.updateWaveformSelection();
        } else if (isDraggingSelection && dragStartTime !== null) {
          // Check if we've moved enough to consider this a drag (not just a click)
          const moveThreshold = 0.02 * this.previewDuration; // 2% of duration
          if (Math.abs(time - dragStartTime) > moveThreshold) {
            hasMoved = true;
            isJustSeeking = false;

            // Set in/out based on drag direction
            const inTime = Math.min(dragStartTime, time);
            const outTime = Math.max(dragStartTime, time);

            this.previewInPoint = Math.max(0, inTime);
            this.previewOutPoint = Math.min(this.previewDuration, outTime);

            this.updatePreviewTimeDisplay();
            this.updatePreviewTimeline();
            this.updateWaveformSelection();

            // Move playhead to current mouse position
            if (this.previewMediaEl) {
              this.previewMediaEl.currentTime = time;
            }
          } else if (isJustSeeking && this.previewMediaEl) {
            // Still just seeking (small movement)
            this.previewMediaEl.currentTime = time;
          }
        }
      });
    });

    // Unified mouseup handler
    document.addEventListener('mouseup', () => {
      const wasChangingInOut = isDraggingHandle || (isDraggingSelection && hasMoved);

      if (isDraggingHandle) {
        isDraggingHandle = false;
        if (handleInEl) handleInEl.classList.remove('dragging');
        if (handleOutEl) handleOutEl.classList.remove('dragging');
        activeHandle = null;
      }
      if (isDraggingSelection) {
        isDraggingSelection = false;

        // If user just clicked (didn't drag), seek to that position
        if (isJustSeeking && !hasMoved && dragStartTime !== null && this.previewMediaEl) {
          this.previewMediaEl.currentTime = dragStartTime;
        }

        dragStartTime = null;
        hasMoved = false;
        isJustSeeking = false;
      }
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      cachedRect = null;

      // Schedule trim export if in/out points were changed
      if (wasChangingInOut) {
        this.scheduleTrimExport();
      }
    });

    // Double-click to reset in/out
    track.addEventListener('dblclick', () => {
      if (!this.previewDuration) return;
      this.previewInPoint = 0;
      this.previewOutPoint = this.previewDuration;
      this.updatePreviewTimeDisplay();
      this.updatePreviewTimeline();
      this.updateWaveformSelection();
      this.scheduleTrimExport();
    });
  }

  /**
   * Setup preview area drag events for exporting to external apps
   */
  setupPreviewDragEvents() {
    const dragArea = this.container.querySelector('#fe-preview-drag-area');
    const dragOverlay = this.container.querySelector('#fe-preview-drag-overlay');
    if (!dragArea) return;

    // Cleanup function for drag end
    let previewDragCleanupTimer = null;

    const cleanupPreviewDrag = () => {
      dragArea.classList.remove('dragging');
      if (previewDragCleanupTimer) {
        clearTimeout(previewDragCleanupTimer);
        previewDragCleanupTimer = null;
      }
      console.log('[FileBridge] Preview drag cleanup complete');
    };

    // Show overlay on hover
    dragArea.addEventListener('mouseenter', () => {
      if (this.previewFile) {
        dragOverlay?.classList.add('visible');
        this.updateDragOverlayStatus();
      }
    });

    dragArea.addEventListener('mouseleave', () => {
      dragOverlay?.classList.remove('visible');
    });

    // IMPORTANT: Prevent mousedown from bubbling to timeline
    // This allows the native drag to start without triggering in/out selection
    dragArea.addEventListener('mousedown', (e) => {
      if (!this.previewFile) return;
      e.stopPropagation();
      console.log('[FileBridge] Mousedown on drag area - ready to drag');
    });

    // Native dragstart - this is called when user starts dragging
    dragArea.addEventListener('dragstart', (e) => {
      if (!this.previewFile) {
        e.preventDefault();
        return;
      }

      e.stopPropagation();
      console.log('[FileBridge] Dragstart triggered');

      // Check if we have a trimmed selection
      const isFullDuration = this.previewInPoint <= 0.1 &&
                             this.previewOutPoint >= (this.previewDuration - 0.1);

      let fileToDrag = this.previewFile.path;

      // If trimmed and cache is ready, use the cached file
      if (!isFullDuration && this.isTrimmedCacheReady && this.cachedTrimmedPath) {
        fileToDrag = this.cachedTrimmedPath;
        console.log('[FileBridge] Using cached trimmed file:', fileToDrag);
      } else if (!isFullDuration && !this.isTrimmedCacheReady) {
        // Cache not ready - still drag original but log warning
        console.log('[FileBridge] Trim cache not ready, dragging original file');
      }

      // Start the native OS drag using the same mechanism as My Media panel
      console.log('[FileBridge] Starting native drag:', fileToDrag);
      window.kolboDesktop.startFileDrag([fileToDrag]);

      // Add dragging class
      dragArea.classList.add('dragging');

      // Timer-based fallback cleanup (native drag doesn't fire browser events)
      previewDragCleanupTimer = setTimeout(cleanupPreviewDrag, 500);
    });

    dragArea.addEventListener('dragend', () => {
      cleanupPreviewDrag();
    });
  }

  /**
   * Update the drag overlay and selection area to show export status
   */
  updateDragOverlayStatus() {
    const overlay = this.container.querySelector('#fe-preview-drag-overlay');
    const statusText = overlay?.querySelector('.fe-drag-status-text');
    const selectionEl = this.container.querySelector('#fe-preview-selection');

    const isFullDuration = this.previewInPoint <= 0.1 &&
                           this.previewOutPoint >= (this.previewDuration - 0.1);

    // Update overlay status
    if (overlay && statusText) {
      if (isFullDuration) {
        overlay.classList.remove('exporting', 'ready');
        statusText.textContent = 'Drag to app';
      } else if (this.isExportingTrim) {
        overlay.classList.add('exporting');
        overlay.classList.remove('ready');
        statusText.textContent = 'Preparing...';
      } else if (this.isTrimmedCacheReady) {
        overlay.classList.remove('exporting');
        overlay.classList.add('ready');
        const duration = this.previewOutPoint - this.previewInPoint;
        statusText.textContent = `Ready (${this.formatDuration(duration)})`;
      } else {
        overlay.classList.remove('exporting', 'ready');
        statusText.textContent = 'Drag to app';
      }
    }

    // Update selection area status (for timeline drag)
    if (selectionEl) {
      selectionEl.classList.remove('exporting', 'ready', 'full-duration');
      if (isFullDuration) {
        selectionEl.classList.add('full-duration');
      } else if (this.isExportingTrim) {
        selectionEl.classList.add('exporting');
      } else if (this.isTrimmedCacheReady) {
        selectionEl.classList.add('ready');
      }
    }
  }

  /**
   * Pre-export trimmed segment in background (called when in/out points change)
   */
  scheduleTrimExport() {
    // Clear any pending export
    if (this._exportDebounceTimer) {
      clearTimeout(this._exportDebounceTimer);
    }

    // Reset cache
    this.isTrimmedCacheReady = false;
    this.cachedTrimmedPath = null;
    this.updateDragOverlayStatus();

    // Check if we need to export (has trim)
    const isFullDuration = this.previewInPoint <= 0.1 &&
                           this.previewOutPoint >= (this.previewDuration - 0.1);

    if (isFullDuration || !this.previewFile || !this.previewDuration) {
      return; // No trim needed
    }

    // Debounce: wait 150ms after last change before exporting (fast enough for responsive UX)
    this._exportDebounceTimer = setTimeout(() => {
      this.exportTrimmedSegment();
    }, 500);
  }

  /**
   * Actually export the trimmed segment
   */
  async exportTrimmedSegment() {
    if (!this.previewFile || this.isExportingTrim) return;

    const isFullDuration = this.previewInPoint <= 0.1 &&
                           this.previewOutPoint >= (this.previewDuration - 0.1);
    if (isFullDuration) return;

    this.isExportingTrim = true;
    this.updateDragOverlayStatus();

    console.log(`[FileBridge] Pre-exporting: ${this.formatDuration(this.previewInPoint)} - ${this.formatDuration(this.previewOutPoint)}`);

    try {
      const result = await window.kolboDesktop.ffmpeg.exportTrimmed({
        inputPath: this.previewFile.path,
        inPoint: this.previewInPoint,
        outPoint: this.previewOutPoint
      });

      if (result.success && result.outputPath) {
        this.cachedTrimmedPath = result.outputPath;
        this.isTrimmedCacheReady = true;
        console.log('[FileBridge] Trim cache ready:', this.cachedTrimmedPath);
      }
    } catch (error) {
      console.error('[FileBridge] Pre-export error:', error);
    }

    this.isExportingTrim = false;
    this.updateDragOverlayStatus();
  }

  /**
   * Update waveform bars to show in/out selection
   */
  updateWaveformSelection() {
    if (this.previewFile?.type !== 'audio' || !this.previewDuration) return;

    const waveformBars = this.container.querySelector('#fe-waveform-bars');
    if (!waveformBars) return;

    const bars = waveformBars.querySelectorAll('.fe-waveform-bar');
    const inPercent = (this.previewInPoint / this.previewDuration) * 100;
    const outPercent = (this.previewOutPoint / this.previewDuration) * 100;

    bars.forEach((bar, i) => {
      const barPercent = (i / bars.length) * 100;
      if (barPercent < inPercent || barPercent > outPercent) {
        bar.classList.add('outside-selection');
      } else {
        bar.classList.remove('outside-selection');
      }
    });
  }

  /**
   * Jump to in point
   */
  jumpToInPoint() {
    if (this.previewMediaEl) {
      this.previewMediaEl.currentTime = this.previewInPoint;
    }
  }

  /**
   * Jump to out point
   */
  jumpToOutPoint() {
    if (this.previewMediaEl) {
      this.previewMediaEl.currentTime = this.previewOutPoint;
    }
  }

  /**
   * Nudge in/out point by small amount
   */
  nudgeInPoint(delta) {
    if (!this.previewDuration) return;
    const frameTime = 1/30; // ~1 frame at 30fps
    this.previewInPoint = Math.max(0, Math.min(this.previewInPoint + (delta * frameTime * 5), this.previewOutPoint - 0.1));
    this.previewMediaEl.currentTime = this.previewInPoint;
    this.updatePreviewTimeDisplay();
    this.updatePreviewTimeline();
    this.updateWaveformSelection();
    this.scheduleTrimExport();
  }

  nudgeOutPoint(delta) {
    if (!this.previewDuration) return;
    const frameTime = 1/30;
    this.previewOutPoint = Math.min(this.previewDuration, Math.max(this.previewOutPoint + (delta * frameTime * 5), this.previewInPoint + 0.1));
    this.updatePreviewTimeDisplay();
    this.updatePreviewTimeline();
    this.updateWaveformSelection();
    this.scheduleTrimExport();
  }

  /**
   * Format duration to mm:ss
   */
  formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Drag the selection (in/out region) to external apps
   */
  async dragPreviewSelection() {
    if (!this.previewFile) return;

    const file = this.previewFile;
    const inPoint = this.previewInPoint;
    const outPoint = this.previewOutPoint;

    // Check if we need to trim (in/out not at full duration)
    const isFullDuration = inPoint <= 0.1 && outPoint >= (this.previewDuration - 0.1);

    if (isFullDuration) {
      // No trimming needed - drag original file
      console.log(`[FileExplorer] Dragging full file: ${file.name}`);
      window.kolboDesktop.startFileDrag([file.path]);
      return;
    }

    // Need to export trimmed segment first
    console.log(`[FileExplorer] Exporting trimmed: ${this.formatDuration(inPoint)} - ${this.formatDuration(outPoint)}`);

    // Show preparing state on drag button
    const dragBtn = this.container.querySelector('#fe-btn-drag-selection');
    const originalHtml = dragBtn.innerHTML;
    dragBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="fe-spin">
        <path d="M21 12a9 9 0 11-6.219-8.56"/>
      </svg>
      Preparing...
    `;
    dragBtn.disabled = true;

    try {
      // Export the trimmed segment
      const result = await window.kolboDesktop.ffmpeg.exportTrimmed({
        inputPath: file.path,
        inPoint: inPoint,
        outPoint: outPoint
      });

      if (result.success && result.outputPath) {
        console.log(`[FileExplorer] Trimmed export ready: ${result.outputPath}`);
        // Drag the trimmed file
        window.kolboDesktop.startFileDrag([result.outputPath]);
      } else {
        console.error('[FileExplorer] Trim export failed:', result.error);
        // Fallback to dragging original file
        window.kolboDesktop.startFileDrag([file.path]);
      }
    } catch (error) {
      console.error('[FileExplorer] Trim export error:', error);
      // Fallback to dragging original file
      window.kolboDesktop.startFileDrag([file.path]);
    } finally {
      // Restore button
      dragBtn.innerHTML = originalHtml;
      dragBtn.disabled = false;
    }
  }

  /**
   * Lazy load metadata for visible files (duration)
   */
  async loadVisibleMetadata() {
    // Get files that need metadata loaded
    const filesToLoad = this.files.filter(f =>
      (f.type === 'video' || f.type === 'audio') &&
      !this.metadataCache.has(f.path)
    );

    // Load in batches of 5
    const batchSize = 5;
    for (let i = 0; i < filesToLoad.length; i += batchSize) {
      const batch = filesToLoad.slice(i, i + batchSize);

      await Promise.all(batch.map(async (file) => {
        try {
          const metadata = await window.kolboDesktop.fileExplorer.getMetadata(file.path);
          if (metadata.success) {
            this.metadataCache.set(file.path, metadata);

            // Update the duration cell in the UI
            const durationCell = this.fileListEl.querySelector(
              `.fe-file-duration[data-path="${CSS.escape(file.path)}"]`
            );
            if (durationCell && metadata.durationFormatted) {
              durationCell.textContent = metadata.durationFormatted;
            }
          }
        } catch (error) {
          console.log('[FileExplorer] Metadata load failed:', file.name);
        }
      }));

      // Small delay between batches
      if (i + batchSize < filesToLoad.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }

  /**
   * Handle native drag start
   */
  handleDragStart(e) {
    const item = e.target.closest('.fe-file-item');
    if (!item || item.classList.contains('folder')) {
      e.preventDefault();
      return;
    }

    const filePath = item.dataset.path;

    // If dragging an unselected item, select only that item
    if (!this.selectedFiles.has(filePath)) {
      this.selectedFiles.clear();
      this.selectedFiles.add(filePath);
      this.updateSelectionUI();
    }

    // Get all selected file paths
    const filePaths = Array.from(this.selectedFiles);

    // Add dragging class
    item.classList.add('dragging');
    this.isDragging = true;

    // Start the native OS drag using the same mechanism as My Media panel
    console.log('[FileBridge] Starting file list drag:', filePaths);
    window.kolboDesktop.startFileDrag(filePaths);

    // Timer-based fallback cleanup (native drag doesn't fire browser events)
    if (this._fileListDragTimer) clearTimeout(this._fileListDragTimer);
    this._fileListDragTimer = setTimeout(() => this.handleDragEnd(), 500);
  }

  /**
   * Handle drag end
   */
  handleDragEnd(e) {
    this.isDragging = false;
    if (this._fileListDragTimer) {
      clearTimeout(this._fileListDragTimer);
      this._fileListDragTimer = null;
    }
    this.fileListEl.querySelectorAll('.fe-file-item.dragging').forEach(item => {
      item.classList.remove('dragging');
    });
    console.log('[FileBridge] File list drag cleanup complete');
  }

  /**
   * Start drag for selected files (from button)
   */
  startDragSelected() {
    if (this.selectedFiles.size === 0) return;

    const filePaths = Array.from(this.selectedFiles);
    window.kolboDesktop.startFileDrag(filePaths);
  }

  /**
   * Handle keyboard shortcuts
   */
  handleKeyDown(e) {
    // Only handle if file explorer is visible
    if (!this.container || this.container.offsetParent === null) return;

    switch (e.key) {
      case 'Backspace':
        if (!e.target.matches('input, textarea')) {
          e.preventDefault();
          this.goUp();
        }
        break;
      case 'F5':
        e.preventDefault();
        this.refresh();
        break;
      case 'a':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.selectAll();
        }
        break;
      case 'Escape':
        if (this.previewFile) {
          this.closePreview();
        } else {
          this.clearSelection();
        }
        break;
      case ' ':
        // Spacebar for play/pause
        if (!e.target.matches('input, textarea') && this.previewMediaEl) {
          e.preventDefault();
          this.togglePreviewPlayback();
        }
        break;
      case 'i':
      case 'I':
        // I for in point
        if (!e.target.matches('input, textarea') && this.previewMediaEl) {
          e.preventDefault();
          this.setPreviewInPoint();
        }
        break;
      case 'o':
      case 'O':
        // O for out point
        if (!e.target.matches('input, textarea') && this.previewMediaEl) {
          e.preventDefault();
          this.setPreviewOutPoint();
        }
        break;
      case 'ArrowLeft':
        // Left arrow - step back (Shift = nudge in point)
        if (!e.target.matches('input, textarea') && this.previewMediaEl) {
          e.preventDefault();
          if (e.shiftKey) {
            this.nudgeInPoint(-1);
          } else if (e.altKey) {
            this.nudgeOutPoint(-1);
          } else {
            this.stepPreviewFrame(-1);
          }
        }
        break;
      case 'ArrowRight':
        // Right arrow - step forward (Shift = nudge in point)
        if (!e.target.matches('input, textarea') && this.previewMediaEl) {
          e.preventDefault();
          if (e.shiftKey) {
            this.nudgeInPoint(1);
          } else if (e.altKey) {
            this.nudgeOutPoint(1);
          } else {
            this.stepPreviewFrame(1);
          }
        }
        break;
      case '[':
        // [ = Jump to in point
        if (!e.target.matches('input, textarea') && this.previewMediaEl) {
          e.preventDefault();
          this.jumpToInPoint();
        }
        break;
      case ']':
        // ] = Jump to out point
        if (!e.target.matches('input, textarea') && this.previewMediaEl) {
          e.preventDefault();
          this.jumpToOutPoint();
        }
        break;
      case 'j':
      case 'J':
        // J = Play backward / slower
        if (!e.target.matches('input, textarea') && this.previewMediaEl) {
          e.preventDefault();
          this.changePlaybackSpeed(-1);
        }
        break;
      case 'k':
      case 'K':
        // K = Stop/Pause
        if (!e.target.matches('input, textarea') && this.previewMediaEl) {
          e.preventDefault();
          this.previewMediaEl.pause();
          this.isPreviewPlaying = false;
          this.updatePlayButton();
        }
        break;
      case 'l':
      case 'L':
        // L = Play forward / faster
        if (!e.target.matches('input, textarea') && this.previewMediaEl) {
          e.preventDefault();
          this.changePlaybackSpeed(1);
        }
        break;
      case 'Home':
        // Home = Go to start / in point
        if (!e.target.matches('input, textarea') && this.previewMediaEl) {
          e.preventDefault();
          this.previewMediaEl.currentTime = this.previewInPoint;
        }
        break;
      case 'End':
        // End = Go to out point
        if (!e.target.matches('input, textarea') && this.previewMediaEl) {
          e.preventDefault();
          this.previewMediaEl.currentTime = this.previewOutPoint;
        }
        break;
    }
  }

  /**
   * Change playback speed (J/K/L shuttle control)
   */
  changePlaybackSpeed(direction) {
    if (!this.previewMediaEl) return;

    const speeds = [0.25, 0.5, 1, 1.5, 2, 4];
    let currentSpeed = this.previewMediaEl.playbackRate;

    if (direction > 0) {
      // Speed up / play forward
      if (!this.isPreviewPlaying) {
        this.previewMediaEl.play();
        this.isPreviewPlaying = true;
        this.previewMediaEl.playbackRate = 1;
      } else {
        const idx = speeds.indexOf(currentSpeed);
        if (idx < speeds.length - 1) {
          this.previewMediaEl.playbackRate = speeds[idx + 1];
        }
      }
    } else {
      // Slow down
      if (this.isPreviewPlaying) {
        const idx = speeds.indexOf(currentSpeed);
        if (idx > 0) {
          this.previewMediaEl.playbackRate = speeds[idx - 1];
        } else {
          this.previewMediaEl.pause();
          this.isPreviewPlaying = false;
        }
      }
    }
    this.updatePlayButton();
  }

  /**
   * Handle clicks outside of file items
   */
  handleClickOutside(e) {
    if (!this.container || this.container.offsetParent === null) return;

    const fileList = this.container.querySelector('.fe-file-list');
    if (fileList && fileList.contains(e.target)) {
      // Clicked inside file list but not on an item
      if (!e.target.closest('.fe-file-item')) {
        this.clearSelection();
      }
    }
  }

  /**
   * Select all files
   */
  selectAll() {
    this.selectedFiles.clear();
    for (const file of this.files) {
      this.selectedFiles.add(file.path);
    }
    this.updateSelectionUI();
    this.hidePreviewPanel();
  }

  /**
   * Show error message
   */
  showError(message) {
    this.fileListEl.innerHTML = `
      <div class="fe-empty-state">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <h3>Error</h3>
        <p>${this.escapeHtml(message)}</p>
      </div>`;
  }

  // ============ Helper Methods ============

  /**
   * Get parent path
   */
  getParentPath(filePath) {
    const separator = filePath.includes('\\') ? '\\' : '/';
    const parts = filePath.split(separator).filter(Boolean);

    if (parts.length <= 1) {
      return separator === '\\' ? parts[0] + '\\' : '/';
    }

    parts.pop();
    return parts.join(separator) + (separator === '\\' && parts.length === 1 ? '\\' : '');
  }

  /**
   * Format date for display
   */
  formatDate(dateStr) {
    if (!dateStr) return '--';
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  /**
   * Get icon for file type (uses CSS for sizing)
   */
  getFileTypeIcon(type) {
    switch (type) {
      case 'video':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m22 8-6 4 6 4V8Z"/>
          <rect width="14" height="12" x="2" y="6" rx="2" ry="2"/>
        </svg>`;
      case 'audio':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="16" r="3"/>
        </svg>`;
      case 'image':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
          <circle cx="9" cy="9" r="2"/>
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
        </svg>`;
      default:
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <path d="M14 2v6h6"/>
        </svg>`;
    }
  }

  /**
   * Get icon for sidebar location
   */
  getLocationIcon(type) {
    switch (type) {
      case 'home':
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>`;
      case 'desktop':
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>`;
      case 'download':
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>`;
      case 'video':
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m22 8-6 4 6 4V8Z"/>
          <rect width="14" height="12" x="2" y="6" rx="2" ry="2"/>
        </svg>`;
      case 'audio':
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="16" r="3"/>
        </svg>`;
      case 'image':
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
          <circle cx="9" cy="9" r="2"/>
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
        </svg>`;
      default:
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>`;
    }
  }

  /**
   * Escape HTML for safe insertion
   */
  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  // ============ Custom Folders Management ============

  /**
   * Load custom folders from localStorage
   */
  loadCustomFolders() {
    try {
      const saved = localStorage.getItem('fe_custom_folders');
      const folders = saved ? JSON.parse(saved) : [];
      console.log('[FileExplorer] Loaded custom folders from storage:', folders.length, folders);
      return folders;
    } catch (e) {
      console.error('[FileExplorer] Failed to load custom folders:', e);
      return [];
    }
  }

  /**
   * Save custom folders to localStorage
   */
  saveCustomFolders() {
    try {
      const data = JSON.stringify(this.customFolders);
      localStorage.setItem('fe_custom_folders', data);
      console.log('[FileExplorer] Saved custom folders to storage:', this.customFolders.length, this.customFolders);

      // Verify save was successful
      const verify = localStorage.getItem('fe_custom_folders');
      if (verify !== data) {
        console.error('[FileExplorer] Save verification failed!');
      }
    } catch (e) {
      console.error('[FileExplorer] Failed to save custom folders:', e);
    }
  }

  /**
   * Available folder colors
   */
  getFolderColors() {
    return [
      { name: 'Default', value: null },
      { name: 'Blue', value: '#3b82f6' },
      { name: 'Green', value: '#22c55e' },
      { name: 'Yellow', value: '#eab308' },
      { name: 'Orange', value: '#f97316' },
      { name: 'Red', value: '#ef4444' },
      { name: 'Purple', value: '#a855f7' },
      { name: 'Pink', value: '#ec4899' },
      { name: 'Cyan', value: '#06b6d4' },
    ];
  }

  /**
   * Add a custom folder via folder picker
   */
  async addCustomFolder() {
    const result = await window.kolboDesktop.fileExplorer.pickFolder();
    if (result.success && result.folderPath) {
      // Check if already exists
      if (this.customFolders.some(f => f.path === result.folderPath)) {
        console.log('[FileExplorer] Folder already in quick access');
        return;
      }

      // Get folder name from path
      const separator = result.folderPath.includes('\\') ? '\\' : '/';
      const parts = result.folderPath.split(separator).filter(Boolean);
      const name = parts[parts.length - 1] || result.folderPath;

      // Show the edit dialog for new folder
      this.showFolderEditDialog(null, {
        name: name,
        path: result.folderPath,
        icon: 'folder',
        color: null
      });
    }
  }

  /**
   * Show folder edit dialog (for adding or editing)
   */
  showFolderEditDialog(folderPath, newFolderData = null) {
    // Find existing folder or use new folder data
    let folder;
    let isNew = false;

    if (newFolderData) {
      folder = newFolderData;
      isNew = true;
    } else {
      folder = this.customFolders.find(f => f.path === folderPath);
      if (!folder) return;
    }

    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'fe-folder-dialog-overlay';
    dialog.innerHTML = `
      <div class="fe-folder-dialog">
        <div class="fe-folder-dialog-header">
          <h3>${isNew ? 'Add Folder' : 'Edit Folder'}</h3>
          <button class="fe-folder-dialog-close" id="fe-dialog-close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="fe-folder-dialog-body">
          <div class="fe-folder-dialog-field">
            <label>Name</label>
            <input type="text" id="fe-folder-name" value="${this.escapeHtml(folder.name)}" placeholder="Folder name">
          </div>
          <div class="fe-folder-dialog-field">
            <label>Color</label>
            <div class="fe-color-picker" id="fe-color-picker">
              ${this.getFolderColors().map(c => `
                <button class="fe-color-option${folder.color === c.value ? ' selected' : ''}"
                        data-color="${c.value || ''}"
                        style="${c.value ? `background: ${c.value}` : 'background: rgba(255,255,255,0.1)'}"
                        title="${c.name}">
                  ${folder.color === c.value ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>' : ''}
                </button>
              `).join('')}
            </div>
          </div>
          <div class="fe-folder-dialog-path">
            <span>Path:</span> ${this.escapeHtml(folder.path)}
          </div>
        </div>
        <div class="fe-folder-dialog-footer">
          <button class="fe-folder-dialog-btn secondary" id="fe-dialog-cancel">Cancel</button>
          <button class="fe-folder-dialog-btn primary" id="fe-dialog-save">${isNew ? 'Add' : 'Save'}</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    // Get elements
    const nameInput = dialog.querySelector('#fe-folder-name');
    const colorPicker = dialog.querySelector('#fe-color-picker');
    let selectedColor = folder.color;

    // Focus name input
    nameInput.focus();
    nameInput.select();

    // Color picker events
    colorPicker.querySelectorAll('.fe-color-option').forEach(btn => {
      btn.addEventListener('click', () => {
        colorPicker.querySelectorAll('.fe-color-option').forEach(b => {
          b.classList.remove('selected');
          b.innerHTML = '';
        });
        btn.classList.add('selected');
        btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>';
        selectedColor = btn.dataset.color || null;
      });
    });

    // Close handlers
    const closeDialog = () => {
      dialog.remove();
    };

    dialog.querySelector('#fe-dialog-close').addEventListener('click', closeDialog);
    dialog.querySelector('#fe-dialog-cancel').addEventListener('click', closeDialog);
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog();
    });

    // Save handler
    dialog.querySelector('#fe-dialog-save').addEventListener('click', () => {
      const newName = nameInput.value.trim() || folder.name;

      if (isNew) {
        // Add new folder
        this.customFolders.push({
          name: newName,
          path: folder.path,
          icon: 'folder',
          color: selectedColor
        });
      } else {
        // Update existing folder
        const idx = this.customFolders.findIndex(f => f.path === folder.path);
        if (idx !== -1) {
          this.customFolders[idx].name = newName;
          this.customFolders[idx].color = selectedColor;
        }
      }

      this.saveCustomFolders();
      this.renderSidebar();
      closeDialog();
      console.log('[FileExplorer] Saved custom folder:', newName);
    });

    // Enter key to save
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        dialog.querySelector('#fe-dialog-save').click();
      } else if (e.key === 'Escape') {
        closeDialog();
      }
    });
  }

  /**
   * Remove a custom folder
   */
  removeCustomFolder(folderPath) {
    this.customFolders = this.customFolders.filter(f => f.path !== folderPath);
    this.saveCustomFolders();
    this.renderSidebar();
    console.log('[FileExplorer] Removed custom folder:', folderPath);
  }
}

// Export for use in main.js
window.FileExplorerManager = FileExplorerManager;

console.log('[FileExplorer] Loaded');
