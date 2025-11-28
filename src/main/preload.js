// Kolbo Desktop - Preload Script
// Secure bridge between main and renderer process using contextBridge
// This is the ONLY way renderer can communicate with main process

const { contextBridge, ipcRenderer } = require('electron');

// Expose safe API to renderer process
contextBridge.exposeInMainWorld('kolboDesktop', {
  // Platform info
  platform: process.platform,
  isElectron: true,
  environment: process.env.KOLBO_ENV || 'development',

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
    ipcRenderer.on('updater:error', (event, error) => callback(error))
});

console.log('[Preload] Context bridge established');
console.log('[Preload] Platform:', process.platform);
console.log('[Preload] Electron version:', process.versions.electron);
