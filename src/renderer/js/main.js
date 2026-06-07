// ============================================================================
// KOLBO.AI ELECTRON DESKTOP APP - MAIN APPLICATION LOGIC
// ============================================================================
//
// PURPOSE:
// This is the main UI controller for the Kolbo.AI Electron desktop application.
// It manages:
// - User authentication and session management
// - Media library display and filtering
// - Batch selection and drag-and-drop functionality
// - Communication with Kolbo.AI backend API (via IPC)
// - Webapp iframe embedding
//
// ARCHITECTURE:
// Electron Renderer Process (this file) ← IPC → Main Process → API/OS
//
// KEY DIFFERENCES FROM PLUGIN:
// - No Adobe-specific import buttons (drag-and-drop only)
// - IPC-based API calls instead of direct HTTP
// - Simplified to universal drag-and-drop
//
// ============================================================================

// Deployment configuration
const WEBAPP_ENVIRONMENT = 'auto'; // 'auto', 'staging', 'production', 'localhost'

function getWebappEnvironment() {
  return localStorage.getItem('WEBAPP_ENVIRONMENT') || WEBAPP_ENVIRONMENT;
}

/**
 * showDialog — styled replacement for native confirm() and alert()
 * Returns a Promise that resolves to true (confirm) or false (cancel).
 * For alert-style dialogs, pass only confirmLabel with no cancelLabel.
 *
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {string} [opts.icon='warning'] - 'warning' | 'danger' | 'info' | 'success'
 * @param {string} [opts.confirmLabel='OK']
 * @param {string} [opts.cancelLabel] - omit for alert-style (no cancel button)
 * @param {string} [opts.confirmStyle='confirm'] - CSS class: 'confirm' | 'danger' | 'success'
 * @returns {Promise<boolean>}
 */
// Short alias for window.t with a literal English fallback so strings render
// even before the i18n bundle finishes loading.
function tr(key, fallback, params) {
  return (typeof window !== 'undefined' && window.t) ? window.t(key, params) : fallback;
}

function showDialog({ title, message, icon = 'warning', confirmLabel = 'OK', cancelLabel, confirmStyle = 'confirm' } = {}) {
  return new Promise((resolve) => {
    const iconSvgs = {
      warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      danger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    };

    const overlay = document.createElement('div');
    overlay.className = 'kolbo-dialog-overlay';
    overlay.innerHTML = `
      <div class="kolbo-dialog">
        <div class="kolbo-dialog-icon ${icon}">${iconSvgs[icon] || iconSvgs.warning}</div>
        <div class="kolbo-dialog-title">${title || ''}</div>
        <div class="kolbo-dialog-message">${message || ''}</div>
        <div class="kolbo-dialog-actions">
          ${cancelLabel ? `<button class="kolbo-dialog-btn cancel">${cancelLabel}</button>` : ''}
          <button class="kolbo-dialog-btn ${confirmStyle}">${confirmLabel}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    function close(result) {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 150);
      resolve(result);
    }

    overlay.querySelector(`.kolbo-dialog-btn.${confirmStyle}`).addEventListener('click', () => close(true));
    const cancelBtn = overlay.querySelector('.kolbo-dialog-btn.cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => close(false));

    // Close on overlay click (outside dialog)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });

    // Close on Escape
    const onKey = (e) => {
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(false); }
    };
    document.addEventListener('keydown', onKey);
  });
}

/**
 * KolboApp - Main Application Class
 */
class KolboApp {

  // ============================================================================
  // CONSTANTS - Centralized configuration values for easy tuning
  // ============================================================================
  static CONSTANTS = {
    // Performance
    FILTER_DEBOUNCE_DELAY: 300,           // ms to wait before applying filter
    INFINITE_SCROLL_ROOT_MARGIN: '200px', // Distance before triggering load (reduced from 400px for stability)
    INFINITE_SCROLL_DEBOUNCE: 250,        // ms to debounce scroll trigger
    INFINITE_SCROLL_COOLDOWN: 500,        // ms cooldown between page loads
    OPTIMAL_PAGE_SIZE_MIN: 12,            // Minimum items per page
    OPTIMAL_PAGE_SIZE_MAX: 50,            // Maximum items per page
    THUMBNAIL_PRELOAD_COUNT: 30,          // Number of thumbnails to preload
    CACHE_PRELOAD_COUNT: 20,              // Number of items to cache for drag-and-drop
    MAX_EMPTY_RESPONSES: 3,               // Max consecutive empty responses before stopping
    MAX_PAGES_LIMIT: 100,                 // Absolute safety limit on pages

    // Memory Management
    TAB_CLEANUP_INTERVAL: 2 * 60 * 1000,  // 2 minutes (reduced from 5)
    AUTO_SAVE_INTERVAL: 30 * 1000,        // 30 seconds

    // Grid & Layout
    MIN_GRID_SIZE: 1,                     // Minimum grid columns
    MAX_GRID_SIZE: 8,                     // Maximum grid columns
    DEFAULT_GRID_SIZE: 3,                 // Default grid columns
    ITEM_WIDTH_ESTIMATE: 220,             // Estimated width per item (px)
    ITEM_HEIGHT_ESTIMATE: 200,            // Estimated height per item (px)
    BUFFER_ROWS: 2,                       // Extra rows to load for smooth scrolling

    // Timeouts
    DRAG_PREVIEW_CLEANUP_DELAY: 100,      // ms to wait before removing drag preview
    GOOGLE_AUTH_POLL_INTERVAL: 2000,      // ms between Google auth checks
    IFRAME_LOAD_TIMEOUT: 30000,           // ms to wait for iframe load

    // Cache
    MAX_DRAG_CACHE_ITEMS: 500,            // Maximum items in drag cache (LRU eviction)

    // Media
    IMAGE_URL_REGEX: /\.(webp|jpg|jpeg|png|gif|avif)(\?|$)/i,
  };

  constructor() {
    // Filter & Project State
    this.currentFilter = 'all';
    this.currentSubcategory = 'all';
    this.selectedProjectId = localStorage.getItem('kolbo_selected_project') || 'all';
    this.gridSize = parseInt(localStorage.getItem('kolbo_grid_size')) || 3;

    // Project Selector State (custom dropdown)
    this.projectSortBy = localStorage.getItem('kolbo_project_sort') || 'createdAt';
    this.projectSearchTerm = '';
    this.projectDropdownOpen = false;

    // Media & Pagination State
    this.media = [];
    this.projects = [];
    this.currentPage = 1;
    this.isLoading = false;
    this.loadingMore = false;
    this.hasMore = false;
    this.totalItems = 0;
    this.emptyResponseCount = 0;          // Track consecutive empty responses
    this.lastLoadTime = 0;                // Timestamp of last page load
    this.scrollDebounceTimer = null;      // Debounce timer for scroll trigger

    // Selection & Interaction State
    this.observer = null;
    this.lazyImgObserver = null;
    this.selectedItems = new Set();
    this.lastSelectedItemId = null;  // For Shift+Click range selection
    this.playingVideoId = null;
    this.playingAudioElement = null;
    this.playingAudioId = null;

    // No drag-and-drop state needed

    // View & Navigation State
    // One-time migration: Clear old 'media' default and set to 'webapp'
    const savedView = localStorage.getItem('kolbo_current_view');
    if (!savedView || savedView === 'media') {
      localStorage.setItem('kolbo_current_view', 'webapp');
      this.currentView = 'webapp';
    } else {
      this.currentView = savedView;
    }
    this.tabManager = null; // Will be initialized when webapp view is shown
    this.fileExplorerManager = null; // Will be initialized when file-explorer view is shown

    // Debug & Performance
    this.DEBUG_MODE = window.KOLBO_CONFIG ? window.KOLBO_CONFIG.debug : (localStorage.getItem('KOLBO_DEBUG') === 'true');
    this.forceRefresh = false;
    this.cachedWebappUrl = null;
    this.cachedApiUrl = null;
    this.domCache = {};
    this.abortController = null;
    this.mediaAbortController = null;      // Controls cancellation of media API requests
    this.filterDebounceTimer = null;
    this.filterDebounceDelay = KolboApp.CONSTANTS.FILTER_DEBOUNCE_DELAY;
    this.preloadAbortController = null; // Controls cancellation of preload operations

    // Memory leak prevention
    this.activeTimeouts = new Set();
    this.activeIntervals = new Set();
    this.googleAuthPollInterval = null;

    this.init();
  }

  // DOM Cache Helper
  getElement(id) {
    if (!this.domCache[id]) {
      this.domCache[id] = document.getElementById(id);
    }
    return this.domCache[id];
  }

  // Memory-safe timer wrappers
  safeSetTimeout(callback, delay) {
    const timeoutId = setTimeout(() => {
      this.activeTimeouts.delete(timeoutId);
      callback();
    }, delay);
    this.activeTimeouts.add(timeoutId);
    return timeoutId;
  }

  safeSetInterval(callback, delay) {
    const intervalId = setInterval(callback, delay);
    this.activeIntervals.add(intervalId);
    return intervalId;
  }

  safeClearTimeout(timeoutId) {
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.activeTimeouts.delete(timeoutId);
    }
  }

  safeClearInterval(intervalId) {
    if (intervalId) {
      clearInterval(intervalId);
      this.activeIntervals.delete(intervalId);
    }
  }


  // Centralized error handling
  handleError(error, context = 'Unknown', showToUser = false) {
    console.error(`[Error] ${context}:`, error);

    // Log to main process for crash reporting
    if (window.kolboDesktop && window.kolboDesktop.logError) {
      window.kolboDesktop.logError({ context, error: error.message, stack: error.stack });
    }

    // Show user-friendly error if needed
    if (showToUser) {
      this.showError(`An error occurred: ${error.message}`);
    }

    // Return false to indicate failure
    return false;
  }

  showError(message) {
    // Simple error display - can be enhanced with toast notifications later
    const errorEl = this.getElement('media-error');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    }
  }

  hideError() {
    const errorEl = this.getElement('media-error');
    if (errorEl) {
      errorEl.classList.add('hidden');
    }
  }

  // Cleanup all timers and listeners
  cleanup() {
    if (this.DEBUG_MODE) {
      console.log('[Cleanup] Cleaning up timers and listeners...');
    }

    this.activeTimeouts.forEach(id => clearTimeout(id));
    this.activeTimeouts.clear();

    this.activeIntervals.forEach(id => clearInterval(id));
    this.activeIntervals.clear();

    if (this.googleAuthPollInterval) {
      clearInterval(this.googleAuthPollInterval);
      this.googleAuthPollInterval = null;
    }

    if (this.iframeLoadTimeout) {
      clearTimeout(this.iframeLoadTimeout);
      this.iframeLoadTimeout = null;
    }

    if (this.filterDebounceTimer) {
      clearTimeout(this.filterDebounceTimer);
      this.filterDebounceTimer = null;
    }

    if (this.scrollDebounceTimer) {
      clearTimeout(this.scrollDebounceTimer);
      this.scrollDebounceTimer = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.mediaAbortController) {
      this.mediaAbortController.abort();
      this.mediaAbortController = null;
    }

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.lazyImgObserver) {
      this.lazyImgObserver.disconnect();
      this.lazyImgObserver = null;
    }

    this.domCache = {};
    this.cachedWebappUrl = null;
    this.cachedApiUrl = null;

    if (this.DEBUG_MODE) {
      console.log('[Cleanup] Cleanup complete');
    }
  }

  async init() {
    if (this.DEBUG_MODE) {
      console.log('Initializing Kolbo Studio App...');
    }

    this.setGridSize(this.gridSize);

    // Sync token from main process (electron-store) to renderer (localStorage)
    // This ensures users stay logged in across app restarts
    await kolboAPI.syncTokenFromMainProcess();

    if (kolboAPI.isAuthenticated()) {
      this.showLoadingOverlay();
      Promise.all([this.loadProjects(), this.loadMedia()]).then(() => {
        // Re-check auth: a 401 during loadProjects/loadMedia clears the token
        // and calls handleLogout(). Without this guard, showMediaScreen would
        // still run (async return resolves the promise), creating the TabManager
        // with no token and loading the iframe unauthenticated.
        if (!kolboAPI.isAuthenticated()) return;
        this.showMediaScreen(false);
      });
    } else {
      this.showLoginScreen();
    }

    this.cacheDOM();
    this.bindEvents();

    // Apply whitelabel branding if applicable
    if (window.KOLBO_WHITELABEL) {
      this.initWhitelabelBranding();
      this.initWhitelabelAuth();
    }

    // Setup drag event listeners
    this.setupDragEventListeners();

    // Setup update listeners on app startup (not just when settings page opens)
    this.setupUpdateListeners();

    // Setup context menu manager
    this.contextMenuManager = new ContextMenuManager(this);
  }


  // Pre-cache frequently accessed DOM elements for performance
  cacheDOM() {
    // Screens
    this.getElement('login-screen');
    this.getElement('media-screen');
    this.getElement('loading-overlay');

    // Views
    this.getElement('media-library-view');
    this.getElement('webapp-view');
    this.getElement('settings-view');

    // Media elements
    this.getElement('media-grid');
    this.getElement('media-count');
    this.getElement('media-container');
    this.getElement('media-loading');
    this.getElement('media-error');
    this.getElement('media-empty');
    this.getElement('loading-more');
    this.getElement('infinite-scroll-trigger');

    // Buttons
    this.getElement('login-btn');
    this.getElement('logout-btn');
    this.getElement('google-login-btn');
    this.getElement('refresh-btn');
    this.getElement('retry-btn');
    this.getElement('settings-btn');
    this.getElement('media-tab');
    this.getElement('webapp-tab');

    // Controls
    this.getElement('grid-size-slider');
    this.getElement('grid-size-value');
    this.getElement('project-dropdown-trigger');
    this.getElement('project-dropdown-content');
    this.getElement('project-search-input');
    this.getElement('project-list');

    // Input fields
    this.getElement('email');
    this.getElement('password');

    // Batch menu
    this.getElement('floating-batch-menu');
    this.getElement('floating-batch-import-premiere-btn');
    this.getElement('floating-batch-download-btn');
    this.getElement('floating-batch-clear-btn');

    // Settings
    this.getElement('clear-cache-btn');
    this.getElement('reveal-cache-btn');
    this.getElement('cache-size');

    // Window controls
    this.getElement('minimize-btn');
    this.getElement('maximize-btn');
    this.getElement('close-btn');
  }

  bindEvents() {
    // Login
    const loginBtn = document.getElementById('login-btn');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const googleLoginBtn = document.getElementById('google-login-btn');
    const togglePasswordBtn = document.getElementById('toggle-password');

    if (loginBtn) {
      loginBtn.addEventListener('click', () => this.handleLogin());
    }

    if (passwordInput) {
      passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.handleLogin();
      });
    }

    if (emailInput && passwordInput) {
      emailInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') passwordInput.focus();
      });
    }

    if (googleLoginBtn) {
      googleLoginBtn.addEventListener('click', () => this.handleGoogleLogin());
    }

    const ssoLoginBtn = document.getElementById('sso-login-btn');
    if (ssoLoginBtn) {
      ssoLoginBtn.addEventListener('click', () => this.handleSSOLogin());
    }

    if (togglePasswordBtn) {
      togglePasswordBtn.addEventListener('click', () => this.togglePassword());
    }

    // Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.handleLogout());
    }

    // Tab Switching
    const mediaTab = document.getElementById('media-tab');
    const webappTab = document.getElementById('webapp-tab');
    const formatFactoryTab = document.getElementById('format-factory-tab');
    const downloaderTab = document.getElementById('downloader-tab');
    const quickToolsTab = document.getElementById('quick-tools-tab');
    if (mediaTab) {
      mediaTab.addEventListener('click', () => this.switchView('media'));
    }
    if (webappTab) {
      webappTab.addEventListener('click', () => this.switchView('webapp'));
    }
    if (formatFactoryTab) {
      formatFactoryTab.addEventListener('click', () => this.switchView('format-factory'));
    }
    if (downloaderTab) {
      downloaderTab.addEventListener('click', () => this.switchView('downloader'));
    }
    if (quickToolsTab) {
      quickToolsTab.addEventListener('click', () => this.switchView('quick-tools'));
    }
    const synciTab = document.getElementById('synci-tab');
    if (synciTab) {
      synciTab.addEventListener('click', () => this.switchView('synci'));
    }
    const fileExplorerTab = document.getElementById('file-explorer-tab');
    if (fileExplorerTab) {
      fileExplorerTab.addEventListener('click', () => this.switchView('file-explorer'));
    }
    const videoStudioTab = document.getElementById('video-studio-tab');
    if (videoStudioTab) {
      videoStudioTab.addEventListener('click', () => this.switchView('video-studio'));
    }
    const agentTab = document.getElementById('agent-tab');
    if (agentTab) {
      agentTab.addEventListener('click', () => this.switchView('agent'));
    }

    // Settings Button (icon button in header-actions)
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => this.switchView('settings'));
    }

    // Window Controls
    this.setupWindowControls();

    // Refresh
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.handleRefresh());
    }

    // Retry
    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.loadMedia(true));
    }

    // Project selector (custom dropdown)
    this.initProjectSelector();

    // Filters
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleFilter(e));
    });

    // Subcategory filters
    document.querySelectorAll('.subcategory-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleSubcategoryFilter(e));
    });

    // Grid size slider
    const gridSizeSlider = document.getElementById('grid-size-slider');
    if (gridSizeSlider) {
      gridSizeSlider.addEventListener('input', (e) => this.handleGridSizeChange(e));
    }

    // Floating batch menu
    const floatingBatchImportPremiereBtn = document.getElementById('floating-batch-import-premiere-btn');
    if (floatingBatchImportPremiereBtn) {
      floatingBatchImportPremiereBtn.addEventListener('click', () => this.handleImportToPremiere());
    }

    const floatingBatchDownloadBtn = document.getElementById('floating-batch-download-btn');
    if (floatingBatchDownloadBtn) {
      floatingBatchDownloadBtn.addEventListener('click', () => this.handleBatchDownload());
    }

    const floatingBatchClearBtn = document.getElementById('floating-batch-clear-btn');
    if (floatingBatchClearBtn) {
      floatingBatchClearBtn.addEventListener('click', () => this.handleBatchClear());
    }

    const floatingBatchFavoriteBtn = document.getElementById('floating-batch-favorite-btn');
    if (floatingBatchFavoriteBtn) {
      floatingBatchFavoriteBtn.addEventListener('click', () => this.handleBatchFavorite());
    }

    const floatingBatchDeleteBtn = document.getElementById('floating-batch-delete-btn');
    if (floatingBatchDeleteBtn) {
      floatingBatchDeleteBtn.addEventListener('click', () => this.handleBatchDelete());
    }

    const floatingBatchRestoreBtn = document.getElementById('floating-batch-restore-btn');
    if (floatingBatchRestoreBtn) {
      floatingBatchRestoreBtn.addEventListener('click', () => this.handleBatchRestore());
    }

    const floatingBatchDeleteForeverBtn = document.getElementById('floating-batch-delete-forever-btn');
    if (floatingBatchDeleteForeverBtn) {
      floatingBatchDeleteForeverBtn.addEventListener('click', () => this.handleBatchPermanentDelete());
    }

    // Settings page buttons
    const clearCacheBtn = document.getElementById('clear-cache-btn');
    const revealCacheBtn = document.getElementById('reveal-cache-btn');
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener('click', () => this.handleClearCache());
    }
    if (revealCacheBtn) {
      revealCacheBtn.addEventListener('click', () => this.handleRevealCache());
    }

    // Setup Billing button
    const billingBtn = document.getElementById('billing-btn');
    if (billingBtn && window.kolboDesktop) {
      if (!billingBtn.hasAttribute('data-listener-attached')) {
        billingBtn.setAttribute('data-listener-attached', 'true');
        billingBtn.addEventListener('click', () => {
          // Build billing URL based on current environment
          const webappUrl = window.KOLBO_CONFIG?.webappUrl || 'https://app.kolbo.ai';
          const billingUrl = `${webappUrl}/billing`;

          if (this.DEBUG_MODE) {
            console.log('[Settings] Opening billing page:', billingUrl);
          }
          window.kolboDesktop.openExternal(billingUrl);
        });
      }
    }
  }

  handleGridSizeChange(e) {
    const size = parseInt(e.target.value);
    this.setGridSize(size);
  }

  setGridSize(size) {
    this.gridSize = size;
    localStorage.setItem('kolbo_grid_size', size);

    const gridEl = document.getElementById('media-grid');
    if (gridEl) {
      gridEl.style.setProperty('--grid-columns', size);
    }

    const slider = document.getElementById('grid-size-slider');
    const sliderContainer = slider?.parentElement;
    const valueDisplay = document.getElementById('grid-size-value');
    if (slider) {
      slider.value = size;
      // Update slider progress for blue glow effect
      const min = parseInt(slider.min) || 1;
      const max = parseInt(slider.max) || 8;
      const progress = ((size - min) / (max - min)) * 100;
      slider.style.setProperty('--slider-progress', `${progress}%`);
      // Also update container for glow pseudo-element
      if (sliderContainer) {
        sliderContainer.style.setProperty('--slider-progress', `${progress}%`);
      }
    }
    if (valueDisplay) valueDisplay.textContent = size;
  }

  showLoginScreen() {
    // First, hide other screens
    document.getElementById('media-screen').classList.add('hidden');
    document.getElementById('loading-overlay').classList.add('hidden');
    
    // Show login screen
    const loginScreen = document.getElementById('login-screen');
    loginScreen.classList.remove('hidden');
    
    // Use requestAnimationFrame to ensure DOM is ready and CSS is applied
    requestAnimationFrame(() => {
      // Force a reflow to ensure CSS is applied
      void loginScreen.offsetHeight;
      
      // Ensure inputs are enabled and focusable
      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');
      const loginBtn = document.getElementById('login-btn');
      const googleLoginBtn = document.getElementById('google-login-btn');
      const togglePasswordBtn = document.getElementById('toggle-password');
      
      if (emailInput) {
        emailInput.disabled = false;
        emailInput.readOnly = false;
        emailInput.style.pointerEvents = 'auto';
        emailInput.style.userSelect = 'text';
        emailInput.style.webkitUserSelect = 'text';
      }
      if (passwordInput) {
        passwordInput.disabled = false;
        passwordInput.readOnly = false;
        passwordInput.style.pointerEvents = 'auto';
        passwordInput.style.userSelect = 'text';
        passwordInput.style.webkitUserSelect = 'text';
      }
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.style.pointerEvents = 'auto';
      }
      if (googleLoginBtn) {
        googleLoginBtn.style.pointerEvents = 'auto';
      }
      if (togglePasswordBtn) {
        togglePasswordBtn.style.pointerEvents = 'auto';
      }
      
      // Ensure auth form and card are interactive
      const authForm = document.querySelector('.auth-form');
      const authCard = document.querySelector('.auth-card');
      if (authForm) {
        authForm.style.pointerEvents = 'auto';
      }
      if (authCard) {
        authCard.style.pointerEvents = 'auto';
      }
    });

    // Re-initialize the background video (skip for whitelabel — uses static image)
    if (!window.KOLBO_WHITELABEL) {
      setTimeout(() => {
        const video = document.querySelector('.auth-video');
        if (video) {
          video.load();
          video.play().catch(err => console.warn('[Video] Autoplay prevented:', err));
        }
      }, 100);
    }
  }

  showLoadingOverlay() {
    document.getElementById('loading-overlay').classList.remove('hidden');
  }

  hideLoadingOverlay() {
    document.getElementById('loading-overlay').classList.add('hidden');
  }

  showMediaScreen(forceMediaView = false) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('loading-overlay').classList.add('hidden');
    document.getElementById('media-screen').classList.remove('hidden');

    if (forceMediaView) {
      this.switchView('media', false);
    } else {
      this.switchView(this.currentView, true);
    }
  }

  switchView(view, skipSave = false) {
    if (this.DEBUG_MODE) {
      console.log(`[View] Switching to: ${view}`);
    }

    if (!skipSave) {
      this.currentView = view;
      localStorage.setItem('kolbo_current_view', view);
    }

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Update settings button
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      settingsBtn.classList.toggle('active', view === 'settings');
    }

    // Show/hide views
    const mediaView = document.getElementById('media-library-view');
    const webappView = document.getElementById('webapp-view');
    const settingsView = document.getElementById('settings-view');
    const formatFactoryView = document.getElementById('format-factory-view');
    const downloaderView = document.getElementById('downloader-view');
    const quickToolsView = document.getElementById('quick-tools-view');
    const fileExplorerView = document.getElementById('file-explorer-view');
    const agentView = document.getElementById('agent-view');
    const videoStudioView = document.getElementById('video-studio-view');
    const synciView = document.getElementById('synci-view');
    const mediaCount = document.getElementById('media-count');

    // Hide all views first
    mediaView?.classList.add('hidden');
    mediaView?.classList.remove('active');
    webappView?.classList.add('hidden');
    webappView?.classList.remove('active');
    settingsView?.classList.add('hidden');
    settingsView?.classList.remove('active');
    formatFactoryView?.classList.add('hidden');
    formatFactoryView?.classList.remove('active');
    downloaderView?.classList.add('hidden');
    downloaderView?.classList.remove('active');
    quickToolsView?.classList.add('hidden');
    quickToolsView?.classList.remove('active');
    fileExplorerView?.classList.add('hidden');
    fileExplorerView?.classList.remove('active');
    agentView?.classList.add('hidden');
    agentView?.classList.remove('active');
    videoStudioView?.classList.add('hidden');
    videoStudioView?.classList.remove('active');
    synciView?.classList.add('hidden');
    synciView?.classList.remove('active');

    if (view === 'media') {
      mediaView?.classList.remove('hidden');
      mediaView?.classList.add('active');
      if (mediaCount) mediaCount.style.display = '';

      // Reset scroll position to top when switching to media view
      // This prevents infinite scroll from firing immediately due to stale scroll position
      const mediaContainer = document.getElementById('media-container');
      if (mediaContainer) {
        mediaContainer.scrollTop = 0;
      }

      // Auto-refresh media when navigating to media view
      if (!skipSave) {
        this.loadMedia(true);
      }
    } else if (view === 'webapp') {
      webappView?.classList.remove('hidden');
      webappView?.classList.add('active');
      if (mediaCount) mediaCount.style.display = 'none';

      // Clear batch selection when navigating to webapp
      this.handleBatchClear();

      // Initialize TabManager if not already initialized
      if (!this.tabManager) {
        this.tabManager = new TabManager();

        // Set up callback for auth status changes from web app
        this.tabManager.onAuthStatusChanged = (authenticated, reason) => {
          if (!authenticated) {
            if (this.DEBUG_MODE) {
            console.log(`[Main] 🔐 Web app logged out (${reason}) - logging out desktop app`);
            }
            this.handleLogout(true); // Skip confirmation for automatic logout
          }
        };

        // Set up callback for login page shown in web app
        this.tabManager.onLoginPageShown = (reason) => {
          if (this.DEBUG_MODE) {
          console.log(`[Main] 🔑 Login page shown in web app (${reason}) - switching to desktop login`);
          }
          // Auto-logout and show desktop login screen (Google OAuth works there)
          this.handleLogout(true); // Skip confirmation for automatic logout
        };

        if (this.DEBUG_MODE) {
          console.log('[View] TabManager initialized');
        }
      } else {
        // TabManager already exists - refresh tabs with current token
        // This ensures tabs are authenticated if user logged in after TabManager was created
        setTimeout(() => this.refreshWebappTabsWithToken(), 300);
      }
    } else if (view === 'settings') {
      settingsView?.classList.remove('hidden');
      settingsView?.classList.add('active');
      if (mediaCount) mediaCount.style.display = 'none';

      // Load settings data
      this.loadSettingsData();
    } else if (view === 'format-factory') {
      formatFactoryView?.classList.remove('hidden');
      formatFactoryView?.classList.add('active');
      if (mediaCount) mediaCount.style.display = 'none';

      if (this.DEBUG_MODE) {
        console.log('[View] Format Factory view shown');
      }
    } else if (view === 'downloader') {
      downloaderView?.classList.remove('hidden');
      downloaderView?.classList.add('active');
      if (mediaCount) mediaCount.style.display = 'none';

      if (this.DEBUG_MODE) {
        console.log('[View] Downloader view shown');
      }
    } else if (view === 'quick-tools') {
      quickToolsView?.classList.remove('hidden');
      quickToolsView?.classList.add('active');
      if (mediaCount) mediaCount.style.display = 'none';

      if (this.DEBUG_MODE) {
        console.log('[View] Quick Tools view shown');
      }
    } else if (view === 'file-explorer') {
      fileExplorerView?.classList.remove('hidden');
      fileExplorerView?.classList.add('active');
      if (mediaCount) mediaCount.style.display = 'none';

      // Initialize file explorer if not already done
      if (!this.fileExplorerManager && window.FileExplorerManager) {
        console.log('[View] Initializing FileExplorerManager...');
        this.fileExplorerManager = new window.FileExplorerManager();
        // Init is async but we don't need to wait - it renders immediately
        this.fileExplorerManager.init(fileExplorerView).catch(err => {
          console.error('[View] FileExplorerManager init failed:', err);
        });
      }

      if (this.DEBUG_MODE) {
        console.log('[View] File Explorer view shown');
      }
    } else if (view === 'video-studio') {
      videoStudioView?.classList.remove('hidden');
      videoStudioView?.classList.add('active');
      if (mediaCount) mediaCount.style.display = 'none';
      this._loadVideoStudioIframe();

      if (this.DEBUG_MODE) {
        console.log('[View] Video Studio view shown');
      }
    } else if (view === 'agent') {
      agentView?.classList.remove('hidden');
      agentView?.classList.add('active');
      if (mediaCount) mediaCount.style.display = 'none';

      this._setupAgentLanding();

      // If terminal was already started in a previous activation, just refocus it.
      if (this._agentTerminal) {
        setTimeout(() => {
          this._agentTerminal._fit();
          this._agentTerminal.focus();
        }, 50);
      }

      if (this.DEBUG_MODE) {
        console.log('[View] Agent view shown');
      }
    } else if (view === 'synci') {
      synciView?.classList.remove('hidden');
      synciView?.classList.add('active');
      if (mediaCount) mediaCount.style.display = 'none';

      // Lazy-init the Synci music library on first open.
      if (!this.synciManager && window.SynciManager) {
        this.synciManager = new window.SynciManager(window.kolboDesktopSynciBridge, window.kolboAPI);
      }
      this.synciManager?.activate();

      if (this.DEBUG_MODE) {
        console.log('[View] Synci view shown');
      }
    }
  }

  // ── Video Studio: lazy-load the vendored LTX sub-app from file:// ──────────────
  _loadVideoStudioIframe() {
    const iframe = document.getElementById('video-studio-iframe');
    const loading = document.getElementById('video-studio-loading');
    if (!iframe) return;
    if (iframe.dataset.loaded === 'true') {
      if (loading) loading.style.display = 'none';
      iframe.style.display = '';
      // Refresh token in case user re-logged in.
      this._postVideoStudioInit(iframe);
      return;
    }
    // Resolve relative path so it works in both dev (electron .) and packaged builds.
    const subAppUrl = new URL('./ltx-studio/dist/index.html', window.location.href).toString();
    iframe.addEventListener('load', () => {
      iframe.dataset.loaded = 'true';
      if (loading) loading.style.display = 'none';
      iframe.style.display = '';
      this._postVideoStudioInit(iframe);
    }, { once: true });
    iframe.src = subAppUrl;
  }

  _postVideoStudioInit(iframe) {
    const win = iframe?.contentWindow;
    if (!win) return;
    const token = (window.kolboAPI && window.kolboAPI.getToken && window.kolboAPI.getToken()) || '';
    const apiBaseUrl = (window.KOLBO_CONFIG && window.KOLBO_CONFIG.apiUrl) || 'https://api.kolbo.ai';
    const brandName = window.KOLBO_WHITELABEL_APP_LABEL || 'Kolbo Studio';
    const brandLogoUrl = window.KOLBO_WHITELABEL_LOGO_URL || '';
    try {
      win.postMessage(
        {
          type: 'kolbo-video-studio:init',
          payload: { token, apiBaseUrl, brandName, brandLogoUrl },
        },
        '*', // file:// origin is "null" — explicit "*" is required here.
      );
      if (this.DEBUG_MODE) {
        console.log('[VideoStudio] posted init', { hasToken: !!token, apiBaseUrl, brandName });
      }
    } catch (err) {
      console.error('[VideoStudio] postMessage failed:', err);
    }
  }

  // ── Kolbo Code: landing card (default) + opt-in built-in terminal ─────────────
  _setupAgentLanding() {
    const landingEl = document.getElementById('agent-landing');
    const urlEl = document.getElementById('agent-landing-url');
    const titleEl = document.getElementById('agent-landing-title');
    const openBtn = document.getElementById('agent-landing-open-btn');
    const terminalBtn = document.getElementById('agent-landing-terminal-btn');

    const webappUrl = (window.KOLBO_CONFIG?.webappUrl || 'https://app.kolbo.ai').replace(/\/$/, '');
    const codeUrl = `${webappUrl}/kolbo-code`;
    const codeLabel = window.KOLBO_WHITELABEL_CODE_LABEL || 'Kolbo Code';

    if (titleEl) titleEl.textContent = codeLabel;
    if (urlEl) urlEl.textContent = codeUrl;

    // If the terminal has already been started in this session, hide the landing.
    if (this._agentTerminal) {
      if (landingEl) landingEl.style.display = 'none';
      return;
    }
    if (landingEl) landingEl.style.display = '';

    if (openBtn && !openBtn._wired) {
      openBtn._wired = true;
      openBtn.addEventListener('click', () => {
        if (window.kolboDesktop?.openExternal) {
          window.kolboDesktop.openExternal(codeUrl);
        } else {
          window.open(codeUrl, '_blank');
        }
      });
    }

    if (terminalBtn && !terminalBtn._wired) {
      terminalBtn._wired = true;
      terminalBtn.addEventListener('click', () => this._startAgentTerminal());
    }

    if (window.lucide?.createIcons) {
      try { window.lucide.createIcons(); } catch (_) {}
    }
  }

  _startAgentTerminal() {
    if (this._agentTerminal) return;

    const landingEl = document.getElementById('agent-landing');
    const container = document.getElementById('agent-terminal-container');
    const loadingEl = document.getElementById('agent-loading');

    if (landingEl) landingEl.style.display = 'none';
    if (container) {
      container.style.display = '';
      container.style.opacity = '0';
    }
    if (loadingEl) {
      loadingEl.style.display = '';
      loadingEl.classList.remove('fade-out', 'error');
    }

    const initAgent = () => {
      this._agentTerminal = new window.AgentTerminal();
      this._agentTerminal.init(container).then(() => {
        this._agentTerminal.kolboReadyPromise.then(() => {
          if (loadingEl) loadingEl.classList.add('fade-out');
          container.style.opacity = '1';
          setTimeout(() => {
            if (loadingEl) loadingEl.style.display = 'none';
            this._agentTerminal._fit();
            this._agentTerminal.focus();
          }, 400);
        });
      }).catch(err => {
        console.error('[Agent] init failed:', err);
        if (loadingEl) {
          loadingEl.classList.add('error');
          const subtitle = loadingEl.querySelector('.agent-loading-subtitle');
          if (subtitle) subtitle.textContent = 'Failed to start';
          const content = loadingEl.querySelector('.agent-loading-content');
          if (content) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'agent-loading-error';
            errorDiv.textContent = err.message;
            content.appendChild(errorDiv);
            const retryBtn = document.createElement('button');
            retryBtn.className = 'agent-loading-retry';
            retryBtn.textContent = 'Retry';
            retryBtn.onclick = () => {
              this._agentTerminal = null;
              this._startAgentTerminal();
            };
            content.appendChild(retryBtn);
          }
        }
      });
    };

    if (container && window.AgentTerminal) {
      const subtitle = loadingEl?.querySelector('.agent-loading-subtitle');
      if (subtitle) subtitle.textContent = `Loading ${window.KOLBO_WHITELABEL_CODE_LABEL || 'Kolbo Code'}...`;
      initAgent();
    } else if (container) {
      const subtitle = loadingEl?.querySelector('.agent-loading-subtitle');
      if (subtitle) subtitle.textContent = 'Loading terminal...';
      const waitForXterm = setInterval(() => {
        if (window.AgentTerminal) {
          clearInterval(waitForXterm);
          if (subtitle) subtitle.textContent = `Loading ${window.KOLBO_WHITELABEL_CODE_LABEL || 'Kolbo Code'}...`;
          initAgent();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(waitForXterm);
        if (!this._agentTerminal && loadingEl) {
          loadingEl.classList.add('error');
          const sub = loadingEl.querySelector('.agent-loading-subtitle');
          if (sub) sub.textContent = 'Terminal failed to load';
        }
      }, 15000);
    }
  }

  // Old webapp loading methods removed - now handled by TabManager

  setupWindowControls() {
    // Only setup if Electron API is available
    if (!window.kolboDesktop) return;

    const minimizeBtn = document.getElementById('minimize-btn');
    const maximizeBtn = document.getElementById('maximize-btn');
    const closeBtn = document.getElementById('close-btn');

    if (minimizeBtn) {
      minimizeBtn.addEventListener('click', () => {
        window.kolboDesktop.minimizeWindow();
      });
    }

    if (maximizeBtn) {
      maximizeBtn.addEventListener('click', async () => {
        await window.kolboDesktop.maximizeWindow();
        // Update button icon
        const isMaximized = await window.kolboDesktop.isMaximized();
        maximizeBtn.classList.toggle('is-maximized', isMaximized);
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        window.kolboDesktop.closeWindow();
      });
    }

    // Listen for maximize state changes
    window.kolboDesktop.onWindowMaximized(() => {
      if (maximizeBtn) maximizeBtn.classList.add('is-maximized');
    });

    window.kolboDesktop.onWindowUnmaximized(() => {
      if (maximizeBtn) maximizeBtn.classList.remove('is-maximized');
    });

    // Set initial state
    window.kolboDesktop.isMaximized().then(isMaximized => {
      if (maximizeBtn) maximizeBtn.classList.toggle('is-maximized', isMaximized);
    });
  }

  handleRefresh() {
    if (this.currentView === 'media') {
      this.loadMedia(true);
    } else if (this.currentView === 'webapp') {
      // Full webapp relaunch - destroy and recreate TabManager
      // This helps recover from bugs, crashes, or any issues
      if (this.DEBUG_MODE) {
        console.log('[Refresh] Relaunching entire webapp view...');
      }

      // Destroy existing TabManager if it exists
      if (this.tabManager) {
        this.tabManager.destroy();
        this.tabManager = null;
      }

      // Clear the tab list and iframe container
      const tabList = document.getElementById('tab-list');
      if (tabList) {
        tabList.innerHTML = `
          <button id="new-tab-btn" class="new-tab-btn" title="New Tab (Ctrl+T)">
${Icons.get('plus', 16)}
            <span>New Tab</span>
          </button>
          <button id="split-view-btn" class="split-view-btn" title="Split View (Ctrl+Shift+S)">
${Icons.get('columns-2', 16)}
            <span>Split View</span>
          </button>
          <div id="split-presets" class="split-presets hidden">
            <button class="split-preset-btn active" data-ratio="0.5" title="Equal Split (50/50)">
              ${Icons.get('columns-2', 16)}
            </button>
            <button class="split-preset-btn" data-ratio="0.25" title="Small Left (25/75)">
              ${Icons.get('panel-left', 16)}
            </button>
            <button class="split-preset-btn" data-ratio="0.7" title="Large Left (70/30)">
              ${Icons.get('panel-left', 16)}
            </button>
          </div>
        `;
      }

      const iframeContainer = document.getElementById('iframe-container');
      if (iframeContainer) {
        iframeContainer.innerHTML = '<div id="webapp-loading" class="loading-state"><div class="spinner"></div><p>' + (window.t ? window.t('loading.webApp') : 'Loading Kolbo Web App...') + '</p></div>';
      }

      // Recreate TabManager (will rebind to new-tab-btn)
      this.tabManager = new TabManager();

      // Set up callback for auth status changes from web app
      this.tabManager.onAuthStatusChanged = (authenticated, reason) => {
        if (!authenticated) {
          if (this.DEBUG_MODE) {
          console.log(`[Main] 🔐 Web app logged out (${reason}) - logging out desktop app`);
          }
          this.handleLogout(true); // Skip confirmation for automatic logout
        }
      };

      // Set up callback for login page shown in web app
      this.tabManager.onLoginPageShown = (reason) => {
        if (this.DEBUG_MODE) {
        console.log(`[Main] 🔑 Login page shown in web app (${reason}) - switching to desktop login`);
        }
        // Auto-logout and show desktop login screen (Google OAuth works there)
        this.handleLogout(true); // Skip confirmation for automatic logout
      };

      if (this.DEBUG_MODE) {
        console.log('[Refresh] Webapp view relaunched successfully');
      }
    }
  }

  // ── Whitelabel: replace all Kolbo branding with whitelabel equivalents ────────
  initWhitelabelBranding() {
    const logoSvg = window.KOLBO_WHITELABEL_LOGO_SVG;
    const appLabel = window.KOLBO_WHITELABEL_APP_LABEL || window.KOLBO_WHITELABEL;
    const codeLabel = window.KOLBO_WHITELABEL_CODE_LABEL || 'Code';
    const appName = appLabel;

    // Update document title
    document.title = appName;

    // Replace webapp tab icon (K SVG → whitelabel logo) and label
    const webappTab = document.getElementById('webapp-tab');
    if (webappTab && logoSvg) {
      const svg = webappTab.querySelector('svg');
      if (svg) {
        const wrapper = document.createElement('span');
        wrapper.innerHTML = logoSvg;
        const newSvg = wrapper.querySelector('svg');
        if (newSvg) {
          const tw = newSvg.getAttribute('width') || '366';
          const th = newSvg.getAttribute('height') || '366';
          if (!newSvg.getAttribute('viewBox')) newSvg.setAttribute('viewBox', `0 0 ${tw} ${th}`);
          newSvg.removeAttribute('width');
          newSvg.removeAttribute('height');
          newSvg.setAttribute('height', '20');
          newSvg.style.width = 'auto';
          svg.replaceWith(newSvg);
        }
      }
      const label = webappTab.querySelector('span[data-i18n]');
      if (label) { label.textContent = appLabel; label.removeAttribute('data-i18n'); }
    }

    // Replace agent tab label
    const agentTab = document.getElementById('agent-tab');
    if (agentTab) {
      const label = agentTab.querySelector('span[data-i18n]');
      if (label) { label.textContent = codeLabel; label.removeAttribute('data-i18n'); }
    }

    // Update agent (Kolbo Code) loading screen title and icon
    const agentLoadingTitle = document.getElementById('agent-loading-title');
    if (agentLoadingTitle) agentLoadingTitle.textContent = codeLabel;

    const agentLoadingIcon = document.getElementById('agent-loading-icon');
    if (agentLoadingIcon && logoSvg) {
      const wrapper = document.createElement('span');
      wrapper.innerHTML = logoSvg;
      const newSvg = wrapper.querySelector('svg');
      if (newSvg) {
        const iw = newSvg.getAttribute('width') || '366';
        const ih = newSvg.getAttribute('height') || '366';
        if (!newSvg.getAttribute('viewBox')) newSvg.setAttribute('viewBox', `0 0 ${iw} ${ih}`);
        newSvg.removeAttribute('width');
        newSvg.removeAttribute('height');
        newSvg.style.width = '64px';
        newSvg.style.height = '64px';
        agentLoadingIcon.innerHTML = '';
        agentLoadingIcon.appendChild(newSvg);
      }
    }

    // Replace loading overlay logo (large K SVG → whitelabel logo)
    const overlayLogo = document.querySelector('.logo-icon-large');
    if (overlayLogo && logoSvg) {
      const wrapper = document.createElement('span');
      wrapper.innerHTML = logoSvg;
      const newSvg = wrapper.querySelector('svg');
      if (newSvg) {
        const ow = newSvg.getAttribute('width') || '366';
        const oh = newSvg.getAttribute('height') || '366';
        if (!newSvg.getAttribute('viewBox')) newSvg.setAttribute('viewBox', `0 0 ${ow} ${oh}`);
        newSvg.classList.add('logo-icon-large');
        newSvg.removeAttribute('width');
        newSvg.removeAttribute('height');
        newSvg.style.height = '80px';
        newSvg.style.width = 'auto';
        overlayLogo.replaceWith(newSvg);
      }
    }
  }

  // ── Whitelabel: auth screen — static bg, whitelabel logo, SSO-only ────────────
  initWhitelabelAuth() {
    const logoSvg = window.KOLBO_WHITELABEL_LOGO_SVG;
    const authBg = window.KOLBO_WHITELABEL_AUTH_BG;

    // 1. Replace video background with static image
    const authBgEl = document.querySelector('.auth-background');
    if (authBgEl && authBg) {
      authBgEl.innerHTML = `<div class="auth-overlay"></div>`;
      authBgEl.style.backgroundImage = `url('${authBg}')`;
      authBgEl.style.backgroundSize = 'cover';
      authBgEl.style.backgroundPosition = 'center';
    }

    // 2. Replace Kolbo logo in auth card with whitelabel logo
    const authLogoEl = document.querySelector('.auth-logo');
    if (authLogoEl && logoSvg) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = logoSvg;
      const newSvg = wrapper.querySelector('svg');
      if (newSvg) {
        // Preserve coordinate system as viewBox before removing fixed dimensions
        const w = newSvg.getAttribute('width') || '366';
        const h = newSvg.getAttribute('height') || '366';
        if (!newSvg.getAttribute('viewBox')) {
          newSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        }
        newSvg.removeAttribute('width');
        newSvg.removeAttribute('height');
        newSvg.style.width = '100px';
        newSvg.style.height = '100px';
        newSvg.style.display = 'block';
        authLogoEl.innerHTML = '';
        authLogoEl.appendChild(newSvg);
      }
    }

    // 3. SSO-only: hide Google button, divider, email form → show SSO button
    const googleBtn = document.getElementById('google-login-btn');
    const divider = document.getElementById('auth-divider');
    const authForm = document.querySelector('.auth-form');
    const ssoBtn = document.getElementById('sso-login-btn');

    if (googleBtn) googleBtn.style.display = 'none';
    if (divider) divider.style.display = 'none';
    if (authForm) authForm.style.display = 'none';
    if (ssoBtn) ssoBtn.style.display = '';
  }

  // ── SSO Login handler ─────────────────────────────────────────────────────────
  async handleSSOLogin() {
    const slug = window.KOLBO_WHITELABEL_SSO_SLUG;
    const errorEl = document.getElementById('login-error');
    const ssoBtn = document.getElementById('sso-login-btn');

    if (!slug) {
      if (errorEl) errorEl.textContent = 'SSO not configured';
      return;
    }

    let countdownInterval = null;
    try {
      if (ssoBtn) ssoBtn.disabled = true;

      // Show spinner + countdown so user knows to complete auth in the browser
      let secondsLeft = 60;
      const updateMsg = () => {
        if (!errorEl) return;
        errorEl.style.color = '#667eea';
        errorEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-direction:column"><div style="display:flex;align-items:center;gap:8px"><div class="spinner" style="width:16px;height:16px;border:2px solid rgba(102,126,234,0.3);border-top-color:#667eea;border-radius:50%;animation:spin 0.8s linear infinite;"></div><span>Complete sign-in in your browser...</span></div><span style="font-size:12px;opacity:0.7">Waiting ${secondsLeft}s</span></div>`;
      };
      updateMsg();
      countdownInterval = setInterval(() => { secondsLeft--; updateMsg(); }, 1000);

      const result = await window.kolboDesktop.ssoLogin(slug);

      if (result.success) {
        if (errorEl) {
          errorEl.style.color = '#10b981';
          errorEl.textContent = '✓ Successfully signed in!';
        }

        setTimeout(async () => {
          this.showLoadingOverlay();
          document.getElementById('login-screen').classList.add('hidden');

          // Sync token from main process (electron-store) → renderer (localStorage)
          if (typeof kolboAPI !== 'undefined' && kolboAPI.syncTokenFromMainProcess) {
            await kolboAPI.syncTokenFromMainProcess();
          }

          await this.loadProjects();
          await this.loadMedia();
          this.showMediaScreen(false);

          if (this.tabManager) {
            setTimeout(() => this.refreshWebappTabsWithToken(), 500);
          }
        }, 800);
      } else {
        if (errorEl) {
          errorEl.style.color = '';
          errorEl.textContent = result.error || 'SSO login failed';
        }
      }
    } catch (error) {
      if (errorEl) {
        errorEl.style.color = '';
        errorEl.textContent = error.message || 'SSO login failed';
      }
    } finally {
      clearInterval(countdownInterval);
      if (ssoBtn) ssoBtn.disabled = false;
    }
  }

  async handleLogin() {
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const loginBtn = document.getElementById('login-btn');
    const errorEl = document.getElementById('login-error');

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      errorEl.textContent = window.t ? window.t('auth.emailRequired') : 'Please enter email and password';
      return;
    }

    try {
      errorEl.textContent = '';
      loginBtn.disabled = true;
      loginBtn.textContent = window.t ? window.t('auth.signingIn') : 'Signing in...';

      const result = await kolboAPI.login(email, password);

      if (result.success) {
        this.showLoadingOverlay();
        document.getElementById('login-screen').classList.add('hidden');

        await this.loadProjects();
        await this.loadMedia();
        this.showMediaScreen(false);
        
        // Refresh webapp tabs with new token if TabManager exists
        // This ensures tabs are authenticated after login
        if (this.tabManager) {
          setTimeout(() => this.refreshWebappTabsWithToken(), 500);
        }
      } else {
        errorEl.textContent = result.error || (window.t ? window.t('auth.loginFailed') : 'Login failed');
      }
    } catch (error) {
      console.error('[Login] Error:', error);
      errorEl.textContent = error.message || (window.t ? window.t('auth.loginFailedRetry') : 'Login failed. Please try again.');
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = window.t ? window.t('auth.signIn') : 'Sign In';
    }
  }

  /**
   * Refresh all webapp tabs with the current authentication token
   * This ensures tabs are authenticated after login
   */
  refreshWebappTabsWithToken() {
    if (!this.tabManager) return;
    
    // Sync token from main process first
    if (window.kolboAPI && typeof window.kolboAPI.syncTokenFromMainProcess === 'function') {
      window.kolboAPI.syncTokenFromMainProcess().then(() => {
        const token = window.kolboAPI?.getToken();
        if (token && this.tabManager) {
          // Only refresh tabs that are already loaded (not currently loading)
          // This prevents ERR_ABORTED (-3) errors from interrupting active loads
          this.tabManager.tabs.forEach(tab => {
            if (tab.iframe && tab.url && tab.loaded) {
              try {
                // Get current iframe URL to check if token needs updating
                const currentSrc = tab.iframe.src;
                const currentUrlObj = new URL(currentSrc);
                const currentToken = currentUrlObj.searchParams.get('token');
                
                // Only refresh if token is missing or different
                if (!currentToken || currentToken !== token) {
                  // Build new URL from base tab.url (not current iframe src)
                  const urlObj = new URL(tab.url);
                  
                  // Get API URL from config
                  const apiUrl = window.KOLBO_CONFIG?.apiUrl || 'http://localhost:5050/api';
                  
                  // Remove old token and params if present
                  urlObj.searchParams.delete('token');
                  urlObj.searchParams.delete('embedded');
                  urlObj.searchParams.delete('source');
                  urlObj.searchParams.delete('apiUrl');
                  
                  // Add new token and embedded params
                  urlObj.searchParams.set('embedded', 'true');
                  urlObj.searchParams.set('source', 'desktop');
                  urlObj.searchParams.set('token', token);
                  urlObj.searchParams.set('apiUrl', apiUrl);
                  
                  // Only reload if the URL actually changed
                  const newUrl = urlObj.toString();
                  if (currentSrc !== newUrl) {
                    // Reload iframe with new URL
                    tab.iframe.src = newUrl;
                    tab.loaded = false;
                    
                    if (this.DEBUG_MODE) {
                      console.log(`[Main] 🔄 Refreshed tab ${tab.id} with new token`);
                    }
                  }
                }
              } catch (error) {
                console.error(`[Main] Error refreshing tab ${tab.id}:`, error);
              }
            } else if (tab.iframe && tab.url && !tab.loaded) {
              // Tab is still loading - wait for it to finish, then refresh
              // Set up a one-time listener to refresh when load completes
              const loadHandler = () => {
                tab.iframe.removeEventListener('load', loadHandler);
                // Small delay to ensure page is fully loaded
                setTimeout(() => {
                  if (tab.loaded) {
                    this.refreshWebappTabsWithToken();
                  }
                }, 500);
              };
              tab.iframe.addEventListener('load', loadHandler, { once: true });
            }
          });
        }
      }).catch(error => {
        console.error('[Main] Error syncing token for webapp refresh:', error);
      });
    }
  }

  async handleGoogleLogin() {
    const errorEl = document.getElementById('login-error');

    try {
      errorEl.style.color = '#667eea';
      errorEl.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; gap: 8px;"><div class="spinner" style="width: 16px; height: 16px; border: 2px solid rgba(102, 126, 234, 0.3); border-top-color: #667eea; border-radius: 50%; animation: spin 0.8s linear infinite;"></div><span>' + (window.t ? window.t('auth.openingGoogle') : 'Opening Google Sign-In...') + '</span></div>';

      const result = await kolboAPI.googleLogin();

      if (result.success) {
        errorEl.style.color = '#10b981';
        errorEl.textContent = '✓ Successfully signed in with Google!';

        setTimeout(async () => {
          this.showLoadingOverlay();
          document.getElementById('login-screen').classList.add('hidden');

          await this.loadProjects();
          await this.loadMedia();
          this.showMediaScreen(false);
          
          // Refresh webapp tabs with new token if TabManager exists
          if (this.tabManager) {
            setTimeout(() => this.refreshWebappTabsWithToken(), 500);
          }
        }, 800);
      } else {
        this.authState = 'failed';
        errorEl.textContent = result.error || (window.t ? window.t('auth.googleFailed') : 'Google login failed');
      }
    } catch (error) {
      this.authState = 'failed';
      errorEl.textContent = error.message || (window.t ? window.t('auth.googleFailed') : 'Google login failed');
    }
  }

  togglePassword() {
    const passwordInput = document.getElementById('password');
    const toggleBtn = document.getElementById('toggle-password');
    const eyeIcon = toggleBtn.querySelector('.eye-icon');

    if (passwordInput.type === 'password') {
      passwordInput.type = 'text';
      eyeIcon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
    } else {
      passwordInput.type = 'password';
      eyeIcon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
    }
  }

  // ============================================================================
  // PROJECT SELECTOR - Custom dropdown with search and sort
  // ============================================================================

  initProjectSelector() {
    // State variables are initialized in constructor

    const trigger = document.getElementById('project-dropdown-trigger');
    const content = document.getElementById('project-dropdown-content');
    const searchInput = document.getElementById('project-search-input');
    const sortDateBtn = document.getElementById('project-sort-date');
    const sortNameBtn = document.getElementById('project-sort-name');

    if (!trigger || !content) return;

    // Toggle dropdown
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleProjectDropdown();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (this.projectDropdownOpen && !content.contains(e.target) && !trigger.contains(e.target)) {
        this.closeProjectDropdown();
      }
    });

    // Search input
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.projectSearchTerm = e.target.value;
        this.renderProjectList();
      });

      // Prevent dropdown close when interacting with search
      searchInput.addEventListener('click', (e) => e.stopPropagation());
    }

    // Sort buttons
    if (sortDateBtn) {
      sortDateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setProjectSort('createdAt');
      });
    }

    if (sortNameBtn) {
      sortNameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setProjectSort('name');
      });
    }

    // Update sort button states
    this.updateSortButtonStates();
  }

  toggleProjectDropdown() {
    if (this.projectDropdownOpen) {
      this.closeProjectDropdown();
    } else {
      this.openProjectDropdown();
    }
  }

  openProjectDropdown() {
    const trigger = document.getElementById('project-dropdown-trigger');
    const content = document.getElementById('project-dropdown-content');
    const searchInput = document.getElementById('project-search-input');

    if (!trigger || !content) return;

    this.projectDropdownOpen = true;
    trigger.classList.add('open');
    content.classList.remove('hidden');

    // Focus search input
    if (searchInput) {
      setTimeout(() => searchInput.focus(), 50);
    }
  }

  closeProjectDropdown() {
    const trigger = document.getElementById('project-dropdown-trigger');
    const content = document.getElementById('project-dropdown-content');
    const searchInput = document.getElementById('project-search-input');

    if (!trigger || !content) return;

    this.projectDropdownOpen = false;
    trigger.classList.remove('open');
    content.classList.add('hidden');

    // Clear search
    if (searchInput) {
      searchInput.value = '';
      this.projectSearchTerm = '';
    }
  }

  setProjectSort(sortBy) {
    this.projectSortBy = sortBy;
    localStorage.setItem('kolbo_project_sort', sortBy);
    this.updateSortButtonStates();
    this.renderProjectList();
  }

  updateSortButtonStates() {
    const sortDateBtn = document.getElementById('project-sort-date');
    const sortNameBtn = document.getElementById('project-sort-name');

    if (sortDateBtn) {
      sortDateBtn.classList.toggle('active', this.projectSortBy === 'createdAt');
    }
    if (sortNameBtn) {
      sortNameBtn.classList.toggle('active', this.projectSortBy === 'name');
    }
  }

  getFilteredAndSortedProjects() {
    let filtered = this.projects.filter(project => {
      const name = (project.name || project.title || '').toLowerCase();
      return !project.isArchived && name.includes(this.projectSearchTerm.toLowerCase());
    });

    filtered.sort((a, b) => {
      if (this.projectSortBy === 'name') {
        return (a.name || a.title || '').localeCompare(b.name || b.title || '');
      } else {
        // Sort by createdAt (newest first)
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      }
    });

    return filtered;
  }

  renderProjectList() {
    const projectList = document.getElementById('project-list');
    if (!projectList) return;

    const filteredProjects = this.getFilteredAndSortedProjects();

    // Build HTML
    let html = `
      <div class="project-item ${this.selectedProjectId === 'all' ? 'active' : ''}" data-value="all">
${Icons.get('grid-2x2', 16)}
        <span>All Projects</span>
      </div>
    `;

    if (filteredProjects.length === 0 && this.projectSearchTerm) {
      html += `<div class="project-item-empty">No projects found</div>`;
    } else {
      filteredProjects.forEach(project => {
        const isActive = this.selectedProjectId === project._id;
        const name = project.name || project.title || 'Unnamed Project';
        html += `
          <div class="project-item ${isActive ? 'active' : ''}" data-value="${project._id}">
${Icons.get('folder', 16)}
            <span>${this.escapeHtml(name)}</span>
          </div>
        `;
      });
    }

    projectList.innerHTML = html;

    // Add click handlers
    projectList.querySelectorAll('.project-item').forEach(item => {
      item.addEventListener('click', () => {
        const value = item.dataset.value;
        this.selectProject(value);
      });
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  selectProject(projectId) {
    this.selectedProjectId = projectId;
    localStorage.setItem('kolbo_selected_project', projectId);

    // Update display name
    const selectedNameEl = document.getElementById('project-selected-name');
    if (selectedNameEl) {
      if (projectId === 'all') {
        selectedNameEl.textContent = 'All Projects';
      } else {
        const project = this.projects.find(p => p._id === projectId);
        selectedNameEl.textContent = project ? (project.name || project.title || 'Unnamed Project') : 'All Projects';
      }
    }

    // Update active states in list
    this.renderProjectList();

    // Close dropdown
    this.closeProjectDropdown();

    if (this.DEBUG_MODE) {
      console.log('Project changed to:', this.selectedProjectId);
    }

    // Reset loading states when changing projects
    this.loadingMore = false;
    const loadingMoreEl = this.getElement('loading-more');
    if (loadingMoreEl) loadingMoreEl.classList.add('hidden');

    clearTimeout(this.filterDebounceTimer);
    this.filterDebounceTimer = setTimeout(() => {
      this.loadMedia(true);
    }, this.filterDebounceDelay);
  }

  async loadProjects() {
    try {
      if (this.DEBUG_MODE) {
        console.log('Loading projects...');
      }

      const response = await kolboAPI.getProjects();

      // Handle different response structures
      if (Array.isArray(response)) {
        this.projects = response;
      } else if (response && response.data) {
        this.projects = response.data;
      } else if (response && response.projects) {
        this.projects = response.projects;
      } else {
        this.projects = [];
      }

      // Render the project list in custom dropdown
      this.renderProjectList();

      // Update the selected project name display
      const selectedNameEl = document.getElementById('project-selected-name');
      if (selectedNameEl) {
        if (this.selectedProjectId === 'all') {
        selectedNameEl.textContent = window.t ? window.t('media.allProjects') : 'All Projects';
        } else {
          const project = this.projects.find(p => p._id === this.selectedProjectId);
        selectedNameEl.textContent = project ? (project.name || project.title || (window.t ? window.t('media.unnamedProject') : 'Unnamed Project')) : (window.t ? window.t('media.allProjects') : 'All Projects');
        }
      }

      if (this.DEBUG_MODE) {
        console.log(`Loaded ${this.projects.length} projects`);
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
      if (error.message && error.message.includes('401')) {
        this.handleLogout(true);
      }
    }
  }

  handleProjectChange(e) {
    // Legacy method - now handled by selectProject
    this.selectProject(e.target.value);
  }

  async handleLogout(skipConfirmation = false) {
    // Skip confirmation if this is an automatic logout (triggered by web app session expiry)
    if (!skipConfirmation) {
      const confirmed = await showDialog({
        title: window.t('auth.logoutTitle') || 'Log Out',
        message: window.t('auth.logoutConfirm') || 'Are you sure you want to log out?',
        icon: 'warning',
        confirmLabel: window.t('header.logoutBtn') || 'Log Out',
        cancelLabel: window.t('dialog.cancel') || 'Cancel',
        confirmStyle: 'danger',
      });
      if (!confirmed) return;
    }

    this.cleanup();

    // Destroy TabManager and clean up all iframes/tabs
    if (this.tabManager) {
      this.tabManager.destroy();
      this.tabManager = null;
    }

    // Destroy FileExplorerManager
    if (this.fileExplorerManager) {
      this.fileExplorerManager.destroy();
      this.fileExplorerManager = null;
    }

    kolboAPI.logout();
    this.media = [];
    this.selectedItems.clear();

    // Clear input values before showing login screen
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const errorEl = document.getElementById('login-error');
    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (errorEl) errorEl.textContent = '';

    // Show login screen - this will ensure inputs are interactive
    this.showLoginScreen();
  }

  handleFilter(e) {
    // Use closest() to ensure we get the button element, even if user clicks on SVG/text inside
    const button = e.target.closest('.filter-btn');
    if (!button) return;

    const filterType = button.dataset.type;

    if (this.DEBUG_MODE) {
      console.log('[Filter] Button clicked, filterType:', filterType);
    }

    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');

    const previousFilter = this.currentFilter;
    this.currentFilter = filterType;
    this.currentSubcategory = 'all';

    if (this.DEBUG_MODE) {
      console.log('[Filter] Previous filter:', previousFilter, '-> New filter:', this.currentFilter);
    }

    // CRITICAL: Cancel any in-progress preload operations to prevent request storms
    if (this.preloadAbortController) {
      this.preloadAbortController.abort();
    }
    this.preloadAbortController = new AbortController();

    // Reset loading states when changing filters
    this.loadingMore = false;
    const loadingMoreEl = this.getElement('loading-more');
    if (loadingMoreEl) loadingMoreEl.classList.add('hidden');

    this.updateSubcategoryVisibility(filterType);

    // Reset scroll position to top when changing filters
    const mediaContainer = document.getElementById('media-container');
    if (mediaContainer) {
      mediaContainer.scrollTop = 0;
    }

    // Favorites & Trash require API reload (different endpoints). All other
    // type filters can stay client-side.
    const needsApiReload =
      filterType === 'favorites' || previousFilter === 'favorites' ||
      filterType === 'trash' || previousFilter === 'trash';
    if (needsApiReload) {
      if (this.DEBUG_MODE) console.log('[Filter] API reload for', filterType);
      clearTimeout(this.filterDebounceTimer);
      this.filterDebounceTimer = setTimeout(() => {
        this.loadMedia(true);
      }, this.filterDebounceDelay);
    } else {
      if (this.DEBUG_MODE) {
        console.log('[Filter] Using client-side filtering');
      }
      this.renderMedia();
    }
  }

  updateSubcategoryVisibility(filterType) {
    const subcategoriesContainer = document.getElementById('subcategories');
    const allSubcategoryGroups = document.querySelectorAll('.subcategory-group');

    allSubcategoryGroups.forEach(group => group.classList.add('hidden'));

    if (filterType === 'image' || filterType === 'video' || filterType === 'audio') {
      const groupId = `${filterType}-subcategories`;
      const group = document.getElementById(groupId);
      if (group) {
        group.classList.remove('hidden');
        subcategoriesContainer.classList.remove('hidden');

        group.querySelectorAll('.subcategory-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.subcategory === 'all');
        });
      }
    } else {
      subcategoriesContainer.classList.add('hidden');
    }
  }

  handleSubcategoryFilter(e) {
    const button = e.target.closest('.subcategory-btn');
    if (!button) return;

    const subcategory = button.dataset.subcategory;

    const parentGroup = button.closest('.subcategory-group');
    if (parentGroup) {
      parentGroup.querySelectorAll('.subcategory-btn').forEach(btn => {
        btn.classList.remove('active');
      });
      button.classList.add('active');
    }

    this.currentSubcategory = subcategory;

    // CRITICAL: Cancel any in-progress preload operations to prevent request storms
    if (this.preloadAbortController) {
      this.preloadAbortController.abort();
    }
    this.preloadAbortController = new AbortController();

    // Reset loading states when changing subcategories
    this.loadingMore = false;
    const loadingMoreEl = this.getElement('loading-more');
    if (loadingMoreEl) loadingMoreEl.classList.add('hidden');

    // Reset scroll position to top when changing subcategory
    const mediaContainer = document.getElementById('media-container');
    if (mediaContainer) {
      mediaContainer.scrollTop = 0;
    }

    clearTimeout(this.filterDebounceTimer);
    this.filterDebounceTimer = setTimeout(() => {
      this.loadMedia(true);
    }, this.filterDebounceDelay);
  }

  loadMore() {
    // IMPROVED: Add multiple safety checks before loading
    if (!this.hasMore || this.loadingMore || this.isLoading) {
      if (this.DEBUG_MODE) {
        console.log('[Infinite Scroll] Blocked - hasMore:', this.hasMore, 'loadingMore:', this.loadingMore, 'isLoading:', this.isLoading);
      }
      return;
    }

    // Safety: Check page limit
    if (this.currentPage >= KolboApp.CONSTANTS.MAX_PAGES_LIMIT) {
      console.warn('[Infinite Scroll] Hit page limit safety check:', this.currentPage);
      this.hasMore = false;
      return;
    }

    // IMPROVED: Cooldown period between loads
    const now = Date.now();
    const timeSinceLastLoad = now - this.lastLoadTime;
    if (timeSinceLastLoad < KolboApp.CONSTANTS.INFINITE_SCROLL_COOLDOWN) {
      if (this.DEBUG_MODE) {
        console.log(`[Infinite Scroll] Cooldown active - wait ${KolboApp.CONSTANTS.INFINITE_SCROLL_COOLDOWN - timeSinceLastLoad}ms`);
      }
      return;
    }

    if (this.DEBUG_MODE) {
      console.log('[Infinite Scroll] Loading more items...');
    }

    // Show spinner immediately when scrolling triggers load
    const loadingMoreEl = this.getElement('loading-more');
    if (loadingMoreEl) {
      loadingMoreEl.classList.remove('hidden');
    }

    this.lastLoadTime = now;
    this.loadMedia(false, true);
  }

  async loadMedia(forceRefresh = false, appendToExisting = false) {
    if (this.isLoading || (this.loadingMore && appendToExisting)) return;

    // IMPROVED: Cancel any in-flight media request
    if (this.mediaAbortController) {
      this.mediaAbortController.abort();
    }
    this.mediaAbortController = new AbortController();

    const loadingEl = this.getElement('loading');
    const loadingMoreEl = this.getElement('loading-more');
    const gridEl = this.getElement('media-grid');
    const emptyEl = this.getElement('empty-state');
    const errorEl = this.getElement('error-state');

    if (appendToExisting) {
      this.loadingMore = true;
      if (loadingMoreEl) loadingMoreEl.classList.remove('hidden');

      // IMPROVED: Add visual feedback - dim container during load
      const mediaContainer = this.getElement('media-container');
      if (mediaContainer) {
        mediaContainer.style.pointerEvents = 'none'; // Disable scrolling during load
        mediaContainer.style.opacity = '0.7';
      }

      this.currentPage++;
    } else {
      this.isLoading = true;
      loadingEl.classList.remove('hidden');
      // Hide loading more indicator when doing a fresh load
      if (loadingMoreEl) loadingMoreEl.classList.add('hidden');
      gridEl.innerHTML = '';
      emptyEl.classList.add('hidden');
      errorEl.classList.add('hidden');
      this.currentPage = 1;
      this.media = [];
      // IMPROVED: Reset safety counters on fresh load
      this.emptyResponseCount = 0;
      this.lastLoadTime = 0;
    }

    try {
      // Calculate optimal page size based on viewport (approx 200px per item)
      // Load just enough to fill viewport + small buffer for smooth scrolling
      const viewportHeight = window.innerHeight;
      const itemsPerRow = Math.max(2, Math.floor(window.innerWidth / 220)); // ~220px per item with gap
      const rowsVisible = Math.ceil(viewportHeight / 200); // ~200px per row
      const optimalPageSize = Math.min(KolboApp.CONSTANTS.OPTIMAL_PAGE_SIZE_MAX, Math.max(KolboApp.CONSTANTS.OPTIMAL_PAGE_SIZE_MIN, itemsPerRow * (rowsVisible + 2))); // +2 rows buffer

      const isTrash = this.currentFilter === 'trash';
      const isFavorites = this.currentFilter === 'favorites';

      const params = {
        page: this.currentPage,
        pageSize: optimalPageSize,
        sort: 'created_desc',
        type: (this.currentFilter === 'all' || isFavorites || isTrash) ? 'all' : this.currentFilter,
        projectId: this.selectedProjectId
      };

      // /media/db/all?category=favorites returns full media items (with duration,
      // model badges, etc). The dedicated /favorite-items endpoint drops those fields.
      if (isFavorites) {
        params.category = 'favorites';
      } else if (this.currentSubcategory && this.currentSubcategory !== 'all') {
        params.category = this.currentSubcategory;
      }

      if (this.DEBUG_MODE) {
        console.log('[Media] Viewport-based pageSize:', optimalPageSize, `(${itemsPerRow} cols x ${rowsVisible + 2} rows)`);
        if (this.DEBUG_MODE) {
        console.log('[Media] Loading media with params:', JSON.stringify(params, null, 2));
        }
        if (this.DEBUG_MODE) {
        console.log('[Media] Current filter state:', this.currentFilter);
        }
        if (this.DEBUG_MODE) {
        console.log('[Media] Append to existing:', appendToExisting);
        }
      }

      const response = isTrash
        ? await kolboAPI.getTrash({ page: this.currentPage, pageSize: optimalPageSize })
        : await kolboAPI.getMedia(params);

      if (this.DEBUG_MODE) {
        console.log('[Media] API Response:', {
          responseKeys: Object.keys(response),
          dataKeys: response.data ? Object.keys(response.data) : [],
          itemsLength: response.data?.items?.length || 0,
          pagination: response.data?.pagination
        });
      }

      // Extract items array from response.data.items (API returns {status, data: {items, pagination}})
      const newItems = (response.data && response.data.items) || [];
      const pagination = (response.data && response.data.pagination) || {};

      // /media/db/all doesn't reliably hydrate isFavorited; the favorites tab itself
      // implies every returned item is favorited. Stamp them so the star renders filled.
      if (isFavorites) newItems.forEach(it => { it.isFavorited = true; });

      // IMPROVED: Track empty responses to prevent infinite loops
      if (appendToExisting && newItems.length === 0 && pagination.hasNext) {
        this.emptyResponseCount++;
        if (this.DEBUG_MODE) {
          console.warn(`[Media] Empty response ${this.emptyResponseCount}/${KolboApp.CONSTANTS.MAX_EMPTY_RESPONSES} (hasNext=true but 0 items)`);
        }
        if (this.emptyResponseCount >= KolboApp.CONSTANTS.MAX_EMPTY_RESPONSES) {
          console.warn('[Media] Hit max empty responses - stopping pagination');
          this.hasMore = false;
          if (loadingMoreEl) loadingMoreEl.classList.add('hidden');
          return;
        }
      } else if (newItems.length > 0) {
        // Reset counter on successful load
        this.emptyResponseCount = 0;
      }

      if (appendToExisting) {
        // Append new items, avoiding duplicates
        const existingIds = new Set(this.media.map(item => item.id));
        const uniqueNewItems = newItems.filter(item => !existingIds.has(item.id));
        this.media = [...this.media, ...uniqueNewItems];

        // IMPROVED: Check if we actually added anything (duplicates check)
        if (uniqueNewItems.length === 0 && newItems.length > 0) {
          if (this.DEBUG_MODE) {
            console.warn('[Media] Received duplicate items - all filtered out');
          }
        }
      } else {
        this.media = newItems;
      }

      this.totalItems = pagination.totalItems || this.media.length;
      this.hasMore = pagination.hasNext || false;

      if (this.DEBUG_MODE) {
        console.log(`[Media] Loaded ${newItems.length} new items, total: ${this.media.length}, hasMore: ${this.hasMore}`);
      }

      if (appendToExisting) {
        if (loadingMoreEl) loadingMoreEl.classList.add('hidden');

        // IMPROVED: Restore visual feedback
        const mediaContainer = this.getElement('media-container');
        if (mediaContainer) {
          mediaContainer.style.pointerEvents = 'auto';
          mediaContainer.style.opacity = '1';
        }

        this.renderMedia();
        this.setupInfiniteScroll();
      } else {
        loadingEl.classList.add('hidden');
        if (this.media.length === 0) {
          emptyEl.classList.remove('hidden');
        } else {
          this.renderMedia();
          this.setupInfiniteScroll();
        }
      }
    } catch (error) {
      console.error('Failed to load media:', error);

      if (error.message && error.message.includes('401')) {
        this.handleLogout(true); // skip confirmation dialog; also clears token via kolboAPI.logout()
        return;
      }

      if (appendToExisting) {
        if (loadingMoreEl) loadingMoreEl.classList.add('hidden');

        // IMPROVED: Restore visual state on error
        const mediaContainer = this.getElement('media-container');
        if (mediaContainer) {
          mediaContainer.style.pointerEvents = 'auto';
          mediaContainer.style.opacity = '1';
        }
      } else {
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
      }
    } finally {
      this.isLoading = false;
      this.loadingMore = false;
    }
  }

  setupInfiniteScroll() {
    // IMPROVED: Create observer with debounced callback
    if (!this.observer) {
      this.observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && !this.loadingMore && !this.isLoading) {
            // IMPROVED: Debounce the trigger to prevent rapid-fire loads during fast scrolling
            clearTimeout(this.scrollDebounceTimer);
            this.scrollDebounceTimer = setTimeout(() => {
              if (this.DEBUG_MODE) {
                console.log('[Infinite Scroll] Trigger visible (debounced), loading more...');
              }
              this.loadMore();
            }, KolboApp.CONSTANTS.INFINITE_SCROLL_DEBOUNCE);
          }
        },
        {
          rootMargin: KolboApp.CONSTANTS.INFINITE_SCROLL_ROOT_MARGIN,
          threshold: 0.1  // Only trigger when at least 10% visible
        }
      );
    }

    // Only observe if there are more items
    if (!this.hasMore) {
      if (this.observer) {
        this.observer.disconnect();
      }
      if (this.DEBUG_MODE) {
        console.log('[Infinite Scroll] No more items to load');
      }
      return;
    }

    const trigger = this.getElement('load-more-trigger');
    if (!trigger) {
      if (this.DEBUG_MODE) {
        console.warn('[Infinite Scroll] Trigger element not found');
      }
      return;
    }

    // Disconnect from previous trigger if any
    this.observer.disconnect();
    // Observe new trigger
    this.observer.observe(trigger);

    if (this.DEBUG_MODE) {
      console.log('[Infinite Scroll] Observer setup complete with debouncing');
    }
  }

  renderMedia(forceRender = false) {
    const gridEl = this.getElement('media-grid');
    if (!gridEl) return;

    // PERFORMANCE FIX: Only rebuild DOM if we're loading new data or forcing a render
    // For filters, just toggle CSS classes - instant performance!
    const needsRebuild = forceRender || gridEl.children.length === 0 ||
                         gridEl.children.length !== this.media.length;

    if (needsRebuild) {
      // Full render - only when loading new data
      if (this.DEBUG_MODE) {
        console.log('[Render] Full DOM rebuild:', this.media.length, 'items');
      }
      gridEl.innerHTML = this.media.map(item => this.renderMediaItem(item)).join('');

      // Setup selection listeners
      this.setupMediaItemListeners();
      this.updateBatchMenu();

      // Preload thumbnails for visible items only (first 30)
      this.preloadAllThumbnails(this.media.slice(0, 30));

      // Start IntersectionObserver lazy loading for all thumbnail images
      this.setupLazyImageLoading();

      // Preload first 20 items to cache for drag-and-drop
      this.preloadVisibleMediaToCache(this.media.slice(0, 20));
    }

    // Apply CSS filter - instant, no DOM changes!
    this.applyFilter();
  }

  setupLazyImageLoading() {
    const lazyImages = document.querySelectorAll('.media-img-lazy[data-src]:not([data-loaded])');
    if (!lazyImages.length) return;

    if (this.lazyImgObserver) this.lazyImgObserver.disconnect();

    this.lazyImgObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        if (img.dataset.loaded) return; // already loaded by cache preloader
        img.dataset.loaded = '1';
        this.lazyImgObserver.unobserve(img);

        img.style.opacity = '0';
        img.onload = () => { img.style.opacity = '1'; };
        img.onerror = () => {
          // retry once with cache-bust
          const sep = img.dataset.src.includes('?') ? '&' : '?';
          const retryUrl = `${img.dataset.src}${sep}_cb=${Date.now()}`;
          img.onerror = () => { img.style.opacity = '1'; }; // give up on 2nd fail
          img.src = retryUrl;
        };
        img.src = img.dataset.src;
      });
    }, { rootMargin: '200px' });

    lazyImages.forEach(img => this.lazyImgObserver.observe(img));
  }

  applyFilter() {
    const gridEl = this.getElement('media-grid');
    if (!gridEl) return;

    // Set data-filter attribute for CSS-based filtering
    const filterValue = this.currentFilter || 'all';
    gridEl.setAttribute('data-filter', filterValue);

    // Count visible items based on current filter
    let filtered = this.media;
    if (this.currentFilter !== 'all' && this.currentFilter !== 'favorites' && this.currentFilter !== 'trash') {
      filtered = this.media.filter(item => item.type === this.currentFilter);
    }

    // Update count
    const countEl = document.getElementById('media-count');
    if (countEl) {
      countEl.textContent = window.t ? window.t('media.itemsCount', { count: filtered.length }) : `${filtered.length} items`;
    }

    if (this.DEBUG_MODE) {
      console.log('[Filter] CSS filter applied:', filterValue, '-', filtered.length, 'visible items');
    }
  }

  async preloadVisibleMediaToCache(items) {
    if (!items || items.length === 0) return;

    // Check if operation was cancelled before starting
    if (this.preloadAbortController?.signal.aborted) return;

    if (this.DEBUG_MODE) {
    console.log(`[Cache] Preloading ${items.length} visible items...`);
    }

    // Prepare items for cache
    const cacheItems = items.map(item => {
      const fileName = this.getFileName(item);
      return {
        id: item.id,
        fileName,
        url: item.url,
        type: item.type
      };
    });

    try {
      // Start preloading (fire and forget)
      window.kolboDesktop.preloadCache(cacheItems).then(result => {
        // Check if cancelled before processing result
        if (this.preloadAbortController?.signal.aborted) return;

        if (result.success) {
          if (this.DEBUG_MODE) {
          console.log(`[Cache] Preloaded ${result.successful}/${result.total} items`);
          }

          // Update cache status indicators for successfully cached items
          this.updateCacheStatusIndicators(items);
        }
      });
    } catch (error) {
      console.error('[Cache] Preload error:', error);
    }
  }

  async updateCacheStatusIndicators(items) {
    // Initialize dragCacheStatus map if not exists
    this.dragCacheStatus = this.dragCacheStatus || new Map();

    // Check if operation was cancelled
    if (this.preloadAbortController?.signal.aborted) return;

    // FIXED: Use Promise.all instead of sequential awaits to prevent request storms
    const results = await Promise.all(
      items.map(item =>
        window.kolboDesktop.getCachedFilePath(item.id)
          .then(result => ({ id: item.id, result }))
          .catch(() => ({ id: item.id, result: null }))
      )
    );

    // Check again after async operation
    if (this.preloadAbortController?.signal.aborted) return;

    // Process all results
    for (const { id, result } of results) {
      if (result?.cached && result?.filePath) {
        // Update cache status map for drag-and-drop
        this.dragCacheStatus.set(id, result.filePath);

        // Show visual indicator
        const cacheItemEl = document.querySelector(`.media-item[data-id="${id}"]`);
        if (cacheItemEl) {
          this.showCacheReady(cacheItemEl);
        }
      }
    }
  }

  async preloadAllThumbnails(items) {
    if (!items || items.length === 0) return;
    if (!window.kolboDesktop || !window.kolboDesktop.preloadThumbnails) return;

    // Check if operation was cancelled before starting
    if (this.preloadAbortController?.signal.aborted) return;

    if (this.DEBUG_MODE) {
    console.log(`[ThumbnailCache] Preloading ${items.length} thumbnails...`);
    }

    // Prepare thumbnail items for cache
    const thumbnailItems = items
      .filter(item => {
        const url = item.thumbnail_url || item.thumbnailUrl;
        return url && KolboApp.CONSTANTS.IMAGE_URL_REGEX.test(url);
      })
      .map(item => ({
        id: item.id,
        thumbnailUrl: item.thumbnail_url || item.thumbnailUrl
      }));

    if (thumbnailItems.length === 0) {
      if (this.DEBUG_MODE) {
      console.log('[ThumbnailCache] No thumbnails to preload');
      }
      return;
    }

    try {
      // Start thumbnail preloading (fire and forget)
      window.kolboDesktop.preloadThumbnails(thumbnailItems).then(result => {
        // Check if cancelled before processing result
        if (this.preloadAbortController?.signal.aborted) return;

        if (result.success) {
          if (this.DEBUG_MODE) {
          console.log(`[ThumbnailCache] Preloaded ${result.successful}/${result.total} thumbnails`);
          }

          // Update all thumbnail images to use cached paths
          this.updateThumbnailsWithCachedPaths(items);
        }
      });
    } catch (error) {
      console.error('[ThumbnailCache] Preload error:', error);
    }
  }

  async updateThumbnailsWithCachedPaths(items) {
    if (!window.kolboDesktop || !window.kolboDesktop.getCachedThumbnailPath) return;

    // Check if operation was cancelled
    if (this.preloadAbortController?.signal.aborted) return;

    // FIXED: Use Promise.all instead of sequential awaits to prevent request storms
    const results = await Promise.all(
      items.map(item =>
        window.kolboDesktop.getCachedThumbnailPath(item.id)
          .then(result => ({ id: item.id, result }))
          .catch(() => ({ id: item.id, result: null }))
      )
    );

    // Check again after async operation
    if (this.preloadAbortController?.signal.aborted) return;

    // Process all results
    for (const { id, result } of results) {
      if (result?.cached && result?.filePath) {
        // Update image src to use file:// protocol for cached thumbnail
        const imgEl = document.querySelector(`[data-id="${id}"] img`);
        if (imgEl) {
          const cachedUrl = `file://${result.filePath.replace(/\\/g, '/')}`;
          imgEl.dataset.loaded = '1'; // prevent lazy observer from overriding
          imgEl.src = cachedUrl;
          imgEl.style.opacity = '1';
          if (this.DEBUG_MODE) {
          console.log(`[ThumbnailCache] Updated thumbnail for ${id}`);
          }
        }
      }
    }
  }

  isFavorited(item) {
    return Boolean(item.isFavorited || item.is_favorited || item.metadata?.isFavorited);
  }

  renderItemActions(item) {
    if (this.currentFilter === 'trash') {
      return `
        <div class="media-item-actions">
          <button class="item-action-btn btn-restore" data-action="restore" data-id="${item.id}" title="${tr('media.actions.restore', 'Restore')}">
            ${Icons.get('undo-2', 16)}
          </button>
          <button class="item-action-btn btn-delete-forever" data-action="permanent-delete" data-id="${item.id}" title="${tr('media.actions.deleteForever', 'Delete forever')}">
            ${Icons.get('x', 16)}
          </button>
        </div>
      `;
    }
    const fav = this.isFavorited(item);
    const favTitle = fav ? tr('media.actions.unfavorite', 'Unfavorite') : tr('media.actions.favorite', 'Favorite');
    return `
      <div class="media-item-actions">
        <button class="item-action-btn btn-favorite ${fav ? 'is-favorited' : ''}" data-action="favorite" data-id="${item.id}" title="${favTitle}">
          ${Icons.get('star', 16)}
        </button>
        <button class="item-action-btn btn-delete" data-action="delete" data-id="${item.id}" title="${tr('media.actions.delete', 'Move to Trash')}">
          ${Icons.get('trash-2', 16)}
        </button>
      </div>
    `;
  }

  renderMediaItem(item) {
    const fileName = this.getFileName(item);
    const title = item.title || fileName;
    const duration = item.duration ? this.formatDuration(item.duration) : '';
    const category = item.metadata?.category || item.category || 'audio';

    // Audio cards have special layout
    if (item.type === 'audio') {
      return this.renderAudioItem(item, fileName, title, category);
    }

    // Video cards
    if (item.type === 'video') {
      return this.renderVideoItem(item, fileName, title, duration);
    }

    // Image cards (default)
    const isSelected = this.selectedItems.has(item.id);
    return `
      <div class="media-item media-item-image ${isSelected ? 'selected' : ''}" data-id="${item.id}" draggable="true" data-filename="${fileName}" data-url="${item.url}" data-type="${item.type}">
        <div class="selection-checkbox ${isSelected ? 'checked' : ''}" data-id="${item.id}"></div>
        <div class="cache-status" data-id="${item.id}" style="display: none;">
          <div class="cache-spinner"></div>
${Icons.get('check', 16)}
        </div>
        ${this.renderItemActions(item)}
        <div class="media-preview">
          <img data-src="${item.thumbnail_url || item.url}" alt="${title}" decoding="async" class="media-img-lazy">
          <span class="type-badge type-badge-image">Image</span>
        </div>
        <div class="overlay">
          <div class="media-title" title="${title}">${title}</div>
        </div>
      </div>
    `;
  }

  renderVideoItem(item, fileName, title, duration) {
    const isSelected = this.selectedItems.has(item.id);
    const isPlaying = this.playingVideoId === item.id;
    const rawThumb = item.thumbnail_url || item.thumbnailUrl || '';
    const isImageThumb = rawThumb && KolboApp.CONSTANTS.IMAGE_URL_REGEX.test(rawThumb);
    const thumbnailUrl = isImageThumb ? rawThumb : '';

    return `
      <div class="media-item media-item-video ${isSelected ? 'selected' : ''} ${isPlaying ? 'playing' : ''}" data-id="${item.id}" draggable="true" data-filename="${fileName}" data-url="${item.url}" data-type="${item.type}">
        <div class="selection-checkbox ${isSelected ? 'checked' : ''}" data-id="${item.id}"></div>
        <div class="cache-status" data-id="${item.id}" style="display: none;">
          <div class="cache-spinner"></div>
${Icons.get('check', 16)}
        </div>
        ${this.renderItemActions(item)}
        <div class="media-preview">
          ${thumbnailUrl ? `<img data-src="${thumbnailUrl}" alt="${title}" decoding="async" class="media-img-lazy video-thumb-img">` : '<div class="video-thumb-img" style="width:100%;height:100%"></div>'}
          <button class="video-play-btn ${isPlaying ? 'playing' : ''}" data-id="${item.id}">
            ${isPlaying ? Icons.get('pause', 22, 2) : Icons.get('play', 22, 2)}
          </button>
          <div class="video-playbar" data-id="${item.id}">
            <div class="video-progress-container" data-id="${item.id}">
              <div class="video-progress-fill" data-id="${item.id}"></div>
            </div>
            <div class="video-time-display" data-id="${item.id}">0:00 / ${duration || '--:--'}</div>
          </div>
          <span class="type-badge type-badge-video">Video</span>
        </div>
        <div class="overlay">
          <div class="media-title" title="${title}">${title}</div>
        </div>
      </div>
    `;
  }

  renderAudioItem(item, fileName, title, category) {
    const audioUrl = item.url || item.audio_url || '';
    const isSelected = this.selectedItems.has(item.id);

    // Determine category badge styling
    const categoryLower = (category || 'audio').toLowerCase();
    let categoryClass = 'category-other';
    let categoryLabel = category || 'Audio';

    if (categoryLower.includes('music') || categoryLower.includes('suno')) {
      categoryClass = 'category-music';
      categoryLabel = 'Music';
    } else if (categoryLower.includes('tts') || categoryLower.includes('speech') || categoryLower.includes('voice')) {
      categoryClass = 'category-tts';
      categoryLabel = 'TTS';
    } else if (categoryLower.includes('sound') || categoryLower.includes('effect') || categoryLower.includes('sfx')) {
      categoryClass = 'category-sfx';
      categoryLabel = 'SFX';
    }

    // Generate random waveform bars for visual appeal
    const waveformBars = this.generateWaveformBars(32);

    return `
      <div class="media-item media-item-audio ${isSelected ? 'selected' : ''}" data-id="${item.id}" draggable="true" data-filename="${fileName}" data-url="${item.url}" data-type="${item.type}">
        <div class="selection-checkbox ${isSelected ? 'checked' : ''}" data-id="${item.id}"></div>
        <div class="cache-status" data-id="${item.id}" style="display: none;">
          <div class="cache-spinner"></div>
${Icons.get('check', 16)}
        </div>
        ${this.renderItemActions(item)}
        <div class="audio-card">
          <div class="audio-card-header">
            <span class="audio-category-badge ${categoryClass}">${categoryLabel}</span>
          </div>
          <div class="audio-title" title="${title}">${title}</div>
          <div class="audio-waveform-container">
            <div class="audio-waveform" data-id="${item.id}">
              ${waveformBars}
              <div class="waveform-progress" data-id="${item.id}"></div>
            </div>
          </div>
          <div class="audio-controls">
            <button class="audio-play-btn" data-id="${item.id}" data-url="${audioUrl}">
<span class="play-icon">${Icons.get('play', 16)}</span>
              <span class="pause-icon" style="display: none;">${Icons.get('pause', 16)}</span>
            </button>
            <div class="audio-time">
              <span class="audio-current-time" data-id="${item.id}">0:00</span>
              <span class="audio-separator">/</span>
              <span class="audio-duration" data-id="${item.id}">--:--</span>
            </div>
          </div>
          <audio class="audio-element" data-id="${item.id}" preload="metadata">
            <source src="${audioUrl}" type="audio/mpeg">
          </audio>
        </div>
      </div>
    `;
  }

  generateWaveformBars(count) {
    // Generate pseudo-random but consistent waveform pattern
    const bars = [];
    for (let i = 0; i < count; i++) {
      // Create a wave pattern with some randomness
      const baseHeight = Math.sin((i / count) * Math.PI) * 60 + 20;
      const variance = Math.sin(i * 0.5) * 15 + Math.cos(i * 0.8) * 10;
      const height = Math.max(15, Math.min(95, baseHeight + variance));
      bars.push(`<div class="waveform-bar" style="height: ${height}%"></div>`);
    }
    return bars.join('');
  }

  getFileName(item) {
    let fileName;
    if (item.filename) {
      fileName = item.filename;
    } else {
      try {
        const url = new URL(item.url);
        const pathname = url.pathname;
        const parts = pathname.split('/');
        fileName = parts[parts.length - 1] || `${item.id}.${item.type === 'video' ? 'mp4' : 'png'}`;
      } catch (e) {
        fileName = `${item.id}.${item.type === 'video' ? 'mp4' : 'png'}`;
      }
    }
    return fileName;
  }

  formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  setupMediaItemListeners() {
    const gridEl = document.getElementById('media-grid');
    if (!gridEl) return;

    // Use event delegation for better performance
    // Remove old listeners if they exist
    const oldHandler = gridEl._clickHandler;
    if (oldHandler) {
      gridEl.removeEventListener('click', oldHandler);
    }

    const oldContextHandler = gridEl._contextmenuHandler;
    if (oldContextHandler) {
      gridEl.removeEventListener('contextmenu', oldContextHandler);
    }

    const oldMousedownHandler = gridEl._progressMousedownHandler;
    if (oldMousedownHandler) {
      gridEl.removeEventListener('mousedown', oldMousedownHandler);
    }

    // Mousedown on progress bar -> drag-to-scrub. Also blocks native file-drag
    // from starting on the playbar (which is inside a draggable media-item).
    const progressMousedownHandler = (e) => {
      if (e.button !== 0) return;
      const progressContainer = e.target.closest('.video-progress-container');
      if (!progressContainer) return;

      e.preventDefault();
      e.stopPropagation();
      const videoId = progressContainer.dataset.id;

      this.handleVideoSeek(e, videoId);

      const onMove = (ev) => {
        this.handleVideoSeek(ev, videoId);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
    gridEl.addEventListener('mousedown', progressMousedownHandler);
    gridEl._progressMousedownHandler = progressMousedownHandler;

    // Create new click handler
    const clickHandler = (e) => {
      // Check if click is on video playbar area (priority - for seeking)
      const playbar = e.target.closest('.video-playbar');
      if (playbar) {
        e.stopPropagation();
        e.preventDefault();
        const videoId = playbar.dataset.id;
        // Only seek if clicking on the progress container
        const progressContainer = e.target.closest('.video-progress-container');
        if (progressContainer) {
          this.handleVideoSeek(e, videoId);
        }
        return;
      }

      // Check if click is on a play button first (priority)
      const playBtn = e.target.closest('.video-play-btn, .audio-play-btn');
      if (playBtn) {
        e.stopPropagation();
        if (playBtn.classList.contains('video-play-btn')) {
          this.handleVideoPlayPause(playBtn.dataset.id);
        }
        // Audio play button handling can be added here if needed
        return;
      }

      // Check if click is on a per-item action button (star / delete / restore)
      const actionBtn = e.target.closest('.item-action-btn');
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.dataset.action;
        const itemId = actionBtn.dataset.id;
        if (action === 'favorite') this.toggleFavorite(itemId);
        else if (action === 'delete') this.deleteItem(itemId);
        else if (action === 'restore') this.restoreItem(itemId);
        else if (action === 'permanent-delete') this.permanentDeleteItem(itemId);
        return;
      }

      // Check if click is on the checkbox
      const checkbox = e.target.closest('.selection-checkbox');
      if (checkbox) {
        e.stopPropagation();
        const itemId = checkbox.closest('.media-item').dataset.id;
        if (e.shiftKey && this.lastSelectedItemId) {
          this.selectRange(this.lastSelectedItemId, itemId);
        } else {
          this.toggleSelection(itemId);
        }
        return;
      }

      // Direct click on media item (anywhere except play buttons)
      const mediaItem = e.target.closest('.media-item');
      if (mediaItem) {
        e.stopPropagation();
        const itemId = mediaItem.dataset.id;
        if (e.shiftKey && this.lastSelectedItemId) {
          this.selectRange(this.lastSelectedItemId, itemId);
        } else {
          this.toggleSelection(itemId);
        }
      }
    };

    // Create context menu handler
    const contextmenuHandler = (e) => {
      const mediaItem = e.target.closest('.media-item');
      if (mediaItem) {
        const mediaId = mediaItem.dataset.id;

        // Auto-select the item if not already selected
        if (!this.selectedItems.has(mediaId)) {
          this.toggleSelection(mediaId);
        }

        if (this.contextMenuManager) {
          this.contextMenuManager.showMediaItemContextMenu(e, mediaId);
        }
      }
    };

    gridEl._clickHandler = clickHandler;
    gridEl._contextmenuHandler = contextmenuHandler;
    gridEl.addEventListener('click', clickHandler);
    gridEl.addEventListener('contextmenu', contextmenuHandler);

    // Add drag-and-drop handlers
    this.setupDragAndDrop(gridEl);

    // Add video playbar listeners for progress and seeking
    this.setupVideoPlaybackListeners();

    // Add audio playback listeners to ensure only one media plays at a time
    this.setupAudioPlaybackListeners();
  }

  setupDragAndDrop(gridEl) {
    // Remove old listeners if they exist
    if (gridEl._dragstartHandler) {
      gridEl.removeEventListener('dragstart', gridEl._dragstartHandler);
    }
    if (gridEl._dragendHandler) {
      gridEl.removeEventListener('dragend', gridEl._dragendHandler);
    }
    if (gridEl._dragoverHandler) {
      gridEl.removeEventListener('dragover', gridEl._dragoverHandler);
    }

    // Cache check map - populated by mouseover events
    this.dragCacheStatus = this.dragCacheStatus || new Map();

    // Mouseover handler - preload cache status on hover
    const mouseoverHandler = (e) => {
      const mediaItem = e.target.closest('.media-item[draggable="true"]');
      if (!mediaItem) return;

      const mediaId = mediaItem.dataset.id;

      // Check if we already know the cache status
      if (this.dragCacheStatus.has(mediaId)) return;

      // Check cache status asynchronously
      window.kolboDesktop.getCachedFilePath(mediaId).then(result => {
        this.dragCacheStatus.set(mediaId, result.cached ? result.filePath : null);
      });
    };

    // Dragstart handler - MUST be synchronous
    const dragstartHandler = (e) => {
      // Don't initiate file drag when interacting with the inline playbar / play button
      if (e.target.closest('.video-playbar, .video-play-btn, .audio-play-btn')) {
        e.preventDefault();
        return;
      }

      const mediaItem = e.target.closest('.media-item[draggable="true"]');
      if (!mediaItem) return;

      const mediaId = mediaItem.dataset.id;

      // Check if dragging a selected item - if so, drag ALL selected items
      let filesToDrag = [];
      let elementsBeingDragged = [];

      if (this.selectedItems.has(mediaId)) {
        // Dragging a selected item - collect ALL selected items
        if (this.DEBUG_MODE) {
        console.log('[Drag] Dragging', this.selectedItems.size, 'selected items');
        }

        const allMediaItems = e.currentTarget.querySelectorAll('.media-item[draggable="true"]');

        // Block drag if any selected item is still downloading
        let anyLoading = false;
        allMediaItems.forEach(item => {
          if (this.selectedItems.has(item.dataset.id) && this.isCacheLoading(item)) {
            anyLoading = true;
          }
        });

        if (anyLoading) {
          e.preventDefault();
          e.stopPropagation();
          this.showToast('Please wait — files are still downloading...', 'info');
          if (this.DEBUG_MODE) {
          console.log('[Drag] Blocked: some selected items still downloading');
          }
          return;
        }

        allMediaItems.forEach(item => {
          const id = item.dataset.id;
          if (this.selectedItems.has(id)) {
            const cachedPath = this.dragCacheStatus.get(id);
            if (cachedPath) {
              filesToDrag.push(cachedPath);
              elementsBeingDragged.push(item);
            } else {
              if (this.DEBUG_MODE) {
              console.log('[Drag] Selected item not cached:', id);
              }
            }
          }
        });
      } else {
        // Dragging a single non-selected item
        const cachedPath = this.dragCacheStatus.get(mediaId);
        if (cachedPath) {
          filesToDrag.push(cachedPath);
          elementsBeingDragged.push(mediaItem);
        }
      }

      if (this.DEBUG_MODE) {
      console.log('[Drag] Starting drag for', filesToDrag.length, 'file(s)');
      }

      if (filesToDrag.length > 0) {
        // Files are cached - start native drag
        e.preventDefault();

        if (this.DEBUG_MODE) {
        console.log('[Drag] Files cached, starting native drag:', filesToDrag);
        }

        // Create custom drag image
        this.setCustomDragImage(e, elementsBeingDragged, mediaItem);

        // Start Electron native drag (will use 'file' or 'files' based on count)
        window.kolboDesktop.startFileDrag(filesToDrag);

        // Set opacity on all dragged items
        elementsBeingDragged.forEach(item => {
          item.style.opacity = '0.5';
        });

        if (this.DEBUG_MODE) {
        console.log('[Drag] Native drag started for', filesToDrag.length, 'file(s)');
        }

        // Clear batch selection after drag starts
        // Note: dragend event doesn't fire reliably with Electron native drags
        // So we clear the selection after a short delay to ensure drag has initiated
        setTimeout(() => {
          // Reset opacity
          elementsBeingDragged.forEach(item => {
            item.style.opacity = '1';
          });

          // Clear batch selection
          this.handleBatchClear();
          if (this.DEBUG_MODE) {
            console.log('[Drag] Batch selection cleared after native drag started');
          }
        }, 150);
      } else {
        // File not cached - prevent drag and download in background
        if (this.DEBUG_MODE) {
        console.log('[Drag] File not cached - preventing drag');
        }
        e.preventDefault();
        e.stopPropagation();

        // Start download in background (no popup)
        const fileName = mediaItem.dataset.filename;
        const url = mediaItem.dataset.url;
        const type = mediaItem.dataset.type;

        this.showCacheSpinner(mediaItem);
        window.kolboDesktop.preloadCache([{
          id: mediaId,
          fileName,
          url,
          type
        }]).then(result => {
          if (result.success && result.successful > 0) {
            // Update cache status
            window.kolboDesktop.getCachedFilePath(mediaId).then(cacheResult => {
              if (cacheResult.cached) {
                this.dragCacheStatus.set(mediaId, cacheResult.filePath);
                this.showCacheReady(mediaItem);
                if (this.DEBUG_MODE) {
                console.log('[Drag] File downloaded and ready for next drag');
                }
              }
            });
          }
        }).catch(error => {
          console.error('[Drag] Download error:', error);
          const cacheStatus = mediaItem.querySelector('.cache-status');
          if (cacheStatus) cacheStatus.style.display = 'none';
        });
      }
    };

    const dragendHandler = (e) => {
      // Reset opacity for all items (in case multiple were being dragged)
      const allMediaItems = e.currentTarget.querySelectorAll('.media-item[draggable="true"]');
      allMediaItems.forEach(item => {
        item.style.opacity = '1';
      });

      // Clear batch selection after drag completes to avoid confusion
      // User has completed the drag action, so selection is no longer needed
      this.handleBatchClear();
      if (this.DEBUG_MODE) {
        console.log('[Drag] Batch selection cleared after drag operation');
      }
    };

    gridEl._dragstartHandler = dragstartHandler;
    gridEl._dragendHandler = dragendHandler;
    gridEl._mouseoverHandler = mouseoverHandler;

    gridEl.addEventListener('dragstart', dragstartHandler);
    gridEl.addEventListener('dragend', dragendHandler);
    gridEl.addEventListener('mouseover', mouseoverHandler);

    if (this.DEBUG_MODE) {
    console.log('[Drag] Drag-and-drop handlers initialized');
    }
  }

  setCustomDragImage(e, elementsBeingDragged, primaryItem) {
    try {
      const count = elementsBeingDragged.length;

      // Create custom drag preview
      const dragPreview = document.createElement('div');
      dragPreview.style.cssText = `
        position: absolute;
        top: -9999px;
        left: -9999px;
        width: 200px;
        padding: 12px;
        background: rgba(20, 20, 20, 0.95);
        border-radius: 8px;
        border: 2px solid rgba(102, 126, 234, 0.5);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        pointer-events: none;
      `;

      // Get thumbnail from the primary item
      const thumbnail = primaryItem.querySelector('img, video');

      if (thumbnail) {
        const thumbClone = document.createElement('img');
        thumbClone.src = thumbnail.src || thumbnail.poster || thumbnail.currentSrc;
        thumbClone.style.cssText = `
          width: 100%;
          height: 120px;
          object-fit: cover;
          border-radius: 6px;
          margin-bottom: ${count > 1 ? '8px' : '0'};
        `;
        dragPreview.appendChild(thumbClone);
      }

      // Add count badge if multiple items
      if (count > 1) {
        const badge = document.createElement('div');
          badge.textContent = window.t ? window.t('media.itemsCount', { count: count }) : `${count} items`;
        badge.style.cssText = `
          color: white;
          font-size: 13px;
          font-weight: 600;
          text-align: center;
          padding: 6px;
          background: rgba(102, 126, 234, 0.8);
          border-radius: 6px;
        `;
        dragPreview.appendChild(badge);
      }

      document.body.appendChild(dragPreview);

      // Set as drag image
      if (e.dataTransfer && e.dataTransfer.setDragImage) {
        e.dataTransfer.setDragImage(dragPreview, 100, 60);
      }

      // Clean up after a delay
      setTimeout(() => {
        if (dragPreview && dragPreview.parentNode) {
          dragPreview.parentNode.removeChild(dragPreview);
        }
      }, 100);
    } catch (error) {
      if (this.DEBUG_MODE) {
      console.warn('[Drag] Failed to set custom drag image:', error);
      }
    }
  }

  handleVideoPlayPause(videoId) {
    let video = document.getElementById(`video-${videoId}`);
    const button = document.querySelector(`.video-play-btn[data-id="${videoId}"]`);
    const mediaItem = document.querySelector(`.media-item-video[data-id="${videoId}"]`);
    if (!button) return;

    // Lazy-inject video element on first play (replaces thumbnail img)
    if (!video) {
      const item = this.media.find(m => m.id === videoId);
      if (!item) return;
      const thumbImg = mediaItem && mediaItem.querySelector('.video-thumb-img');
      video = document.createElement('video');
      video.id = `video-${videoId}`;
      video.src = item.url || item.video_url;
      video.muted = false;
      video.loop = true;
      video.className = 'video-preview';
      video.addEventListener('loadedmetadata', () => { video.currentTime = 0; });
      if (thumbImg) {
        thumbImg.replaceWith(video);
      } else if (mediaItem) {
        const preview = mediaItem.querySelector('.media-preview');
        if (preview) preview.prepend(video);
      }
      // Wire progress/time listeners for this card only — avoids O(n) full-grid scan
      if (mediaItem) this.setupSingleVideoListeners(videoId, video, mediaItem);
    }

    // Pause any playing audio first and reset its UI
    if (this.playingAudioElement) {
      this.playingAudioElement.pause();
      if (this.playingAudioId) {
        this.updateAudioUI(this.playingAudioId, false);
      }
      this.playingAudioElement = null;
      this.playingAudioId = null;
    }

    // Pause currently playing video if different
    if (this.playingVideoId && this.playingVideoId !== videoId) {
      const currentVideo = document.getElementById(`video-${this.playingVideoId}`);
      const currentButton = document.querySelector(`.video-play-btn[data-id="${this.playingVideoId}"]`);
      const currentMediaItem = document.querySelector(`.media-item-video[data-id="${this.playingVideoId}"]`);
      if (currentVideo) {
        currentVideo.pause();
        currentVideo.muted = true;
      }
      if (currentButton) {
        currentButton.classList.remove('playing');
        currentButton.innerHTML = Icons.get('play', 22, 2);
      }
      if (currentMediaItem) {
        currentMediaItem.classList.remove('playing');
      }
    }

    // Toggle play/pause
    if (this.playingVideoId === videoId) {
      video.pause();
      video.muted = true;
      this.playingVideoId = null;
      button.classList.remove('playing');
      if (mediaItem) mediaItem.classList.remove('playing');
      button.innerHTML = Icons.get('play', 22, 2);
    } else {
      video.muted = false;
      video.play();
      this.playingVideoId = videoId;
      button.classList.add('playing');
      if (mediaItem) mediaItem.classList.add('playing');
      button.innerHTML = Icons.get('pause', 22, 2);
    }
  }

  handleVideoSeek(e, videoId) {
    const video = document.getElementById(`video-${videoId}`);
    const progressContainer = document.querySelector(`.video-progress-container[data-id="${videoId}"]`);
    if (!video || !progressContainer) return;

    const rect = progressContainer.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const progress = Math.max(0, Math.min(1, clickX / rect.width));

    if (video.duration) {
      video.currentTime = progress * video.duration;
    }

    // If not playing, start playback
    if (video.paused) {
      this.handleVideoPlayPause(videoId);
    }
  }

  setupVideoPlaybackListeners() {
    document.querySelectorAll('.media-item-video').forEach(card => {
      const video = card.querySelector('.video-preview');
      if (!video) return;
      this.setupSingleVideoListeners(card.dataset.id, video, card);
    });
  }

  setupSingleVideoListeners(videoId, video, card) {
    const progressFill = card.querySelector('.video-progress-fill');
    const timeDisplay = card.querySelector('.video-time-display');
    const progressContainer = card.querySelector('.video-progress-container');

    if (!progressFill || !timeDisplay) return;

    if (video._timeUpdateHandler) {
      video.removeEventListener('timeupdate', video._timeUpdateHandler);
    }
    if (video._loadedHandler) {
      video.removeEventListener('loadedmetadata', video._loadedHandler);
    }
    if (video._endedHandler) {
      video.removeEventListener('ended', video._endedHandler);
    }

    const timeUpdateHandler = () => {
      if (video.duration) {
        const progress = (video.currentTime / video.duration) * 100;
        progressFill.style.width = `${progress}%`;
        timeDisplay.textContent = `${this.formatVideoTime(video.currentTime)} / ${this.formatVideoTime(video.duration)}`;
      }
    };
    video._timeUpdateHandler = timeUpdateHandler;
    video.addEventListener('timeupdate', timeUpdateHandler);

    const loadedHandler = () => {
      if (video.duration) {
        timeDisplay.textContent = `0:00 / ${this.formatVideoTime(video.duration)}`;
      }
    };
    video._loadedHandler = loadedHandler;
    video.addEventListener('loadedmetadata', loadedHandler);

    const endedHandler = () => {
      progressFill.style.width = '0%';
      timeDisplay.textContent = `0:00 / ${this.formatVideoTime(video.duration || 0)}`;
    };
    video._endedHandler = endedHandler;
    video.addEventListener('ended', endedHandler);

    if (progressContainer) {
      let isDragging = false;

      const startDrag = (e) => {
        e.stopPropagation();
        e.preventDefault();
        isDragging = true;
        this.handleVideoSeek(e, videoId);
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
      };

      const onDrag = (e) => {
        if (isDragging) {
          const rect = progressContainer.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const progress = Math.max(0, Math.min(1, x / rect.width));
          if (video.duration) {
            video.currentTime = progress * video.duration;
          }
        }
      };

      const stopDrag = () => {
        isDragging = false;
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
      };

      if (progressContainer._mousedownHandler) {
        progressContainer.removeEventListener('mousedown', progressContainer._mousedownHandler);
      }
      progressContainer._mousedownHandler = startDrag;
      progressContainer.addEventListener('mousedown', startDrag);
    }
  }

  formatVideoTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  handleAudioPlay(audioElement, audioId) {
    // Pause any currently playing video
    if (this.playingVideoId) {
      const currentVideo = document.getElementById(`video-${this.playingVideoId}`);
      const currentButton = document.querySelector(`.video-play-btn[data-id="${this.playingVideoId}"]`);
      const currentMediaItem = document.querySelector(`.media-item-video[data-id="${this.playingVideoId}"]`);
      if (currentVideo) {
        currentVideo.pause();
        currentVideo.muted = true;
      }
      if (currentButton) {
        currentButton.classList.remove('playing');
        currentButton.innerHTML = Icons.get('play', 22, 2);
      }
      if (currentMediaItem) {
        currentMediaItem.classList.remove('playing');
      }
      this.playingVideoId = null;
    }

    // Pause any other playing audio and reset its UI
    if (this.playingAudioElement && this.playingAudioElement !== audioElement) {
      this.playingAudioElement.pause();
      const prevId = this.playingAudioElement.dataset.id;
      this.updateAudioUI(prevId, false);
    }

    // Track the new playing audio
    this.playingAudioElement = audioElement;
    this.playingAudioId = audioId;
  }

  updateAudioUI(audioId, isPlaying) {
    const mediaItem = document.querySelector(`.media-item-audio[data-id="${audioId}"]`);
    if (!mediaItem) return;

    const playBtn = mediaItem.querySelector('.audio-play-btn');
    const playIcon = playBtn?.querySelector('.play-icon');
    const pauseIcon = playBtn?.querySelector('.pause-icon');

    if (isPlaying) {
      mediaItem.classList.add('playing');
      if (playIcon) playIcon.style.display = 'none';
      if (pauseIcon) pauseIcon.style.display = 'block';
    } else {
      mediaItem.classList.remove('playing');
      if (playIcon) playIcon.style.display = 'block';
      if (pauseIcon) pauseIcon.style.display = 'none';
    }
  }

  updateWaveformProgress(audioId, progress) {
    const mediaItem = document.querySelector(`.media-item-audio[data-id="${audioId}"]`);
    if (!mediaItem) return;

    const waveform = mediaItem.querySelector('.audio-waveform');
    if (!waveform) return;

    // Update the progress fill overlay so it tracks playback position
    const progressFill = waveform.querySelector('.waveform-progress');
    if (progressFill) progressFill.style.width = `${progress * 100}%`;

    const bars = waveform.querySelectorAll('.waveform-bar');
    const playedCount = Math.floor(bars.length * progress);

    bars.forEach((bar, index) => {
      if (index < playedCount) {
        bar.classList.add('played');
      } else {
        bar.classList.remove('played');
      }
    });
  }

  formatAudioTime(seconds) {
    if (!seconds || isNaN(seconds)) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  setupAudioPlaybackListeners() {
    const audioCards = document.querySelectorAll('.media-item-audio');

    audioCards.forEach(card => {
      const audioId = card.dataset.id;
      const audio = card.querySelector('.audio-element');
      const playBtn = card.querySelector('.audio-play-btn');
      const waveform = card.querySelector('.audio-waveform');
      const currentTimeEl = card.querySelector('.audio-current-time');
      const durationEl = card.querySelector('.audio-duration');

      if (!audio || !playBtn) return;

      // Remove existing listeners
      if (playBtn._clickHandler) {
        playBtn.removeEventListener('click', playBtn._clickHandler);
      }
      if (audio._timeUpdateHandler) {
        audio.removeEventListener('timeupdate', audio._timeUpdateHandler);
      }
      if (audio._loadedHandler) {
        audio.removeEventListener('loadedmetadata', audio._loadedHandler);
      }
      if (audio._endedHandler) {
        audio.removeEventListener('ended', audio._endedHandler);
      }
      if (waveform?._clickHandler) {
        waveform.removeEventListener('click', waveform._clickHandler);
      }

      // Play/Pause button handler
      const clickHandler = (e) => {
        e.stopPropagation();

        if (audio.paused) {
          this.handleAudioPlay(audio, audioId);
          audio.play();
          this.updateAudioUI(audioId, true);
        } else {
          audio.pause();
          this.updateAudioUI(audioId, false);
          this.playingAudioElement = null;
          this.playingAudioId = null;
        }
      };
      playBtn._clickHandler = clickHandler;
      playBtn.addEventListener('click', clickHandler);

      // Time update handler
      const timeUpdateHandler = () => {
        const progress = audio.currentTime / audio.duration;
        this.updateWaveformProgress(audioId, progress);
        if (currentTimeEl) {
          currentTimeEl.textContent = this.formatAudioTime(audio.currentTime);
        }
      };
      audio._timeUpdateHandler = timeUpdateHandler;
      audio.addEventListener('timeupdate', timeUpdateHandler);

      // Loaded metadata handler
      const loadedHandler = () => {
        if (durationEl) {
          durationEl.textContent = this.formatAudioTime(audio.duration);
        }
      };
      audio._loadedHandler = loadedHandler;
      audio.addEventListener('loadedmetadata', loadedHandler);

      // Ended handler
      const endedHandler = () => {
        this.updateAudioUI(audioId, false);
        this.updateWaveformProgress(audioId, 0);
        if (currentTimeEl) currentTimeEl.textContent = '0:00';
        this.playingAudioElement = null;
        this.playingAudioId = null;
      };
      audio._endedHandler = endedHandler;
      audio.addEventListener('ended', endedHandler);

      // Waveform click for seeking
      if (waveform) {
        const waveformClickHandler = (e) => {
          e.stopPropagation();
          const rect = waveform.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const progress = Math.max(0, Math.min(1, clickX / rect.width));

          if (audio.duration) {
            audio.currentTime = progress * audio.duration;

            // Immediately sync visuals — don't wait for the async timeupdate event.
            // This makes the waveform bars, progress fill, and time display respond
            // to the click instantly rather than lagging until the next timeupdate.
            this.updateWaveformProgress(audioId, progress);
            if (currentTimeEl) currentTimeEl.textContent = this.formatAudioTime(audio.currentTime);
          }

          // If not playing, start playback from the new position
          if (audio.paused) {
            this.handleAudioPlay(audio, audioId);
            audio.play();
            this.updateAudioUI(audioId, true);
          }
        };
        waveform._clickHandler = waveformClickHandler;
        waveform.addEventListener('click', waveformClickHandler);
      }
    });
  }

  toggleSelection(itemId) {
    const wasSelected = this.selectedItems.has(itemId);

    if (wasSelected) {
      this.selectedItems.delete(itemId);
    } else {
      this.selectedItems.add(itemId);
      // Track last selected item for Shift+Click range selection
      this.lastSelectedItemId = itemId;

      // Pre-download file to cache when selected (for instant drag-and-drop)
      const item = document.querySelector(`[data-id="${itemId}"]`);
      if (item) {
        const fileName = item.dataset.filename;
        const url = item.dataset.url;
        const type = item.dataset.type;

        if (this.DEBUG_MODE) {
        console.log('[Selection] Checking cache status for:', itemId);
        }

        // Check if file is actually cached (not just in dragCacheStatus)
        window.kolboDesktop.getCachedFilePath(itemId).then(cacheResult => {
          if (cacheResult.cached) {
            // Already cached
            this.dragCacheStatus.set(itemId, cacheResult.filePath);
            if (this.DEBUG_MODE) {
            console.log('[Selection] Item already cached:', itemId);
            }
            this.showCacheReady(item);
          } else {
            // Not cached - download it, show spinner first
            if (this.DEBUG_MODE) {
            console.log('[Selection] Pre-downloading selected item:', itemId);
            }
            this.showCacheSpinner(item);

            // Start background download
            window.kolboDesktop.preloadCache([{
              id: itemId,
              fileName,
              url,
              type
            }]).then(result => {
              if (result.success && result.successful > 0) {
                // Update cache status
                window.kolboDesktop.getCachedFilePath(itemId).then(cacheResult => {
                  if (cacheResult.cached) {
                    this.dragCacheStatus.set(itemId, cacheResult.filePath);
                    this.showCacheReady(item);
                    if (this.DEBUG_MODE) {
                    console.log('[Selection] Item cached and ready:', itemId);
                    }
                  }
                });
              }
            }).catch(error => {
              console.error('[Selection] Download error:', error);
              // Hide spinner on error
              const cacheStatus = item.querySelector('.cache-status');
              if (cacheStatus) cacheStatus.style.display = 'none';
            });
          }
        });
      }
    }

    // Update UI
    const item = document.querySelector(`[data-id="${itemId}"]`);
    if (item) {
      item.classList.toggle('selected');
      const checkbox = item.querySelector('.selection-checkbox');
      checkbox.classList.toggle('checked');
    }

    this.updateBatchMenu();
  }

  selectRange(startItemId, endItemId) {
    // Get all media items in their DOM order
    const mediaGrid = document.getElementById('media-grid');
    if (!mediaGrid) return;

    const allItems = Array.from(mediaGrid.querySelectorAll('.media-item'));
    const itemIds = allItems.map(item => item.dataset.id);

    // Find indices
    const startIndex = itemIds.indexOf(startItemId);
    const endIndex = itemIds.indexOf(endItemId);

    if (startIndex === -1 || endIndex === -1) return;

    // Determine range (handle both directions)
    const minIndex = Math.min(startIndex, endIndex);
    const maxIndex = Math.max(startIndex, endIndex);

    // Select all items in range
    for (let i = minIndex; i <= maxIndex; i++) {
      const itemId = itemIds[i];
      const item = allItems[i];

      // Skip if already selected
      if (this.selectedItems.has(itemId)) continue;

      // Add to selection
      this.selectedItems.add(itemId);

      // Update UI
      item.classList.add('selected');
      const checkbox = item.querySelector('.selection-checkbox');
      if (checkbox) {
        checkbox.classList.add('checked');
      }

      // Pre-cache the item (same logic as toggleSelection)
      const fileName = item.dataset.filename;
      const url = item.dataset.url;
      const type = item.dataset.type;

      if (fileName && url) {
        window.kolboDesktop.getCachedFilePath(itemId).then(cacheResult => {
          if (cacheResult.cached) {
            this.dragCacheStatus.set(itemId, cacheResult.filePath);
            this.showCacheReady(item);
          } else {
            this.showCacheSpinner(item);
            window.kolboDesktop.preloadCache([{
              id: itemId,
              fileName,
              url,
              type
            }]).then(result => {
              if (result.success && result.successful > 0) {
                window.kolboDesktop.getCachedFilePath(itemId).then(cacheResult => {
                  if (cacheResult.cached) {
                    this.dragCacheStatus.set(itemId, cacheResult.filePath);
                    this.showCacheReady(item);
                  }
                });
              }
            }).catch(error => {
              console.error('[Selection] Range download error:', error);
              const cacheStatus = item.querySelector('.cache-status');
              if (cacheStatus) cacheStatus.style.display = 'none';
            });
          }
        });
      }
    }

    // Update last selected to end of range
    this.lastSelectedItemId = endItemId;

    this.updateBatchMenu();
  }

  showCacheSpinner(itemEl) {
    const cacheStatus = itemEl.querySelector('.cache-status');
    if (cacheStatus) {
      cacheStatus.style.display = 'flex';
      cacheStatus.classList.remove('ready');
      cacheStatus.classList.add('loading');
    }
    this.updateBatchMenu();
  }

  showCacheReady(itemEl) {
    const cacheStatus = itemEl.querySelector('.cache-status');
    if (cacheStatus) {
      cacheStatus.style.display = 'flex';
      cacheStatus.classList.remove('loading');
      cacheStatus.classList.add('ready');
    }
    this.updateBatchMenu();
  }

  isCacheLoading(itemEl) {
    const cacheStatus = itemEl.querySelector('.cache-status');
    return cacheStatus && cacheStatus.classList.contains('loading');
  }

  updateBatchMenu() {
    const menu = document.getElementById('floating-batch-menu');
    const count = document.getElementById('floating-batch-count');
    const cachingStatus = document.getElementById('batch-caching-status');
    const cachingText = document.getElementById('batch-caching-text');

    // Show restore button only in trash view; hide favorite/delete there.
    const inTrash = this.currentFilter === 'trash';
    const deleteBtn = document.getElementById('floating-batch-delete-btn');
    const restoreBtn = document.getElementById('floating-batch-restore-btn');
    const favoriteBtn = document.getElementById('floating-batch-favorite-btn');
    const deleteForeverBtn = document.getElementById('floating-batch-delete-forever-btn');
    if (deleteBtn) deleteBtn.classList.toggle('hidden', inTrash);
    if (favoriteBtn) favoriteBtn.classList.toggle('hidden', inTrash);
    if (restoreBtn) restoreBtn.classList.toggle('hidden', !inTrash);
    if (deleteForeverBtn) deleteForeverBtn.classList.toggle('hidden', !inTrash);

    if (this.selectedItems.size > 0) {
      menu?.classList.remove('hidden');
      if (count) count.textContent = this.selectedItems.size;

      // Count how many selected items are still downloading to cache
      const loadingCount = Array.from(this.selectedItems).filter(id => {
        const el = document.querySelector(`.media-item[data-id="${id}"]`);
        return el && this.isCacheLoading(el);
      }).length;

      if (cachingStatus) {
        if (loadingCount > 0) {
          cachingStatus.classList.remove('hidden');
          if (cachingText) {
            cachingText.textContent = loadingCount === 1
              ? 'Preparing 1 file...'
              : `Preparing ${loadingCount} files...`;
          }
        } else {
          cachingStatus.classList.add('hidden');
        }
      }
    } else {
      menu?.classList.add('hidden');
      cachingStatus?.classList.add('hidden');
    }
  }

  async handleBatchDownload() {
    if (this.selectedItems.size === 0) {
      alert('No items selected');
      return;
    }

    if (this.DEBUG_MODE) {
    console.log('[Batch Download] Starting download for', this.selectedItems.size, 'items');
    }

    try {
      // Show folder picker
      const folderResult = await window.kolboDesktop.pickFolder();

      if (!folderResult.success) {
        if (!folderResult.canceled) {
          console.error('[Batch Download] Folder picker failed:', folderResult.error);
          alert((window.t ? window.t('batch.folderSelectFailed') : 'Failed to select folder: ') + (folderResult.error || 'Unknown error'));
        }
        return;
      }

      const targetFolder = folderResult.folderPath;
      if (this.DEBUG_MODE) {
      console.log('[Batch Download] Target folder:', targetFolder);
      }

      // Build items array
      const items = Array.from(this.selectedItems).map(id => {
        const mediaItem = this.media.find(m => m.id === id);
        if (!mediaItem) return null;

        let fileName = mediaItem.filename || `kolbo-${mediaItem.id}`;
        if (fileName.length > 50) {
          const ext = fileName.split('.').pop();
          fileName = `kolbo-${mediaItem.id}.${ext}`;
        }
        if (!fileName.includes('.')) {
          const ext = mediaItem.type === 'video' ? 'mp4' :
                      mediaItem.type === 'audio' ? 'mp3' : 'png';
          fileName = `${fileName}.${ext}`;
        }

        return {
          id: mediaItem.id,
          fileName,
          url: mediaItem.url
        };
      }).filter(item => item !== null);

      if (items.length === 0) {
        alert(window.t ? window.t('batch.noValidItems') : 'No valid items to download');
        return;
      }

      // Show downloading message
      const downloadBtn = document.getElementById('floating-batch-download-btn');
      const originalText = downloadBtn ? downloadBtn.innerHTML : '';
      if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = `
${Icons.get('loader', 24)}
          <span>Downloading...</span>
        `;
      }

      if (this.DEBUG_MODE) {
      console.log('[Batch Download] Downloading', items.length, 'files...');
      }

      // Start download
      const result = await window.kolboDesktop.batchDownload(items, targetFolder);

      if (this.DEBUG_MODE) {
      console.log('[Batch Download] Result:', result);
      }

      if (result.success) {
        if (this.DEBUG_MODE) {
        console.log(`[Batch Download] Successfully downloaded ${result.successCount}/${items.length} files`);
        }

        // Open the folder where files were downloaded
        await window.kolboDesktop.openFolder(targetFolder);

        // Clear selection after successful download
        this.handleBatchClear();
      } else {
          alert(window.t ? window.t('batch.downloadFailed') : 'Download failed. Please try again.');
      }

    } catch (error) {
      console.error('[Batch Download] Error:', error);
        alert((window.t ? window.t('batch.downloadFailed') : 'Download failed. Please try again.') + ' ' + error.message);
    } finally {
      // Restore button
      const downloadBtn = document.getElementById('floating-batch-download-btn');
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = `
${Icons.get('download', 16)}
          <span>Download</span>
        `;
      }
    }
  }

  async handleImportToPremiere() {
    if (this.selectedItems.size === 0) {
      alert('No items selected');
      return;
    }

    if (this.DEBUG_MODE) {
    console.log('[Import to Premiere] Starting import for', this.selectedItems.size, 'items');
    }

    try {
      // Build items array
      const items = Array.from(this.selectedItems).map(id => {
        const mediaItem = this.media.find(m => m.id === id);
        if (!mediaItem) return null;

        let fileName = mediaItem.filename || `kolbo-${mediaItem.id}`;
        if (fileName.length > 50) {
          const ext = fileName.split('.').pop();
          fileName = `kolbo-${mediaItem.id}.${ext}`;
        }
        if (!fileName.includes('.')) {
          const ext = mediaItem.type === 'video' ? 'mp4' :
                      mediaItem.type === 'audio' ? 'mp3' : 'png';
          fileName = `${fileName}.${ext}`;
        }

        return {
          id: mediaItem.id,
          fileName,
          url: mediaItem.url,
          type: mediaItem.type
        };
      }).filter(item => item !== null);

      if (items.length === 0) {
        alert(window.t ? window.t('batch.noValidImport') : 'No valid items to import');
        return;
      }

      // Show importing message
      const importBtn = document.getElementById('floating-batch-import-premiere-btn');
      const originalHTML = importBtn ? importBtn.innerHTML : '';
      if (importBtn) {
        importBtn.disabled = true;
        importBtn.innerHTML = `
${Icons.get('loader', 24)}
          <span>Importing...</span>
        `;
      }

      if (this.DEBUG_MODE) {
      console.log('[Import to Premiere] Sending', items.length, 'files to Premiere...');
      }

      // Send to Premiere via IPC
      const result = await window.kolboDesktop.importToPremiere(items);

      if (this.DEBUG_MODE) {
      console.log('[Import to Premiere] Result:', result);
      }

      // Check if plugin is installed
      if (!result.hasPlugin) {
        if (this.DEBUG_MODE) {
        console.log('[Import to Premiere] Plugin not detected');
        }

        // Show dialog with options
        const choice = confirm(
          '⚠️ Kolbo Adobe Plugin Not Detected\n\n' +
          'The Kolbo Adobe Plugin is required to automatically import files to Premiere Pro.\n\n' +
          'Click OK to download files to a folder instead, or Cancel to install the plugin first.'
        );

        if (choice) {
          // User chose to download - fallback to batch download
          if (this.DEBUG_MODE) {
          console.log('[Import to Premiere] Falling back to batch download');
          }
          this.handleBatchDownload();
        } else {
          // User chose to install plugin
          const installUrl = 'https://github.com/ZoharFranco/kolbo-adobe-plugin';
          window.kolboDesktop.openExternal(installUrl);
        }

        return;
      }

      if (result.success) {
        if (this.DEBUG_MODE) {
        console.log(`[Import to Premiere] Successfully sent ${result.count} files to Premiere Pro`);
        }
        this.showToast(`Sent ${result.count} items to Premiere Pro. They will appear in the "Kolbo AI" bin and timeline.`, 'success');

        // Clear selection after successful import
        this.handleBatchClear();
      } else {
          alert((window.t ? window.t('batch.failedPremiere') : 'Failed to send to Premiere: ') + (result.error || 'Unknown error'));
      }

    } catch (error) {
      console.error('[Import to Premiere] Error:', error);
        alert((window.t ? window.t('batch.failedImportPremiere') : 'Failed to import to Premiere: ') + error.message);
    } finally {
      // Restore button
      const importBtn = document.getElementById('floating-batch-import-premiere-btn');
      if (importBtn) {
        importBtn.disabled = false;
        importBtn.innerHTML = `
${Icons.get('file-text', 16)}
          <span>Import to Premiere</span>
        `;
      }
    }
  }

  refreshItemCard(id) {
    const item = this.media.find(m => m.id === id);
    const el = document.querySelector(`.media-item[data-id="${id}"]`);
    if (!item || !el) return;
    const fav = this.isFavorited(item);
    const favBtn = el.querySelector('.item-action-btn.btn-favorite');
    if (favBtn) {
      favBtn.classList.toggle('is-favorited', fav);
      favBtn.title = fav ? tr('media.actions.unfavorite', 'Unfavorite') : tr('media.actions.favorite', 'Favorite');
    }
  }

  async _optimisticMutate({ ids, apiCall, okMsg, failMsg, mode = 'remove', targetState }) {
    const prior = [...this.media];
    const idSet = new Set(ids);
    const gridEl = this.getElement('media-grid');

    if (mode === 'remove') {
      this.media = this.media.filter(m => !idSet.has(m.id));
      ids.forEach(id => this.selectedItems.delete(id));
      if (gridEl) gridEl.querySelectorAll('.media-item').forEach(el => {
        if (idSet.has(el.dataset.id)) el.remove();
      });
      this.updateBatchMenu();
    } else if (mode === 'flip-favorite') {
      this.media.forEach(m => { if (idSet.has(m.id)) m.isFavorited = targetState; });
      ids.forEach(id => this.refreshItemCard(id));
    }

    try {
      await apiCall();
      const msg = typeof okMsg === 'function' ? okMsg() : okMsg;
      if (msg) this.showToast(msg, 'info');
      return { ok: true };
    } catch (e) {
      console.error(failMsg, e);
      this.media = prior;
      this.renderMedia(true);
      if (failMsg) this.showToast(failMsg, 'error');
      return { ok: false };
    }
  }

  async toggleFavorite(id) {
    const item = this.media.find(m => m.id === id);
    if (!item) return;
    const next = !this.isFavorited(item);
    // Unfavoriting in the favorites tab removes the card; otherwise we just flip.
    const dropFromList = !next && this.currentFilter === 'favorites';

    if (dropFromList) {
      await this._optimisticMutate({
        ids: [id],
        apiCall: () => kolboAPI.unfavoriteMedia(id),
        failMsg: tr('media.toasts.favoriteFailed', 'Could not update favorite'),
        mode: 'remove',
      });
    } else {
      await this._optimisticMutate({
        ids: [id],
        apiCall: () => next ? kolboAPI.favoriteMedia(id) : kolboAPI.unfavoriteMedia(id),
        failMsg: tr('media.toasts.favoriteFailed', 'Could not update favorite'),
        mode: 'flip-favorite',
        targetState: next,
      });
    }
  }

  deleteItem(id) {
    return this._optimisticMutate({
      ids: [id],
      apiCall: () => kolboAPI.deleteMedia(id),
      okMsg: tr('media.toasts.movedToTrash', 'Moved to Trash'),
      failMsg: tr('media.toasts.deleteFailed', 'Delete failed'),
    });
  }

  restoreItem(id) {
    return this._optimisticMutate({
      ids: [id],
      apiCall: () => kolboAPI.restoreMedia(id),
      okMsg: tr('media.toasts.restored', 'Restored'),
      failMsg: tr('media.toasts.restoreFailed', 'Restore failed'),
    });
  }

  async permanentDeleteItem(id) {
    const ok = await showDialog({
      title: tr('media.confirm.deleteForeverTitle', 'Delete forever?'),
      message: tr('media.confirm.deleteForeverMessage', 'This item will be permanently removed. This cannot be undone.'),
      icon: 'danger',
      confirmLabel: tr('media.confirm.deleteForeverConfirm', 'Delete forever'),
      cancelLabel: tr('media.confirm.cancel', 'Cancel'),
      confirmStyle: 'danger',
    });
    if (!ok) return;
    return this._optimisticMutate({
      ids: [id],
      apiCall: () => kolboAPI.permanentDeleteMedia(id),
      okMsg: tr('media.toasts.deletedForever', 'Permanently deleted'),
      failMsg: tr('media.toasts.deleteForeverFailed', 'Permanent delete failed'),
    });
  }

  async handleBatchFavorite() {
    if (this.selectedItems.size === 0) return;
    const ids = Array.from(this.selectedItems);
    const items = ids.map(id => this.media.find(m => m.id === id)).filter(Boolean);
    if (items.length === 0) return;

    const allFav = items.every(it => this.isFavorited(it));
    const targetState = !allFav;
    const toFlip = items.filter(it => this.isFavorited(it) !== targetState);
    if (toFlip.length === 0) return;

    const flipIds = toFlip.map(it => it.id);
    const apiFn = targetState ? kolboAPI.favoriteMedia.bind(kolboAPI) : kolboAPI.unfavoriteMedia.bind(kolboAPI);

    await this._optimisticMutate({
      ids: flipIds,
      apiCall: async () => {
        const results = await Promise.allSettled(flipIds.map(id => apiFn(id)));
        const failed = results.filter(r => r.status === 'rejected').length;
        if (failed > 0) throw new Error(`${failed}/${flipIds.length} failed`);
      },
      okMsg: targetState
        ? tr('media.toasts.favoritedN', `Favorited ${flipIds.length}`, { count: flipIds.length })
        : tr('media.toasts.unfavoritedN', `Unfavorited ${flipIds.length}`, { count: flipIds.length }),
      failMsg: tr('media.toasts.favoritePartial', 'Some favorite updates failed'),
      mode: 'flip-favorite',
      targetState,
    });
  }

  async handleBatchDelete() {
    if (this.selectedItems.size === 0) return;
    const ids = Array.from(this.selectedItems);
    this.handleBatchClear();
    await this._optimisticMutate({
      ids,
      apiCall: () => kolboAPI.bulkDeleteMedia(ids),
      okMsg: tr('media.toasts.movedNToTrash', `Moved ${ids.length} to Trash`, { count: ids.length }),
      failMsg: tr('media.toasts.deleteFailed', 'Delete failed'),
    });
  }

  async handleBatchPermanentDelete() {
    if (this.selectedItems.size === 0) return;
    const ids = Array.from(this.selectedItems);
    const ok = await showDialog({
      title: tr('media.confirm.deleteForeverNTitle', `Delete ${ids.length} items forever?`, { count: ids.length }),
      message: tr('media.confirm.deleteForeverNMessage', 'These items will be permanently removed. This cannot be undone.'),
      icon: 'danger',
      confirmLabel: tr('media.confirm.deleteForeverConfirm', 'Delete forever'),
      cancelLabel: tr('media.confirm.cancel', 'Cancel'),
      confirmStyle: 'danger',
    });
    if (!ok) return;
    this.handleBatchClear();
    await this._optimisticMutate({
      ids,
      apiCall: () => kolboAPI.bulkPermanentDeleteMedia(ids),
      okMsg: tr('media.toasts.deletedForeverN', `Permanently deleted ${ids.length}`, { count: ids.length }),
      failMsg: tr('media.toasts.deleteForeverFailed', 'Permanent delete failed'),
    });
  }

  // kolbo-api has no bulk restore endpoint, so fan out and accept partial success.
  async handleBatchRestore() {
    if (this.selectedItems.size === 0) return;
    const ids = Array.from(this.selectedItems);
    this.handleBatchClear();
    let succeeded = ids.length;
    await this._optimisticMutate({
      ids,
      apiCall: async () => {
        const results = await Promise.allSettled(ids.map(id => kolboAPI.restoreMedia(id)));
        const failed = results.filter(r => r.status === 'rejected').length;
        succeeded = ids.length - failed;
        if (failed === ids.length) throw new Error('all restore calls failed');
      },
      okMsg: () => succeeded === ids.length
        ? tr('media.toasts.restoredN', `Restored ${ids.length}`, { count: ids.length })
        : tr('media.toasts.restoredPartial', `Restored ${succeeded}/${ids.length}`, { succeeded, total: ids.length }),
      failMsg: tr('media.toasts.restoreFailed', 'Restore failed'),
    });
  }

  handleBatchClear() {
    this.selectedItems.clear();
    document.querySelectorAll('.media-item.selected').forEach(item => {
      item.classList.remove('selected');
      const checkbox = item.querySelector('.selection-checkbox');
      checkbox.classList.remove('checked');
    });
    this.updateBatchMenu();
  }

  showToast(message, type = 'info') {
    if (this.DEBUG_MODE) {
    console.log(`[Toast ${type}] ${message}`);
    }

    const toast = document.getElementById('toast-notification');
    if (!toast) return;

    const messageEl = toast.querySelector('.toast-message');
    const iconEl = toast.querySelector('.toast-icon');

    if (messageEl) messageEl.textContent = message;

    if (iconEl) {
      iconEl.style.stroke = type === 'error' ? '#ef4444' :
                           type === 'success' ? '#22c55e' : '#3b82f6';
    }

    toast.classList.add('show');

    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  // ============================================================================
  // SETTINGS PAGE METHODS
  // ============================================================================

  async loadSettingsData() {
    if (this.DEBUG_MODE) {
      console.log('[Settings] Loading settings data...');
    }

    try {
      // Load cache size
      if (window.kolboDesktop) {
        const cacheInfo = await window.kolboDesktop.getCacheSize();
        const cacheSizeDisplay = document.getElementById('cache-size-display');
        if (cacheSizeDisplay) {
          cacheSizeDisplay.textContent = cacheInfo.formatted;
        }

        // Show cache location
        const cacheLocationPath = document.getElementById('cache-location-path');
        if (cacheLocationPath) {
          // Get user data path from Electron
          const userDataPath = await this.getUserDataPath();
          cacheLocationPath.textContent = `${userDataPath}\\MediaCache`;
        }

        // Load app version
        const appVersionEl = document.getElementById('app-version');
        if (appVersionEl && window.electronBridge) {
          const version = await window.electronBridge.getAppVersion();
          appVersionEl.textContent = `Version ${version}`;
        }

        // Load auto-launch setting
        const autoLaunchToggle = document.getElementById('auto-launch-toggle');
        if (autoLaunchToggle && window.kolboDesktop.getAutoLaunch) {
          const isEnabled = await window.kolboDesktop.getAutoLaunch();
          autoLaunchToggle.checked = isEnabled;

          // Add event listener for toggle changes (only once)
          if (!autoLaunchToggle.hasAttribute('data-listener-attached')) {
            autoLaunchToggle.setAttribute('data-listener-attached', 'true');
            autoLaunchToggle.addEventListener('change', async (e) => {
              try {
                const result = await window.kolboDesktop.setAutoLaunch(e.target.checked);
                if (!result.success) {
                  console.error('[Settings] Failed to set auto-launch:', result.error);
                  // Revert the toggle on error
                  e.target.checked = !e.target.checked;
                  alert(`Failed to ${e.target.checked ? 'enable' : 'disable'} auto-launch: ${result.error}`);
                } else {
                  if (this.DEBUG_MODE) {
                    console.log(`[Settings] Auto-launch ${result.enabled ? 'enabled' : 'disabled'}`);
                  }
                }
              } catch (error) {
                console.error('[Settings] Auto-launch toggle error:', error);
                e.target.checked = !e.target.checked;
                alert(`Failed to ${e.target.checked ? 'enable' : 'disable'} auto-launch`);
              }
            });
          }
        }

        // Load download folder setting
        const downloadFolderPath = document.getElementById('download-folder-path');
        const changeDownloadFolderBtn = document.getElementById('change-download-folder-btn');

        if (downloadFolderPath && window.kolboDesktop.getDownloadFolder) {
          const currentFolder = await window.kolboDesktop.getDownloadFolder();
          if (currentFolder) {
            downloadFolderPath.textContent = currentFolder;
          } else {
            downloadFolderPath.textContent = 'Not set (will ask on first download)';
          }
        }

        if (changeDownloadFolderBtn && window.kolboDesktop.setDownloadFolder) {
          if (!changeDownloadFolderBtn.hasAttribute('data-listener-attached')) {
            changeDownloadFolderBtn.setAttribute('data-listener-attached', 'true');
            changeDownloadFolderBtn.addEventListener('click', async () => {
              try {
                const newFolder = await window.kolboDesktop.setDownloadFolder();
                if (newFolder && downloadFolderPath) {
                  downloadFolderPath.textContent = newFolder;
                  if (this.DEBUG_MODE) {
                  console.log('[Settings] Download folder changed to:', newFolder);
                  }
                }
              } catch (error) {
                console.error('[Settings] Failed to change download folder:', error);
                alert('Failed to change download folder');
              }
            });
          }
        }

        // Load Format Factory settings
        const ffModeSource = document.getElementById('ff-mode-source');
        const ffModeCustom = document.getElementById('ff-mode-custom');
        const ffOutputFolderPath = document.getElementById('ff-output-folder-path');
        const ffChangeOutputFolderBtn = document.getElementById('ff-change-output-folder-btn');
        const ffCustomFolderSetting = document.getElementById('ff-custom-folder-setting');

        if (window.kolboDesktop?.ffmpeg) {
          // Load current output mode
          try {
            const modeResult = await window.kolboDesktop.ffmpeg.getOutputMode();
            const currentMode = modeResult.success ? modeResult.outputMode : 'source';

            if (ffModeSource && ffModeCustom) {
              if (currentMode === 'source') {
                ffModeSource.checked = true;
                if (ffCustomFolderSetting) ffCustomFolderSetting.style.opacity = '0.5';
              } else {
                ffModeCustom.checked = true;
                if (ffCustomFolderSetting) ffCustomFolderSetting.style.opacity = '1';
              }
            }

            // Load current output folder
            const folderResult = await window.kolboDesktop.ffmpeg.getOutputFolder();
            if (folderResult.success && folderResult.outputFolder && ffOutputFolderPath) {
              ffOutputFolderPath.textContent = folderResult.outputFolder;
            } else if (ffOutputFolderPath) {
              ffOutputFolderPath.textContent = 'Not set';
            }
          } catch (error) {
            console.error('[Settings] Failed to load Format Factory settings:', error);
          }

          // Handle output mode change
          if (ffModeSource && !ffModeSource.hasAttribute('data-listener-attached')) {
            ffModeSource.setAttribute('data-listener-attached', 'true');
            ffModeSource.addEventListener('change', async () => {
              if (ffModeSource.checked) {
                try {
                  await window.kolboDesktop.ffmpeg.setOutputMode('source');
                  if (ffCustomFolderSetting) ffCustomFolderSetting.style.opacity = '0.5';

                  // Notify format factory manager if it exists
                  if (window.formatFactoryManager) {
                    await window.formatFactoryManager.loadSettings();
                  }

                  console.log('[Settings] Format Factory output mode set to: source');
                } catch (error) {
                  console.error('[Settings] Failed to set output mode:', error);
                }
              }
            });
          }

          if (ffModeCustom && !ffModeCustom.hasAttribute('data-listener-attached')) {
            ffModeCustom.setAttribute('data-listener-attached', 'true');
            ffModeCustom.addEventListener('change', async () => {
              if (ffModeCustom.checked) {
                if (ffCustomFolderSetting) ffCustomFolderSetting.style.opacity = '1';

                // If no folder is set, prompt to select one
                const folderResult = await window.kolboDesktop.ffmpeg.getOutputFolder();
                if (!folderResult.success || !folderResult.outputFolder) {
                  const result = await window.kolboDesktop.ffmpeg.selectOutputFolder();
                  if (result.success && !result.canceled && ffOutputFolderPath) {
                    ffOutputFolderPath.textContent = result.folderPath;
                    await window.kolboDesktop.ffmpeg.setOutputFolder(result.folderPath);
                  } else {
                    // User canceled, revert to source mode
                    if (ffModeSource) ffModeSource.checked = true;
                    if (ffCustomFolderSetting) ffCustomFolderSetting.style.opacity = '0.5';
                    return;
                  }
                }

                try {
                  await window.kolboDesktop.ffmpeg.setOutputMode('custom');

                  // Notify format factory manager if it exists
                  if (window.formatFactoryManager) {
                    await window.formatFactoryManager.loadSettings();
                  }

                  console.log('[Settings] Format Factory output mode set to: custom');
                } catch (error) {
                  console.error('[Settings] Failed to set output mode:', error);
                }
              }
            });
          }

          // Handle change folder button
          if (ffChangeOutputFolderBtn && !ffChangeOutputFolderBtn.hasAttribute('data-listener-attached')) {
            ffChangeOutputFolderBtn.setAttribute('data-listener-attached', 'true');
            ffChangeOutputFolderBtn.addEventListener('click', async () => {
              try {
                const result = await window.kolboDesktop.ffmpeg.selectOutputFolder();
                if (result.success && !result.canceled) {
                  if (ffOutputFolderPath) {
                    ffOutputFolderPath.textContent = result.folderPath;
                  }
                  await window.kolboDesktop.ffmpeg.setOutputFolder(result.folderPath);

                  // Set mode to custom
                  if (ffModeCustom) ffModeCustom.checked = true;
                  await window.kolboDesktop.ffmpeg.setOutputMode('custom');
                  if (ffCustomFolderSetting) ffCustomFolderSetting.style.opacity = '1';

                  // Notify format factory manager if it exists
                  if (window.formatFactoryManager) {
                    await window.formatFactoryManager.loadSettings();
                  }

                  console.log('[Settings] Format Factory output folder changed to:', result.folderPath);
                }
              } catch (error) {
                console.error('[Settings] Failed to change Format Factory output folder:', error);
                alert('Failed to change output folder');
              }
            });
          }
        }

        // Load subscription usage (credits and plan)
        const currentPlanEl = document.getElementById('current-plan');
        const creditsTextEl = document.getElementById('credits-text');

        if (currentPlanEl && creditsTextEl) {
          try {
            const token = localStorage.getItem('token') || localStorage.getItem('kolbo_token');
            if (token) {
              const apiUrl = window.KOLBO_CONFIG?.apiUrl || 'http://localhost:5050/api';
              const response = await fetch(`${apiUrl}/user-usage-summary`, {
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
                }
              });

              if (response.ok) {
                const result = await response.json();
                const data = result.data;

                // Display plan name
                const planName = data?.subscription?.name || 'Free';
                currentPlanEl.textContent = planName;
                currentPlanEl.style.fontWeight = '500';
                currentPlanEl.style.color = 'var(--text-primary, #fff)';

                // Display credits with nice formatting
                const totalCredits = data?.subscription?.totalCredits || 0;
                creditsTextEl.textContent = totalCredits.toLocaleString() + ' credits';
                creditsTextEl.style.fontWeight = '500';
                creditsTextEl.style.color = 'var(--primary-color, #4A90E2)';

                if (this.DEBUG_MODE) {
                console.log('[Settings] Loaded subscription:', planName, 'with', totalCredits, 'credits');
                }
              } else {
                currentPlanEl.textContent = 'Unable to load';
                creditsTextEl.textContent = 'Unable to load';
                console.error('[Settings] Failed to fetch subscription usage:', response.status);
              }
            } else {
              currentPlanEl.textContent = 'Not logged in';
              creditsTextEl.textContent = 'Not logged in';
            }
          } catch (error) {
            console.error('[Settings] Failed to load subscription usage:', error);
            currentPlanEl.textContent = 'Failed to load';
            creditsTextEl.textContent = 'Failed to load';
          }
        }

        // Setup Purchase Credits button
        const purchaseCreditsBtn = document.getElementById('purchase-credits-btn');
        if (purchaseCreditsBtn && window.kolboDesktop) {
          if (!purchaseCreditsBtn.hasAttribute('data-listener-attached')) {
            purchaseCreditsBtn.setAttribute('data-listener-attached', 'true');
            purchaseCreditsBtn.addEventListener('click', () => {
              // Build pricing URL based on current environment
              const webappUrl = window.KOLBO_CONFIG?.webappUrl || 'https://app.kolbo.ai';
              const pricingUrl = `${webappUrl}/pricing`;

              if (this.DEBUG_MODE) {
              console.log('[Settings] Opening pricing page:', pricingUrl);
              }
              window.kolboDesktop.openExternal(pricingUrl);
            });
          }
        }

        // Load update settings
        await this.loadUpdateSettings();
      }
    } catch (error) {
      console.error('[Settings] Failed to load settings data:', error);
    }
  }

  async loadUpdateSettings() {
    if (!window.kolboDesktop) return;

    try {
      // Display current version
      const currentVersionEl = document.getElementById('current-version');
      if (currentVersionEl) {
        const version = await window.kolboDesktop.getVersion();
        currentVersionEl.textContent = `Version ${version}`;
      }

      // Setup update check button (only once)
      const checkUpdatesBtn = document.getElementById('check-updates-btn');
      if (checkUpdatesBtn && !checkUpdatesBtn.hasAttribute('data-listener-attached')) {
        checkUpdatesBtn.setAttribute('data-listener-attached', 'true');
        checkUpdatesBtn.addEventListener('click', () => this.handleCheckForUpdates());
      }

      // Setup download button (only once)
      const downloadBtn = document.getElementById('download-update-btn');
      if (downloadBtn && !downloadBtn.hasAttribute('data-listener-attached')) {
        downloadBtn.setAttribute('data-listener-attached', 'true');
        downloadBtn.addEventListener('click', () => this.handleDownloadUpdate());
      }

      // Setup install button (only once)
      const installBtn = document.getElementById('install-update-btn');
      if (installBtn && !installBtn.hasAttribute('data-listener-attached')) {
        installBtn.setAttribute('data-listener-attached', 'true');
        installBtn.addEventListener('click', () => this.handleInstallUpdate());
      }

      // Update listeners are now set up on app startup (see setupUpdateListeners in init())
      // Check if there's already an update available
      const updateInfo = await window.kolboDesktop.getUpdateInfo();
      if (updateInfo && updateInfo.available) {
        this.showUpdateAvailable(updateInfo);
      } else {
        this.showUpdateStatus('Checking for updates...', 'checking');
      }
    } catch (error) {
      console.error('[Update] Error loading update settings:', error);
    }
  }

  async handleCheckForUpdates() {
    const checkBtn = document.getElementById('check-updates-btn');
    const statusEl = document.getElementById('update-status');

    try {
      // Disable button and show checking status
      if (checkBtn) {
        checkBtn.disabled = true;
        checkBtn.innerHTML = `
          <div class="spinner" style="width: 14px; height: 14px; border: 2px solid rgba(102, 126, 234, 0.3); border-top-color: #667eea;"></div>
          Checking...
        `;
      }

      if (statusEl) {
        statusEl.textContent = 'Checking for updates...';
        statusEl.className = 'settings-sublabel checking';
      }

      if (this.DEBUG_MODE) {
      console.log('[Update] Manual check requested');
      }
      const result = await window.kolboDesktop.checkForUpdates();

      if (this.DEBUG_MODE) {
      console.log('[Update] Check result:', result);
      }

      // Button will be re-enabled by event handlers
      setTimeout(() => {
        if (checkBtn) {
          checkBtn.disabled = false;
          checkBtn.innerHTML = `
${Icons.get('refresh-cw', 16)}
            Check Now
          `;
        }
      }, 2000);
    } catch (error) {
      console.error('[Update] Check failed:', error);
      this.showUpdateStatus(`Error: ${error.message}`, 'error');

      // Re-enable button
      if (checkBtn) {
        checkBtn.disabled = false;
        checkBtn.innerHTML = `
          ${Icons.get('refresh-cw', 16)}
          Check Now
        `;
      }
    }
  }

  // Setup update event listeners on app startup
  setupDragEventListeners() {
    if (!window.kolboDesktop) return;

    if (!this._dragListenersSetup) {
      this._dragListenersSetup = true;

      if (this.DEBUG_MODE) {
      console.log('[Drag] Setting up drag event listeners...');
      }

      // Listen for drag errors from main process
      window.kolboDesktop.onDragError((data) => {
        console.error('[Drag] Drag operation failed:', data.message);
        console.error('[Drag] Failed files:', data.failedFiles);

        // Show error to user
          alert((window.t ? window.t('errors.dragFailed', { message: data.message }) : `❌ Drag Failed: ${data.message}`) + '\n\nSome files may be locked by another application.');
      });

      // Listen for drag warnings from main process
      window.kolboDesktop.onDragWarning((data) => {
        if (this.DEBUG_MODE) {
        console.warn('[Drag] Drag warning:', data.message);
        }
        if (this.DEBUG_MODE) {
        console.warn(`[Drag] Accessible: ${data.accessibleCount}, Failed: ${data.failedCount}`);
        }

        // Show warning toast (optional - could be intrusive)
        // For now just log it, user will see files that drag successfully
      });
    }
  }

  setupUpdateListeners() {
    if (!this._updateListenersSetup) {
      this._updateListenersSetup = true;

      if (this.DEBUG_MODE) {
      console.log('[Update] Setting up update listeners...');
      }

      window.kolboDesktop.onUpdateAvailable((info) => {
        if (this.DEBUG_MODE) {
        console.log('[Update] Update available:', info);
        }
        this.showUpdateAvailable(info);
      });

      window.kolboDesktop.onUpdateNotAvailable(() => {
        if (this.DEBUG_MODE) {
        console.log('[Update] App is up to date');
        }
        this.showUpdateStatus('Your app is up to date', 'uptodate');
      });

      window.kolboDesktop.onDownloadProgress((progress) => {
        if (this.DEBUG_MODE) {
        console.log('[Update] Download progress:', progress.percent);
        }
        this.updateDownloadProgress(progress);
      });

      window.kolboDesktop.onUpdateDownloaded((info) => {
        if (this.DEBUG_MODE) {
        console.log('[Update] Update downloaded:', info);
        }
        this.showUpdateDownloaded(info);
      });

      window.kolboDesktop.onUpdateError((error) => {
        console.error('[Update] Error:', error);
        this.showUpdateStatus(`Error checking for updates: ${error}`, 'error');
      });
    }
  }

  showUpdateAvailable(info) {
    if (this.DEBUG_MODE) {
    console.log('[Updater] Update available:', info.version);
    }

    // Show header update button — auto-download is running in background
    const updateBtn = this.getElement('update-available-btn');
    const updateBtnLabel = this.getElement('update-btn-label');
    if (updateBtn) {
      updateBtn.classList.remove('hidden');
          if (updateBtnLabel) updateBtnLabel.textContent = window.t ? window.t('header.downloadingUpdate') : 'Downloading Update…';
      updateBtn.onclick = () => {
        this.switchView('settings');
        setTimeout(() => {
          const updatesSection = document.querySelector('.settings-section:has(#update-available-card)');
          if (updatesSection) {
            updatesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      };
    }

    // Show settings page update card
    const updateCard = this.getElement('update-available-card');
    const versionText = this.getElement('update-version-text');
    const changelog = this.getElement('update-changelog');
    const statusEl = this.getElement('update-status');

    if (updateCard) updateCard.classList.remove('hidden');
        if (versionText) versionText.textContent = (window.t ? window.t('settings.updates.versionReady', { version: info.version }) : `Version ${info.version}`) + ' — downloading in background…';

    if (changelog && info.releaseNotes) {
      changelog.innerHTML = info.releaseNotes;
    }

    if (statusEl) {
          statusEl.textContent = window.t ? window.t('settings.updates.downloading', { version: info.version }) : `Downloading update ${info.version}…`;
      statusEl.className = 'settings-sublabel available';
    }

    // Show progress bar immediately since auto-download has started
    const progressContainer = this.getElement('update-progress-container');
    if (progressContainer) progressContainer.classList.remove('hidden');
  }

  showUpdateStatus(message, className = '') {
    const statusEl = document.getElementById('update-status');
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.className = `settings-sublabel ${className}`;
    }
  }

  async handleDownloadUpdate() {
    const downloadBtn = document.getElementById('download-update-btn');
    const progressContainer = document.getElementById('update-progress-container');

    try {
      // Show progress bar
      if (progressContainer) progressContainer.classList.remove('hidden');

      // Disable button with centered spinner
      if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
            <div class="spinner" style="width: 14px; height: 14px; border: 2px solid white; border-top-color: transparent;"></div>
            <span>Downloading...</span>
          </div>
        `;
      }

      if (this.DEBUG_MODE) {
      console.log('[Update] Starting download');
      }
      const result = await window.kolboDesktop.downloadUpdate();

      // Download complete - update UI
      if (result && result.success) {
        if (downloadBtn) {
          downloadBtn.disabled = false;
          // Keep button visible - don't hide it
          downloadBtn.innerHTML = `
${Icons.get('download', 16)}
            Download Update
          `;
        }

        const statusEl = document.getElementById('update-status');
        if (statusEl) {
          statusEl.textContent = window.t ? window.t('settings.updates.downloadedToDownloads') : 'Installer downloaded to Downloads folder!';
          statusEl.className = 'settings-sublabel available';
        }

        if (progressContainer) progressContainer.classList.add('hidden');

        // Show success message
        const progressText = document.getElementById('update-progress-text');
        if (progressText) {
          progressText.textContent = window.t ? window.t('settings.updates.downloaded') : 'Download complete! Check your Downloads folder.';
        }
      }
    } catch (error) {
      console.error('[Update] Download failed:', error);
          alert((window.t ? window.t('settings.updates.downloadFailed') : 'Failed to download update: ') + error.message);

      // Re-enable button
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = `
${Icons.get('download', 16)}
          Download Update
        `;
      }

      if (progressContainer) progressContainer.classList.add('hidden');
    }
  }

  updateDownloadProgress(progress) {
    const progressFill = document.getElementById('update-progress-fill');
    const progressText = document.getElementById('update-progress-text');

    const percent = Math.round(progress.percent);

    if (progressFill) {
      progressFill.style.width = `${percent}%`;
    }

    if (progressText) {
      const mbTransferred = (progress.transferred / 1024 / 1024).toFixed(1);
      const mbTotal = (progress.total / 1024 / 1024).toFixed(1);
          progressText.textContent = window.t
            ? window.t('settings.updates.downloadingProgressMb', { percent: percent, mb: mbTransferred, mbTotal: mbTotal })
            : `Downloading... ${percent}% (${mbTransferred} MB / ${mbTotal} MB)`;
    }
  }

  showUpdateDownloaded(info) {
    const downloadBtn = this.getElement('download-update-btn');
    const installBtn = this.getElement('install-update-btn');
    const progressText = this.getElement('update-progress-text');
    const statusEl = this.getElement('update-status');
    const updateBtn = this.getElement('update-available-btn');
    const updateBtnLabel = this.getElement('update-btn-label');

    // Hide download button, show install button
    if (downloadBtn) downloadBtn.classList.add('hidden');
    if (installBtn) installBtn.classList.remove('hidden');

    if (progressText) {
      progressText.textContent = window.t ? window.t('settings.updates.downloaded') : 'Download complete! Ready to install.';
    }

    if (statusEl) {
        statusEl.textContent = (window.t ? window.t('settings.updates.versionReady', { version: info.version }) : `Version ${info.version}`) + ' ready — click to restart';
      statusEl.className = 'settings-sublabel available';
    }

    // Nav button now triggers install directly with one click
    if (updateBtn) {
      if (updateBtnLabel) updateBtnLabel.textContent = window.t ? window.t('header.restartToUpdate') : 'Restart to Update';
      updateBtn.title = `Version ${info.version} ready — click to install and relaunch`;
      updateBtn.onclick = () => this.handleInstallUpdate();
    }
  }

  async handleInstallUpdate() {
    if (this.DEBUG_MODE) {
      console.log('[Update] Installing update');
    }
    await window.kolboDesktop.installUpdate();
    // App will quit, install, and relaunch
  }

  async getUserDataPath() {
    // Get from Electron's app.getPath('userData')
    // This is typically: C:\Users\{username}\AppData\Roaming\kolbo-desktop
    try {
      // We can infer this from the environment or ask main process
      // For now, use a reasonable default
      if (navigator.platform.includes('Win')) {
        const username = await this.getUsername();
        return `C:\\Users\\${username}\\AppData\\Roaming\\kolbo-desktop`;
      } else if (navigator.platform.includes('Mac')) {
        return '~/Library/Application Support/kolbo-desktop';
      } else {
        return '~/.config/kolbo-desktop';
      }
    } catch (error) {
      return 'AppData/kolbo-desktop';
    }
  }

  async getUsername() {
    // Get username from environment
    try {
      // In Electron, we can use process.env, but it's in main process
      // For now, return a placeholder
      return 'User';
    } catch (error) {
      return 'User';
    }
  }

  async handleClearCache() {
    if (this.DEBUG_MODE) {
      console.log('[Settings] Clear cache clicked');
    }

    // Show styled confirmation dialog
    const confirmed = await showDialog({
      title: window.t('settings.cacheManagement.clearAllCache') || 'Clear All Cache',
      message: (window.t('settings.cacheManagement.clearCacheDesc') || 'This will delete all downloaded media files.') +
        '<br><br><span style="color:#f59e0b">' +
        (window.t('settings.cacheManagement.clearCacheWarning') || 'Video editing projects using cached files will show "Media Offline" errors.') +
        '</span>',
      icon: 'danger',
      confirmLabel: window.t('settings.cacheManagement.clearCache') || 'Clear Cache',
      cancelLabel: window.t('dialog.cancel') || 'Cancel',
      confirmStyle: 'danger',
    });

    if (!confirmed) {
      return;
    }

    try {
      if (window.kolboDesktop) {
        const clearCacheBtn = document.getElementById('clear-cache-btn');
        if (clearCacheBtn) {
          clearCacheBtn.disabled = true;
          clearCacheBtn.innerHTML = `
            <div class="spinner" style="width: 14px; height: 14px; border: 2px solid rgba(239, 68, 68, 0.3); border-top-color: #ef4444;"></div>
            Clearing...
          `;
        }

        const result = await window.kolboDesktop.clearCache();

        if (result.success) {
          showDialog({
            title: window.t('settings.cacheManagement.cacheCleared') || 'Cache Cleared',
            message: (window.t('settings.cacheManagement.deletedFiles', { count: result.deletedFiles }) || `Deleted ${result.deletedFiles} file(s).`) +
              '<br>' + (window.t('settings.cacheManagement.newFilesWillDownload') || 'New files will be downloaded when you drag them to video editors.'),
            icon: 'success',
            confirmLabel: 'OK',
            confirmStyle: 'success',
          });

          // Reload cache size
          this.loadSettingsData();
        } else {
          showDialog({ title: 'Error', message: `Failed to clear cache: ${result.error}`, icon: 'danger', confirmStyle: 'danger' });
        }

        // Restore button
        if (clearCacheBtn) {
          clearCacheBtn.disabled = false;
          clearCacheBtn.innerHTML = `
${Icons.get('trash-2', 16)}
            ${window.t('settings.cacheManagement.clearAllCache') || 'Clear All Cache'}
          `;
        }
      }
    } catch (error) {
      console.error('[Settings] Clear cache error:', error);
      showDialog({ title: 'Error', message: `Failed to clear cache: ${error.message}`, icon: 'danger', confirmStyle: 'danger' });
    }
  }

  async handleRevealCache() {
    if (this.DEBUG_MODE) {
      console.log('[Settings] Reveal cache clicked');
    }

    try {
      if (window.kolboDesktop && window.kolboDesktop.openCacheFolder) {
        const result = await window.kolboDesktop.openCacheFolder();

        if (result.success) {
          if (this.DEBUG_MODE) {
          console.log('[Settings] Cache folder opened:', result.path);
          }
        } else {
          showDialog({ title: 'Error', message: `Failed to open cache folder: ${result.error}`, icon: 'danger', confirmStyle: 'danger' });
        }
      } else {
        showDialog({
          title: 'Cache Location',
          message: 'Windows: C:\\Users\\{YourUsername}\\AppData\\Roaming\\kolbo-desktop\\MediaCache<br><br>' +
            'Mac: ~/Library/Application Support/kolbo-desktop/MediaCache',
          icon: 'info',
          confirmStyle: 'confirm',
        });
      }
    } catch (error) {
      console.error('[Settings] Reveal cache error:', error);
      showDialog({ title: 'Error', message: `Failed to open cache folder: ${error.message}`, icon: 'danger', confirmStyle: 'danger' });
    }
  }
}

// Initialize background video
function initBackgroundVideo() {
  const video = document.querySelector('.auth-video');
  if (!video) {
    if (this.DEBUG_MODE) {
    console.warn('[Video] Video element not found');
    }
    return;
  }

  // Set video properties to ensure it plays
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');

  // Function to attempt playing the video
  const attemptPlay = async () => {
    try {
      await video.play();
    } catch (err) {
      console.error('[Video] Play failed:', err);
    }
  };

  video.addEventListener('loadedmetadata', () => {
    // Ensure video element has explicit dimensions
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      video.style.width = '100%';
      video.style.height = '100%';
    }
  });

  // Force video to load and play
  video.addEventListener('loadeddata', () => {
    // Force dimensions if still 0
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      video.style.width = '100vw';
      video.style.height = '100vh';
    }
    attemptPlay();
  });

  video.addEventListener('canplay', () => {
    attemptPlay();
  });

  video.addEventListener('playing', () => {
    // Force video to be visible
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.display = 'block';
    video.style.visibility = 'visible';
    video.style.opacity = '1';
  });

  video.addEventListener('error', (e) => {
    console.error('[Video] Video loading error:', e);
    console.error('[Video] Error details:', video.error);
    if (video.error) {
      console.error('[Video] Error code:', video.error.code);
      console.error('[Video] Error message:', video.error.message);
    }
  });

  // Force video to be visible from the start
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.display = 'block';
  video.style.visibility = 'visible';
  video.style.opacity = '1';

  // Ensure video loads
  video.load();

  // Try to play after a short delay
  setTimeout(() => {
    attemptPlay();
  }, 100);

  // Try on any user interaction
  const playOnInteraction = () => {
    attemptPlay();
    document.removeEventListener('click', playOnInteraction);
    document.removeEventListener('keydown', playOnInteraction);
    document.removeEventListener('mousemove', playOnInteraction);
  };
  document.addEventListener('click', playOnInteraction, { once: true });
  document.addEventListener('keydown', playOnInteraction, { once: true });
  document.addEventListener('mousemove', playOnInteraction, { once: true });
}

// Initialize app when DOM is ready
let app;
document.addEventListener('DOMContentLoaded', () => {
  // Add platform class for OS-specific styling (e.g., macOS traffic light padding)
  if (navigator.platform.includes('Mac')) {
    document.body.classList.add('is-mac');
  } else if (navigator.platform.includes('Win')) {
    document.body.classList.add('is-windows');
  }

  // Initialize Lucide icons in static HTML
  Icons.init();

  // Initialize background video first
  initBackgroundVideo();

  app = new KolboApp();
  window.app = app; // Make accessible for debugging

  // Signal main process that UI is ready — dismisses splash screen.
  // Use requestAnimationFrame to ensure the browser has actually
  // painted the login/app screen before we swap windows.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (window.kolboDesktop && window.kolboDesktop.signalReady) {
        window.kolboDesktop.signalReady();
      }
    });
  });
});

// Global error handlers
window.addEventListener('error', (e) => {
  console.error('[Global Error]', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[Unhandled Promise Rejection]', e.reason);
});

// ============================================================================
// DOWNLOAD NOTIFICATIONS
// ============================================================================

// Setup download notification banner
function setupDownloadNotifications() {
  const notification = document.getElementById("download-notification");
  const filenameEl = notification.querySelector(".download-filename");
  const folderEl = notification.querySelector(".download-folder");
  const openFileBtn = document.getElementById("open-file-btn");
  const showFolderBtn = document.getElementById("show-folder-btn");
  const changeFolderBtn = document.getElementById("change-folder-btn");
  const closeBtn = document.getElementById("close-notification-btn");

  let currentFilePath = null;
  let autoCloseTimeout = null;

  // Listen for download complete events
  if (window.kolboDesktop && window.kolboDesktop.onDownloadComplete) {
    window.kolboDesktop.onDownloadComplete((data) => {
      if (this.DEBUG_MODE) {
      console.log("[Download Notification] Download complete:", data);
      }

      currentFilePath = data.filePath;
      filenameEl.textContent = data.fileName;
      folderEl.textContent = data.folderPath;

      notification.classList.remove("hidden");

      // Auto-close after 5 seconds
      if (autoCloseTimeout) clearTimeout(autoCloseTimeout);
      autoCloseTimeout = setTimeout(() => {
        notification.classList.add("hidden");
      }, 5000);
    });
  }

  // Listen for download failed events
  if (window.kolboDesktop && window.kolboDesktop.onDownloadFailed) {
    window.kolboDesktop.onDownloadFailed((data) => {
      console.error("[Download Notification] Download failed:", data);
      showToast(`Download failed: ${data.fileName}`, "error");
    });
  }

  // Open file button
  openFileBtn.addEventListener("click", () => {
    if (currentFilePath && window.kolboDesktop && window.kolboDesktop.openExternal) {
      window.kolboDesktop.openExternal(currentFilePath);
      notification.classList.add("hidden");
    }
  });

  // Show folder button
  showFolderBtn.addEventListener("click", () => {
    if (currentFilePath && window.kolboDesktop && window.kolboDesktop.showInFolder) {
      window.kolboDesktop.showInFolder(currentFilePath);
      notification.classList.add("hidden");
    }
  });

  // Change folder button
  changeFolderBtn.addEventListener("click", async () => {
    if (window.kolboDesktop && window.kolboDesktop.setDownloadFolder) {
      const newFolder = await window.kolboDesktop.setDownloadFolder();
      if (newFolder) {
        showToast(`Download folder changed to: ${newFolder}`, "success");
        notification.classList.add("hidden");
      }
    }
  });

  // Close button
  closeBtn.addEventListener("click", () => {
    notification.classList.add("hidden");
    if (autoCloseTimeout) clearTimeout(autoCloseTimeout);
  });
}

// Initialize download notifications on DOM load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupDownloadNotifications);
} else {
  setupDownloadNotifications();
}

