// Kolbo Desktop - File Manager
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
const MAX_CACHE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

class FileManager {
  static setupHandlers() {
    ipcMain.handle('file:download', this.downloadFile.bind(this));
    ipcMain.handle('cache:get-size', this.getCacheSize.bind(this));
    ipcMain.handle('cache:clear', this.clearCache.bind(this));
    ipcMain.handle('media:get', this.getMedia.bind(this));
    ipcMain.handle('media:get-projects', this.getProjects.bind(this));

    // Ensure cache directory exists
    this.ensureCacheDir();

    console.log('[FileManager] IPC handlers registered');
    console.log('[FileManager] Cache directory:', CACHE_DIR);
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
      // Update access time for LRU
      fs.utimesSync(filePath, new Date(), new Date());
      console.log('[FileManager] File already cached:', fileName);
      return { success: true, filePath };
    }

    // Check cache size before download
    const cacheSize = this.getCacheSizeSync();
    if (cacheSize > MAX_CACHE_SIZE) {
      console.log('[FileManager] Cache full (' + (cacheSize / (1024 ** 3)).toFixed(2) + ' GB), evicting oldest files...');
      await this.evictOldestFiles();
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
    return {
      bytes,
      formatted: `${gb} GB`,
      maxSize: MAX_CACHE_SIZE,
      maxFormatted: '5.00 GB'
    };
  }

  static async evictOldestFiles() {
    try {
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

      // Sort by access time (oldest first)
      files.sort((a, b) => a.atime - b.atime);

      // Delete oldest files until cache is under 4GB (80% of max)
      let currentSize = this.getCacheSizeSync();
      const targetSize = MAX_CACHE_SIZE * 0.8;

      let deletedCount = 0;
      for (const file of files) {
        if (currentSize <= targetSize) break;

        try {
          fs.unlinkSync(file.path);
          currentSize -= file.size;
          deletedCount++;
        } catch (error) {
          console.error('[FileManager] Failed to delete:', file.path, error);
        }
      }

      console.log(`[FileManager] Evicted ${deletedCount} files, cache now ${(currentSize / (1024 ** 3)).toFixed(2)} GB`);
    } catch (error) {
      console.error('[FileManager] Eviction error:', error);
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
