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

  // Drag & Drop
  prepareForDrag: (items) =>
    ipcRenderer.invoke('drag:prepare', items),

  startDrag: (filePaths, thumbnailPaths) =>
    ipcRenderer.invoke('drag:start', { filePaths, thumbnailPaths }),

  // Cache Management
  getCacheSize: () =>
    ipcRenderer.invoke('cache:get-size'),

  clearCache: () =>
    ipcRenderer.invoke('cache:clear'),

  // App
  getVersion: () =>
    ipcRenderer.invoke('app:get-version'),

  openExternal: (url) =>
    ipcRenderer.invoke('app:open-external', url)
});

console.log('[Preload] Context bridge established');
console.log('[Preload] Platform:', process.platform);
console.log('[Preload] Electron version:', process.versions.electron);
