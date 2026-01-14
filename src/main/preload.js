// Kolbo Studio - Preload Script
console.log('[Preload] Script starting...');

const { contextBridge, ipcRenderer } = require('electron');
console.log('[Preload] Electron loaded');

// Detect environment from app executable name
function detectEnvironment() {
  // PRIORITY 1: Check process.env.KOLBO_ENV (works with npm start using cross-env)
  if (process.env.KOLBO_ENV) {
    console.log('[Preload] Environment from KOLBO_ENV:', process.env.KOLBO_ENV);
    return process.env.KOLBO_ENV;
  }

  // PRIORITY 2: Detect from executable name (works in packaged apps)
  // Use simple string parsing to avoid path module issues
  const exePath = process.execPath || '';
  console.log('[Preload] Executable path:', exePath);

  // Get filename from path (works on Windows and Unix)
  let exeName = exePath;
  const lastBackslash = exePath.lastIndexOf('\\');
  const lastSlash = exePath.lastIndexOf('/');
  const lastSeparator = Math.max(lastBackslash, lastSlash);

  if (lastSeparator >= 0) {
    exeName = exePath.substring(lastSeparator + 1);
  }

  // Remove .exe extension
  if (exeName.endsWith('.exe')) {
    exeName = exeName.slice(0, -4);
  }

  console.log('[Preload] Executable name:', exeName);

  // Detect environment from name
  if (exeName.includes('Dev')) {
    console.log('[Preload] Detected DEVELOPMENT from executable name');
    return 'development';
  } else if (exeName.includes('Staging')) {
    console.log('[Preload] Detected STAGING from executable name');
    return 'staging';
  } else if (exeName.toLowerCase().includes('kolbo')) {
    console.log('[Preload] Detected PRODUCTION from executable name');
    return 'production';
  }

  // PRIORITY 3: Fallback to development (for npm start without cross-env)
  console.warn('[Preload] Using fallback environment: development');
  return 'development';
}

const detectedEnvironment = detectEnvironment();
console.log('[Preload] Final detected environment:', detectedEnvironment);

// Expose safe API to renderer process
contextBridge.exposeInMainWorld('kolboDesktop', {
  // Platform info
  platform: process.platform,
  isElectron: true,
  environment: detectedEnvironment,

  // Authentication
  login: (email, password) =>
    ipcRenderer.invoke('auth:login', { email, password }),

  googleLogin: () =>
    ipcRenderer.invoke('auth:google-login'),

  logout: () =>
    ipcRenderer.invoke('auth:logout'),

  getToken: () =>
    ipcRenderer.invoke('auth:get-token'),

  // Media API
  getMedia: (params) =>
    ipcRenderer.invoke('media:get', params),

  getProjects: () =>
    ipcRenderer.invoke('media:get-projects'),

  // Cache Management
  getCacheSize: () =>
    ipcRenderer.invoke('cache:get-size'),

  clearCache: () =>
    ipcRenderer.invoke('cache:clear'),

  isFileCached: (fileName) =>
    ipcRenderer.invoke('cache:is-cached', { fileName }),

  // PERFORMANCE FIX: Batch cache check to reduce IPC calls
  batchIsFileCached: (fileNames) =>
    ipcRenderer.invoke('cache:batch-is-cached', fileNames),

  openCacheFolder: () =>
    ipcRenderer.invoke('cache:open-folder'),

  openFolder: (folderPath) =>
    ipcRenderer.invoke('file:open-folder', folderPath),

  revealFileInFolder: (filePath) =>
    ipcRenderer.invoke('file:reveal-in-folder', filePath),

  pickFolder: () =>
    ipcRenderer.invoke('file:pick-folder'),

  batchDownload: (items, targetFolder) =>
    ipcRenderer.invoke('file:batch-download', { items, targetFolder }),

  importToPremiere: (items) =>
    ipcRenderer.invoke('premiere:import', items),

  // Media Cache
  getCachedFilePath: (mediaId) =>
    ipcRenderer.invoke('cache:get-file-path', mediaId),

  preloadCache: (items) =>
    ipcRenderer.invoke('cache:preload', items),

  getCacheStats: () =>
    ipcRenderer.invoke('cache:get-stats'),

  // Thumbnail Cache
  getCachedThumbnailPath: (mediaId) =>
    ipcRenderer.invoke('cache:get-thumbnail-path', mediaId),

  preloadThumbnails: (items) =>
    ipcRenderer.invoke('cache:preload-thumbnails', items),

  clearThumbnails: () =>
    ipcRenderer.invoke('cache:clear-thumbnails'),

  startFileDrag: (filePaths) =>
    ipcRenderer.send('file:start-drag', filePaths),

  // App
  getVersion: () =>
    ipcRenderer.invoke('app:get-version'),

  openExternal: (url) =>
    ipcRenderer.invoke('app:open-external', url),

  // Window Controls
  minimizeWindow: () =>
    ipcRenderer.invoke('window:minimize'),

  maximizeWindow: () =>
    ipcRenderer.invoke('window:maximize'),

  closeWindow: () =>
    ipcRenderer.invoke('window:close'),

  isMaximized: () =>
    ipcRenderer.invoke('window:is-maximized'),

  // Window events
  onWindowMaximized: (callback) =>
    ipcRenderer.on('window:maximized', callback),

  onWindowUnmaximized: (callback) =>
    ipcRenderer.on('window:unmaximized', callback),

  // Create new window
  createNewWindow: (url) =>
    ipcRenderer.invoke('window:create-new', url),

  // Listen for tab URL to open in new window
  onOpenTabUrl: (callback) =>
    ipcRenderer.on('open-tab-url', (event, url) => callback(url)),

  // Auto-launch on startup
  getAutoLaunch: () =>
    ipcRenderer.invoke('autoLaunch:get'),

  setAutoLaunch: (enabled) =>
    ipcRenderer.invoke('autoLaunch:set', enabled),

  // Update System
  checkForUpdates: () =>
    ipcRenderer.invoke('updater:check'),

  getUpdateInfo: () =>
    ipcRenderer.invoke('updater:get-info'),

  downloadUpdate: () =>
    ipcRenderer.invoke('updater:download'),

  installUpdate: () =>
    ipcRenderer.invoke('updater:install'),

  // Update events
  onUpdateAvailable: (callback) =>
    ipcRenderer.on('updater:available', (event, info) => callback(info)),

  onUpdateNotAvailable: (callback) =>
    ipcRenderer.on('updater:not-available', () => callback()),

  onDownloadProgress: (callback) =>
    ipcRenderer.on('updater:progress', (event, progress) => callback(progress)),

  onUpdateDownloaded: (callback) =>
    ipcRenderer.on('updater:downloaded', (event, info) => callback(info)),

  onUpdateError: (callback) =>
    ipcRenderer.on('updater:error', (event, error) => callback(error)),

  // Download Management
  getDownloadFolder: () =>
    ipcRenderer.invoke('get-download-folder'),

  setDownloadFolder: () =>
    ipcRenderer.invoke('set-download-folder'),

  showInFolder: (filePath) =>
    ipcRenderer.invoke('show-in-folder', filePath),

  // Download events
  onDownloadComplete: (callback) =>
    ipcRenderer.on('download-complete', (event, data) => callback(data)),

  onDownloadFailed: (callback) =>
    ipcRenderer.on('download-failed', (event, data) => callback(data)),

  // Drag-and-drop events
  onDragError: (callback) =>
    ipcRenderer.on('drag:error', (event, data) => callback(data)),

  onDragWarning: (callback) =>
    ipcRenderer.on('drag:warning', (event, data) => callback(data)),

  // Context Menu
  showMediaItemContextMenu: (params) =>
    ipcRenderer.invoke('context-menu:show-media-item', params),

  showWebappContextMenu: (params) =>
    ipcRenderer.invoke('context-menu:show-webapp', params),

  downloadFileFromContextMenu: (url, type) =>
    ipcRenderer.invoke('context-menu:download-file', url, type),

  // Context menu action events
  onContextMenuAction: (callback) =>
    ipcRenderer.on('context-menu-action', (event, data) => callback(data)),

  // Memory Monitoring
  onMemoryStatus: (callback) =>
    ipcRenderer.on('memory:status', (event, status) => callback(status)),

  onMemoryAutoCleanup: (callback) =>
    ipcRenderer.on('memory:auto-cleanup', () => callback()),

  onMemoryForceCleanup: (callback) =>
    ipcRenderer.on('memory:force-cleanup', () => callback()),

  // Screenshot
  captureScreenshot: (bounds) =>
    ipcRenderer.invoke('screenshot:capture', bounds),

  copyScreenshotToClipboard: (dataUrl) =>
    ipcRenderer.invoke('screenshot:copy-to-clipboard', dataUrl),

  writeClipboardText: (text) =>
    ipcRenderer.invoke('clipboard:write-text', text),

  saveScreenshot: (dataUrl, format) =>
    ipcRenderer.invoke('screenshot:save', dataUrl, format),

  // Copy image from URL to clipboard
  copyImageToClipboard: (imageUrl) =>
    ipcRenderer.invoke('clipboard:copy-image', imageUrl),

  // FFmpeg / Format Factory
  ffmpeg: {
    // Get GPU information
    getGPUInfo: () =>
      ipcRenderer.invoke('ff:get-gpu-info'),

    // Convert a file
    convertJob: (job) =>
      ipcRenderer.invoke('ff:convert-job', job),

    // Cancel a specific job
    cancelJob: (jobId) =>
      ipcRenderer.invoke('ff:cancel-job', jobId),

    // Cancel all jobs
    cancelAll: () =>
      ipcRenderer.invoke('ff:cancel-all'),

    // Select output folder
    selectOutputFolder: () =>
      ipcRenderer.invoke('ff:select-output-folder'),

    // Probe file metadata
    probeFile: (filePath) =>
      ipcRenderer.invoke('ff:probe-file', filePath),

    // Get saved output folder preference
    getOutputFolder: () =>
      ipcRenderer.invoke('ff:get-output-folder'),

    // Set output folder preference
    setOutputFolder: (folderPath) =>
      ipcRenderer.invoke('ff:set-output-folder', folderPath),

    // Get output mode preference ('source' or 'custom')
    getOutputMode: () =>
      ipcRenderer.invoke('ff:get-output-mode'),

    // Set output mode preference
    setOutputMode: (mode) =>
      ipcRenderer.invoke('ff:set-output-mode', mode),

    // Listen for progress updates
    onProgress: (callback) => {
      ipcRenderer.on('ff:progress', (event, data) => callback(data));
    },

    // Listen for job completion
    onComplete: (callback) => {
      ipcRenderer.on('ff:complete', (event, data) => callback(data));
    },

    // Listen for errors
    onError: (callback) => {
      ipcRenderer.on('ff:error', (event, data) => callback(data));
    },

    // Listen for GPU info
    onGPUInfo: (callback) => {
      ipcRenderer.on('ff:gpu-info', (event, data) => callback(data));
    },

    // Remove listeners (cleanup)
    removeListener: (channel, callback) => {
      ipcRenderer.removeListener(channel, callback);
    }
  }
});

console.log('[Preload] Context bridge established');
console.log('[Preload] Platform:', process.platform);
