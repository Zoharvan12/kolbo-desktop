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
    const env = localStorage.getItem('WEBAPP_ENVIRONMENT') || 'auto';
    if (env === 'localhost') {
      return 'http://localhost:8080';
    } else if (env === 'staging') {
      return 'https://staging.kolbo.ai';
    } else if (env === 'production') {
      return 'https://app.kolbo.ai';
    } else {
      // Auto-detect based on API URL
      const apiUrl = localStorage.getItem('API_BASE_URL') || '';
      if (apiUrl.includes('localhost')) {
        return 'http://localhost:8080';
      } else if (apiUrl.includes('staging')) {
        return 'https://staging.kolbo.ai';
      } else {
        return 'https://app.kolbo.ai';
      }
    }
  }

  init() {
    if (this.DEBUG_MODE) {
      console.log('[TabManager] Initializing...');
    }

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
            // Restore tabs
            tabsData.forEach(tabData => {
              this.createTab(tabData.url, tabData.title, false);
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
    iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-modals');

    // Add authentication token to URL
    const token = kolboAPI?.getToken();
    if (token) {
      const separator = tabUrl.includes('?') ? '&' : '?';
      iframe.src = `${tabUrl}${separator}embedded=true&token=${encodeURIComponent(token)}`;
    } else {
      iframe.src = tabUrl;
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
