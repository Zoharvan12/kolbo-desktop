// Kolbo Desktop - Main Process Entry Point
// Handles window creation, system tray, and IPC setup

const { app, BrowserWindow, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');

// Import IPC handlers
const AuthManager = require('./auth-manager');
const FileManager = require('./file-manager');
const DragHandler = require('./drag-handler');

// Persistent settings store
const store = new Store();

let mainWindow = null;
let tray = null;

// Disable GPU for better compatibility (must be before app.ready)
app.disableHardwareAcceleration();

// Additional Windows compatibility flags
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-sandbox');

// Ignore certificate errors for local development
app.commandLine.appendSwitch('ignore-certificate-errors');

// Aggressively disable ALL caching to avoid permission issues
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-application-cache');
app.commandLine.appendSwitch('disk-cache-size', '0');
app.commandLine.appendSwitch('media-cache-size', '0');

// Set custom user data path to avoid Windows permission issues
// Use a fresh path each time to avoid cache conflicts
const tempDataPath = path.join(require('os').tmpdir(), 'kolbo-desktop-' + Date.now());
app.setPath('userData', tempDataPath);
console.log('[Main] Custom userData path:', tempDataPath);

// Single instance lock (prevent multiple app instances)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus the existing window if user tries to open another instance
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  // Get primary display dimensions
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  
  // Calculate 75% of screen size
  const windowWidth = Math.floor(screenWidth * 0.75);
  const windowHeight = Math.floor(screenHeight * 0.75);
  
  // Center the window on screen
  const x = Math.floor((screenWidth - windowWidth) / 2);
  const y = Math.floor((screenHeight - windowHeight) / 2);
  
  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: x,
    y: y,
    minWidth: 350,
    minHeight: 500,
    title: 'Kolbo Desktop',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      nodeIntegration: false,      // Security: no Node.js in renderer
      contextIsolation: true,       // Security: isolate contexts
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false           // Disable for debugging
    },
    show: true // Show immediately for debugging
  });

  // Load the main application HTML
  const htmlPath = path.join(__dirname, '..', 'renderer', 'index.html');
  console.log('[Main] Loading HTML:', htmlPath);

  mainWindow.loadFile(htmlPath)
    .then(() => {
      console.log('[Main] HTML loaded successfully');
    })
    .catch((err) => {
      console.error('[Main] Failed to load HTML file:', err);
    });

  // Show window when ready (prevents flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('[Main] Window shown');
  });

  // Add error listener for renderer process
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Main] Failed to load page:', errorCode, errorDescription);
  });

  // Log when page finishes loading
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Page finished loading');
  });

  // Log console messages from renderer
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log('[Renderer]', message);
  });

  // Minimize to tray on close (don't quit)
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      console.log('[Main] Window hidden to tray');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Dev tools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    console.log('[Main] Dev tools opened (development mode)');
  }
}

function createTray() {
  // Create tray icon (use a placeholder for now, we'll add proper icon later)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Kolbo Desktop',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Kolbo Desktop');
  tray.setContextMenu(contextMenu);

  // Click tray icon to show window
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  console.log('[Main] System tray created');
}

// App ready
app.whenReady().then(() => {
  console.log('[Main] App ready, creating window and tray');

  createWindow();
  createTray();

  // Setup IPC handlers
  AuthManager.setupHandlers();
  FileManager.setupHandlers();
  DragHandler.setupHandlers();

  console.log('[Main] IPC handlers registered');
});

// Window all closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Activate (macOS)
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Quit handler
app.on('before-quit', () => {
  app.isQuitting = true;
});

console.log('[Main] Kolbo Desktop starting...');
console.log('[Main] App version:', app.getVersion());
console.log('[Main] Electron version:', process.versions.electron);
console.log('[Main] Node version:', process.versions.node);
console.log('[Main] User data path:', app.getPath('userData'));
