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
 * KolboApp - Main Application Class
 */
class KolboApp {
  constructor() {
    // Filter & Project State
    this.currentFilter = 'all';
    this.currentSubcategory = 'all';
    this.selectedProjectId = localStorage.getItem('kolbo_selected_project') || 'all';
    this.gridSize = parseInt(localStorage.getItem('kolbo_grid_size')) || 3;

    // Media & Pagination State
    this.media = [];
    this.projects = [];
    this.currentPage = 1;
    this.isLoading = false;
    this.loadingMore = false;
    this.hasMore = false;
    this.totalItems = 0;

    // Selection & Interaction State
    this.observer = null;
    this.selectedItems = new Set();
    this.playingVideoId = null;

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

    // Debug & Performance
    this.DEBUG_MODE = window.KOLBO_CONFIG ? window.KOLBO_CONFIG.debug : (localStorage.getItem('KOLBO_DEBUG') === 'true');
    this.forceRefresh = false;
    this.cachedWebappUrl = null;
    this.cachedApiUrl = null;
    this.domCache = {};
    this.abortController = null;
    this.filterDebounceTimer = null;
    this.filterDebounceDelay = 300;
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

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
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
      this.loadProjects().then(async () => {
        await this.loadMedia();
        this.showMediaScreen(false);
      });
    } else {
      this.showLoginScreen();
    }

    this.bindEvents();

    // Setup update listeners on app startup (not just when settings page opens)
    this.setupUpdateListeners();
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
    if (mediaTab) {
      mediaTab.addEventListener('click', () => this.switchView('media'));
    }
    if (webappTab) {
      webappTab.addEventListener('click', () => this.switchView('webapp'));
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

    // Project selector
    const projectSelect = document.getElementById('project-select');
    if (projectSelect) {
      projectSelect.addEventListener('change', (e) => this.handleProjectChange(e));
    }

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

    // Settings page buttons
    const clearCacheBtn = document.getElementById('clear-cache-btn');
    const revealCacheBtn = document.getElementById('reveal-cache-btn');
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener('click', () => this.handleClearCache());
    }
    if (revealCacheBtn) {
      revealCacheBtn.addEventListener('click', () => this.handleRevealCache());
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
    const valueDisplay = document.getElementById('grid-size-value');
    if (slider) slider.value = size;
    if (valueDisplay) valueDisplay.textContent = size;
  }

  showLoginScreen() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('media-screen').classList.add('hidden');
    document.getElementById('loading-overlay').classList.add('hidden');
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
    const mediaCount = document.getElementById('media-count');

    // Hide all views first
    mediaView?.classList.add('hidden');
    mediaView?.classList.remove('active');
    webappView?.classList.add('hidden');
    webappView?.classList.remove('active');
    settingsView?.classList.add('hidden');
    settingsView?.classList.remove('active');

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
    } else if (view === 'webapp') {
      webappView?.classList.remove('hidden');
      webappView?.classList.add('active');
      if (mediaCount) mediaCount.style.display = 'none';

      // Initialize TabManager if not already initialized
      if (!this.tabManager) {
        this.tabManager = new TabManager();
        if (this.DEBUG_MODE) {
          console.log('[View] TabManager initialized');
        }
      }
    } else if (view === 'settings') {
      settingsView?.classList.remove('hidden');
      settingsView?.classList.add('active');
      if (mediaCount) mediaCount.style.display = 'none';

      // Load settings data
      this.loadSettingsData();
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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            <span>New Tab</span>
          </button>
          <button id="split-view-btn" class="split-view-btn" title="Split View (Ctrl+Shift+S)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="18" rx="1"></rect>
              <rect x="14" y="3" width="7" height="18" rx="1"></rect>
            </svg>
            <span>Split View</span>
          </button>
          <div id="split-presets" class="split-presets hidden">
            <button class="split-preset-btn active" data-ratio="0.5" title="Equal Split (50/50)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="18" rx="1"></rect>
                <rect x="14" y="3" width="7" height="18" rx="1"></rect>
              </svg>
            </button>
            <button class="split-preset-btn" data-ratio="0.25" title="Small Left (25/75)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="4" height="18" rx="1"></rect>
                <rect x="10" y="3" width="11" height="18" rx="1"></rect>
              </svg>
            </button>
            <button class="split-preset-btn" data-ratio="0.7" title="Large Left (70/30)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="11" height="18" rx="1"></rect>
                <rect x="17" y="3" width="4" height="18" rx="1"></rect>
              </svg>
            </button>
          </div>
        `;
      }

      const iframeContainer = document.getElementById('iframe-container');
      if (iframeContainer) {
        iframeContainer.innerHTML = '<div id="webapp-loading" class="loading-state"><div class="spinner"></div><p>Loading Kolbo Web App...</p></div>';
      }

      // Recreate TabManager (will rebind to new-tab-btn)
      this.tabManager = new TabManager();

      if (this.DEBUG_MODE) {
        console.log('[Refresh] Webapp view relaunched successfully');
      }
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
      errorEl.textContent = 'Please enter email and password';
      return;
    }

    try {
      errorEl.textContent = '';
      loginBtn.disabled = true;
      loginBtn.textContent = 'Signing in...';

      const result = await kolboAPI.login(email, password);

      if (result.success) {
        this.showLoadingOverlay();
        document.getElementById('login-screen').classList.add('hidden');

        await this.loadProjects();
        await this.loadMedia();
        this.showMediaScreen(false);
      } else {
        errorEl.textContent = result.error || 'Login failed';
      }
    } catch (error) {
      console.error('[Login] Error:', error);
      errorEl.textContent = error.message || 'Login failed. Please try again.';
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign In';
    }
  }

  async handleGoogleLogin() {
    const errorEl = document.getElementById('login-error');

    try {
      errorEl.style.color = '#667eea';
      errorEl.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; gap: 8px;"><div class="spinner" style="width: 16px; height: 16px; border: 2px solid rgba(102, 126, 234, 0.3); border-top-color: #667eea; border-radius: 50%; animation: spin 0.8s linear infinite;"></div><span>Opening Google Sign-In...</span></div>';

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
        }, 800);
      } else {
        errorEl.style.color = '#ef4444';
        errorEl.textContent = result.error || 'Google login failed';
      }
    } catch (error) {
      console.error('[Google Login] Error:', error);
      errorEl.style.color = '#ef4444';
      errorEl.textContent = error.message || 'Google login failed';
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

  async loadProjects() {
    try {
      if (this.DEBUG_MODE) {
        console.log('Loading projects...');
      }

      const response = await kolboAPI.getProjects();
      this.projects = response.data || response.projects || [];

      const projectSelect = document.getElementById('project-select');
      if (projectSelect && this.projects.length > 0) {
        projectSelect.innerHTML = '<option value="all">All Projects</option>';

        this.projects.forEach(project => {
          const option = document.createElement('option');
          option.value = project._id;
          option.textContent = project.name || project.title || 'Unnamed Project';
          projectSelect.appendChild(option);
        });

        // Ensure default is always 'all' if no valid selection exists
        projectSelect.value = this.selectedProjectId || 'all';
      }

      if (this.DEBUG_MODE) {
        console.log(`Loaded ${this.projects.length} projects`);
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  }

  handleProjectChange(e) {
    this.selectedProjectId = e.target.value;
    localStorage.setItem('kolbo_selected_project', this.selectedProjectId);

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

  handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
      this.cleanup();
      kolboAPI.logout();
      this.media = [];
      this.selectedItems.clear();
      this.showLoginScreen();

      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');
      const errorEl = document.getElementById('login-error');
      if (emailInput) emailInput.value = '';
      if (passwordInput) passwordInput.value = '';
      if (errorEl) errorEl.textContent = '';
    }
  }

  handleFilter(e) {
    const filterType = e.target.dataset.type;

    if (this.DEBUG_MODE) {
      console.log('[Filter] Button clicked, filterType:', filterType);
    }

    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');

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

    if (filterType === 'favorites' || previousFilter === 'favorites') {
      if (this.DEBUG_MODE) {
        console.log('[Filter] Triggering API reload for favorites');
      }
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
    const subcategory = e.target.dataset.subcategory;

    const parentGroup = e.target.closest('.subcategory-group');
    if (parentGroup) {
      parentGroup.querySelectorAll('.subcategory-btn').forEach(btn => {
        btn.classList.remove('active');
      });
      e.target.classList.add('active');
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
    if (!this.hasMore || this.loadingMore) return;
    if (this.DEBUG_MODE) {
      console.log('[Infinite Scroll] Loading more items...');
    }
    this.loadMedia(false, true);
  }

  async loadMedia(forceRefresh = false, appendToExisting = false) {
    if (this.isLoading || (this.loadingMore && appendToExisting)) return;

    const loadingEl = this.getElement('loading');
    const loadingMoreEl = this.getElement('loading-more');
    const gridEl = this.getElement('media-grid');
    const emptyEl = this.getElement('empty-state');
    const errorEl = this.getElement('error-state');

    if (appendToExisting) {
      this.loadingMore = true;
      if (loadingMoreEl) loadingMoreEl.classList.remove('hidden');
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
    }

    try {
      // Calculate optimal page size based on viewport (approx 200px per item)
      // Load just enough to fill viewport + small buffer for smooth scrolling
      const viewportHeight = window.innerHeight;
      const itemsPerRow = Math.max(2, Math.floor(window.innerWidth / 220)); // ~220px per item with gap
      const rowsVisible = Math.ceil(viewportHeight / 200); // ~200px per row
      const optimalPageSize = Math.min(50, Math.max(12, itemsPerRow * (rowsVisible + 2))); // +2 rows buffer

      const params = {
        page: this.currentPage,
        pageSize: optimalPageSize,
        sort: 'created_desc',
        type: (this.currentFilter === 'all' || this.currentFilter === 'favorites') ? 'all' : this.currentFilter,
        projectId: this.selectedProjectId
      };

      // Add favorites filter if active
      // Backend expects category=favorites, NOT isFavorited=true
      if (this.currentFilter === 'favorites') {
        params.category = 'favorites';
        if (this.DEBUG_MODE) {
          console.log('[Media] ✓ Favorites filter active, setting category=favorites');
        }
      } else if (this.currentSubcategory && this.currentSubcategory !== 'all') {
        params.category = this.currentSubcategory;
      }

      if (this.DEBUG_MODE) {
        console.log('[Media] Viewport-based pageSize:', optimalPageSize, `(${itemsPerRow} cols x ${rowsVisible + 2} rows)`);
        console.log('[Media] Loading media with params:', JSON.stringify(params, null, 2));
        console.log('[Media] Current filter state:', this.currentFilter);
        console.log('[Media] Append to existing:', appendToExisting);
      }

      const response = await kolboAPI.getMedia(params);

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

      if (appendToExisting) {
        // Append new items, avoiding duplicates
        const existingIds = new Set(this.media.map(item => item.id));
        const uniqueNewItems = newItems.filter(item => !existingIds.has(item.id));
        this.media = [...this.media, ...uniqueNewItems];
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
      if (appendToExisting) {
        if (loadingMoreEl) loadingMoreEl.classList.add('hidden');
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
    // Reuse existing observer if available
    if (!this.observer) {
      this.observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && !this.loadingMore) {
            if (this.DEBUG_MODE) {
              console.log('[Infinite Scroll] Trigger visible, loading more...');
            }
            this.loadMore();
          }
        },
        { rootMargin: '400px' } // Start loading when trigger is 400px from viewport
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
      console.log('[Infinite Scroll] Observer setup complete');
    }
  }

  renderMedia() {
    const gridEl = this.getElement('media-grid');
    if (!gridEl) return;

    // Filter media based on current filter
    let filtered = this.media;
    if (this.currentFilter !== 'all' && this.currentFilter !== 'favorites') {
      filtered = this.media.filter(item => item.type === this.currentFilter);
    }

    // Update count
    const countEl = document.getElementById('media-count');
    if (countEl) {
      countEl.textContent = `${filtered.length} items`;
    }

    // Render items
    gridEl.innerHTML = filtered.map(item => this.renderMediaItem(item)).join('');

    // Setup selection listeners
    this.setupMediaItemListeners();
    this.updateBatchMenu();

    // Preload thumbnails for visible items only (first 30) to prevent request storms
    // More thumbnails will load on-demand as user scrolls
    this.preloadAllThumbnails(filtered.slice(0, 30));

    // Preload first 20 items to cache for drag-and-drop (async, don't wait)
    this.preloadVisibleMediaToCache(filtered.slice(0, 20));
  }

  async preloadVisibleMediaToCache(items) {
    if (!items || items.length === 0) return;

    // Check if operation was cancelled before starting
    if (this.preloadAbortController?.signal.aborted) return;

    console.log(`[Cache] Preloading ${items.length} visible items...`);

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
          console.log(`[Cache] Preloaded ${result.successful}/${result.total} items`);

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
        const cacheStatus = document.querySelector(`.cache-status[data-id="${id}"]`);
        if (cacheStatus) {
          cacheStatus.style.display = 'block';
        }
      }
    }
  }

  async preloadAllThumbnails(items) {
    if (!items || items.length === 0) return;
    if (!window.kolboDesktop || !window.kolboDesktop.preloadThumbnails) return;

    // Check if operation was cancelled before starting
    if (this.preloadAbortController?.signal.aborted) return;

    console.log(`[ThumbnailCache] Preloading ${items.length} thumbnails...`);

    // Prepare thumbnail items for cache
    const thumbnailItems = items
      .filter(item => item.thumbnail_url || item.thumbnailUrl)
      .map(item => ({
        id: item.id,
        thumbnailUrl: item.thumbnail_url || item.thumbnailUrl
      }));

    if (thumbnailItems.length === 0) {
      console.log('[ThumbnailCache] No thumbnails to preload');
      return;
    }

    try {
      // Start thumbnail preloading (fire and forget)
      window.kolboDesktop.preloadThumbnails(thumbnailItems).then(result => {
        // Check if cancelled before processing result
        if (this.preloadAbortController?.signal.aborted) return;

        if (result.success) {
          console.log(`[ThumbnailCache] Preloaded ${result.successful}/${result.total} thumbnails`);

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
        const imgEl = document.querySelector(`[data-id="${id}"] img, [data-id="${id}"] video`);
        if (imgEl) {
          const cachedUrl = `file://${result.filePath.replace(/\\/g, '/')}`;
          if (imgEl.tagName === 'IMG') {
            imgEl.src = cachedUrl;
          } else if (imgEl.tagName === 'VIDEO') {
            imgEl.poster = cachedUrl;
          }
          console.log(`[ThumbnailCache] Updated thumbnail for ${id}`);
        }
      }
    }
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#4CAF50">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
        </div>
        <div class="media-preview">
          <img src="${item.thumbnail_url || item.url}" alt="${title}" loading="lazy" decoding="async" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%2290%22%3E%3Crect fill=%22%23333%22 width=%22160%22 height=%2290%22/%3E%3C/svg%3E'">
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
    const thumbnailUrl = item.thumbnail_url || item.url;

    return `
      <div class="media-item media-item-video ${isSelected ? 'selected' : ''}" data-id="${item.id}" draggable="true" data-filename="${fileName}" data-url="${item.url}" data-type="${item.type}">
        <div class="selection-checkbox ${isSelected ? 'checked' : ''}" data-id="${item.id}"></div>
        <div class="cache-status" data-id="${item.id}" style="display: none;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#4CAF50">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
        </div>
        <div class="media-preview">
          <video
            id="video-${item.id}"
            src="${item.url || item.video_url}"
            poster="${thumbnailUrl}"
            preload="metadata"
            ${isPlaying ? '' : 'muted'}
            loop
            class="video-preview"
            onloadedmetadata="this.currentTime=0"
          ></video>
          <button class="video-play-btn ${isPlaying ? 'playing' : ''}" data-id="${item.id}">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
              ${isPlaying ?
                '<path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>' :
                '<path d="M8 5v14l11-7z"/>'}
            </svg>
          </button>
          <span class="type-badge type-badge-video">Video</span>
          ${duration ? `<span class="duration">${duration}</span>` : ''}
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

    return `
      <div class="media-item media-item-audio ${isSelected ? 'selected' : ''}" data-id="${item.id}" draggable="true" data-filename="${fileName}" data-url="${item.url}" data-type="${item.type}">
        <div class="selection-checkbox ${isSelected ? 'checked' : ''}" data-id="${item.id}"></div>
        <div class="cache-status" data-id="${item.id}" style="display: none;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#4CAF50">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
        </div>
        <div class="audio-card">
          <div class="audio-title" title="${title}">${title}</div>
          <div class="audio-player-wrapper">
            <audio controls class="audio-player" preload="none">
              <source src="${audioUrl}" type="audio/mpeg">
              Your browser does not support audio playback.
            </audio>
          </div>
        </div>
      </div>
    `;
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

    // Create new click handler
    const clickHandler = (e) => {
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

      // Check if click is on the checkbox
      const checkbox = e.target.closest('.selection-checkbox');
      if (checkbox) {
        e.stopPropagation();
        const itemId = checkbox.closest('.media-item').dataset.id;
        this.toggleSelection(itemId);
        return;
      }

      // Direct click on media item (anywhere except play buttons)
      const mediaItem = e.target.closest('.media-item');
      if (mediaItem) {
        e.stopPropagation();
        const itemId = mediaItem.dataset.id;
        this.toggleSelection(itemId);
      }
    };

    gridEl._clickHandler = clickHandler;
    gridEl.addEventListener('click', clickHandler);

    // Add drag-and-drop handlers
    this.setupDragAndDrop(gridEl);
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
      const mediaItem = e.target.closest('.media-item[draggable="true"]');
      if (!mediaItem) return;

      const mediaId = mediaItem.dataset.id;

      // Check if dragging a selected item - if so, drag ALL selected items
      let filesToDrag = [];
      let elementsBeingDragged = [];

      if (this.selectedItems.has(mediaId)) {
        // Dragging a selected item - collect ALL selected items
        console.log('[Drag] Dragging', this.selectedItems.size, 'selected items');

        const allMediaItems = e.currentTarget.querySelectorAll('.media-item[draggable="true"]');

        allMediaItems.forEach(item => {
          const id = item.dataset.id;
          if (this.selectedItems.has(id)) {
            const cachedPath = this.dragCacheStatus.get(id);
            if (cachedPath) {
              filesToDrag.push(cachedPath);
              elementsBeingDragged.push(item);
            } else {
              console.log('[Drag] Selected item not cached:', id);
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

      console.log('[Drag] Starting drag for', filesToDrag.length, 'file(s)');

      if (filesToDrag.length > 0) {
        // Files are cached - start native drag
        e.preventDefault();

        console.log('[Drag] Files cached, starting native drag:', filesToDrag);

        // Create custom drag image
        this.setCustomDragImage(e, elementsBeingDragged, mediaItem);

        // Start Electron native drag (will use 'file' or 'files' based on count)
        window.kolboDesktop.startFileDrag(filesToDrag);

        // Set opacity on all dragged items
        elementsBeingDragged.forEach(item => {
          item.style.opacity = '0.5';
        });

        console.log('[Drag] Native drag started for', filesToDrag.length, 'file(s)');
      } else {
        // File not cached - prevent drag and download in background
        console.log('[Drag] File not cached - preventing drag');
        e.preventDefault();
        e.stopPropagation();

        // Start download in background (no popup)
        const fileName = mediaItem.dataset.filename;
        const url = mediaItem.dataset.url;
        const type = mediaItem.dataset.type;

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

                // Show cache indicator
                const cacheStatus = mediaItem.querySelector('.cache-status');
                if (cacheStatus) {
                  cacheStatus.style.display = 'block';
                }

                console.log('[Drag] File downloaded and ready for next drag');
              }
            });
          }
        }).catch(error => {
          console.error('[Drag] Download error:', error);
        });
      }
    };

    const dragendHandler = (e) => {
      // Reset opacity for all items (in case multiple were being dragged)
      const allMediaItems = e.currentTarget.querySelectorAll('.media-item[draggable="true"]');
      allMediaItems.forEach(item => {
        item.style.opacity = '1';
      });
    };

    gridEl._dragstartHandler = dragstartHandler;
    gridEl._dragendHandler = dragendHandler;
    gridEl._mouseoverHandler = mouseoverHandler;

    gridEl.addEventListener('dragstart', dragstartHandler);
    gridEl.addEventListener('dragend', dragendHandler);
    gridEl.addEventListener('mouseover', mouseoverHandler);

    console.log('[Drag] Drag-and-drop handlers initialized');
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
        badge.textContent = `${count} items`;
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
      console.warn('[Drag] Failed to set custom drag image:', error);
    }
  }

  handleVideoPlayPause(videoId) {
    const video = document.getElementById(`video-${videoId}`);
    const button = document.querySelector(`.video-play-btn[data-id="${videoId}"]`);
    if (!video || !button) return;

    // Pause currently playing video if different
    if (this.playingVideoId && this.playingVideoId !== videoId) {
      const currentVideo = document.getElementById(`video-${this.playingVideoId}`);
      const currentButton = document.querySelector(`.video-play-btn[data-id="${this.playingVideoId}"]`);
      if (currentVideo) {
        currentVideo.pause();
        currentVideo.muted = true;
      }
      if (currentButton) {
        currentButton.classList.remove('playing');
        currentButton.innerHTML = `
          <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
            <path d="M8 5v14l11-7z"/>
          </svg>
        `;
      }
    }

    // Toggle play/pause
    if (this.playingVideoId === videoId) {
      video.pause();
      video.muted = true;
      this.playingVideoId = null;
      button.classList.remove('playing');
      button.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
          <path d="M8 5v14l11-7z"/>
        </svg>
      `;
    } else {
      video.muted = false;
      video.play();
      this.playingVideoId = videoId;
      button.classList.add('playing');
      button.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
          <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
        </svg>
      `;
    }
  }

  toggleSelection(itemId) {
    const wasSelected = this.selectedItems.has(itemId);

    if (wasSelected) {
      this.selectedItems.delete(itemId);
    } else {
      this.selectedItems.add(itemId);

      // Pre-download file to cache when selected (for instant drag-and-drop)
      const item = document.querySelector(`[data-id="${itemId}"]`);
      if (item) {
        const fileName = item.dataset.filename;
        const url = item.dataset.url;
        const type = item.dataset.type;

        console.log('[Selection] Checking cache status for:', itemId);

        // Check if file is actually cached (not just in dragCacheStatus)
        window.kolboDesktop.getCachedFilePath(itemId).then(cacheResult => {
          if (cacheResult.cached) {
            // Already cached
            this.dragCacheStatus.set(itemId, cacheResult.filePath);
            console.log('[Selection] Item already cached:', itemId);

            // Show cache indicator
            const cacheStatus = item.querySelector('.cache-status');
            if (cacheStatus) {
              cacheStatus.style.display = 'block';
            }
          } else {
            // Not cached - download it
            console.log('[Selection] Pre-downloading selected item:', itemId);

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

                    // Show cache indicator
                    const cacheStatus = item.querySelector('.cache-status');
                    if (cacheStatus) {
                      cacheStatus.style.display = 'block';
                    }

                    console.log('[Selection] Item cached and ready:', itemId);
                  }
                });
              }
            }).catch(error => {
              console.error('[Selection] Download error:', error);
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


  updateBatchMenu() {
    const menu = document.getElementById('floating-batch-menu');
    const count = document.getElementById('floating-batch-count');

    if (this.selectedItems.size > 0) {
      menu?.classList.remove('hidden');
      if (count) count.textContent = this.selectedItems.size;
    } else {
      menu?.classList.add('hidden');
    }
  }

  async handleBatchDownload() {
    if (this.selectedItems.size === 0) {
      alert('No items selected');
      return;
    }

    console.log('[Batch Download] Starting download for', this.selectedItems.size, 'items');

    try {
      // Show folder picker
      const folderResult = await window.kolboDesktop.pickFolder();

      if (!folderResult.success) {
        if (!folderResult.canceled) {
          console.error('[Batch Download] Folder picker failed:', folderResult.error);
          alert('Failed to select folder: ' + (folderResult.error || 'Unknown error'));
        }
        return;
      }

      const targetFolder = folderResult.folderPath;
      console.log('[Batch Download] Target folder:', targetFolder);

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
        alert('No valid items to download');
        return;
      }

      // Show downloading message
      const downloadBtn = document.getElementById('floating-batch-download-btn');
      const originalText = downloadBtn ? downloadBtn.innerHTML : '';
      if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
            <circle cx="12" cy="12" r="10"/>
          </svg>
          <span>Downloading...</span>
        `;
      }

      console.log('[Batch Download] Downloading', items.length, 'files...');

      // Start download
      const result = await window.kolboDesktop.batchDownload(items, targetFolder);

      console.log('[Batch Download] Result:', result);

      if (result.success) {
        console.log(`[Batch Download] Successfully downloaded ${result.successCount}/${items.length} files`);

        // Open the folder where files were downloaded
        await window.kolboDesktop.openFolder(targetFolder);

        // Clear selection after successful download
        this.handleBatchClear();
      } else {
        alert('Download failed. Please try again.');
      }

    } catch (error) {
      console.error('[Batch Download] Error:', error);
      alert('Failed to download files: ' + error.message);
    } finally {
      // Restore button
      const downloadBtn = document.getElementById('floating-batch-download-btn');
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
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

    console.log('[Import to Premiere] Starting import for', this.selectedItems.size, 'items');

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
        alert('No valid items to import');
        return;
      }

      // Show importing message
      const importBtn = document.getElementById('floating-batch-import-premiere-btn');
      const originalHTML = importBtn ? importBtn.innerHTML : '';
      if (importBtn) {
        importBtn.disabled = true;
        importBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="animation: spin 1s linear infinite;">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
          </svg>
          <span>Importing...</span>
        `;
      }

      console.log('[Import to Premiere] Sending', items.length, 'files to Premiere...');

      // Send to Premiere via IPC
      const result = await window.kolboDesktop.importToPremiere(items);

      console.log('[Import to Premiere] Result:', result);

      // Check if plugin is installed
      if (!result.hasPlugin) {
        console.log('[Import to Premiere] Plugin not detected');

        // Show dialog with options
        const choice = confirm(
          '⚠️ Kolbo Adobe Plugin Not Detected\n\n' +
          'The Kolbo Adobe Plugin is required to automatically import files to Premiere Pro.\n\n' +
          'Click OK to download files to a folder instead, or Cancel to install the plugin first.'
        );

        if (choice) {
          // User chose to download - fallback to batch download
          console.log('[Import to Premiere] Falling back to batch download');
          this.handleBatchDownload();
        } else {
          // User chose to install plugin
          const installUrl = 'https://github.com/ZoharFranco/kolbo-adobe-plugin';
          window.kolboDesktop.openExternal(installUrl);
        }

        return;
      }

      if (result.success) {
        console.log(`[Import to Premiere] Successfully sent ${result.count} files to Premiere Pro`);
        this.showToast(`Sent ${result.count} items to Premiere Pro. They will appear in the "Kolbo AI" bin and timeline.`, 'success');

        // Clear selection after successful import
        this.handleBatchClear();
      } else {
        alert('Failed to send to Premiere: ' + (result.error || 'Unknown error'));
      }

    } catch (error) {
      console.error('[Import to Premiere] Error:', error);
      alert('Failed to import to Premiere: ' + error.message);
    } finally {
      // Restore button
      const importBtn = document.getElementById('floating-batch-import-premiere-btn');
      if (importBtn) {
        importBtn.disabled = false;
        importBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13.5 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8.5L13.5 3zM7 5h6v4h4v10H7V5zm3 8v-2h2.5c.83 0 1.5.67 1.5 1.5S13.33 14 12.5 14H10z"/>
          </svg>
          <span>Import to Premiere</span>
        `;
      }
    }
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
    console.log(`[Toast ${type}] ${message}`);
    // TODO: Implement toast notifications
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
                  console.log('[Settings] Download folder changed to:', newFolder);
                }
              } catch (error) {
                console.error('[Settings] Failed to change download folder:', error);
                alert('Failed to change download folder');
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

                console.log('[Settings] Loaded subscription:', planName, 'with', totalCredits, 'credits');
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

              console.log('[Settings] Opening pricing page:', pricingUrl);
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

      console.log('[Update] Manual check requested');
      const result = await window.kolboDesktop.checkForUpdates();

      console.log('[Update] Check result:', result);

      // Button will be re-enabled by event handlers
      setTimeout(() => {
        if (checkBtn) {
          checkBtn.disabled = false;
          checkBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
            </svg>
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
          Check Now
        `;
      }
    }
  }

  // Setup update event listeners on app startup
  setupUpdateListeners() {
    if (!this._updateListenersSetup) {
      this._updateListenersSetup = true;

      console.log('[Update] Setting up update listeners...');

      window.kolboDesktop.onUpdateAvailable((info) => {
        console.log('[Update] Update available:', info);
        this.showUpdateAvailable(info);
      });

      window.kolboDesktop.onUpdateNotAvailable(() => {
        console.log('[Update] App is up to date');
        this.showUpdateStatus('Your app is up to date', 'uptodate');
      });

      window.kolboDesktop.onDownloadProgress((progress) => {
        console.log('[Update] Download progress:', progress.percent);
        this.updateDownloadProgress(progress);
      });

      window.kolboDesktop.onUpdateDownloaded((info) => {
        console.log('[Update] Update downloaded:', info);
        this.showUpdateDownloaded(info);
      });

      window.kolboDesktop.onUpdateError((error) => {
        console.error('[Update] Error:', error);
        this.showUpdateStatus(`Error checking for updates: ${error}`, 'error');
      });
    }
  }

  showUpdateAvailable(info) {
    console.log('[Updater] Update available:', info.version);

    // Show header update button
    const updateBtn = document.getElementById('update-available-btn');
    if (updateBtn) {
      updateBtn.classList.remove('hidden');
      updateBtn.onclick = () => {
        // Switch to settings view and scroll to updates section
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
    const updateCard = document.getElementById('update-available-card');
    const versionText = document.getElementById('update-version-text');
    const changelog = document.getElementById('update-changelog');
    const statusEl = document.getElementById('update-status');

    if (updateCard) updateCard.classList.remove('hidden');
    if (versionText) versionText.textContent = `Version ${info.version} is ready to download`;

    if (changelog && info.releaseNotes) {
      changelog.textContent = info.releaseNotes;
    }

    if (statusEl) {
      statusEl.textContent = `Update available: ${info.version}`;
      statusEl.className = 'settings-sublabel available';
    }
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

      console.log('[Update] Starting download');
      const result = await window.kolboDesktop.downloadUpdate();

      // Download complete - update UI
      if (result && result.success) {
        if (downloadBtn) {
          downloadBtn.disabled = false;
          downloadBtn.classList.add('hidden');
        }

        const statusEl = document.getElementById('update-status');
        if (statusEl) {
          statusEl.textContent = 'Installer downloaded to Downloads folder!';
          statusEl.className = 'settings-sublabel available';
        }

        if (progressContainer) progressContainer.classList.add('hidden');

        // Show success message
        const progressText = document.getElementById('update-progress-text');
        if (progressText) {
          progressText.textContent = 'Download complete! Check your Downloads folder.';
        }
      }
    } catch (error) {
      console.error('[Update] Download failed:', error);
      alert(`Failed to download update: ${error.message}`);

      // Re-enable button
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
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
      progressText.textContent = `Downloading... ${percent}% (${mbTransferred} MB / ${mbTotal} MB)`;
    }
  }

  showUpdateDownloaded(info) {
    const downloadBtn = document.getElementById('download-update-btn');
    const installBtn = document.getElementById('install-update-btn');
    const progressText = document.getElementById('update-progress-text');
    const statusEl = document.getElementById('update-status');

    // Hide download button, show install button
    if (downloadBtn) downloadBtn.classList.add('hidden');
    if (installBtn) installBtn.classList.remove('hidden');

    if (progressText) {
      progressText.textContent = 'Download complete! Ready to install.';
    }

    if (statusEl) {
      statusEl.textContent = `Update ready to install: ${info.version}`;
      statusEl.className = 'settings-sublabel available';
    }
  }

  async handleInstallUpdate() {
    const confirmed = confirm(
      'The app will close and install the update.\n\n' +
      'Your work will be saved. Continue?'
    );

    if (confirmed) {
      console.log('[Update] Installing update');
      await window.kolboDesktop.installUpdate();
      // App will quit and install
    }
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

    // Show confirmation dialog
    const confirmed = confirm(
      '⚠️ Clear All Cache?\n\n' +
      'This will delete all downloaded media files from your computer.\n\n' +
      'Warning: Video editing projects (Premiere Pro, After Effects, DaVinci Resolve) ' +
      'that are using these files will show "Media Offline" errors.\n\n' +
      'Are you sure you want to continue?'
    );

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
          alert(
            `✅ Cache Cleared Successfully!\n\n` +
            `Deleted ${result.deletedFiles} file(s).\n\n` +
            `New files will be downloaded when you drag them to video editors.`
          );

          // Reload cache size
          this.loadSettingsData();
        } else {
          alert(`❌ Failed to clear cache: ${result.error}`);
        }

        // Restore button
        if (clearCacheBtn) {
          clearCacheBtn.disabled = false;
          clearCacheBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Clear All Cache
          `;
        }
      }
    } catch (error) {
      console.error('[Settings] Clear cache error:', error);
      alert(`❌ Failed to clear cache: ${error.message}`);
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
          console.log('[Settings] Cache folder opened:', result.path);
        } else {
          alert(`Failed to open cache folder: ${result.error}`);
        }
      } else {
        // Fallback for non-Electron environments
        alert(
          'Cache Location:\n\n' +
          'Windows: C:\\Users\\{YourUsername}\\AppData\\Roaming\\kolbo-desktop\\MediaCache\n\n' +
          'Mac: ~/Library/Application Support/kolbo-desktop/MediaCache\n\n' +
          'You can navigate to this folder using File Explorer or Finder.'
        );
      }
    } catch (error) {
      console.error('[Settings] Reveal cache error:', error);
      alert(`Failed to open cache folder: ${error.message}`);
    }
  }
}

// Initialize background video
function initBackgroundVideo() {
  const video = document.querySelector('.auth-video');
  if (!video) {
    console.warn('[Video] Video element not found');
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

  // Initialize background video first
  initBackgroundVideo();
  
  app = new KolboApp();
  window.app = app; // Make accessible for debugging
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
  const showFolderBtn = document.getElementById("show-folder-btn");
  const changeFolderBtn = document.getElementById("change-folder-btn");
  const closeBtn = document.getElementById("close-notification-btn");

  let currentFilePath = null;
  let autoCloseTimeout = null;

  // Listen for download complete events
  if (window.kolboDesktop && window.kolboDesktop.onDownloadComplete) {
    window.kolboDesktop.onDownloadComplete((data) => {
      console.log("[Download Notification] Download complete:", data);

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

