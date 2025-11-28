// ============================================================================
// TAB MANAGER - Multi-tab system for Kolbo Desktop
// ============================================================================
//
// PURPOSE:
// Manages multiple tabs in the Web App view, allowing users to open multiple
// Kolbo.ai pages simultaneously (chat, image tools, video tools, etc.)
//
// ARCHITECTURE:
// - Each tab has its own iframe
// - Tabs are stored in an array with metadata (id, title, url, iframe)
// - Active tab is displayed, others are hidden
// - Tab state persists across app restarts
//
// ============================================================================

class TabManager {
  constructor() {
    this.tabs = [];
    this.activeTabId = null;
    this.nextTabId = 1;
    this.MAX_TABS = 10;
    this.DEBUG_MODE = window.KOLBO_CONFIG ? window.KOLBO_CONFIG.debug : false;

    // Cache webapp URL to avoid multiple calls
    this._cachedWebappUrl = null;

    // Generate unique ID for this window instance to avoid localStorage conflicts
    this.windowId = `win_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // DOM elements
    this.tabList = document.getElementById('tab-list');
    this.iframeContainer = document.getElementById('iframe-container');
    this.newTabBtn = document.getElementById('new-tab-btn');
    this.loadingEl = document.getElementById('webapp-loading');

    // Default Kolbo.ai URLs
    this.defaultUrls = {
      home: this.getWebappUrl(),
      chat: `${this.getWebappUrl()}/chat`,
      imageTools: `${this.getWebappUrl()}/image-tools`,
      videoTools: `${this.getWebappUrl()}/video-tools`,
    };

    this.init();
  }

  getWebappUrl() {
    // Return cached URL if already determined
    if (this._cachedWebappUrl) {
      return this._cachedWebappUrl;
    }

    let url;

    // PRIORITY 1: Use centralized config from config.js (respects build environment)
    if (typeof window !== 'undefined' && window.KOLBO_CONFIG && window.KOLBO_CONFIG.webappUrl) {
      url = window.KOLBO_CONFIG.webappUrl;
      if (this.DEBUG_MODE) {
        console.log('[TabManager] Using webapp URL from KOLBO_CONFIG:', url);
      }
    }
    // PRIORITY 2: Manual override via localStorage (for debugging/testing)
    else if (localStorage.getItem('WEBAPP_ENVIRONMENT')) {
      const env = localStorage.getItem('WEBAPP_ENVIRONMENT');
      if (env === 'localhost') {
        url = 'http://localhost:8080';
      } else if (env === 'staging') {
        url = 'https://staging.kolbo.ai';
      } else if (env === 'production') {
        url = 'https://app.kolbo.ai';
      }
    }
    // PRIORITY 3: Auto-detect from Electron environment
    else if (typeof window !== 'undefined' && window.kolboDesktop && window.kolboDesktop.environment) {
      const electronEnv = window.kolboDesktop.environment;
      if (electronEnv === 'development') {
        url = 'http://localhost:8080';
      } else if (electronEnv === 'staging') {
        url = 'https://staging.kolbo.ai';
      } else if (electronEnv === 'production') {
        url = 'https://app.kolbo.ai';
      }
    }
    // PRIORITY 4: Fallback to production
    else {
      console.warn('[TabManager] Could not detect environment, defaulting to production');
      url = 'https://app.kolbo.ai';
    }

    // Cache the result
    this._cachedWebappUrl = url;
    return url;
  }

  /**
   * Check if saved tabs are from a different environment and clear them if needed
   * This prevents using production URLs in development and vice versa
   */
  checkAndClearStaleTabsIfNeeded() {
    try {
      const savedTabs = localStorage.getItem('kolbo_tabs');
      if (!savedTabs) return;

      const currentWebappUrl = this.getWebappUrl();
      const currentEnvironment = this.getCurrentEnvironment();

      // Get saved environment (if stored)
      const savedEnvironment = localStorage.getItem('kolbo_tabs_environment');

      // If environment changed, clear saved tabs
      if (savedEnvironment && savedEnvironment !== currentEnvironment) {
        console.log(`[TabManager] Environment changed: ${savedEnvironment} → ${currentEnvironment}`);
        console.log('[TabManager] Clearing saved tabs to prevent URL mismatch');
        localStorage.removeItem('kolbo_tabs');
        localStorage.removeItem('kolbo_active_tab');
      }

      // Store current environment for next time
      localStorage.setItem('kolbo_tabs_environment', currentEnvironment);

    } catch (error) {
      console.error('[TabManager] Error checking stale tabs:', error);
    }
  }

  /**
   * Get current environment name
   */
  getCurrentEnvironment() {
    if (window.KOLBO_CONFIG && window.KOLBO_CONFIG.environment) {
      return window.KOLBO_CONFIG.environment;
    }
    if (window.kolboDesktop && window.kolboDesktop.environment) {
      return window.kolboDesktop.environment;
    }
    const webappUrl = this.getWebappUrl();
    if (webappUrl.includes('localhost')) return 'development';
    if (webappUrl.includes('staging')) return 'staging';
    return 'production';
  }

  init() {
    if (this.DEBUG_MODE) {
      console.log('[TabManager] Initializing...');
    }

    // 🔧 ENVIRONMENT CHANGE DETECTION: Clear saved tabs if environment changed
    // This ensures tabs use the correct environment URL after switching
    this.checkAndClearStaleTabsIfNeeded();

    // Bind events
    if (this.newTabBtn) {
      this.newTabBtn.addEventListener('click', () => this.createTab());
    }

    // Load saved tabs or create default tab
    this.loadSavedTabs();

    // Setup keyboard shortcuts
    this.setupKeyboardShortcuts();

    // Setup global message listener for iframe title updates
    this.setupGlobalMessageListener();

    // Setup listener for opening specific tabs in new windows
    this.setupNewWindowTabListener();

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Initialized with', this.tabs.length, 'tabs');
    }
  }

  setupNewWindowTabListener() {
    // Listen for IPC message to open a specific tab URL
    // This is used when dragging a tab out to create a new window
    if (window.kolboDesktop && window.kolboDesktop.onOpenTabUrl) {
      window.kolboDesktop.onOpenTabUrl((url) => {
        if (this.DEBUG_MODE) {
          console.log('[TabManager] Received request to open tab with URL:', url);
        }

        // Close the default tab if it exists and hasn't been used
        if (this.tabs.length === 1 && this.tabs[0].url === this.defaultUrls.home) {
          const defaultTab = this.tabs[0];
          if (!defaultTab.loaded || defaultTab.url === this.defaultUrls.home) {
            // Replace default tab with the requested URL
            this.closeTab(defaultTab.id);
          }
        }

        // Create new tab with the specified URL
        this.createTab(url, null, true);
      });
    }
  }

  setupGlobalMessageListener() {
    window.addEventListener('message', (event) => {
      // Check for title update messages from iframes
      if (event.data && event.data.type === 'PAGE_TITLE_UPDATE') {
        const iframeId = event.data.iframeId;
        const title = event.data.title;

        // Find tab by iframe ID
        const tab = this.tabs.find(t => t.iframe.id === iframeId);
        if (tab && title) {
          this.updateTabTitle(tab.id, title);
        }
      }
    });
  }

  setupTitleListener(iframe, tabId) {
    // Inject script into iframe to send title updates (only works for same-origin)
    iframe.addEventListener('load', () => {
      try {
        if (iframe.contentWindow) {
          const script = iframe.contentDocument.createElement('script');
          script.textContent = `
            (function() {
              // Send initial title
              if (window.parent) {
                window.parent.postMessage({
                  type: 'PAGE_TITLE_UPDATE',
                  iframeId: '${iframe.id}',
                  title: document.title
                }, '*');
              }

              // Watch for title changes
              const titleObserver = new MutationObserver(() => {
                if (window.parent) {
                  window.parent.postMessage({
                    type: 'PAGE_TITLE_UPDATE',
                    iframeId: '${iframe.id}',
                    title: document.title
                  }, '*');
                }
              });

              titleObserver.observe(
                document.querySelector('title') || document.head,
                { subtree: true, characterData: true, childList: true }
              );
            })();
          `;
          iframe.contentDocument.head.appendChild(script);
        }
      } catch (e) {
        // Cross-origin iframe, can't inject script
        if (this.DEBUG_MODE) {
          console.log('[TabManager] Cannot inject title listener (cross-origin):', tabId);
        }
      }
    });
  }

  loadSavedTabs() {
    try {
      // Only load tabs if this is the main window (first one opened)
      // New windows (from drag-out) start fresh
      const isMainWindow = !window.opener; // window.opener is set if opened by another window

      if (isMainWindow) {
        const savedTabs = localStorage.getItem('kolbo_tabs');
        const savedActiveTabId = localStorage.getItem('kolbo_active_tab');

        if (savedTabs) {
          const tabsData = JSON.parse(savedTabs);
          if (Array.isArray(tabsData) && tabsData.length > 0) {
            // 🔧 FIX: Update saved URLs to use current environment's webapp URL
            // This prevents using production URLs when in development mode
            const currentWebappUrl = this.getWebappUrl();

            tabsData.forEach(tabData => {
              // Replace the base URL with the current environment's URL
              let updatedUrl = tabData.url;

              // Check if the saved URL is a Kolbo URL (not a custom URL)
              if (tabData.url.includes('app.kolbo.ai') ||
                  tabData.url.includes('staging.kolbo.ai') ||
                  tabData.url.includes('localhost:8080')) {

                // Extract the path (everything after the domain)
                const urlObj = new URL(tabData.url);
                const path = urlObj.pathname + urlObj.search + urlObj.hash;

                // Use current environment's base URL
                updatedUrl = path === '/' ? currentWebappUrl : currentWebappUrl + path;

                if (this.DEBUG_MODE) {
                  console.log(`[TabManager] Updated tab URL: ${tabData.url} → ${updatedUrl}`);
                }
              }

              this.createTab(updatedUrl, tabData.title, false);
            });

            // Restore active tab
            if (savedActiveTabId) {
              const activeTab = this.tabs.find(t => t.id === savedActiveTabId);
              if (activeTab) {
                this.switchTab(savedActiveTabId);
              } else {
                this.switchTab(this.tabs[0].id);
              }
            } else {
              this.switchTab(this.tabs[0].id);
            }

            return;
          }
        }
      }
    } catch (error) {
      console.error('[TabManager] Error loading saved tabs:', error);
    }

    // No saved tabs or new window, create default
    this.createTab(this.defaultUrls.home);
  }

  saveTabs() {
    try {
      // Only save tabs for the main window to avoid conflicts
      const isMainWindow = !window.opener;
      if (isMainWindow) {
        const tabsData = this.tabs.map(tab => ({
          url: tab.url,
          title: tab.title
        }));
        localStorage.setItem('kolbo_tabs', JSON.stringify(tabsData));
        localStorage.setItem('kolbo_active_tab', this.activeTabId);
      }
    } catch (error) {
      console.error('[TabManager] Error saving tabs:', error);
    }
  }

  createTab(url = null, title = null, switchTo = true) {
    // Check max tabs limit
    if (this.tabs.length >= this.MAX_TABS) {
      console.warn('[TabManager] Maximum number of tabs reached:', this.MAX_TABS);
      // Show toast notification
      this.showToast(`Maximum ${this.MAX_TABS} tabs allowed`);
      return null;
    }

    const tabId = `tab-${this.nextTabId++}`;
    const tabUrl = url || this.defaultUrls.home;
    const tabTitle = title || `Kolbo.AI ${this.tabs.length + 1}`;

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Creating tab:', tabId, tabTitle, tabUrl);
    }

    // Create iframe
    const iframe = document.createElement('iframe');
    iframe.id = `iframe-${tabId}`;
    iframe.className = 'tab-iframe';
    // Note: 'allow-downloads-without-user-activation' is not valid in Electron 28, removed
    iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads');

    // Add authentication token to URL
    // NOTE: Web app iframe has its own localStorage that persists the token,
    // but we pass it every time to ensure:
    // 1. First-time auto-login works
    // 2. Token stays synchronized if user re-logs in with different account
    // 3. Expired tokens get refreshed automatically
    // 4. The webapp knows it's embedded and won't try to do Google OAuth (which won't work in iframe)
    const token = window.kolboAPI?.getToken();
    if (token) {
      const separator = tabUrl.includes('?') ? '&' : '?';
      // Add source=desktop to identify the embedding context (like Adobe plugin does with source=adobe)
      // This tells the webapp to use the passed token and not show Google login options
      iframe.src = `${tabUrl}${separator}embedded=true&source=desktop&token=${encodeURIComponent(token)}`;

      if (this.DEBUG_MODE) {
        console.log(`[TabManager] Creating iframe with authentication token`);
        console.log(`[TabManager] Token (first 20 chars): ${token.substring(0, 20)}...`);
        console.log(`[TabManager] Full URL: ${tabUrl}${separator}embedded=true&source=desktop&token=${token.substring(0, 20)}...`);
      }
    } else {
      iframe.src = tabUrl;
      console.warn('[TabManager] No authentication token found - iframe will load without authentication');
      console.warn('[TabManager] User may need to login again in the web app');
    }

    // Create tab element
    const tabElement = document.createElement('div');
    tabElement.className = 'tab';
    tabElement.id = `tab-${tabId}`;
    tabElement.setAttribute('data-tab-id', tabId);
    tabElement.innerHTML = `
      <span class="tab-title">${this.escapeHtml(tabTitle)}</span>
      <button class="tab-close" title="Close tab (Ctrl+W)">
        <svg width="10" height="10" viewBox="0 0 12 12">
          <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
    `;

    // Tab object
    const tab = {
      id: tabId,
      title: tabTitle,
      url: tabUrl,
      element: tabElement,
      iframe: iframe,
      loaded: false
    };

    // Add event listeners
    tabElement.addEventListener('click', (e) => {
      if (!e.target.closest('.tab-close')) {
        this.switchTab(tabId);
      }
    });

    tabElement.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tabId);
    });

    // Add drag functionality
    this.setupTabDrag(tabElement, tab);

    // Handle iframe load
    iframe.addEventListener('load', () => {
      tab.loaded = true;
      if (this.DEBUG_MODE) {
        console.log('[TabManager] Tab iframe loaded:', tabId);
      }

      // Hide loading overlay if this is the active tab
      if (this.activeTabId === tabId && this.loadingEl) {
        this.loadingEl.style.display = 'none';
      }

      // Try to get page title from iframe (if same-origin)
      try {
        const iframeTitle = iframe.contentDocument?.title;
        if (iframeTitle && iframeTitle !== tabTitle) {
          this.updateTabTitle(tabId, iframeTitle);
        }
      } catch (e) {
        // Cross-origin, can't access title - will use postMessage
      }
    });

    // Listen for title updates from iframe via postMessage
    this.setupTitleListener(iframe, tabId);

    // Add to DOM - insert tab BEFORE the new-tab button
    const newTabBtn = document.getElementById('new-tab-btn');
    if (newTabBtn && newTabBtn.parentNode === this.tabList) {
      this.tabList.insertBefore(tabElement, newTabBtn);
    } else {
      this.tabList.appendChild(tabElement);
    }
    this.iframeContainer.appendChild(iframe);

    // Add to tabs array
    this.tabs.push(tab);

    // Switch to new tab if requested
    if (switchTo) {
      this.switchTab(tabId);
    }

    // Save tabs
    this.saveTabs();

    return tab;
  }

  closeTab(tabId) {
    const tabIndex = this.tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;

    // Don't close if it's the last tab
    if (this.tabs.length === 1) {
      if (this.DEBUG_MODE) {
        console.log('[TabManager] Cannot close last tab');
      }
      return;
    }

    const tab = this.tabs[tabIndex];

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Closing tab:', tabId);
    }

    // If closing active tab, switch to another tab
    if (this.activeTabId === tabId) {
      const newActiveIndex = tabIndex > 0 ? tabIndex - 1 : tabIndex + 1;
      const newActiveTab = this.tabs[newActiveIndex];
      this.switchTab(newActiveTab.id);
    }

    // Remove from DOM
    tab.element.remove();
    tab.iframe.remove();

    // Remove from array
    this.tabs.splice(tabIndex, 1);

    // Save tabs
    this.saveTabs();
  }

  switchTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Switching to tab:', tabId);
    }

    // Update active tab ID
    this.activeTabId = tabId;

    // Update UI
    this.tabs.forEach(t => {
      t.element.classList.toggle('active', t.id === tabId);
      t.iframe.classList.toggle('active', t.id === tabId);
    });

    // Show/hide loading based on tab loaded state
    if (this.loadingEl) {
      if (tab.loaded) {
        this.loadingEl.style.display = 'none';
      } else {
        this.loadingEl.style.display = 'flex';
      }
    }

    // Save tabs
    this.saveTabs();
  }

  updateTabTitle(tabId, newTitle) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    tab.title = newTitle;
    const titleElement = tab.element.querySelector('.tab-title');
    if (titleElement) {
      titleElement.textContent = newTitle;
    }

    // Save tabs
    this.saveTabs();
  }

  getActiveTab() {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+T or Cmd+T - New tab
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        this.createTab();
      }

      // Ctrl+W or Cmd+W - Close active tab
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault();
        if (this.activeTabId) {
          this.closeTab(this.activeTabId);
        }
      }

      // Ctrl+Tab - Next tab
      if (e.ctrlKey && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        this.switchToNextTab();
      }

      // Ctrl+Shift+Tab - Previous tab
      if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        this.switchToPreviousTab();
      }

      // Ctrl+1-9 - Switch to tab by index
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (this.tabs[index]) {
          this.switchTab(this.tabs[index].id);
        }
      }
    });
  }

  switchToNextTab() {
    const currentIndex = this.tabs.findIndex(t => t.id === this.activeTabId);
    const nextIndex = (currentIndex + 1) % this.tabs.length;
    this.switchTab(this.tabs[nextIndex].id);
  }

  switchToPreviousTab() {
    const currentIndex = this.tabs.findIndex(t => t.id === this.activeTabId);
    const prevIndex = currentIndex === 0 ? this.tabs.length - 1 : currentIndex - 1;
    this.switchTab(this.tabs[prevIndex].id);
  }

  setupTabDrag(tabElement, tab) {
    // Tab dragging is disabled
    // Users cannot drag tabs out of the application window
    tabElement.setAttribute('draggable', 'false');
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showToast(message) {
    const toast = document.getElementById('toast-notification');
    if (toast) {
      const messageEl = toast.querySelector('.toast-message');
      if (messageEl) {
        messageEl.textContent = message;
      }
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }
  }

  // Cleanup
  destroy() {
    this.tabs.forEach(tab => {
      tab.element.remove();
      tab.iframe.remove();
    });
    this.tabs = [];
    this.activeTabId = null;
  }
}

// Make TabManager globally available
window.TabManager = TabManager;
