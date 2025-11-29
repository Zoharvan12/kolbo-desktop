// ============================================================================
// TAB MANAGER - Multi-tab system for Kolbo Studio
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
    this.initialized = false; // Track initialization state

    // Cache webapp URL to avoid multiple calls
    this._cachedWebappUrl = null;

    // Generate unique ID for this window instance to avoid localStorage conflicts
    this.windowId = `win_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Merged tabs tracking
    this.mergedTabs = new Map(); // mergedTabId -> { leftTabId, rightTabId, leftPane, rightPane, divider, activePaneId, splitRatio }

    // DOM elements
    this.tabList = document.getElementById('tab-list');
    this.iframeContainer = document.getElementById('iframe-container');
    this.newTabBtn = document.getElementById('new-tab-btn');
    this.splitViewBtn = document.getElementById('split-view-btn');
    this.splitPresetsContainer = document.getElementById('split-presets');
    this.loadingEl = document.getElementById('webapp-loading');
    this.backBtn = document.getElementById('webapp-back-btn');
    this.forwardBtn = document.getElementById('webapp-forward-btn');
    this.refreshBtn = document.getElementById('webapp-refresh-btn');
    this.zoomInBtn = document.getElementById('webapp-zoom-in-btn');
    this.zoomOutBtn = document.getElementById('webapp-zoom-out-btn');

    // Default Kolbo.ai URLs
    this.defaultUrls = {
      home: this.getWebappUrl(),
      chat: `${this.getWebappUrl()}/chat`,
      imageTools: `${this.getWebappUrl()}/image-tools`,
      videoTools: `${this.getWebappUrl()}/video-tools`,
    };

    // Initialize asynchronously (can't await in constructor)
    this.init().then(() => {
      this.initialized = true;
      if (this.DEBUG_MODE) {
        console.log('[TabManager] Async initialization complete');
      }
    }).catch(err => {
      console.error('[TabManager] Initialization error:', err);
    });
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
      // ALWAYS log for debugging
      console.log('[TabManager] 📍 Using webapp URL from KOLBO_CONFIG:', url);
      console.log('[TabManager] 📍 Environment:', window.KOLBO_CONFIG.environment);
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

  async init() {
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

    // Bind split view button
    if (this.splitViewBtn) {
      this.splitViewBtn.addEventListener('click', () => this.toggleSplitView());
    }

    // Bind split preset buttons
    if (this.splitPresetsContainer) {
      const presetButtons = this.splitPresetsContainer.querySelectorAll('.split-preset-btn');
      presetButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          const ratio = parseFloat(e.currentTarget.getAttribute('data-ratio'));
          this.applySplitPreset(ratio);
        });
      });
    }

    // Bind navigation button events
    if (this.backBtn) {
      this.backBtn.addEventListener('click', () => this.goBack());
    }
    if (this.forwardBtn) {
      this.forwardBtn.addEventListener('click', () => this.goForward());
    }
    if (this.refreshBtn) {
      this.refreshBtn.addEventListener('click', () => this.refresh());
    }
    if (this.zoomInBtn) {
      this.zoomInBtn.addEventListener('click', () => this.zoomIn());
    }
    if (this.zoomOutBtn) {
      this.zoomOutBtn.addEventListener('click', () => this.zoomOut());
    }

    // Load saved tabs or create default tab (MUST AWAIT!)
    await this.loadSavedTabs();

    // Setup keyboard shortcuts
    this.setupKeyboardShortcuts();

    // Setup global message listener for iframe title updates
    this.setupGlobalMessageListener();

    // Setup listener for opening specific tabs in new windows
    this.setupNewWindowTabListener();

    // Auto-save state on window close/blur to preserve user's work
    this.setupAutoSave();

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Initialized with', this.tabs.length, 'tabs');
    }
  }

  setupAutoSave() {
    // Save state before window closes
    window.addEventListener('beforeunload', () => {
      this.saveTabs();
    });

    // Auto-save every 30 seconds to prevent data loss
    setInterval(() => {
      this.saveTabs();
    }, 30000);

    // Save on visibility change (when user switches away)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.saveTabs();
      }
    });

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Auto-save enabled (30s interval + beforeunload)');
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

  async loadSavedTabs() {
    try {
      // Only load tabs if this is the main window (first one opened)
      // New windows (from drag-out) start fresh
      const isMainWindow = !window.opener; // window.opener is set if opened by another window

      if (isMainWindow) {
        // Try to load new state format first
        const savedState = localStorage.getItem('kolbo_tabs_state');

        if (savedState) {
          const state = JSON.parse(savedState);

          if (state.tabs && Array.isArray(state.tabs) && state.tabs.length > 0) {
            const currentWebappUrl = this.getWebappUrl();
            const tabIdMap = new Map(); // Map old IDs to new IDs

            if (this.DEBUG_MODE) {
              console.log('[TabManager] Restoring state:', state);
            }

            // Create all regular tabs first
            for (const tabData of state.tabs) {
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

              const newTab = await this.createTab(updatedUrl, tabData.title, false);
              if (newTab && tabData.id) {
                tabIdMap.set(tabData.id, newTab.id);

                // Restore zoom level if saved
                if (tabData.zoomLevel && tabData.zoomLevel !== 1.0) {
                  newTab.zoomLevel = tabData.zoomLevel;
                  this.applyZoom(newTab);
                }
              }
            }

            // Restore merged tabs if any
            if (state.mergedTabs && state.mergedTabs.length > 0) {
              for (const mergedData of state.mergedTabs) {
                const leftTabId = tabIdMap.get(mergedData.leftTabId);
                const rightTabId = tabIdMap.get(mergedData.rightTabId);

                if (leftTabId && rightTabId) {
                  // Find the tabs
                  const leftTab = this.tabs.find(t => t.id === leftTabId);
                  const rightTab = this.tabs.find(t => t.id === rightTabId);

                  if (leftTab && rightTab) {
                    // Create merged tab
                    const currentIndex = this.tabs.indexOf(leftTab);
                    this.activeTabId = leftTab.id; // Set active to left tab for createMergedTab

                    // Store the desired split ratio before creating
                    const desiredRatio = mergedData.splitRatio || 0.5;

                    this.createMergedTab();

                    // Apply the saved split ratio
                    if (this.tabs.length > 0) {
                      const mergedTab = this.tabs[this.tabs.length - 1];
                      if (mergedTab.isMerged) {
                        // Wait for next tick to ensure merged tab is fully created
                        setTimeout(() => {
                          this.activeTabId = mergedTab.id;
                          this.applySplitPreset(desiredRatio);
                        }, 100);
                      }
                    }

                    if (this.DEBUG_MODE) {
                      console.log('[TabManager] Restored merged tab with ratio:', desiredRatio);
                    }
                  }
                }
              }
            }

            // Restore active tab
            if (state.activeTabId) {
              // Check if active tab was a merged tab
              const wasMergedTab = state.mergedTabs &&
                state.mergedTabs.some(m => m.mergedId === state.activeTabId);

              if (wasMergedTab) {
                // Find the recreated merged tab (it will be the last one)
                const mergedTab = this.tabs.find(t => t.isMerged);
                if (mergedTab) {
                  this.switchTab(mergedTab.id);
                } else {
                  this.switchTab(this.tabs[0].id);
                }
              } else {
                // Regular tab - map old ID to new ID
                const newActiveTabId = tabIdMap.get(state.activeTabId);
                const activeTab = this.tabs.find(t => t.id === newActiveTabId);
                if (activeTab) {
                  this.switchTab(activeTab.id);
                } else {
                  this.switchTab(this.tabs[0].id);
                }
              }
            } else {
              this.switchTab(this.tabs[0].id);
            }

            if (this.DEBUG_MODE) {
              console.log('[TabManager] State restored successfully');
            }

            return;
          }
        }

        // Fallback: Try old format (backward compatibility)
        const savedTabs = localStorage.getItem('kolbo_tabs');
        if (savedTabs) {
          const tabsData = JSON.parse(savedTabs);
          if (Array.isArray(tabsData) && tabsData.length > 0) {
            const currentWebappUrl = this.getWebappUrl();

            for (const tabData of tabsData) {
              let updatedUrl = tabData.url;

              if (tabData.url.includes('app.kolbo.ai') ||
                  tabData.url.includes('staging.kolbo.ai') ||
                  tabData.url.includes('localhost:8080')) {

                const urlObj = new URL(tabData.url);
                const path = urlObj.pathname + urlObj.search + urlObj.hash;
                updatedUrl = path === '/' ? currentWebappUrl : currentWebappUrl + path;
              }

              await this.createTab(updatedUrl, tabData.title, false);
            }

            this.switchTab(this.tabs[0].id);
            return;
          }
        }
      }
    } catch (error) {
      console.error('[TabManager] Error loading saved tabs:', error);
    }

    // No saved tabs or new window, create default
    await this.createTab(this.defaultUrls.home);
  }

  saveTabs() {
    try {
      // Only save tabs for the main window to avoid conflicts
      const isMainWindow = !window.opener;
      if (isMainWindow) {
        const tabsData = this.tabs
          .filter(tab => !tab.isMerged) // Don't save merged tabs, we'll recreate them
          .map(tab => ({
            url: tab.url,
            title: tab.title,
            id: tab.id,
            zoomLevel: tab.zoomLevel || 1.0
          }));

        // Save merged tabs info separately
        const mergedTabsData = [];
        this.mergedTabs.forEach((data, mergedId) => {
          mergedTabsData.push({
            mergedId: mergedId,
            leftTabId: data.leftTabId,
            rightTabId: data.rightTabId,
            splitRatio: data.splitRatio || 0.5,
            activePaneId: data.activePaneId || 'left'
          });
        });

        const state = {
          tabs: tabsData,
          activeTabId: this.activeTabId,
          mergedTabs: mergedTabsData,
          timestamp: Date.now()
        };

        localStorage.setItem('kolbo_tabs_state', JSON.stringify(state));

        if (this.DEBUG_MODE) {
          console.log('[TabManager] Saved state:', state);
        }
      }
    } catch (error) {
      console.error('[TabManager] Error saving tabs:', error);
    }
  }

  async createTab(url = null, title = null, switchTo = true) {
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

    // IMPORTANT: Sync token from main process (electron-store) before creating iframe
    // This ensures Google OAuth tokens are available immediately after login
    if (window.kolboAPI && typeof window.kolboAPI.syncTokenFromMainProcess === 'function') {
      try {
        await window.kolboAPI.syncTokenFromMainProcess();
      } catch (error) {
        console.error('[TabManager] Error syncing token from main process:', error);
      }
    }

    const token = window.kolboAPI?.getToken();
    if (token) {
      const separator = tabUrl.includes('?') ? '&' : '?';
      // Add source=desktop to identify the embedding context (like Adobe plugin does with source=adobe)
      // This tells the webapp to use the passed token and not show Google login options
      iframe.src = `${tabUrl}${separator}embedded=true&source=desktop&token=${encodeURIComponent(token)}`;

      // ALWAYS log iframe URL for debugging (even if not in debug mode)
      console.log(`[TabManager] 🌐 Creating iframe with URL: ${tabUrl}${separator}embedded=true&source=desktop&token=***`);
      console.log(`[TabManager] 🔑 Token (first 20 chars): ${token.substring(0, 20)}...`);
      console.log(`[TabManager] ✅ Token synced from main process`);
    } else {
      iframe.src = tabUrl;
      console.error('[TabManager] ❌ No authentication token found - iframe will load without authentication');
      console.error('[TabManager] ⚠️ URL being loaded:', tabUrl);
      console.error('[TabManager] ⚠️ User may need to login again in the web app');
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
      loaded: false,
      zoomLevel: 1.0 // 100% zoom by default
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

    // Update split view button state
    this.updateSplitViewButtonState();

    // Save tabs
    this.saveTabs();

    return tab;
  }

  closeTab(tabId) {
    const tabIndex = this.tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;

    const tab = this.tabs[tabIndex];

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Closing tab:', tabId);
    }

    // Handle merged tab closing
    if (tab.isMerged) {
      // Get the original tabs
      const leftTab = this.tabs.find(t => t.id === tab.leftTabId);
      const rightTab = this.tabs.find(t => t.id === tab.rightTabId);

      // Get the merged tab data to access the iframes
      const mergedData = this.mergedTabs.get(tabId);

      if (this.DEBUG_MODE) {
        console.log('[TabManager] Closing merged tab, restoring original tabs:', tab.leftTabId, tab.rightTabId);
      }

      // Remove CSS classes from iframes to restore normal layout (NO DOM MOVING!)
      if (mergedData) {
        if (mergedData.leftIframe) {
          mergedData.leftIframe.classList.remove('split-left-iframe', 'split-active');
          mergedData.leftIframe.style.width = '';
          mergedData.leftIframe.style.left = '';
          mergedData.leftIframe.style.right = '';
          mergedData.leftIframe.classList.remove('active');
          if (this.DEBUG_MODE) {
            console.log('[TabManager] Restored left iframe CSS:', leftTab.id);
          }
        }
        if (mergedData.rightIframe) {
          mergedData.rightIframe.classList.remove('split-right-iframe', 'split-active');
          mergedData.rightIframe.style.width = '';
          mergedData.rightIframe.style.left = '';
          mergedData.rightIframe.style.right = '';
          mergedData.rightIframe.classList.remove('active');
          if (this.DEBUG_MODE) {
            console.log('[TabManager] Restored right iframe CSS:', rightTab.id);
          }
        }
      }

      // Remove merged tab element and overlay from DOM
      tab.element.remove();
      tab.iframe.remove();

      // Remove from array
      this.tabs.splice(tabIndex, 1);

      // Remove from merged tabs map
      this.mergedTabs.delete(tabId);

      // Restore original tabs visibility
      if (leftTab) {
        leftTab.element.style.display = '';
      }
      if (rightTab) {
        rightTab.element.style.display = '';
      }

      // Switch to left tab (which will properly show its iframe)
      if (leftTab) {
        this.switchTab(leftTab.id);
      } else if (rightTab) {
        this.switchTab(rightTab.id);
      }

      // Update split view button state
      this.updateSplitViewButtonState();

      // Save tabs
      this.saveTabs();

      if (this.DEBUG_MODE) {
        console.log('[TabManager] Merged tab closed successfully');
      }

      return;
    }

    // Don't close if it's the last non-hidden tab
    const visibleTabs = this.tabs.filter(t => t.element.style.display !== 'none');
    if (visibleTabs.length === 1) {
      if (this.DEBUG_MODE) {
        console.log('[TabManager] Cannot close last visible tab');
      }
      return;
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

    // Update split view button state
    this.updateSplitViewButtonState();

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

    // Update UI - only visible tabs
    this.tabs.forEach(t => {
      if (t.element.style.display !== 'none') {
        t.element.classList.toggle('active', t.id === tabId);
      }
      t.iframe.classList.toggle('active', t.id === tabId);
    });

    // Apply zoom for the active tab
    if (tab.zoomLevel && tab.zoomLevel !== 1.0) {
      this.applyZoom(tab);
    }

    // Handle merged tab - ensure both iframes are visible
    if (tab.isMerged) {
      const mergedData = this.mergedTabs.get(tabId);
      if (mergedData) {
        // Show both split iframes
        mergedData.leftIframe.style.display = 'block';
        mergedData.rightIframe.style.display = 'block';

        if (this.DEBUG_MODE) {
          console.log('[TabManager] Showing split iframes for merged tab:', tabId);
        }
      }
    } else {
      // Hide any split iframes from other merged tabs
      this.mergedTabs.forEach((data, mergedId) => {
        if (mergedId !== tabId) {
          // Don't hide them, let the normal active class handle it
        }
      });
    }

    // Show/hide loading based on tab loaded state
    if (this.loadingEl) {
      if (tab.loaded) {
        this.loadingEl.style.display = 'none';
      } else {
        this.loadingEl.style.display = 'flex';
      }
    }

    // Update split view button state
    this.updateSplitViewButtonState();

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

      // Ctrl+Shift+S - Toggle split view (create/close merged tab)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        this.toggleSplitView();
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
        if (this.tabs[index] && this.tabs[index].element.style.display !== 'none') {
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

  /**
   * Navigate back in the active tab's iframe
   * Uses postMessage to communicate with the iframe since direct access is blocked by CORS
   */
  goBack() {
    const activeTab = this.getActiveTab();
    if (!activeTab || !activeTab.iframe) {
      console.warn('[TabManager] No active tab for navigation');
      return;
    }

    try {
      // Send postMessage to iframe to navigate back
      activeTab.iframe.contentWindow.postMessage({
        type: 'NAVIGATE_BACK'
      }, '*');

      if (this.DEBUG_MODE) {
        console.log('[TabManager] Sent navigate back message to tab:', activeTab.id);
      }
    } catch (error) {
      console.error('[TabManager] Error navigating back:', error);
    }
  }

  /**
   * Navigate forward in the active tab's iframe
   * Uses postMessage to communicate with the iframe since direct access is blocked by CORS
   */
  goForward() {
    const activeTab = this.getActiveTab();
    if (!activeTab || !activeTab.iframe) {
      console.warn('[TabManager] No active tab for navigation');
      return;
    }

    try {
      // Send postMessage to iframe to navigate forward
      activeTab.iframe.contentWindow.postMessage({
        type: 'NAVIGATE_FORWARD'
      }, '*');

      if (this.DEBUG_MODE) {
        console.log('[TabManager] Sent navigate forward message to tab:', activeTab.id);
      }
    } catch (error) {
      console.error('[TabManager] Error navigating forward:', error);
    }
  }

  /**
   * Refresh/reload the active tab's iframe current page
   * Uses postMessage to communicate with the iframe since direct access is blocked by CORS
   */
  refresh() {
    const activeTab = this.getActiveTab();
    if (!activeTab || !activeTab.iframe) {
      console.warn('[TabManager] No active tab to refresh');
      return;
    }

    try {
      // Send postMessage to iframe to reload current page
      activeTab.iframe.contentWindow.postMessage({
        type: 'RELOAD_PAGE'
      }, '*');

      if (this.DEBUG_MODE) {
        console.log('[TabManager] Sent reload message to tab:', activeTab.id);
      }
    } catch (error) {
      console.error('[TabManager] Error refreshing:', error);
    }
  }

  zoomIn() {
    try {
      const activeTab = this.tabs.find(t => t.id === this.activeTabId);
      if (!activeTab) return;

      // Increase zoom by 10% (0.1)
      activeTab.zoomLevel = Math.min(activeTab.zoomLevel + 0.1, 3.0); // Max 300%
      this.applyZoom(activeTab);

      if (this.DEBUG_MODE) {
        console.log('[TabManager] Zoom in:', activeTab.id, activeTab.zoomLevel);
      }
    } catch (error) {
      console.error('[TabManager] Error zooming in:', error);
    }
  }

  zoomOut() {
    try {
      const activeTab = this.tabs.find(t => t.id === this.activeTabId);
      if (!activeTab) return;

      // Decrease zoom by 10% (0.1)
      activeTab.zoomLevel = Math.max(activeTab.zoomLevel - 0.1, 0.3); // Min 30%
      this.applyZoom(activeTab);

      if (this.DEBUG_MODE) {
        console.log('[TabManager] Zoom out:', activeTab.id, activeTab.zoomLevel);
      }
    } catch (error) {
      console.error('[TabManager] Error zooming out:', error);
    }
  }

  applyZoom(tab) {
    if (!tab || !tab.iframe) return;

    // Apply CSS transform to zoom the iframe content
    tab.iframe.style.transform = `scale(${tab.zoomLevel})`;
    tab.iframe.style.transformOrigin = 'top left';

    // Adjust iframe dimensions to compensate for the scale
    // This prevents content from being cut off
    const containerWidth = this.iframeContainer.offsetWidth;
    const containerHeight = this.iframeContainer.offsetHeight;

    if (tab.zoomLevel !== 1.0) {
      tab.iframe.style.width = `${100 / tab.zoomLevel}%`;
      tab.iframe.style.height = `${100 / tab.zoomLevel}%`;
    } else {
      tab.iframe.style.width = '100%';
      tab.iframe.style.height = '100%';
    }

    // Save tabs to persist zoom level
    this.saveTabs();
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

  // ============================================================================
  // MERGED TABS / SPLIT VIEW METHODS
  // ============================================================================

  /**
   * Toggle merged tab - create or close merged tab
   */
  toggleSplitView() {
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);

    // Check if current tab is a merged tab
    if (activeTab && activeTab.isMerged) {
      // Close the merged tab (which will restore the original tabs)
      this.closeTab(activeTab.id);
    } else {
      // Create a new merged tab
      this.createMergedTab();
    }
  }

  /**
   * Create a new merged tab from 2 existing tabs
   */
  createMergedTab() {
    // Need at least 2 tabs
    if (this.tabs.length < 2) {
      this.showToast('Need at least 2 tabs to create a merged view');
      return;
    }

    // Get current tab and next tab
    const currentIndex = this.tabs.findIndex(t => t.id === this.activeTabId);
    const nextIndex = currentIndex + 1 < this.tabs.length ? currentIndex + 1 : 0;

    const leftTab = this.tabs[currentIndex];
    const rightTab = this.tabs[nextIndex];

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Creating merged tab from:', leftTab.title, 'and', rightTab.title);
    }

    // Create merged tab ID
    const mergedTabId = `merged-tab-${this.nextTabId++}`;
    const mergedTitle = `${leftTab.title} | ${rightTab.title}`;

    // Create merged tab element
    const tabElement = document.createElement('div');
    tabElement.className = 'tab tab-merged';
    tabElement.id = `tab-${mergedTabId}`;
    tabElement.setAttribute('data-tab-id', mergedTabId);
    tabElement.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="merged-icon">
        <rect x="3" y="3" width="7" height="18" rx="1"></rect>
        <rect x="14" y="3" width="7" height="18" rx="1"></rect>
      </svg>
      <span class="tab-title">${this.escapeHtml(mergedTitle)}</span>
      <button class="tab-close" title="Close tab (Ctrl+W)">
        <svg width="10" height="10" viewBox="0 0 12 12">
          <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
    `;

    // DON'T create a container or move iframes! Instead, we'll use CSS to position them.
    // Store references to the actual iframe elements (they stay in place)
    const leftIframe = leftTab.iframe;
    const rightIframe = rightTab.iframe;

    // Create overlay container that sits on top
    const mergedContainer = document.createElement('div');
    mergedContainer.id = `iframe-${mergedTabId}`;
    mergedContainer.className = 'merged-split-overlay';

    // Create divider only (panes will be CSS-based)
    const divider = document.createElement('div');
    divider.className = 'split-divider';
    divider.style.left = '50%'; // Initial position
    mergedContainer.appendChild(divider);

    // Add to DOM
    const newTabBtn = document.getElementById('new-tab-btn');
    if (newTabBtn && newTabBtn.parentNode === this.tabList) {
      this.tabList.insertBefore(tabElement, newTabBtn);
    } else {
      this.tabList.appendChild(tabElement);
    }
    this.iframeContainer.appendChild(mergedContainer);

    // Create tab object
    const mergedTab = {
      id: mergedTabId,
      title: mergedTitle,
      url: 'merged', // Special URL for merged tabs
      element: tabElement,
      iframe: mergedContainer,
      loaded: true,
      isMerged: true, // Flag to identify merged tabs
      leftTabId: leftTab.id,
      rightTabId: rightTab.id
    };

    // Store merged tab info including iframe references
    this.mergedTabs.set(mergedTabId, {
      leftTabId: leftTab.id,
      rightTabId: rightTab.id,
      divider,
      leftIframe,  // Store iframe reference
      rightIframe, // Store iframe reference
      activePaneId: 'left',
      splitRatio: 0.5
    });

    // Apply CSS classes to iframes for split positioning (NO DOM MOVING!)
    leftIframe.classList.add('split-left-iframe');
    leftIframe.style.width = '50%';
    leftIframe.style.left = '0';
    leftIframe.classList.add('active');

    rightIframe.classList.add('split-right-iframe');
    rightIframe.style.width = '50%';
    rightIframe.style.left = '50%';
    rightIframe.classList.remove('active');

    // Add event listeners
    tabElement.addEventListener('click', (e) => {
      if (!e.target.closest('.tab-close')) {
        this.switchTab(mergedTabId);
      }
    });

    tabElement.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(mergedTabId);
    });

    // Setup divider drag
    this.setupMergedTabDivider(mergedTabId, divider, leftIframe, rightIframe);

    // Track active pane on click (but don't show visual indicator)
    leftIframe.addEventListener('click', () => {
      const mergedData = this.mergedTabs.get(mergedTabId);
      if (mergedData) mergedData.activePaneId = 'left';
    });
    rightIframe.addEventListener('click', () => {
      const mergedData = this.mergedTabs.get(mergedTabId);
      if (mergedData) mergedData.activePaneId = 'right';
    });

    // Add to tabs array
    this.tabs.push(mergedTab);

    // Hide original tabs (but keep their iframe references intact)
    // Note: The iframes have been moved to the merged container's panes,
    // but the tab objects still maintain their references for restoration
    leftTab.element.style.display = 'none';
    rightTab.element.style.display = 'none';
    // The iframes are now inside the panes, so they're still accessible via leftTab.iframe and rightTab.iframe

    // Switch to merged tab
    this.switchTab(mergedTabId);

    // Update split view button state
    this.updateSplitViewButtonState();

    // Save tabs
    this.saveTabs();

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Merged tab created:', mergedTabId);
    }
  }

  /**
   * Setup divider for a merged tab - click to cycle through presets
   */
  setupMergedTabDivider(mergedTabId, divider, leftIframe, rightIframe) {
    // Store references in mergedTabs for applySplitPreset to use
    const mergedData = this.mergedTabs.get(mergedTabId);
    if (mergedData) {
      mergedData.divider = divider;
      mergedData.leftIframe = leftIframe;
      mergedData.rightIframe = rightIframe;
    }

    // Click on divider to cycle through presets: 50/50 -> 25/75 -> 70/30 -> 50/50
    const presets = [0.5, 0.25, 0.7];

    divider.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const currentRatio = mergedData.splitRatio || 0.5;
      const currentIndex = presets.indexOf(currentRatio);
      const nextIndex = (currentIndex + 1) % presets.length;
      const nextRatio = presets[nextIndex];

      this.applySplitPreset(nextRatio);
    });

    // Visual feedback
    divider.style.cursor = 'pointer';
  }

  /**
   * Apply a split preset ratio to the active merged tab
   */
  applySplitPreset(ratio) {
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!activeTab || !activeTab.isMerged) return;

    const mergedData = this.mergedTabs.get(activeTab.id);
    if (!mergedData) return;

    const { divider, leftIframe, rightIframe } = mergedData;

    // Update iframe widths and positions
    const leftPercent = (ratio * 100) + '%';
    const rightPercent = ((1 - ratio) * 100) + '%';

    leftIframe.style.width = leftPercent;
    rightIframe.style.width = rightPercent;
    rightIframe.style.left = leftPercent;

    // Update divider position
    divider.style.left = leftPercent;

    // Update stored ratio
    mergedData.splitRatio = ratio;

    // Update active state of preset buttons
    if (this.splitPresetsContainer) {
      const presetButtons = this.splitPresetsContainer.querySelectorAll('.split-preset-btn');
      presetButtons.forEach(btn => {
        const btnRatio = parseFloat(btn.getAttribute('data-ratio'));
        btn.classList.toggle('active', btnRatio === ratio);
      });
    }

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Split ratio changed to:', ratio);
    }
  }

  /**
   * Set active pane for a merged tab
   */
  setMergedTabActivePane(mergedTabId, paneId) {
    const mergedData = this.mergedTabs.get(mergedTabId);
    if (!mergedData) return;

    mergedData.activePaneId = paneId;

    // Update visual indicators with CSS classes
    mergedData.leftIframe.classList.toggle('split-active', paneId === 'left');
    mergedData.rightIframe.classList.toggle('split-active', paneId === 'right');
  }

  /**
   * Update split view button state
   */
  updateSplitViewButtonState() {
    if (!this.splitViewBtn) return;

    const activeTab = this.tabs.find(t => t.id === this.activeTabId);

    // If current tab is merged, show "active" state and preset buttons
    if (activeTab && activeTab.isMerged) {
      this.splitViewBtn.classList.add('active');
      this.splitViewBtn.disabled = false;

      // Show preset buttons
      if (this.splitPresetsContainer) {
        this.splitPresetsContainer.classList.remove('hidden');
      }
    } else {
      this.splitViewBtn.classList.remove('active');

      // Hide preset buttons
      if (this.splitPresetsContainer) {
        this.splitPresetsContainer.classList.add('hidden');
      }

      // Disable button if less than 2 non-merged tabs
      const nonMergedTabs = this.tabs.filter(t => !t.isMerged && t.element.style.display !== 'none');
      if (nonMergedTabs.length < 2) {
        this.splitViewBtn.disabled = true;
      } else {
        this.splitViewBtn.disabled = false;
      }
    }
  }
}

// Make TabManager globally available
window.TabManager = TabManager;
