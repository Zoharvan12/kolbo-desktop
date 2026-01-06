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
    this.isRestoring = false; // Flag to indicate we're restoring tabs from saved state

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
    this.screenshotBtn = document.getElementById('webapp-screenshot-btn');

    // Screenshot state
    this.screenshotMode = false;
    this.screenshotDragging = false;
    this.screenshotStartX = 0;
    this.screenshotStartY = 0;
    this.screenshotOverlay = null;
    this.screenshotSelection = null;
    this.screenshotContextMenu = null;

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
      if (this.DEBUG_MODE) {
      console.log('[TabManager] 📍 Using webapp URL from KOLBO_CONFIG:', url);
      }
      if (this.DEBUG_MODE) {
      console.log('[TabManager] 📍 Environment:', window.KOLBO_CONFIG.environment);
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
        if (this.DEBUG_MODE) {
        console.log(`[TabManager] Environment changed: ${savedEnvironment} → ${currentEnvironment}`);
        }
        if (this.DEBUG_MODE) {
        console.log('[TabManager] Clearing saved tabs to prevent URL mismatch');
        }
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

    // Screenshot button
    if (this.screenshotBtn) {
      this.screenshotBtnHandler = () => this.startScreenshot();
      this.screenshotBtn.addEventListener('click', this.screenshotBtnHandler);
    }

    // Screenshot keyboard shortcut (Ctrl+Shift+5)
    // MEMORY LEAK FIX: Store handler for cleanup
    this.screenshotKeyboardHandler = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === '%') { // % is Shift+5
        e.preventDefault();
        this.startScreenshot();
      }
    };
    document.addEventListener('keydown', this.screenshotKeyboardHandler);

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

    // Setup memory monitoring listeners
    this.setupMemoryMonitoringListeners();

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Initialized with', this.tabs.length, 'tabs');
    }
  }

  setupAutoSave() {
    // MEMORY LEAK FIX: Store handler references for proper cleanup
    this.beforeUnloadHandler = () => {
      this.saveTabs();
    };

    this.visibilityChangeHandler = () => {
      if (document.hidden) {
        this.saveTabs();
      }
    };

    // Save state before window closes
    window.addEventListener('beforeunload', this.beforeUnloadHandler);

    // OPTIMIZED: Debounced auto-save (was every 30s, now only when changed)
    this.autoSaveInterval = setInterval(() => {
      this.saveTabs();
    }, 60000); // Increased to 60 seconds to reduce I/O

    // Save on visibility change (when user switches away)
    document.addEventListener('visibilitychange', this.visibilityChangeHandler);

    // MEMORY MANAGEMENT: Periodic cleanup of inactive tabs
    // Run every 5 minutes to prevent memory accumulation
    // DISABLED:     setInterval(() => {
    // DISABLED:       this.performMemoryCleanup();
    // DISABLED:     }, 5 * 60 * 1000); // 5 minutes

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Auto-save enabled (memory cleanup DISABLED)');
    }
  }

  /**
   * Perform memory cleanup on inactive tabs
   * This helps prevent grey screen crashes during continuous usage
   */
  performMemoryCleanup() {
    if (this.DEBUG_MODE) {
      console.log('[TabManager] Running periodic memory cleanup...');
    }

    let cleanedCount = 0;

    // Only cleanup inactive tabs (not the currently visible one)
    this.tabs.forEach(tab => {
      if (tab.id !== this.activeTabId && tab.iframe && !tab.isMerged) {
        try {
          // For inactive tabs, we can reload them to free memory
          // Their state will be restored when user switches back
          const currentSrc = tab.iframe.src;

          // Only reload if it's been loaded (not blank)
          if (currentSrc && currentSrc !== 'about:blank' && tab.loaded) {
            // Set src to blank to unload content
            tab.iframe.src = 'about:blank';

            // Store the original URL so we can reload when needed
            if (!tab.originalUrl) {
              tab.originalUrl = currentSrc;
            }

            // Mark as needing reload
            tab.needsReload = true;
            tab.loaded = false;

            cleanedCount++;

            if (this.DEBUG_MODE) {
              console.log('[TabManager] Cleaned inactive tab:', tab.id, tab.title);
            }
          }
        } catch (error) {
          console.error('[TabManager] Error cleaning up inactive tab:', error);
        }
      }
    });

    if (cleanedCount > 0) {
      if (this.DEBUG_MODE) {
      console.log(`[TabManager] Memory cleanup complete: cleaned ${cleanedCount} inactive tab(s)`);
      }
    }
  }

  /**
   * Setup listeners for memory monitoring events from main process
   */
  setupMemoryMonitoringListeners() {
    if (!window.kolboDesktop) {
      console.warn('[TabManager] kolboDesktop not available, memory monitoring disabled');
      return;
    }

    // Listen for memory status updates
    window.kolboDesktop.onMemoryStatus((status) => {
      if (this.DEBUG_MODE) {
        console.log('[TabManager] Memory status:', status);
      }
      // Store current memory status for potential UI display
      this.currentMemoryStatus = status;
    });

    // Listen for auto-cleanup requests (80%+ threshold)
    window.kolboDesktop.onMemoryAutoCleanup(() => {
      if (this.DEBUG_MODE) {
      console.log('[TabManager] 🧹 Auto-cleanup requested by memory monitor');
      }
      this.performMemoryCleanup();
    });

    // Listen for forced cleanup requests (90%+ threshold)
    window.kolboDesktop.onMemoryForceCleanup(() => {
      console.warn('[TabManager] ⚠️ Forced cleanup requested - memory usage high');

      // Perform aggressive cleanup
      this.performMemoryCleanup();

      // Show toast notification to user
      this.showToast('Memory usage high. Cleaning up inactive tabs...', 'warning');
    });

    if (this.DEBUG_MODE) {
    console.log('[TabManager] Memory monitoring listeners enabled');
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
      // Log all messages for debugging
      if (event.data && event.data.type) {
        if (this.DEBUG_MODE) {
        console.log('[TabManager] Received postMessage:', event.data.type, event.data);
        }
      }

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

      // Check for context menu messages from iframes
      if (event.data && event.data.type === 'CONTEXT_MENU') {
        const contextData = event.data.data;

        if (this.DEBUG_MODE) {
        console.log('[TabManager] ✅ Context menu message received from iframe:', contextData);
        }

        // Show context menu using Electron API
        if (window.kolboDesktop && window.kolboDesktop.showWebappContextMenu) {
          if (this.DEBUG_MODE) {
          console.log('[TabManager] Showing webapp context menu...');
          }
          window.kolboDesktop.showWebappContextMenu(contextData);
        } else {
          console.error('[TabManager] ❌ showWebappContextMenu not available!');
        }
      }

      if (event.data && event.data.type === 'CLIPBOARD_WRITE_TEXT') {
        const clipboardText = event.data.text || '';
        if (window.kolboDesktop && window.kolboDesktop.writeClipboardText) {
          window.kolboDesktop.writeClipboardText(clipboardText);
        } else {
          console.warn('[TabManager] writeClipboardText API not available');
        }
      }

      // Check for authentication status change messages from web app
      if (event.data && event.data.type === 'AUTH_STATUS_CHANGED') {
        const { authenticated, reason } = event.data;
        if (this.DEBUG_MODE) {
        console.log(`[TabManager] 🔐 Auth status changed: authenticated=${authenticated}, reason=${reason}`);
        }

        // If user logged out in the web app, log them out of the desktop app too
        if (!authenticated) {
          if (this.DEBUG_MODE) {
          console.log('[TabManager] ⚠️ Web app logged out - triggering desktop app logout');
          }

          // Trigger the logout handler from the main app
          if (this.onAuthStatusChanged) {
            this.onAuthStatusChanged(authenticated, reason);
          } else {
            console.error('[TabManager] ❌ onAuthStatusChanged callback not set!');
          }
        }
      }

      // Check for login page shown messages from web app
      if (event.data && event.data.type === 'LOGIN_PAGE_SHOWN') {
        const { reason } = event.data;
        if (this.DEBUG_MODE) {
        console.log(`[TabManager] 🔑 Login page shown in iframe, reason=${reason}`);
        }
        if (this.DEBUG_MODE) {
        console.log('[TabManager] 💡 Switching to desktop login screen (Google OAuth will work there)');
        }

        // Trigger the login screen switch from the main app
        if (this.onLoginPageShown) {
          this.onLoginPageShown(reason);
        } else {
          console.error('[TabManager] ❌ onLoginPageShown callback not set!');
        }
      }

      // Check for copy image messages from iframes
      if (event.data && event.data.type === 'COPY_IMAGE') {
        const imageUrl = event.data.imageUrl;
        if (this.DEBUG_MODE) {
        console.log('[TabManager] Copy image request received:', imageUrl);
        }

        if (window.kolboDesktop && window.kolboDesktop.copyImageToClipboard) {
          window.kolboDesktop.copyImageToClipboard(imageUrl)
            .then(result => {
              if (result.success) {
                if (this.DEBUG_MODE) {
                console.log('[TabManager] ✅ Image copied to clipboard');
                }
              } else {
                console.error('[TabManager] ❌ Failed to copy image:', result.error);
              }
            })
            .catch(err => {
              console.error('[TabManager] ❌ Error copying image:', err);
            });
        } else {
          console.error('[TabManager] ❌ copyImageToClipboard API not available');
        }
      }

      // Check for download file messages from iframes
      if (event.data && event.data.type === 'DOWNLOAD_FILE') {
        const { url, filename, mediaType } = event.data;
        if (this.DEBUG_MODE) {
        console.log('[TabManager] Download file request received:', { url, filename, mediaType });
        }

        if (window.kolboDesktop && window.kolboDesktop.downloadFileFromContextMenu) {
          window.kolboDesktop.downloadFileFromContextMenu(url, mediaType)
            .then(result => {
              if (result.success) {
                if (this.DEBUG_MODE) {
                console.log('[TabManager] ✅ Download started:', filename);
                }
              } else if (!result.canceled) {
                console.error('[TabManager] ❌ Download failed:', result.error);
              }
            })
            .catch(err => {
              console.error('[TabManager] ❌ Error downloading file:', err);
            });
        } else {
          console.error('[TabManager] ❌ downloadFileFromContextMenu API not available');
        }
      }

      // Check for open external URL messages from iframes
      if (event.data && event.data.type === 'OPEN_EXTERNAL_URL') {
        const { url, reason } = event.data;
        if (this.DEBUG_MODE) {
        console.log('[TabManager] Open external URL request received:', { url, reason });
        }

        if (window.kolboDesktop && window.kolboDesktop.openExternal) {
          window.kolboDesktop.openExternal(url)
            .then(result => {
              if (result && result.success === false) {
                console.error('[TabManager] ❌ Failed to open URL:', result.error);
              } else {
                if (this.DEBUG_MODE) {
                console.log('[TabManager] ✅ Opened URL in browser:', url);
                }
              }
            })
            .catch(err => {
              console.error('[TabManager] ❌ Error opening URL:', err);
            });
        } else {
          console.error('[TabManager] ❌ openExternal API not available');
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

  setupIframeContextMenu(iframe) {
    // Note: For cross-origin iframes (like kolbo.ai), we CANNOT inject scripts
    // The web app (kolbo-map) should handle context menus and send postMessage
    // We listen for those messages in setupGlobalMessageListener()

    // Only try to inject for same-origin iframes (like localhost during development)
    iframe.addEventListener('load', () => {
      try {
        const iframeDoc = iframe.contentDocument;
        if (!iframeDoc) {
          if (this.DEBUG_MODE) {
            console.log('[TabManager] Cross-origin iframe detected - relying on web app postMessage for context menus');
          }
          return;
        }

        // If we can access the document, it's same-origin - inject the script
        const script = iframeDoc.createElement('script');
        script.textContent = `
          (function() {
            if (this.DEBUG_MODE) {
            console.log('[Kolbo Desktop] Context menu script injected into same-origin iframe');
            }

            document.addEventListener('contextmenu', function(e) {
              e.preventDefault();
              e.stopPropagation();

              const target = e.target;
              let linkURL = '';
              let srcURL = '';
              let mediaType = 'none';
              let selectionText = '';

              // Get selection text
              if (window.getSelection) {
                selectionText = window.getSelection().toString();
              }

              // Check if target is a link
              const linkElement = target.closest('a');
              if (linkElement && linkElement.href) {
                linkURL = linkElement.href;
              }

              // Check if target is an image
              if (target.tagName === 'IMG' && target.src) {
                srcURL = target.src;
                mediaType = 'image';
              }
              // Check if target is a video
              else if (target.tagName === 'VIDEO') {
                const video = target;
                srcURL = video.src || video.currentSrc || '';
                if (!srcURL && video.querySelector('source')) {
                  srcURL = video.querySelector('source').src;
                }
                mediaType = 'video';
              }
              // Check if target is audio
              else if (target.tagName === 'AUDIO') {
                const audio = target;
                srcURL = audio.src || audio.currentSrc || '';
                if (!srcURL && audio.querySelector('source')) {
                  srcURL = audio.querySelector('source').src;
                }
                mediaType = 'audio';
              }
              // Check if target is inside a video or audio element
              else if (target.closest('video')) {
                const video = target.closest('video');
                srcURL = video.src || video.currentSrc || '';
                if (!srcURL && video.querySelector('source')) {
                  srcURL = video.querySelector('source').src;
                }
                mediaType = 'video';
              }
              else if (target.closest('audio')) {
                const audio = target.closest('audio');
                srcURL = audio.src || audio.currentSrc || '';
                if (!srcURL && audio.querySelector('source')) {
                  srcURL = audio.querySelector('source').src;
                }
                mediaType = 'audio';
              }

              // Send context menu data to parent window
              window.parent.postMessage({
                type: 'CONTEXT_MENU',
                iframeId: '${iframe.id}',
                data: {
                  x: e.clientX,
                  y: e.clientY,
                  linkURL: linkURL,
                  srcURL: srcURL,
                  mediaType: mediaType,
                  selectionText: selectionText,
                  pageURL: window.location.href
                }
              }, '*');

              if (this.DEBUG_MODE) {
              console.log('[Kolbo Desktop] Context menu requested:', {
              }
                mediaType: mediaType,
                srcURL: srcURL,
                linkURL: linkURL
              });
            }, true); // Use capture phase to catch all events

            if (this.DEBUG_MODE) {
            console.log('[Kolbo Desktop] Context menu listener registered');
            }
          })();
        `;

        iframeDoc.head.appendChild(script);

        if (this.DEBUG_MODE) {
          console.log('[TabManager] Context menu script injected into same-origin iframe');
        }
      } catch (e) {
        // Cross-origin iframe - this is EXPECTED for production kolbo.ai
        // The web app itself handles context menus and sends postMessage
        if (this.DEBUG_MODE) {
          console.log('[TabManager] Cross-origin iframe - context menus handled by web app via postMessage');
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

        if (this.DEBUG_MODE) {
        console.log('[TabManager] 🔍 Checking for saved tabs...');
        }
        if (this.DEBUG_MODE) {
        console.log('[TabManager] Saved state exists:', !!savedState);
        }

        if (savedState) {
          const state = JSON.parse(savedState);
          if (this.DEBUG_MODE) {
          console.log('[TabManager] 📦 Parsed state:', state);
          }

          if (state.tabs && Array.isArray(state.tabs) && state.tabs.length > 0) {
            if (this.DEBUG_MODE) {
            console.log('[TabManager] ✅ Found', state.tabs.length, 'saved tabs. Starting restoration...');
            }

            // CRITICAL: Set restoration flag to prevent renumbering during restore
            this.isRestoring = true;

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

            // CRITICAL: Clear restoration flag and do one final renumber
            this.isRestoring = false;
            this.renumberTabs();

            if (this.DEBUG_MODE) {
            console.log('[TabManager] ✅ Tab restoration complete!');
            }
            if (this.DEBUG_MODE) {
            console.log('[TabManager] 📊 Restored tabs:', this.tabs.map(t => ({ id: t.id, title: t.title, url: t.url })));
            }

            if (this.DEBUG_MODE) {
              console.log('[TabManager] State restored successfully');
            }

            return;
          } else {
            if (this.DEBUG_MODE) {
            console.log('[TabManager] ❌ No valid tabs in saved state');
            }
          }
        } else {
          if (this.DEBUG_MODE) {
          console.log('[TabManager] ℹ️ No saved state found, creating default tab');
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
    // PERFORMANCE FIX: Debounce saves to prevent excessive I/O
    clearTimeout(this._saveDebounceTimer);
    this._saveDebounceTimer = setTimeout(() => {
      this._doSaveTabs();
    }, 1000); // Wait 1 second after last change before saving
  }

  _doSaveTabs() {
    try {
      // Don't save during restoration to avoid conflicts
      if (this.isRestoring) {
        return;
      }

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

        // PERFORMANCE FIX: Only save if state actually changed
        const stateJson = JSON.stringify(state);
        if (stateJson !== this._lastSavedState) {
          localStorage.setItem('kolbo_tabs_state', stateJson);
          this._lastSavedState = stateJson;

          if (this.DEBUG_MODE) {
            console.log('[TabManager] 💾 Saved', tabsData.length, 'tabs to localStorage');
          }

          if (this.DEBUG_MODE) {
            console.log('[TabManager] Saved state:', state);
          }
        } else if (this.DEBUG_MODE) {
          console.log('[TabManager] ⏭️  Skipped save (no changes)');
        }
      }
    } catch (error) {
      console.error('[TabManager] ❌ Error saving tabs:', error);
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
    // CRITICAL FOR MAC: allow-storage-access-by-user-activation prevents crashes when uploading files
    iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-storage-access-by-user-activation');
    // Enable all necessary permissions for the iframe to work properly
    // clipboard-read/write: for copy/paste operations
    // autoplay: for video/audio playback without user interaction
    // fullscreen: for media player fullscreen mode
    // web-share: for sharing content (if used)
    // camera/microphone: for file input access (critical for Mac file uploads)
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write; autoplay; fullscreen; web-share; camera; microphone');

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
      if (this.DEBUG_MODE) {
      console.log(`[TabManager] 🌐 Creating iframe with URL: ${tabUrl}${separator}embedded=true&source=desktop&token=***`);
      }
      if (this.DEBUG_MODE) {
      console.log(`[TabManager] 🔑 Token (first 20 chars): ${token.substring(0, 20)}...`);
      }
      if (this.DEBUG_MODE) {
      console.log(`[TabManager] ✅ Token synced from main process`);
      }
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

    // Setup context menu for iframe content
    this.setupIframeContextMenu(iframe);

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

    // Renumber tabs to ensure sequential numbering
    // Skip renumbering if we're restoring tabs (will renumber once at the end)
    if (!this.isRestoring) {
      this.renumberTabs();
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
      // Get the merged tab data to access the original tabs and iframes
      const mergedData = this.mergedTabs.get(tabId);

      if (!mergedData) {
        console.error('[TabManager] No merged data found for tab:', tabId);
        return;
      }

      // Get the original tabs from stored data (not from this.tabs, since we removed them)
      const leftTab = mergedData.leftTab;
      const rightTab = mergedData.rightTab;

      if (this.DEBUG_MODE) {
        console.log('[TabManager] Closing merged tab, restoring original tabs:', tab.leftTabId, tab.rightTabId);
        if (this.DEBUG_MODE) {
        console.log('[TabManager] Left tab:', leftTab ? leftTab.id : 'null');
        }
        if (this.DEBUG_MODE) {
        console.log('[TabManager] Right tab:', rightTab ? rightTab.id : 'null');
        }
      }

      // CRITICAL: Fully restore iframes to their pre-split state
      if (mergedData) {
        // Restore left iframe
        if (mergedData.leftIframe && leftTab) {
          if (this.DEBUG_MODE) {
            console.log('[TabManager] Restoring left iframe:', leftTab.id);
          }

          // Remove ALL split-view CSS classes
          mergedData.leftIframe.classList.remove('split-left-iframe', 'split-right-iframe', 'split-active');

          // Clear ALL split-view inline styles (but preserve zoom styles)
          const currentTransform = mergedData.leftIframe.style.transform;
          const currentTransformOrigin = mergedData.leftIframe.style.transformOrigin;

          mergedData.leftIframe.style.width = '';
          mergedData.leftIframe.style.height = '';
          mergedData.leftIframe.style.left = '';
          mergedData.leftIframe.style.right = '';
          mergedData.leftIframe.style.top = '';
          mergedData.leftIframe.style.bottom = '';
          mergedData.leftIframe.style.position = '';
          mergedData.leftIframe.style.display = '';

          // Restore transform if it was set (for zoom)
          if (currentTransform) {
            mergedData.leftIframe.style.transform = currentTransform;
          }
          if (currentTransformOrigin) {
            mergedData.leftIframe.style.transformOrigin = currentTransformOrigin;
          }

          // Reapply zoom if tab has custom zoom level
          if (leftTab.zoomLevel && leftTab.zoomLevel !== 1.0) {
            this.applyZoom(leftTab);
          }
        }

        // Restore right iframe
        if (mergedData.rightIframe && rightTab) {
          if (this.DEBUG_MODE) {
            console.log('[TabManager] Restoring right iframe:', rightTab.id);
          }

          // Remove ALL split-view CSS classes
          mergedData.rightIframe.classList.remove('split-left-iframe', 'split-right-iframe', 'split-active');

          // Clear ALL split-view inline styles (but preserve zoom styles)
          const currentTransform = mergedData.rightIframe.style.transform;
          const currentTransformOrigin = mergedData.rightIframe.style.transformOrigin;

          mergedData.rightIframe.style.width = '';
          mergedData.rightIframe.style.height = '';
          mergedData.rightIframe.style.left = '';
          mergedData.rightIframe.style.right = '';
          mergedData.rightIframe.style.top = '';
          mergedData.rightIframe.style.bottom = '';
          mergedData.rightIframe.style.position = '';
          mergedData.rightIframe.style.display = '';

          // Restore transform if it was set (for zoom)
          if (currentTransform) {
            mergedData.rightIframe.style.transform = currentTransform;
          }
          if (currentTransformOrigin) {
            mergedData.rightIframe.style.transformOrigin = currentTransformOrigin;
          }

          // Reapply zoom if tab has custom zoom level
          if (rightTab.zoomLevel && rightTab.zoomLevel !== 1.0) {
            this.applyZoom(rightTab);
          }
        }
      }

      // Remove merged tab element and overlay from DOM
      // Note: tab.iframe is the mergedContainer which includes divider
      // Refresh buttons are in split-presets container, so remove them separately
      tab.element.remove();
      tab.iframe.remove();

      // Remove refresh buttons and separator from split-presets container
      if (mergedData.separator) mergedData.separator.remove();
      if (mergedData.leftRefreshBtn) mergedData.leftRefreshBtn.remove();
      if (mergedData.rightRefreshBtn) mergedData.rightRefreshBtn.remove();

      // Remove from array BEFORE switching tabs (important for proper state)
      this.tabs.splice(tabIndex, 1);

      // Remove from merged tabs map (cleans up references to buttons, divider, etc.)
      this.mergedTabs.delete(tabId);

      // CRITICAL: Re-add the original tabs back to the DOM and tabs array
      // Insert left tab at the position where the merged tab was
      const newTabBtn = document.getElementById('new-tab-btn');
      if (newTabBtn && newTabBtn.parentNode === this.tabList) {
        // Insert before the new tab button
        this.tabList.insertBefore(leftTab.element, newTabBtn);
      } else {
        this.tabList.appendChild(leftTab.element);
      }

      // Insert right tab after left tab
      if (leftTab.element.nextSibling) {
        this.tabList.insertBefore(rightTab.element, leftTab.element.nextSibling);
      } else {
        this.tabList.appendChild(rightTab.element);
      }

      // Add tabs back to the tabs array at the position where merged tab was
      this.tabs.splice(tabIndex, 0, leftTab, rightTab);

      if (this.DEBUG_MODE) {
        console.log('[TabManager] Restored original tabs to DOM and tabs array');
      }

      // Restore original tabs visibility
      leftTab.element.style.display = '';
      rightTab.element.style.display = '';

      // Switch to the left tab (first of the restored tabs)
      this.switchTab(leftTab.id);

      // Renumber tabs after closing merged tab
      this.renumberTabs();

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

    // MEMORY CLEANUP: Properly cleanup iframe to prevent memory leaks
    if (tab.iframe) {
      try {
        // Stop any ongoing loads
        if (tab.iframe.contentWindow) {
          tab.iframe.contentWindow.stop();
        }

        // Clear src to unload content and free memory
        tab.iframe.src = 'about:blank';

        // MEMORY LEAK FIX: Wait for unload, then remove from DOM
        // Using requestIdleCallback for better GC timing
        if (window.requestIdleCallback) {
          requestIdleCallback(() => {
            if (tab.iframe && tab.iframe.parentNode) {
              tab.iframe.remove();
            }
          });
        } else {
          // Fallback: immediate removal
          tab.iframe.remove();
        }

        // Clear reference immediately to help garbage collection
        tab.iframe = null;

        if (this.DEBUG_MODE) {
          console.log('[TabManager] Iframe memory cleaned up for tab:', tabId);
        }
      } catch (error) {
        console.error('[TabManager] Error cleaning up iframe:', error);
        // Fallback: just remove it
        if (tab.iframe) {
          try {
            tab.iframe.remove();
          } catch (e) {
            console.error('[TabManager] Could not remove iframe:', e);
          }
          tab.iframe = null;
        }
      }
    }

    // Remove tab element from DOM
    if (tab.element) {
      tab.element.remove();
      tab.element = null;
    }

    // Remove from array
    this.tabs.splice(tabIndex, 1);

    // Renumber tabs after closing
    this.renumberTabs();

    // Update split view button state
    this.updateSplitViewButtonState();

    // Save tabs
    this.saveTabs();
  }

  switchTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) {
      console.error('[TabManager] Cannot switch to non-existent tab:', tabId);
      return;
    }

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Switching to tab:', tabId, tab.title);
    }

    // MEMORY MANAGEMENT: Reload tab if it was unloaded to save memory
    if (tab.needsReload && tab.iframe) {
      const urlToReload = tab.originalUrl || tab.url;
      if (this.DEBUG_MODE) {
        console.log('[TabManager] Reloading previously unloaded tab:', tab.id, urlToReload);
      }
      tab.iframe.src = urlToReload;
      tab.needsReload = false;
      tab.loaded = true;
    }

    // Update active tab ID
    this.activeTabId = tabId;

    // CRITICAL: Update UI - manage active states for ALL tabs and iframes
    this.tabs.forEach(t => {
      const isActiveTab = t.id === tabId;

      // Update tab element active state (only for visible tabs)
      if (t.element.style.display !== 'none') {
        if (isActiveTab) {
          t.element.classList.add('active');
        } else {
          t.element.classList.remove('active');
        }
      }

      // Update iframe active state
      // For merged tabs, we handle their iframes separately below
      if (!t.isMerged) {
        if (isActiveTab) {
          t.iframe.classList.add('active');
          if (this.DEBUG_MODE) {
            console.log('[TabManager] Activated iframe for tab:', t.id);
          }
        } else {
          t.iframe.classList.remove('active');
        }
      }
    });

    // Handle merged tab - ensure both iframes are visible and active
    if (tab.isMerged) {
      const mergedData = this.mergedTabs.get(tabId);
      if (mergedData) {
        // CRITICAL: First, hide ALL other merged tab overlays and iframes
        this.mergedTabs.forEach((data, mergedId) => {
          if (mergedId !== tabId) {
            // CRITICAL: Hide iframes from other merged tabs
            // PERFORMANCE FIX: Removed style.display = 'none' - CSS handles visibility now
            if (data.leftIframe) {
              data.leftIframe.classList.remove('active', 'split-left-iframe', 'split-right-iframe');
            }
            if (data.rightIframe) {
              data.rightIframe.classList.remove('active', 'split-left-iframe', 'split-right-iframe');
            }
          }
        });

        // Hide all other merged tab overlay containers
        this.tabs.forEach(t => {
          if (t.isMerged && t.id !== tabId) {
            // PERFORMANCE FIX: Removed style.display = 'none' - CSS handles visibility
            t.iframe.classList.remove('active');
          }
        });

        // Now show and activate THIS merged tab's iframes
        // First, ensure split classes are applied correctly
        // PERFORMANCE FIX: Removed style.display - CSS handles visibility now
        mergedData.leftIframe.classList.remove('split-right-iframe'); // Remove wrong class if any
        mergedData.leftIframe.classList.add('active', 'split-left-iframe');

        mergedData.rightIframe.classList.remove('split-left-iframe'); // Remove wrong class if any
        mergedData.rightIframe.classList.add('active', 'split-right-iframe');

        // Show this merged tab's overlay container
        tab.iframe.classList.add('active');

        if (this.DEBUG_MODE) {
          console.log('[TabManager] Activated split iframes for merged tab:', tabId);
        }
      }
    } else {
      // For regular tabs, hide ALL merged tab overlays and their split iframes
      // CRITICAL: This ensures when switching from split view to single tab,
      // the split view is completely hidden
      this.mergedTabs.forEach((data, mergedId) => {
        // CRITICAL: Deactivate iframes from all merged tabs
        // PERFORMANCE FIX: Removed style.display = 'none' - CSS handles visibility now
        if (data.leftIframe) {
          data.leftIframe.classList.remove('active', 'split-left-iframe', 'split-right-iframe');
        }
        if (data.rightIframe) {
          data.rightIframe.classList.remove('active', 'split-left-iframe', 'split-right-iframe');
        }
      });

      // Hide the merged overlay container for ALL merged tabs
      // This ensures the split divider and overlay are not visible
      this.tabs.forEach(t => {
        if (t.isMerged) {
          // PERFORMANCE FIX: Removed style.display = 'none' - CSS handles visibility
          t.iframe.classList.remove('active');
        }
      });

      // CRITICAL FIX: When switching to a regular tab, reset split-view styles
      // and ensure ONLY the active tab's iframe is visible
      this.tabs.forEach(t => {
        if (!t.isMerged && t.iframe) {
          // Remove split-view CSS classes from all regular tabs
          t.iframe.classList.remove('split-left-iframe', 'split-right-iframe');

          if (t.id === tabId) {
            // Active regular tab - reset to full width, normal positioning
            t.iframe.style.width = '';
            t.iframe.style.left = '';
            t.iframe.style.right = '';
            t.iframe.style.position = '';
            // Ensure it's visible
            t.iframe.style.display = '';
          } else {
            // Inactive regular tabs should be hidden
            // (handled by the active class logic above)
          }
        }
      });
    }

    // Apply zoom for the active tab
    if (tab.zoomLevel && tab.zoomLevel !== 1.0) {
      this.applyZoom(tab);
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

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Successfully switched to tab:', tabId);
    }
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

  /**
   * Renumber all tabs with default "Kolbo.AI X" naming based on their current position
   * This ensures tabs are always numbered sequentially (1, 2, 3...) regardless of which tabs were closed
   *
   * IMPORTANT: Only renumbers tabs with default naming pattern.
   * - Skips hidden tabs (used in merged/split views)
   * - Skips merged tabs (they have "Tab1 | Tab2" naming)
   * - Preserves custom titles from the web app (like "Chat", "Image Tools", etc.)
   */
  renumberTabs() {
    let visibleTabNumber = 1;
    const defaultNamePattern = /^Kolbo\.AI \d+$/;

    // First pass: collect all visible, non-merged tabs that need renumbering
    const tabsToRenumber = [];

    this.tabs.forEach((tab) => {
      // Skip hidden tabs (these are tabs hidden when used in merged views)
      if (tab.element.style.display === 'none') {
        if (this.DEBUG_MODE) {
          console.log(`[TabManager] Skipping hidden tab: ${tab.id} (${tab.title})`);
        }
        return;
      }

      // Skip merged/split view tabs - they have special naming like "Tab1 | Tab2"
      if (tab.isMerged) {
        if (this.DEBUG_MODE) {
          console.log(`[TabManager] Skipping merged tab: ${tab.id} (${tab.title})`);
        }
        return;
      }

      // Check if this tab has the default "Kolbo.AI X" naming pattern
      if (defaultNamePattern.test(tab.title)) {
        tabsToRenumber.push(tab);
      } else {
        // This is a custom-named tab (from web app), preserve it
        if (this.DEBUG_MODE) {
          console.log(`[TabManager] Preserving custom-named tab: ${tab.id} (${tab.title})`);
        }
      }
    });

    // Second pass: renumber only the tabs with default naming
    tabsToRenumber.forEach((tab) => {
      const newTitle = `Kolbo.AI ${visibleTabNumber}`;

      // Only update if the number actually changed (avoid unnecessary DOM updates)
      if (tab.title !== newTitle) {
        tab.title = newTitle;

        const titleElement = tab.element.querySelector('.tab-title');
        if (titleElement) {
          titleElement.textContent = newTitle;
        }

        if (this.DEBUG_MODE) {
          console.log(`[TabManager] Renumbered tab ${tab.id} to: ${newTitle}`);
        }
      }

      visibleTabNumber++;
    });

    if (this.DEBUG_MODE) {
      console.log(`[TabManager] Renumbering complete. Total default-named tabs: ${tabsToRenumber.length}`);
    }
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
   * If active tab is a merged/split view, refreshes BOTH panes
   */
  refresh() {
    const activeTab = this.getActiveTab();
    if (!activeTab || !activeTab.iframe) {
      console.warn('[TabManager] No active tab to refresh');
      return;
    }

    try {
      // Check if this is a merged tab (split view)
      if (activeTab.isMerged) {
        // Refresh both panes in split view
        const mergedData = this.mergedTabs.get(activeTab.id);
        if (mergedData && mergedData.leftIframe && mergedData.rightIframe) {
          // Refresh left pane
          mergedData.leftIframe.contentWindow.postMessage({
            type: 'RELOAD_PAGE'
          }, '*');

          // Refresh right pane
          mergedData.rightIframe.contentWindow.postMessage({
            type: 'RELOAD_PAGE'
          }, '*');

          if (this.DEBUG_MODE) {
            console.log('[TabManager] Sent reload message to both panes in split view:', activeTab.id);
          }
        }
      } else {
        // Regular tab - refresh single iframe
        activeTab.iframe.contentWindow.postMessage({
          type: 'RELOAD_PAGE'
        }, '*');

        if (this.DEBUG_MODE) {
          console.log('[TabManager] Sent reload message to tab:', activeTab.id);
        }
      }
    } catch (error) {
      console.error('[TabManager] Error refreshing:', error);
    }
  }

  /**
   * Refresh a specific pane in a split view
   * @param {string} mergedTabId - ID of the merged tab
   * @param {string} paneId - Either 'left' or 'right'
   */
  refreshSplitPane(mergedTabId, paneId) {
    const mergedData = this.mergedTabs.get(mergedTabId);
    if (!mergedData) {
      console.warn('[TabManager] No merged tab data found for:', mergedTabId);
      return;
    }

    try {
      // Get the appropriate iframe based on pane
      const iframe = paneId === 'left' ? mergedData.leftIframe : mergedData.rightIframe;
      const tabName = paneId === 'left' ? mergedData.leftTab.title : mergedData.rightTab.title;

      if (!iframe || !iframe.contentWindow) {
        console.warn('[TabManager] No iframe found for pane:', paneId);
        return;
      }

      // Send postMessage to the specific iframe to reload
      iframe.contentWindow.postMessage({
        type: 'RELOAD_PAGE'
      }, '*');

      if (this.DEBUG_MODE) {
        console.log(`[TabManager] Sent reload message to ${paneId} pane (${tabName})`);
      }
    } catch (error) {
      console.error(`[TabManager] Error refreshing ${paneId} pane:`, error);
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

  // Screenshot Methods
  startScreenshot() {
    try {
      if (this.screenshotMode) return;

      this.screenshotMode = true;

      // Create overlay
      this.screenshotOverlay = document.createElement('div');
      this.screenshotOverlay.className = 'screenshot-overlay active';
      document.body.appendChild(this.screenshotOverlay);

      // Create selection rectangle
      this.screenshotSelection = document.createElement('div');
      this.screenshotSelection.className = 'screenshot-selection';
      this.screenshotOverlay.appendChild(this.screenshotSelection);

      // Mouse events
      this.screenshotOverlay.addEventListener('mousedown', this.onScreenshotMouseDown.bind(this));
      this.screenshotOverlay.addEventListener('mousemove', this.onScreenshotMouseMove.bind(this));
      this.screenshotOverlay.addEventListener('mouseup', this.onScreenshotMouseUp.bind(this));

      // ESC to cancel
      this.screenshotEscHandler = (e) => {
        if (e.key === 'Escape') {
          this.cancelScreenshot();
        }
      };
      document.addEventListener('keydown', this.screenshotEscHandler);

      if (this.DEBUG_MODE) {
        console.log('[TabManager] Screenshot mode started');
      }
    } catch (error) {
      console.error('[TabManager] Error starting screenshot:', error);
    }
  }

  onScreenshotMouseDown(e) {
    this.screenshotDragging = true;
    this.screenshotStartX = e.clientX;
    this.screenshotStartY = e.clientY;
    this.screenshotSelection.style.left = `${this.screenshotStartX}px`;
    this.screenshotSelection.style.top = `${this.screenshotStartY}px`;
    this.screenshotSelection.style.width = '0px';
    this.screenshotSelection.style.height = '0px';
    this.screenshotSelection.style.display = 'block';
  }

  onScreenshotMouseMove(e) {
    // Only update selection while dragging
    if (!this.screenshotDragging) return;
    if (!this.screenshotSelection.style.display || this.screenshotSelection.style.display === 'none') return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const width = Math.abs(currentX - this.screenshotStartX);
    const height = Math.abs(currentY - this.screenshotStartY);
    const left = Math.min(currentX, this.screenshotStartX);
    const top = Math.min(currentY, this.screenshotStartY);

    this.screenshotSelection.style.left = `${left}px`;
    this.screenshotSelection.style.top = `${top}px`;
    this.screenshotSelection.style.width = `${width}px`;
    this.screenshotSelection.style.height = `${height}px`;
  }

  onScreenshotMouseUp(e) {
    // Stop dragging
    this.screenshotDragging = false;

    const width = parseInt(this.screenshotSelection.style.width);
    const height = parseInt(this.screenshotSelection.style.height);

    // If selection is too small, cancel
    if (width < 10 || height < 10) {
      this.cancelScreenshot();
      return;
    }

    // Get selection bounds
    const bounds = {
      x: parseInt(this.screenshotSelection.style.left),
      y: parseInt(this.screenshotSelection.style.top),
      width: width,
      height: height
    };

    // Show context menu
    this.showScreenshotContextMenu(e.clientX, e.clientY, bounds);
  }

  showScreenshotContextMenu(x, y, bounds) {
    // Create context menu
    this.screenshotContextMenu = document.createElement('div');
    this.screenshotContextMenu.className = 'screenshot-context-menu active';

    this.screenshotContextMenu.innerHTML = `
      <button class="screenshot-context-menu-item" data-action="copy">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        Copy to Clipboard
      </button>
      <button class="screenshot-context-menu-item" data-action="save-png">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
          <polyline points="17 21 17 13 7 13 7 21"></polyline>
          <polyline points="7 3 7 8 15 8"></polyline>
        </svg>
        Save as PNG
      </button>
      <button class="screenshot-context-menu-item" data-action="save-jpg">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
          <polyline points="17 21 17 13 7 13 7 21"></polyline>
          <polyline points="7 3 7 8 15 8"></polyline>
        </svg>
        Save as JPG
      </button>
      <div class="screenshot-context-menu-separator"></div>
      <button class="screenshot-context-menu-item" data-action="cancel">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
        Cancel
      </button>
    `;

    document.body.appendChild(this.screenshotContextMenu);

    // Calculate menu dimensions and position dynamically
    const menuHeight = this.screenshotContextMenu.offsetHeight;
    const menuWidth = this.screenshotContextMenu.offsetWidth;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Determine if menu should open upward or downward
    const spaceBelow = viewportHeight - y;
    const spaceAbove = y;
    const openUpward = spaceBelow < menuHeight && spaceAbove > spaceBelow;

    // Calculate horizontal position (ensure it stays within viewport)
    let leftPos = x + 10;
    if (leftPos + menuWidth > viewportWidth) {
      leftPos = viewportWidth - menuWidth - 10;
    }

    // Calculate vertical position
    let topPos = openUpward ? y - menuHeight : y;

    // Ensure menu doesn't go off top or bottom
    if (topPos < 0) topPos = 0;
    if (topPos + menuHeight > viewportHeight) topPos = viewportHeight - menuHeight;

    this.screenshotContextMenu.style.left = `${leftPos}px`;
    this.screenshotContextMenu.style.top = `${topPos}px`;

    // Add click handlers
    this.screenshotContextMenu.querySelectorAll('.screenshot-context-menu-item').forEach(item => {
      item.addEventListener('click', async () => {
        const action = item.dataset.action;
        await this.handleScreenshotAction(action, bounds);
      });
    });
  }

  async handleScreenshotAction(action, bounds) {
    try {
      if (action === 'cancel') {
        this.cancelScreenshot();
        return;
      }

      // Capture screenshot with bounds
      if (window.kolboDesktop && window.kolboDesktop.captureScreenshot) {
        // Include device pixel ratio in bounds for accurate capture
        const boundsWithDPR = {
          ...bounds,
          devicePixelRatio: window.devicePixelRatio || 1
        };

        const result = await window.kolboDesktop.captureScreenshot(boundsWithDPR);

        if (action === 'copy') {
          await window.kolboDesktop.copyScreenshotToClipboard(result.dataUrl);
          if (this.DEBUG_MODE) {
          console.log('[TabManager] Screenshot copied to clipboard');
          }
        } else if (action === 'save-png' || action === 'save-jpg') {
          const format = action === 'save-png' ? 'png' : 'jpg';
          await window.kolboDesktop.saveScreenshot(result.dataUrl, format);
          if (this.DEBUG_MODE) {
          console.log('[TabManager] Screenshot saved as', format);
          }
        }
      } else {
        console.warn('[TabManager] Screenshot API not available');
      }

      this.cancelScreenshot();
    } catch (error) {
      console.error('[TabManager] Error handling screenshot action:', error);
      this.cancelScreenshot();
    }
  }

  cancelScreenshot() {
    this.screenshotMode = false;
    this.screenshotDragging = false;

    if (this.screenshotOverlay) {
      this.screenshotOverlay.remove();
      this.screenshotOverlay = null;
    }

    if (this.screenshotSelection) {
      this.screenshotSelection = null;
    }

    if (this.screenshotContextMenu) {
      this.screenshotContextMenu.remove();
      this.screenshotContextMenu = null;
    }

    if (this.screenshotEscHandler) {
      document.removeEventListener('keydown', this.screenshotEscHandler);
      this.screenshotEscHandler = null;
    }

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Screenshot mode cancelled');
    }
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
    // MEMORY LEAK FIX: Remove all event listeners before destroying
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }

    if (this.visibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
      this.visibilityChangeHandler = null;
    }

    if (this.screenshotKeyboardHandler) {
      document.removeEventListener('keydown', this.screenshotKeyboardHandler);
      this.screenshotKeyboardHandler = null;
    }

    if (this.screenshotBtnHandler && this.screenshotBtn) {
      this.screenshotBtn.removeEventListener('click', this.screenshotBtnHandler);
      this.screenshotBtnHandler = null;
    }

    // Clear all intervals
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }

    // Clear debounce timer
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
      this._saveDebounceTimer = null;
    }

    // Clean up tabs and iframes
    this.tabs.forEach(tab => {
      if (tab.iframe) {
        tab.iframe.src = 'about:blank'; // Unload content first
        tab.iframe.remove();
        tab.iframe = null; // Clear reference for GC
      }
      if (tab.element) {
        tab.element.remove();
        tab.element = null;
      }
    });

    this.tabs = [];
    this.activeTabId = null;
    this._lastSavedState = null;

    console.log('[TabManager] Destroyed and cleaned up all resources');
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

    // Create refresh buttons for split presets bar
    // Add separator before refresh buttons
    const separator = document.createElement('div');
    separator.className = 'split-refresh-separator';

    const leftRefreshBtn = document.createElement('button');
    leftRefreshBtn.className = 'split-pane-refresh-btn split-pane-refresh-left';
    leftRefreshBtn.title = 'Refresh Left Pane';
    leftRefreshBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
      </svg>
      <span>Left</span>
    `;
    leftRefreshBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.refreshSplitPane(mergedTabId, 'left');
    });

    const rightRefreshBtn = document.createElement('button');
    rightRefreshBtn.className = 'split-pane-refresh-btn split-pane-refresh-right';
    rightRefreshBtn.title = 'Refresh Right Pane';
    rightRefreshBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
      </svg>
      <span>Right</span>
    `;
    rightRefreshBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.refreshSplitPane(mergedTabId, 'right');
    });

    // Append refresh buttons to split-presets container instead of merged overlay
    if (this.splitPresetsContainer) {
      this.splitPresetsContainer.appendChild(separator);
      this.splitPresetsContainer.appendChild(leftRefreshBtn);
      this.splitPresetsContainer.appendChild(rightRefreshBtn);
    }

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

    // Store merged tab info including iframe references AND original tab objects
    // CRITICAL: We need to store the original tab objects so we can restore them
    // when the merged tab is closed (since we remove them from this.tabs array)
    this.mergedTabs.set(mergedTabId, {
      leftTabId: leftTab.id,
      rightTabId: rightTab.id,
      leftTab: leftTab,   // Store full tab object
      rightTab: rightTab, // Store full tab object
      divider,
      leftIframe,  // Store iframe reference
      rightIframe, // Store iframe reference
      separator,   // Store separator element reference
      leftRefreshBtn,  // Store left refresh button reference
      rightRefreshBtn, // Store right refresh button reference
      activePaneId: 'left',
      splitRatio: 0.5
    });

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Setting up split view CSS for iframes');
      if (this.DEBUG_MODE) {
      console.log('[TabManager] Left iframe:', leftTab.id);
      }
      if (this.DEBUG_MODE) {
      console.log('[TabManager] Right iframe:', rightTab.id);
      }
    }

    // CRITICAL: First, remove any existing split classes and reset inline styles
    // This ensures a clean state if the iframe was previously in a split view
    leftIframe.classList.remove('split-left-iframe', 'split-right-iframe', 'split-active');
    rightIframe.classList.remove('split-left-iframe', 'split-right-iframe', 'split-active');

    // Apply CSS classes to iframes for split positioning (NO DOM MOVING!)
    // Position left iframe
    leftIframe.classList.add('split-left-iframe');
    leftIframe.style.width = '50%';
    leftIframe.style.left = '0';
    leftIframe.style.right = '';
    leftIframe.style.position = '';
    leftIframe.style.display = 'block';

    // Position right iframe
    rightIframe.classList.add('split-right-iframe');
    rightIframe.style.width = '50%';
    rightIframe.style.left = '50%';
    rightIframe.style.right = '';
    rightIframe.style.position = '';
    rightIframe.style.display = 'block';

    // NOTE: Don't manually set 'active' class here - let switchTab() handle it
    // This prevents conflicts and ensures consistent state management

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

    // CRITICAL: Remove original tab elements from DOM (not just hide them)
    // This ensures the tab bar only shows the merged tab, not the original tabs
    leftTab.element.remove();
    rightTab.element.remove();

    // Remove original tabs from the tabs array
    const leftTabIndex = this.tabs.indexOf(leftTab);
    const rightTabIndex = this.tabs.indexOf(rightTab);

    // Remove from array (remove higher index first to avoid index shifting issues)
    if (leftTabIndex > rightTabIndex) {
      if (leftTabIndex !== -1) this.tabs.splice(leftTabIndex, 1);
      if (rightTabIndex !== -1) this.tabs.splice(rightTabIndex, 1);
    } else {
      if (rightTabIndex !== -1) this.tabs.splice(rightTabIndex, 1);
      if (leftTabIndex !== -1) this.tabs.splice(leftTabIndex, 1);
    }

    if (this.DEBUG_MODE) {
      console.log('[TabManager] Removed original tabs from array. Tabs remaining:', this.tabs.length);
    }

    // Switch to merged tab
    this.switchTab(mergedTabId);

    // DON'T renumber tabs after creating split view!
    // We want to preserve the original tab numbers so the merged tab name makes sense
    // Example: If we merge "Kolbo.AI 2" and "Kolbo.AI 3", and "Kolbo.AI 1" remains,
    // we want to see "Kolbo.AI 1" and "Kolbo.AI 2 | Kolbo.AI 3" (not "Kolbo.AI 1" and "Kolbo.AI 1 | Kolbo.AI 2")
    // Renumbering only happens when tabs are closed, not when merged
    // this.renumberTabs(); // REMOVED - don't renumber after merge

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

    // Refresh buttons are now in the split-presets bar and don't need repositioning

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

    // CRITICAL: Check if ANY merged tab already exists
    // We only allow ONE split view at a time to prevent iframe conflicts
    const hasMergedTab = this.tabs.some(t => t.isMerged);

    // If a merged tab exists and we're NOT currently viewing it, disable the split button
    // This prevents creating multiple split views which would cause display conflicts
    if (hasMergedTab && activeTab && !activeTab.isMerged) {
      this.splitViewBtn.disabled = true;
      this.splitViewBtn.classList.remove('active');

      // Hide preset buttons
      if (this.splitPresetsContainer) {
        this.splitPresetsContainer.classList.add('hidden');
      }

      if (this.DEBUG_MODE) {
        console.log('[TabManager] Split button disabled - a split view already exists');
      }

      return; // Exit early - don't allow creating another split view
    }

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
