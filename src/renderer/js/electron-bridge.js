// ============================================================================
// ELECTRON BRIDGE - DRAG & DROP HANDLER
// ============================================================================
//
// PURPOSE:
// Handles OS-level drag-and-drop from Electron renderer to ANY application
// Replaces adobe-bridge.js from the CEP plugin
//
// KEY FEATURES:
// - Universal drag-and-drop (works with ANY app, not just Adobe)
// - File download and caching (5GB cache with LRU eviction)
// - Batch operations (drag multiple files at once)
// - Progress tracking
//
// ARCHITECTURE:
// Renderer (this file) → IPC → Main Process (drag-handler.js) → OS Drag API
//
// WORKFLOW:
// 1. User clicks drag handle or drags media item
// 2. Call prepareDrag() to download files to cache
// 3. Call startDrag() to initiate OS-level drag
// 4. User drops files into ANY application
//
// ============================================================================

/**
 * Debug logging helper
 */
function log(...args) {
  const DEBUG_MODE = localStorage.getItem('KOLBO_DEBUG') === 'true';
  if (DEBUG_MODE) {
    console.log('[ElectronBridge]', ...args);
  }
}

/**
 * Prepare files for drag operation
 * Downloads files to cache and returns local file paths
 *
 * @param {Array} items - Array of media items {id, fileName, url, thumbnailUrl}
 * @returns {Promise<Object>} - {success, filePaths[], thumbnailPaths[], errors[]}
 */
async function prepareDrag(items) {
  log('Preparing drag for', items.length, 'items');

  try {
    // Call main process to download files
    const result = await window.kolboDesktop.prepareForDrag(items);

    log('Prepare drag result:', result);

    if (result.success) {
      // Extract successful file paths
      const filePaths = result.results
        .filter(r => r.success)
        .map(r => r.filePath);

      const thumbnailPaths = result.results
        .filter(r => r.success && r.thumbnailPath)
        .map(r => r.thumbnailPath);

      const errors = result.results
        .filter(r => !r.success)
        .map(r => ({
          fileName: r.fileName,
          error: r.error
        }));

      return {
        success: true,
        filePaths,
        thumbnailPaths,
        successCount: result.successCount,
        totalCount: result.totalCount,
        errors
      };
    } else {
      return {
        success: false,
        error: result.error || 'Failed to prepare files for drag'
      };
    }
  } catch (error) {
    console.error('[ElectronBridge] Prepare drag error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Start OS-level drag operation
 * Must be called AFTER prepareDrag()
 *
 * @param {Array} filePaths - Local file paths from prepareDrag()
 * @param {Array} thumbnailPaths - Thumbnail paths for drag icons
 * @returns {Promise<Object>} - {success, error}
 */
async function startDrag(filePaths, thumbnailPaths = []) {
  log('Starting drag with', filePaths.length, 'files');

  try {
    const result = await window.kolboDesktop.startDrag(filePaths, thumbnailPaths);

    log('Start drag result:', result);

    return result;
  } catch (error) {
    console.error('[ElectronBridge] Start drag error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Prepare and start drag in one operation
 * Convenience function that combines prepareDrag() and startDrag()
 *
 * @param {Array} items - Array of media items
 * @param {Function} onProgress - Progress callback (optional)
 * @returns {Promise<Object>} - {success, error}
 */
async function prepareAndStartDrag(items, onProgress = null) {
  log('Prepare and start drag for', items.length, 'items');

  try {
    // Show progress if callback provided
    if (onProgress) {
      onProgress({
        stage: 'preparing',
        message: `Preparing ${items.length} file(s) for drag...`,
        progress: 0
      });
    }

    // Prepare files
    const prepareResult = await prepareDrag(items);

    if (!prepareResult.success) {
      return {
        success: false,
        error: prepareResult.error
      };
    }

    // Check if any files succeeded
    if (prepareResult.filePaths.length === 0) {
      return {
        success: false,
        error: 'No files could be prepared for drag'
      };
    }

    // Show progress
    if (onProgress) {
      onProgress({
        stage: 'ready',
        message: `${prepareResult.successCount}/${prepareResult.totalCount} files ready`,
        progress: 100
      });
    }

    // Start drag
    const dragResult = await startDrag(
      prepareResult.filePaths,
      prepareResult.thumbnailPaths
    );

    // Report any errors
    if (prepareResult.errors.length > 0) {
      console.warn('[ElectronBridge] Some files failed:', prepareResult.errors);
    }

    return {
      success: dragResult.success,
      successCount: prepareResult.successCount,
      totalCount: prepareResult.totalCount,
      errors: prepareResult.errors,
      error: dragResult.error
    };
  } catch (error) {
    console.error('[ElectronBridge] Prepare and start drag error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get cache information
 *
 * @returns {Promise<Object>} - {bytes, formatted, maxSize, maxFormatted}
 */
async function getCacheSize() {
  try {
    return await window.kolboDesktop.getCacheSize();
  } catch (error) {
    console.error('[ElectronBridge] Get cache size error:', error);
    return {
      bytes: 0,
      formatted: '0 GB',
      maxSize: 5368709120,
      maxFormatted: '5.00 GB'
    };
  }
}

/**
 * Clear all cached files
 *
 * @returns {Promise<Object>} - {success, deletedFiles}
 */
async function clearCache() {
  try {
    log('Clearing cache');
    return await window.kolboDesktop.clearCache();
  } catch (error) {
    console.error('[ElectronBridge] Clear cache error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Open URL in external browser
 *
 * @param {String} url - URL to open
 */
async function openExternal(url) {
  try {
    log('Opening external URL:', url);
    await window.kolboDesktop.openExternal(url);
  } catch (error) {
    console.error('[ElectronBridge] Open external error:', error);
  }
}

/**
 * Get app version
 *
 * @returns {Promise<String>} - App version
 */
async function getAppVersion() {
  try {
    return await window.kolboDesktop.getVersion();
  } catch (error) {
    console.error('[ElectronBridge] Get version error:', error);
    return '0.0.0';
  }
}

// ============================================================================
// LEGACY COMPATIBILITY (for plugin code that may still reference these)
// ============================================================================

/**
 * Legacy: Import to project bin (not applicable in Electron)
 * In Electron, we only support drag-and-drop
 */
function importToBin(item) {
  console.warn('[ElectronBridge] importToBin() not supported - use drag-and-drop instead');
  return Promise.resolve({
    success: false,
    error: 'Import to bin not supported in desktop app. Please use drag-and-drop.'
  });
}

/**
 * Legacy: Import to timeline (not applicable in Electron)
 * In Electron, we only support drag-and-drop
 */
function importToTimeline(item) {
  console.warn('[ElectronBridge] importToTimeline() not supported - use drag-and-drop instead');
  return Promise.resolve({
    success: false,
    error: 'Import to timeline not supported in desktop app. Please use drag-and-drop.'
  });
}

/**
 * Legacy: Batch import to timeline (not applicable in Electron)
 * In Electron, we only support drag-and-drop
 */
function addBatchToTimeline(items) {
  console.warn('[ElectronBridge] addBatchToTimeline() not supported - use drag-and-drop instead');
  return Promise.resolve({
    success: false,
    error: 'Batch import not supported in desktop app. Please use drag-and-drop.'
  });
}

// ============================================================================
// EXPORTS (available globally)
// ============================================================================

// Main API
window.electronBridge = {
  prepareDrag,
  startDrag,
  prepareAndStartDrag,
  getCacheSize,
  clearCache,
  openExternal,
  getAppVersion,

  // Legacy compatibility (return errors)
  importToBin,
  importToTimeline,
  addBatchToTimeline
};

log('Electron bridge initialized');
