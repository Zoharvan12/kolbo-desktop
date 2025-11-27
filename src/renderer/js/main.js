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
    this.gridSize = parseInt(localStorage.getItem('kolbo_grid_size')) || 2;

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

    // Drag & Drop State
    this.preparedDragData = null; // Downloaded files ready for drag
    this.downloadingForDrag = false;

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
      console.log('Initializing Kolbo Desktop App...');
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
    } else if (this.currentView === 'webapp' && this.tabManager) {
      // Reload active tab
      const activeTab = this.tabManager.getActiveTab();
      if (activeTab && activeTab.iframe) {
        activeTab.iframe.src = activeTab.iframe.src; // Force reload
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
        projectSelect.innerHTML = '<option value="all">Select All Projects</option>';

        this.projects.forEach(project => {
          const option = document.createElement('option');
          option.value = project._id;
          option.textContent = project.name || project.title || 'Unnamed Project';
          projectSelect.appendChild(option);
        });

        projectSelect.value = this.selectedProjectId;
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

    this.updateSubcategoryVisibility(filterType);

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
      gridEl.innerHTML = '';
      emptyEl.classList.add('hidden');
      errorEl.classList.add('hidden');
      this.currentPage = 1;
      this.media = [];
    }

    try {
      const params = {
        page: this.currentPage,
        pageSize: 50,
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

    // Check and update cached status for all items
    this.updateCachedIndicators();
  }

  async updateCachedIndicators() {
    const mediaItems = document.querySelectorAll('.media-item[data-filename]');

    for (const item of mediaItems) {
      const fileName = item.dataset.filename;
      if (!fileName) continue;

      try {
        const result = await window.electronBridge.isFileCached(fileName);
        if (result && result.cached) {
          const indicator = item.querySelector('.cached-indicator');
          if (indicator) {
            indicator.style.display = 'flex';
            indicator.classList.add('visible');
          }
        }
      } catch (error) {
        // Silently fail - not critical
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
      <div class="media-item media-item-image ${isSelected ? 'selected' : ''}" data-id="${item.id}" data-filename="${fileName}" draggable="true">
        <div class="selection-checkbox ${isSelected ? 'checked' : ''}" data-id="${item.id}"></div>
        <div class="cached-indicator" style="display: none;"></div>
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
      <div class="media-item media-item-video ${isSelected ? 'selected' : ''}" data-id="${item.id}" data-filename="${fileName}" draggable="true">
        <div class="selection-checkbox ${isSelected ? 'checked' : ''}" data-id="${item.id}"></div>
        <div class="cached-indicator" style="display: none;"></div>
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
      <div class="media-item media-item-audio ${isSelected ? 'selected' : ''}" data-id="${item.id}" data-filename="${fileName}" draggable="true">
        <div class="selection-checkbox ${isSelected ? 'checked' : ''}" data-id="${item.id}"></div>
        <div class="cached-indicator" style="display: none;"></div>
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
      const target = e.target.closest('.selection-checkbox, .video-play-btn, .media-item');
      if (!target) return;

      e.stopPropagation();

      if (target.classList.contains('selection-checkbox')) {
        const itemId = target.closest('.media-item').dataset.id;
        this.toggleSelection(itemId);
      } else if (target.classList.contains('video-play-btn')) {
        this.handleVideoPlayPause(target.dataset.id);
      }
    };

    gridEl._clickHandler = clickHandler;
    gridEl.addEventListener('click', clickHandler);

    // Drag events delegation
    if (!gridEl._dragHandlersSetup) {
      // Mousedown: Start pre-downloading files
      gridEl.addEventListener('mousedown', (e) => {
        // Only for media items, not buttons
        if (e.target.closest('button, audio, video, .selection-checkbox')) {
          return;
        }

        const card = e.target.closest('.media-item');
        if (card && card.dataset.id) {
          // Add downloading visual state
          card.classList.add('downloading');

          // Start pre-downloading files for drag (pass card element)
          this.prepareFilesForDrag(card.dataset.id, card);
        }
      });

      gridEl.addEventListener('dragstart', (e) => {
        // Prevent dragging if user clicked on buttons or interactive elements
        if (e.target.closest('button, audio, video')) {
          e.preventDefault();
          return;
        }

        const card = e.target.closest('.media-item');
        if (card && card.dataset.id) {
          // Handle drag start - uses pre-downloaded files
          this.handleDragStart(e, card.dataset.id);
        }
      });

      gridEl.addEventListener('dragend', (e) => {
        const card = e.target.closest('.media-item');
        if (card) {
          this.handleDragEnd(e);
        }
      });

      gridEl._dragHandlersSetup = true;
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
    if (this.selectedItems.has(itemId)) {
      this.selectedItems.delete(itemId);
    } else {
      this.selectedItems.add(itemId);
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

  async prepareFilesForDrag(itemId, cardElement) {
    // Prevent multiple simultaneous downloads
    if (this.downloadingForDrag) {
      console.log('[Drag] Already downloading, skipping...');
      return;
    }

    console.log('[Drag] prepareFilesForDrag called for:', itemId);

    // Don't change selection - just use whatever is currently selected
    // If item is not selected, it will be handled in dragstart
    const itemsToDownload = this.selectedItems.has(itemId)
      ? Array.from(this.selectedItems)
      : [itemId];

    // Build items array
    const items = itemsToDownload.map(id => {
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
        thumbnailUrl: mediaItem.thumbnailUrl
      };
    }).filter(item => item !== null);

    if (items.length === 0) {
      console.error('[Drag] No valid items');
      if (cardElement) cardElement.classList.remove('downloading');
      return;
    }

    try {
      this.downloadingForDrag = true;

      console.log('[Drag] Downloading files:', items);
      const result = await window.electronBridge.prepareDrag(items);

      if (result && result.success) {
        // Extract file paths from results array
        const filePaths = result.results
          .filter(r => r.success)
          .map(r => r.filePath);
        const thumbnailPaths = result.results
          .filter(r => r.success && r.thumbnailPath)
          .map(r => r.thumbnailPath);

        this.preparedDragData = {
          filePaths,
          thumbnailPaths
        };
        console.log('[Drag] Files prepared:', this.preparedDragData);
      } else {
        console.error('[Drag] Download failed:', result);
        this.preparedDragData = null;
      }
    } catch (error) {
      console.error('[Drag] Error downloading:', error);
      this.preparedDragData = null;
    } finally {
      this.downloadingForDrag = false;
      // Remove downloading state after download completes
      if (cardElement) {
        cardElement.classList.remove('downloading');
      }
    }
  }

  async handleDragStart(e, itemId) {
    console.log('[Drag] handleDragStart called with itemId:', itemId);
    console.log('[Drag] Currently selected items:', Array.from(this.selectedItems));
    console.log('[Drag] Total media items:', this.media.length);

    // DON'T change selection here - it was already handled in mousedown/prepareFilesForDrag
    // This prevents deselecting batch items during drag

    // Get selected media items
    const items = Array.from(this.selectedItems).map(id => {
      const mediaItem = this.media.find(m => m.id === id);
      if (!mediaItem) {
        console.error('[Drag] Media item not found for id:', id);
        return null;
      }

      // Use shorter filename for compatibility
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
        fileName: fileName,
        url: mediaItem.url,
        thumbnailUrl: mediaItem.thumbnailUrl
      };
    }).filter(item => item !== null);

    if (items.length === 0) {
      console.error('[Drag] No valid items to drag');
      return;
    }

    console.log('[Drag] Preparing to drag', items.length, 'file(s)...');

    // Calculate expected file paths (where files will be downloaded)
    const { app } = require('electron').remote || {};
    const cachePath = app ? app.getPath('userData') + '\\MediaCache\\' : 'C:\\Users\\Zohar\\AppData\\Roaming\\kolbo-desktop\\MediaCache\\';
    const expectedFilePaths = items.map(item => cachePath + item.fileName);

    console.log('[Drag] Expected file paths:', expectedFilePaths);

    // Check if files are already prepared from mousedown
    if (!this.preparedDragData) {
      console.error('[Drag] No prepared drag data! Files must be downloaded on mousedown before drag starts.');
      alert('Please click and hold for a moment before dragging to allow files to download.');
      return;
    }

    console.log('[Drag] Using prepared files:', this.preparedDragData.filePaths);

    // Remove downloading state
    const card = e.target.closest('.media-item');
    if (card) card.classList.remove('downloading');

    // Use the prepared file paths
    const filePaths = this.preparedDragData.filePaths;

    // Set drag data with file URIs
    const uriList = filePaths.map(fp => {
      const normalized = fp.replace(/\\/g, '/');
      return `file:///${normalized}`;
    }).join('\n');

    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/uri-list', uriList);
    e.dataTransfer.setData('text/plain', filePaths.join('\n'));

    console.log('[Drag] Drag data set:', filePaths);

    // Call Electron's startDrag()
    if (window.electronBridge && window.electronBridge.startDrag) {
      window.electronBridge.startDrag(filePaths, []).catch(err => {
        console.error('[Drag] Electron startDrag error:', err);
      });
    }
  }

  // Reveal file in Windows Explorer
  async revealFileInExplorer(itemId) {
    console.log('[Reveal] Revealing file for item:', itemId);

    try {
      // Find the media item
      const mediaItem = this.media.find(m => m.id === itemId);
      if (!mediaItem) {
        console.error('[Reveal] Media item not found');
        return;
      }

      // Get filename
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

      // First, ensure file is downloaded
      const items = [{
        id: mediaItem.id,
        fileName: fileName,
        url: mediaItem.url,
        thumbnailUrl: mediaItem.thumbnailUrl
      }];

      const prepareResult = await window.electronBridge.prepareDrag(items);

      if (prepareResult.success && prepareResult.results[0]?.filePath) {
        const filePath = prepareResult.results[0].filePath;

        // Open file in Explorer (shell.showItemInFolder)
        if (window.kolboDesktop && window.kolboDesktop.revealFileInFolder) {
          await window.kolboDesktop.revealFileInFolder(filePath);
        } else {
          alert(`File location:\n${filePath}\n\nOpen this folder manually in File Explorer.`);
        }
      } else {
        alert('Failed to prepare file. Please try again.');
      }
    } catch (error) {
      console.error('[Reveal] Error:', error);
      alert('Failed to reveal file: ' + error.message);
    }
  }

  handleDragEnd(e) {
    console.log('[Drag] handleDragEnd called');

    // Cleanup drag state - remove visual states
    document.querySelectorAll('.media-item.dragging, .media-item.downloading').forEach(item => {
      item.classList.remove('dragging');
      item.classList.remove('downloading');
    });

    // Clear prepared drag data
    this.preparedDragData = null;

    console.log('[Drag] Drag operation complete');
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

      // Setup update event listeners (only once)
      if (!this._updateListenersSetup) {
        this._updateListenersSetup = true;

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

  showUpdateAvailable(info) {
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

      // Disable button
      if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = `
          <div class="spinner" style="width: 14px; height: 14px; border: 2px solid white; border-top-color: transparent;"></div>
          Downloading...
        `;
      }

      console.log('[Update] Starting download');
      await window.kolboDesktop.downloadUpdate();
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

  console.log('[Video] Initializing background video...');
  console.log('[Video] Video src:', video.currentSrc || video.src);
  console.log('[Video] Video source element:', video.querySelector('source')?.src);

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
      console.log('[Video] Video is now playing');
      console.log('[Video] Video paused:', video.paused);
      console.log('[Video] Video readyState:', video.readyState);
    } catch (err) {
      console.error('[Video] Play failed:', err);
      console.log('[Video] Video paused:', video.paused);
      console.log('[Video] Video readyState:', video.readyState);
    }
  };

  video.addEventListener('loadedmetadata', () => {
    console.log('[Video] Video metadata loaded');
    console.log('[Video] Video dimensions:', video.videoWidth, 'x', video.videoHeight);
    // Ensure video element has explicit dimensions
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      console.log('[Video] Video has valid dimensions, setting styles');
      video.style.width = '100%';
      video.style.height = '100%';
    }
  });

  // Force video to load and play
  video.addEventListener('loadeddata', () => {
    console.log('[Video] Video data loaded, readyState:', video.readyState);
    console.log('[Video] Video dimensions after loadeddata:', video.videoWidth, 'x', video.videoHeight);
    // Force dimensions if still 0
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      console.warn('[Video] Video dimensions are 0, forcing size via CSS');
      video.style.width = '100vw';
      video.style.height = '100vh';
    }
    attemptPlay();
  });

  video.addEventListener('canplay', () => {
    console.log('[Video] Video can play, readyState:', video.readyState);
    console.log('[Video] Video dimensions at canplay:', video.videoWidth, 'x', video.videoHeight);
    attemptPlay();
  });

  video.addEventListener('canplaythrough', () => {
    console.log('[Video] Video can play through');
    attemptPlay();
  });

  video.addEventListener('playing', () => {
    console.log('[Video] Video is now playing!');
    console.log('[Video] Video currentTime:', video.currentTime);
    console.log('[Video] Video duration:', video.duration);
    console.log('[Video] Video videoWidth:', video.videoWidth);
    console.log('[Video] Video videoHeight:', video.videoHeight);
    
    // Force video to be visible even if dimensions are 0
    // This handles cases where metadata doesn't load properly
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.display = 'block';
    video.style.visibility = 'visible';
    video.style.opacity = '1';
    
    // Check dimensions again after a short delay
    setTimeout(() => {
      console.log('[Video] Delayed check - dimensions:', video.videoWidth, 'x', video.videoHeight);
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        console.warn('[Video] Video still has 0 dimensions, but forcing visibility');
        // Force container to show video
        const container = video.parentElement;
        if (container) {
          container.style.width = '100%';
          container.style.height = '100%';
        }
      }
    }, 500);
  });

  video.addEventListener('play', () => {
    console.log('[Video] Play event fired');
  });

  video.addEventListener('pause', () => {
    console.warn('[Video] Video was paused');
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
  
  // Debug function to check video visibility
  const checkVideoVisibility = () => {
    const styles = window.getComputedStyle(video);
    const rect = video.getBoundingClientRect();
    console.log('[Video] Computed styles:', {
      width: styles.width,
      height: styles.height,
      display: styles.display,
      visibility: styles.visibility,
      opacity: styles.opacity,
      zIndex: styles.zIndex,
      position: styles.position
    });
    console.log('[Video] Bounding rect:', {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left
    });
    console.log('[Video] Video element dimensions:', {
      offsetWidth: video.offsetWidth,
      offsetHeight: video.offsetHeight,
      clientWidth: video.clientWidth,
      clientHeight: video.clientHeight
    });
  };
  
  // Ensure video loads
  video.load();
  console.log('[Video] Video load() called');
  
  // Check visibility after load
  setTimeout(checkVideoVisibility, 200);
  
  // Try to play immediately (might fail due to autoplay policy)
  setTimeout(() => {
    attemptPlay();
  }, 100);

  // Also try after a short delay
  setTimeout(() => {
    attemptPlay();
  }, 500);
  
  // Final check after video should be playing
  setTimeout(() => {
    console.log('[Video] Final check - playing:', !video.paused, 'dimensions:', video.videoWidth, 'x', video.videoHeight);
    checkVideoVisibility();
    if (!video.paused && (video.videoWidth === 0 || video.videoHeight === 0)) {
      console.warn('[Video] Video is playing but has no dimensions - this may indicate a codec issue');
      // Force visibility anyway
      video.style.width = '100vw';
      video.style.height = '100vh';
      video.style.minWidth = '100%';
      video.style.minHeight = '100%';
      checkVideoVisibility();
    }
  }, 1000);

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
