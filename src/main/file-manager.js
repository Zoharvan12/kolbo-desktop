// Kolbo Studio - File Manager
// Handles file downloads to cache with 5GB limit and LRU eviction

const { ipcMain, app, dialog } = require('electron');
const Store = require('electron-store');
const config = require('../config');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const checkDiskSpace = require('check-disk-space').default;

const store = new Store(); // Shared store instance
const CACHE_DIR = path.join(app.getPath('userData'), 'MediaCache');
// Cache limit removed - users manage cache manually via Settings page
// This prevents NLE project corruption from automatic file deletion

class FileManager {
  static setupHandlers() {
    ipcMain.handle('file:download', this.downloadFile.bind(this));
    ipcMain.handle('file:batch-download', this.batchDownload.bind(this));
    ipcMain.handle('cache:get-size', this.getCacheSize.bind(this));
    ipcMain.handle('cache:clear', this.clearCache.bind(this));
    ipcMain.handle('cache:is-cached', this.isFileCached.bind(this));
    // PERFORMANCE FIX: Batch cache check to reduce IPC overhead
    ipcMain.handle('cache:batch-is-cached', this.batchIsFileCached.bind(this));
    ipcMain.handle('media:get', this.getMedia.bind(this));
    ipcMain.handle('media:get-projects', this.getProjects.bind(this));

    // Ensure cache directory exists
    this.ensureCacheDir();

    console.log('[FileManager] IPC handlers registered');
    console.log('[FileManager] Cache directory:', CACHE_DIR);
  }

  static isFileCached(event, { fileName }) {
    const filePath = path.join(CACHE_DIR, fileName);
    const exists = fs.existsSync(filePath);
    return { cached: exists, filePath };
  }

  // PERFORMANCE FIX: Batch check multiple files at once (reduces IPC overhead)
  static batchIsFileCached(event, fileNames) {
    if (!Array.isArray(fileNames)) {
      console.error('[FileManager] batchIsFileCached expects array, got:', typeof fileNames);
      return [];
    }

    return fileNames.map(fileName => {
      const filePath = path.join(CACHE_DIR, fileName);
      const exists = fs.existsSync(filePath);
      return { fileName, cached: exists, filePath };
    });
  }

  static ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      console.log('[FileManager] Cache directory created');
    }
  }

  /**
   * Check available disk space
   * @param {string} directoryPath - Path to check disk space for
   * @returns {Promise<Object>} - { free, size, available } in bytes
   */
  static async checkDiskSpace(directoryPath) {
    try {
      const diskSpace = await checkDiskSpace(directoryPath);
      return diskSpace;
    } catch (error) {
      console.error('[FileManager] Error checking disk space:', error);
      // Return null to indicate error, caller should handle gracefully
      return null;
    }
  }

  /**
   * Check if there's enough disk space for a download
   * @param {number} requiredBytes - Bytes needed for download
   * @param {string} targetPath - Target directory path
   * @returns {Promise<Object>} - { hasSpace: boolean, available: number, required: number, message: string }
   */
  static async hasEnoughDiskSpace(requiredBytes, targetPath) {
    const diskSpace = await this.checkDiskSpace(targetPath);

    if (!diskSpace) {
      // If we can't check disk space, allow download but warn
      console.warn('[FileManager] Could not check disk space, proceeding with download');
      return { hasSpace: true, available: -1, required: requiredBytes };
    }

    const availableBytes = diskSpace.free;
    // Keep 500MB buffer for system stability
    const bufferBytes = 500 * 1024 * 1024;
    const hasSpace = availableBytes > (requiredBytes + bufferBytes);

    const availableMB = (availableBytes / (1024 * 1024)).toFixed(2);
    const requiredMB = (requiredBytes / (1024 * 1024)).toFixed(2);
    const availableGB = (availableBytes / (1024 * 1024 * 1024)).toFixed(2);

    let message = '';
    if (!hasSpace) {
      message = `Not enough disk space. Available: ${availableGB} GB, Required: ${requiredMB} MB (plus 500 MB buffer)`;
    } else if (availableBytes < 2 * 1024 * 1024 * 1024) {
      // Warn if less than 2GB available
      message = `Warning: Low disk space (${availableGB} GB remaining)`;
    }

    return {
      hasSpace,
      available: availableBytes,
      required: requiredBytes,
      availableMB: parseFloat(availableMB),
      requiredMB: parseFloat(requiredMB),
      availableGB: parseFloat(availableGB),
      message
    };
  }

  static async downloadFile(event, { url, fileName }) {
    // Check disk space before downloading (estimate 100MB if size unknown)
    const estimatedSize = 100 * 1024 * 1024; // 100MB default estimate
    const spaceCheck = await this.hasEnoughDiskSpace(estimatedSize, CACHE_DIR);

    if (!spaceCheck.hasSpace) {
      const error = new Error(spaceCheck.message);
      error.code = 'ENOSPC';
      console.error('[FileManager] Insufficient disk space:', spaceCheck.message);

      // Show error dialog to user
      dialog.showErrorBox(
        'Insufficient Disk Space',
        `Cannot download ${fileName}.\n\n${spaceCheck.message}\n\nPlease free up disk space and try again, or clear cached files in Settings.`
      );

      throw error;
    }

    // Warn user if low disk space
    if (spaceCheck.message && spaceCheck.hasSpace) {
      console.warn('[FileManager]', spaceCheck.message);
    }

    // Generate unique filename if file already exists
    let filePath = path.join(CACHE_DIR, fileName);
    let counter = 1;
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);

    while (fs.existsSync(filePath)) {
      filePath = path.join(CACHE_DIR, `${base} (${counter})${ext}`);
      counter++;
    }

    // If filename was changed, log it
    if (counter > 1) {
      console.log('[FileManager] File exists, using unique name:', path.basename(filePath));
    }

    // Download file
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(filePath);
      const protocol = url.startsWith('https') ? https : http;

      console.log('[FileManager] Downloading:', fileName);

      const request = protocol.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          console.log('[FileManager] Redirect to:', response.headers.location);
          file.close();
          fs.unlinkSync(filePath);
          return this.downloadFile(event, {
            url: response.headers.location,
            fileName
          }).then(resolve).catch(reject);
        }

        if (response.statusCode !== 200) {
          file.close();
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          return reject(new Error(`HTTP ${response.statusCode}`));
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log('[FileManager] Downloaded:', path.basename(filePath));
          resolve({ success: true, filePath });
        });
      });

      request.on('error', (err) => {
        file.close();
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        // Check if it's a disk space error
        if (err.code === 'ENOSPC') {
          dialog.showErrorBox(
            'Disk Full',
            `Your disk is full. Cannot download ${fileName}.\n\nPlease free up disk space and try again, or clear cached files in Settings.`
          );
        }

        reject(err);
      });

      // Handle file write errors (including ENOSPC)
      file.on('error', (err) => {
        file.close();
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (unlinkErr) {
            console.warn('[FileManager] Could not delete partial file:', unlinkErr.message);
          }
        }

        // Check if it's a disk space error
        if (err.code === 'ENOSPC') {
          dialog.showErrorBox(
            'Disk Full',
            `Your disk is full. Cannot download ${fileName}.\n\nPlease free up disk space and try again, or clear cached files in Settings.`
          );
        }

        reject(err);
      });

      request.setTimeout(300000, () => {
        request.destroy();
        reject(new Error('Download timeout'));
      });
    });
  }

  static async batchDownload(event, { items, targetFolder }) {
    console.log(`[FileManager] Batch downloading ${items.length} files to:`, targetFolder);

    // Check disk space before starting batch download
    const estimatedTotalSize = items.length * 100 * 1024 * 1024; // Estimate 100MB per file
    const spaceCheck = await this.hasEnoughDiskSpace(estimatedTotalSize, targetFolder);

    if (!spaceCheck.hasSpace) {
      const error = new Error(spaceCheck.message);
      error.code = 'ENOSPC';
      console.error('[FileManager] Insufficient disk space for batch download:', spaceCheck.message);

      dialog.showErrorBox(
        'Insufficient Disk Space',
        `Cannot download ${items.length} files.\n\n${spaceCheck.message}\n\nPlease free up disk space and try again, or clear cached files in Settings.`
      );

      return {
        success: false,
        error: spaceCheck.message,
        results: [],
        successCount: 0,
        totalCount: items.length
      };
    }

    // Warn user if low disk space
    if (spaceCheck.message && spaceCheck.hasSpace) {
      console.warn('[FileManager] Batch download:', spaceCheck.message);
    }

    const results = [];

    for (const item of items) {
      try {
        // Generate unique filename if file already exists
        let filePath = path.join(targetFolder, item.fileName);
        let counter = 1;
        const ext = path.extname(item.fileName);
        const base = path.basename(item.fileName, ext);

        while (fs.existsSync(filePath)) {
          filePath = path.join(targetFolder, `${base} (${counter})${ext}`);
          counter++;
        }

        // If filename was changed, log it
        if (counter > 1) {
          console.log('[FileManager] File exists, using unique name:', path.basename(filePath));
        }

        // Download file
        await new Promise((resolve, reject) => {
          const file = fs.createWriteStream(filePath);
          const protocol = item.url.startsWith('https') ? https : http;

          console.log('[FileManager] Downloading:', item.fileName);

          const request = protocol.get(item.url, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
              console.log('[FileManager] Redirect to:', response.headers.location);
              file.close();
              fs.unlinkSync(filePath);

              // Update URL and retry
              item.url = response.headers.location;
              return this.batchDownload(event, {
                items: [item],
                targetFolder
              }).then(resolve).catch(reject);
            }

            if (response.statusCode !== 200) {
              file.close();
              if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
              return reject(new Error(`HTTP ${response.statusCode}`));
            }

            response.pipe(file);

            file.on('finish', () => {
              file.close();
              console.log('[FileManager] Downloaded:', path.basename(filePath));
              resolve();
            });
          });

          request.on('error', (err) => {
            file.close();
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

            // Check if it's a disk space error
            if (err.code === 'ENOSPC') {
              dialog.showErrorBox(
                'Disk Full',
                `Your disk is full. Cannot download ${item.fileName}.\n\nBatch download stopped. Please free up disk space and try again.`
              );
            }

            reject(err);
          });

          // Handle file write errors (including ENOSPC)
          file.on('error', (err) => {
            file.close();
            if (fs.existsSync(filePath)) {
              try {
                fs.unlinkSync(filePath);
              } catch (unlinkErr) {
                console.warn('[FileManager] Could not delete partial file:', unlinkErr.message);
              }
            }

            // Check if it's a disk space error
            if (err.code === 'ENOSPC') {
              dialog.showErrorBox(
                'Disk Full',
                `Your disk is full. Cannot download ${item.fileName}.\n\nBatch download stopped. Please free up disk space and try again.`
              );
            }

            reject(err);
          });

          request.setTimeout(300000, () => {
            request.destroy();
            reject(new Error('Download timeout'));
          });
        });

        results.push({
          success: true,
          fileName: path.basename(filePath),
          filePath
        });

      } catch (error) {
        console.error('[FileManager] Download failed:', item.fileName, error);
        results.push({
          success: false,
          fileName: item.fileName,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`[FileManager] Batch download complete: ${successCount}/${items.length} successful`);

    return {
      success: true,
      results,
      successCount,
      totalCount: items.length
    };
  }

  static getCacheSizeSync() {
    let totalSize = 0;
    if (!fs.existsSync(CACHE_DIR)) return 0;

    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      const filePath = path.join(CACHE_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          totalSize += stats.size;
        }
      } catch (error) {
        // Skip files that can't be read
      }
    }
    return totalSize;
  }

  static getCacheSize() {
    const bytes = this.getCacheSizeSync();
    const gb = (bytes / (1024 ** 3)).toFixed(2);
    const mb = (bytes / (1024 ** 2)).toFixed(2);
    return {
      bytes,
      mb: parseFloat(mb),
      gb: parseFloat(gb),
      formatted: bytes > 1024 ** 3 ? `${gb} GB` : `${mb} MB`
    };
  }

  // Note: This function is no longer called automatically
  // It's kept for potential future "Clear Old Files" feature
  static async evictOldestFiles(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      // Get all files with access times
      const files = fs.readdirSync(CACHE_DIR).map(file => {
        const filePath = path.join(CACHE_DIR, file);
        try {
          const stats = fs.statSync(filePath);
          return {
            path: filePath,
            atime: stats.atime,
            size: stats.size
          };
        } catch (error) {
          return null;
        }
      }).filter(f => f !== null);

      // Delete files older than cutoff date
      let deletedCount = 0;
      let deletedSize = 0;

      for (const file of files) {
        if (file.atime < cutoffDate) {
          try {
            fs.unlinkSync(file.path);
            deletedSize += file.size;
            deletedCount++;
          } catch (error) {
            console.error('[FileManager] Failed to delete:', file.path, error);
          }
        }
      }

      console.log(`[FileManager] Evicted ${deletedCount} files older than ${daysOld} days, freed ${(deletedSize / (1024 ** 3)).toFixed(2)} GB`);
      return { success: true, deletedCount, deletedSize };
    } catch (error) {
      console.error('[FileManager] Eviction error:', error);
      return { success: false, error: error.message };
    }
  }

  static clearCache() {
    try {
      if (!fs.existsSync(CACHE_DIR)) {
        return { success: true, deletedFiles: 0 };
      }

      const files = fs.readdirSync(CACHE_DIR);
      let deletedCount = 0;

      for (const file of files) {
        try {
          fs.unlinkSync(path.join(CACHE_DIR, file));
          deletedCount++;
        } catch (error) {
          console.error('[FileManager] Failed to delete:', file, error);
        }
      }

      console.log(`[FileManager] Cache cleared: ${deletedCount} files deleted`);
      return { success: true, deletedFiles: deletedCount };

    } catch (error) {
      console.error('[FileManager] Clear cache error:', error);
      return { success: false, error: error.message };
    }
  }

  // Media API proxies (call Kolbo API from main process)
  static async getMedia(event, params) {
    try {
      // Use favorites endpoint if filtering by favorites
      if (params.isFavorited || params.category === 'favorites') {
        return this.getFavorites(event, params);
      }

      const API_BASE_URL = config.apiUrl;
      const token = store.get('token') || store.get('kolbo_access_token') || store.get('kolbo_token');

      if (!token) {
        console.error('[FileManager] No token found in store. Keys:', Object.keys(store.store));
        return { success: false, error: 'Not authenticated' };
      }

      console.log('[FileManager] Token found, making API request to:', API_BASE_URL);

      const queryParams = new URLSearchParams();
      if (params.page) queryParams.set('page', params.page);
      if (params.pageSize) queryParams.set('pageSize', params.pageSize);
      if (params.type && params.type !== 'all') queryParams.set('type', params.type);
      if (params.projectId && params.projectId !== 'all') queryParams.set('projectId', params.projectId);
      if (params.category && params.category !== 'favorites') queryParams.set('category', params.category);
      if (params.sort) queryParams.set('sort', params.sort);

      const url = `${API_BASE_URL}/media/db/all?${queryParams.toString()}`;
      console.log('[FileManager] Fetching media from:', url);

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        console.error('[FileManager] Media fetch failed:', response.status, response.statusText);
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data = await response.json();
      console.log('[FileManager] Media response:', {
        itemsCount: data.items?.length || data.data?.items?.length || 0,
        totalItems: data.pagination?.totalItems || data.totalCount || 0,
        hasNext: data.pagination?.hasNext || false,
        currentPage: data.pagination?.currentPage || params.page || 1
      });

      return { success: true, data };

    } catch (error) {
      console.error('[FileManager] getMedia error:', error);
      return { success: false, error: error.message };
    }
  }

  // Get favorites using dedicated endpoint (same as Adobe plugin)
  static async getFavorites(event, params) {
    try {
      const API_BASE_URL = config.apiUrl;
      const token = store.get('token') || store.get('kolbo_access_token') || store.get('kolbo_token');

      if (!token) {
        console.error('[FileManager] No token found for favorites');
        return { success: false, error: 'Not authenticated' };
      }

      const queryParams = new URLSearchParams();
      // Favorites endpoint uses 'limit' instead of 'pageSize'
      queryParams.set('limit', params.pageSize || 100);
      if (params.page) queryParams.set('page', params.page);

      // Add item_type filter if specified
      if (params.type && params.type !== 'all') {
        queryParams.set('item_type', params.type);
      }

      // Add project_id filter if specified
      if (params.projectId && params.projectId !== 'all') {
        queryParams.set('project_id', params.projectId);
      }

      const url = `${API_BASE_URL}/favorite-items?${queryParams.toString()}`;
      console.log('[FileManager] Fetching favorites from:', url);

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        console.error('[FileManager] Favorites fetch failed:', response.status, response.statusText);
        return { success: false, error: `HTTP ${response.status}` };
      }

      const responseData = await response.json();
      console.log('[FileManager] Favorites raw response:', responseData);

      // Transform favorites response to match media response format
      // Favorites endpoint returns {favorites: [...], totalCount, page, totalPages, hasMore}
      // Media endpoint returns {status: true, data: {items: [...], pagination: {...}}}
      const favorites = responseData.data?.favorites || responseData.favorites || [];
      const totalCount = responseData.data?.totalCount || responseData.totalCount || 0;
      const currentPage = responseData.data?.page || responseData.page || 1;
      const totalPages = responseData.data?.totalPages || responseData.totalPages || 1;
      const hasMore = responseData.data?.hasMore || responseData.hasMore || false;

      // Transform each favorite to match media item format
      const items = favorites.map(fav => ({
        id: fav.item_id || fav._id,
        type: fav.item_type,
        category: fav.metadata?.category || fav.item_type,
        filename: fav.metadata?.title || fav.metadata?.filename || 'Untitled',
        url: fav.url,
        thumbnailUrl: fav.metadata?.thumbnail_url || fav.metadata?.thumbnailUrl,
        created: fav.created_at,
        projectId: fav.project_id,
        userId: fav.user_id,
        metadata: fav.metadata || {},
        isFavorited: true
      }));

      console.log('[FileManager] Transformed favorites:', {
        itemsCount: items.length,
        totalItems: totalCount,
        currentPage,
        totalPages,
        hasMore
      });

      // Return in standard media format
      const data = {
        status: true,
        data: {
          items: items,
          pagination: {
            totalItems: totalCount,
            currentPage: currentPage,
            totalPages: totalPages,
            hasNext: hasMore,
            pageSize: params.pageSize || 100
          }
        }
      };

      return { success: true, data };

    } catch (error) {
      console.error('[FileManager] getFavorites error:', error);
      return { success: false, error: error.message };
    }
  }

  static async getProjects(event) {
    try {
      const API_BASE_URL = config.apiUrl;
      const token = store.get('token') || store.get('kolbo_access_token') || store.get('kolbo_token');

      if (!token) {
        console.error('[FileManager] No token found for projects. Keys:', Object.keys(store.store));
        return { success: false, error: 'Not authenticated' };
      }

      console.log('[FileManager] Token found for projects, making API request');

      const response = await fetch(`${API_BASE_URL}/project`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data = await response.json();
      return { success: true, data };

    } catch (error) {
      console.error('[FileManager] getProjects error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = FileManager;
