// Kolbo Studio - File Manager
// Handles file downloads to cache with 5GB limit and LRU eviction

const { ipcMain, app } = require('electron');
const Store = require('electron-store');
const config = require('../config');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

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

  static ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      console.log('[FileManager] Cache directory created');
    }
  }

  static async downloadFile(event, { url, fileName }) {
    const filePath = path.join(CACHE_DIR, fileName);

    // Check if already cached
    if (fs.existsSync(filePath)) {
      // Update access time for future reference
      fs.utimesSync(filePath, new Date(), new Date());
      console.log('[FileManager] File already cached:', fileName);
      return { success: true, filePath };
    }

    // No automatic cache size check - users manage cache manually
    // This prevents automatic deletion which could corrupt NLE projects

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
          console.log('[FileManager] Downloaded:', fileName);
          resolve({ success: true, filePath });
        });
      });

      request.on('error', (err) => {
        file.close();
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
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

    const results = [];

    for (const item of items) {
      try {
        const filePath = path.join(targetFolder, item.fileName);

        // Check if file already exists
        if (fs.existsSync(filePath)) {
          console.log('[FileManager] File already exists, skipping:', item.fileName);
          results.push({
            success: true,
            fileName: item.fileName,
            filePath,
            skipped: true
          });
          continue;
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
              console.log('[FileManager] Downloaded:', item.fileName);
              resolve();
            });
          });

          request.on('error', (err) => {
            file.close();
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            reject(err);
          });

          request.setTimeout(300000, () => {
            request.destroy();
            reject(new Error('Download timeout'));
          });
        });

        results.push({
          success: true,
          fileName: item.fileName,
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
      if (params.category) queryParams.set('category', params.category);
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
