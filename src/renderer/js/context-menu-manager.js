// Kolbo Studio - Context Menu Manager (Renderer Side)
// Handles context menu detection and display

class ContextMenuManager {
  constructor(app) {
    this.app = app; // Reference to main KolboApp instance
    this.setupContextMenuActionListener();
  }

  /**
   * Setup listener for context menu actions from main process
   */
  setupContextMenuActionListener() {
    if (!window.kolboDesktop) return;

    window.kolboDesktop.onContextMenuAction((data) => {
      const { action, params } = data;

      console.log('[Context Menu] Action received:', action, params);

      switch (action) {
        case 'download':
          this.handleDownload(params);
          break;
        case 'download-batch':
          this.handleBatchDownload(params);
          break;
        case 'import-premiere':
          this.handlePremiereImport(params);
          break;
        case 'premiere-batch':
          this.handleBatchPremiereImport(params);
          break;
        case 'copy-urls-batch':
          this.handleCopyUrlsBatch(params);
          break;
        case 'clear-selection':
          this.handleClearSelection();
          break;
        case 'reveal-cache':
          this.handleRevealCache(params);
          break;
        case 'open-in-new-tab':
          this.handleOpenInNewTab(params);
          break;
        case 'open-in-new-window':
          this.handleOpenInNewWindow(params);
          break;
        case 'go-back':
          this.handleGoBack();
          break;
        case 'go-forward':
          this.handleGoForward();
          break;
        case 'reload':
          this.handleReload();
          break;
        default:
          console.warn('[Context Menu] Unknown action:', action);
      }
    });
  }

  /**
   * Show context menu for media item (My Media tab)
   */
  async showMediaItemContextMenu(event, mediaId) {
    event.preventDefault();
    event.stopPropagation();

    // Check if this is a batch selection
    const isMultiSelect = this.app.selectedItems.size > 1 && this.app.selectedItems.has(mediaId);

    if (isMultiSelect) {
      // Batch selection menu
      await window.kolboDesktop.showMediaItemContextMenu({
        isMultiSelect: true,
        selectedCount: this.app.selectedItems.size,
        selectedIds: Array.from(this.app.selectedItems)
      });
    } else {
      // Single item menu
      const mediaItem = this.app.media.find(m => m.id === mediaId);
      if (!mediaItem) return;

      // Check if cached
      const cacheResult = await window.kolboDesktop.getCachedFilePath(mediaId);

      await window.kolboDesktop.showMediaItemContextMenu({
        isMultiSelect: false,
        selectedCount: 1,
        mediaItem: {
          id: mediaItem.id,
          type: mediaItem.type,
          url: mediaItem.url,
          fileName: mediaItem.file_name || `media_${mediaItem.id}`,
          cached: cacheResult.cached,
          cachePath: cacheResult.filePath
        }
      });
    }
  }

  /**
   * Handle download action
   */
  async handleDownload(params) {
    const { mediaItem } = params;

    if (!mediaItem) return;

    console.log('[Context Menu] Downloading:', mediaItem.fileName);

    // Use existing download functionality
    if (this.app && this.app.handleBatchDownload) {
      // Find the full media item
      const fullMediaItem = this.app.media.find(m => m.id === mediaItem.id);
      if (fullMediaItem) {
        await this.app.handleBatchDownload([fullMediaItem]);
      }
    }
  }

  /**
   * Handle batch download
   */
  async handleBatchDownload(params) {
    const { selectedIds } = params;

    if (!selectedIds || !this.app) return;

    console.log('[Context Menu] Batch downloading:', selectedIds.length, 'items');

    // Get full media items
    const mediaItems = this.app.media.filter(m => selectedIds.includes(m.id));

    if (this.app.handleBatchDownload) {
      await this.app.handleBatchDownload(mediaItems);
    }
  }

  /**
   * Handle Premiere import
   */
  async handlePremiereImport(params) {
    const { mediaItem } = params;

    if (!mediaItem || !this.app) return;

    console.log('[Context Menu] Importing to Premiere:', mediaItem.fileName);

    const fullMediaItem = this.app.media.find(m => m.id === mediaItem.id);
    if (fullMediaItem && this.app.handleBatchPremiereImport) {
      await this.app.handleBatchPremiereImport([fullMediaItem]);
    }
  }

  /**
   * Handle batch Premiere import
   */
  async handleBatchPremiereImport(params) {
    const { selectedIds } = params;

    if (!selectedIds || !this.app) return;

    console.log('[Context Menu] Batch importing to Premiere:', selectedIds.length, 'items');

    const mediaItems = this.app.media.filter(m => selectedIds.includes(m.id));

    if (this.app.handleBatchPremiereImport) {
      await this.app.handleBatchPremiereImport(mediaItems);
    }
  }

  /**
   * Handle copy URLs batch
   */
  handleCopyUrlsBatch(params) {
    const { selectedIds } = params;

    if (!selectedIds || !this.app) return;

    const urls = this.app.media
      .filter(m => selectedIds.includes(m.id))
      .map(m => m.url)
      .join('\n');

    // Copy to clipboard using textarea (works cross-platform)
    const textarea = document.createElement('textarea');
    textarea.value = urls;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);

    console.log('[Context Menu] Copied', selectedIds.length, 'URLs to clipboard');

    if (this.app.showToast) {
      this.app.showToast(`Copied ${selectedIds.length} URLs to clipboard`, 'success');
    }
  }

  /**
   * Handle clear selection
   */
  handleClearSelection() {
    if (this.app && this.app.handleBatchClear) {
      this.app.handleBatchClear();
    }
  }

  /**
   * Handle reveal in cache
   */
  async handleRevealCache(params) {
    const { mediaItem } = params;

    if (!mediaItem || !mediaItem.cachePath) return;

    await window.kolboDesktop.revealFileInFolder(mediaItem.cachePath);
  }

  /**
   * Handle open in new tab (webapp)
   */
  handleOpenInNewTab(params) {
    const { url } = params;

    if (!url) return;

    console.log('[Context Menu] Opening in new tab:', url);

    // Use tab manager to open new tab
    if (this.app && this.app.tabManager) {
      this.app.tabManager.createTab(url);
    }
  }

  /**
   * Handle open in new window
   */
  async handleOpenInNewWindow(params) {
    const { url } = params;

    if (!url) return;

    console.log('[Context Menu] Opening in new window:', url);

    await window.kolboDesktop.createNewWindow(url);
  }

  /**
   * Handle go back (webapp)
   */
  handleGoBack() {
    if (this.app && this.app.tabManager) {
      const activeTab = this.app.tabManager.getActiveTab();
      if (activeTab && activeTab.iframe && activeTab.iframe.contentWindow) {
        activeTab.iframe.contentWindow.history.back();
      }
    }
  }

  /**
   * Handle go forward (webapp)
   */
  handleGoForward() {
    if (this.app && this.app.tabManager) {
      const activeTab = this.app.tabManager.getActiveTab();
      if (activeTab && activeTab.iframe && activeTab.iframe.contentWindow) {
        activeTab.iframe.contentWindow.history.forward();
      }
    }
  }

  /**
   * Handle reload (webapp)
   */
  handleReload() {
    if (this.app && this.app.tabManager) {
      const activeTab = this.app.tabManager.getActiveTab();
      if (activeTab && activeTab.iframe) {
        const currentSrc = activeTab.iframe.src;
        activeTab.iframe.src = currentSrc;
      }
    }
  }
}

// Make it globally available
window.ContextMenuManager = ContextMenuManager;
