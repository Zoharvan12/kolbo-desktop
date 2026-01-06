// Kolbo Studio - Main Process Entry Point
// Handles window creation, system tray, and IPC setup

const { app, BrowserWindow, Tray, Menu, nativeImage, screen, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');
const checkDiskSpace = require('check-disk-space').default;

// Import IPC handlers
const AuthManager = require('./auth-manager');
const FileManager = require('./file-manager');
const DragHandler = require('./drag-handler');
const ContextMenuHandler = require('./context-menu-handler');

// Persistent settings store
const store = new Store();

let mainWindow = null;
let tray = null;

// GPU acceleration needed for video rendering
// Only disable if experiencing stability issues
// app.disableHardwareAcceleration();

// Additional Windows compatibility flags
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-dev-shm-usage');

// Performance: Increase HTTP disk cache to 500MB (default is ~50MB)
// This significantly improves performance for repeat page loads
app.commandLine.appendSwitch('disk-cache-size', '524288000'); // 500MB in bytes

// Enable modern Chromium performance features
app.commandLine.appendSwitch('enable-features', 'NetworkService,NetworkServiceInProcess,CanvasOopRasterization,VaapiVideoDecoder');

// Hardware acceleration flags for better rendering performance
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-video-decode');

// Legacy GPU flags (kept commented for reference - do NOT enable unless debugging)
// app.commandLine.appendSwitch('in-process-gpu');
// app.commandLine.appendSwitch('disable-gpu');  // Would disable all GPU acceleration!
// app.commandLine.appendSwitch('disable-gpu-compositing');
// app.commandLine.appendSwitch('disable-gpu-sandbox');

// Memory management flags to prevent crashes during continuous usage
// Dynamic V8 heap limit based on system RAM (50% of total)
const os = require('os');
const totalRAM = os.totalmem() / (1024 * 1024 * 1024); // Convert to GB
const heapSizeGB = Math.floor(totalRAM * 0.5); // Use 50% of system RAM
const heapSizeMB = heapSizeGB * 1024;

// Apply the dynamic limit
app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${heapSizeMB}`);
// Enable speed optimization instead of size (better performance for embedded webapp)
app.commandLine.appendSwitch('js-flags', '--optimize-for-speed');
// Enable TurboFan fast API calls for better performance
app.commandLine.appendSwitch('js-flags', '--turbo-fast-api-calls');

console.log('[Main] System RAM:', totalRAM.toFixed(2), 'GB');
console.log('[Main] V8 heap limit (50% of RAM):', heapSizeGB, 'GB (', heapSizeMB, 'MB)');
console.log('[Main] Remaining RAM for native memory, GPU, OS:', (totalRAM - heapSizeGB).toFixed(2), 'GB');

// Ignore certificate errors ONLY in development
if (process.env.NODE_ENV === 'development') {
  app.commandLine.appendSwitch('ignore-certificate-errors');
  console.log('[Main] Certificate validation disabled (development mode)');
}

// Set permanent user data path for persistent settings
const userDataPath = path.join(app.getPath('appData'), 'kolbo-desktop');
app.setPath('userData', userDataPath);
console.log('[Main] User data path:', userDataPath);

// Single instance lock removed - allow multiple instances
// Users can now open multiple windows of the app simultaneously
console.log('[Main] Multiple instances allowed');

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
    title: 'Kolbo Studio',
    backgroundColor: '#1e1e1e',
    frame: false,                   // Remove default frame for custom title bar
    titleBarStyle: 'hidden',        // Hide default title bar
    webPreferences: {
      nodeIntegration: false,      // Security: no Node.js in renderer
      contextIsolation: true,       // Security: isolate contexts
      preload: (() => {
        const preloadPath = path.join(__dirname, 'preload.js');
        console.log('[Main] Preload script path:', preloadPath);
        console.log('[Main] Preload exists:', require('fs').existsSync(preloadPath));
        return preloadPath;
      })(),
      webSecurity: process.env.NODE_ENV === 'development' ? false : true,  // Disabled in dev for CORS/CSP
      // Performance optimization settings
      v8CacheOptions: 'bypassHeatCheck',  // Aggressive caching for faster execution (was 'code')
      enableWebSQL: false,         // Disable unused WebSQL to save memory
      spellcheck: false,           // Disable spellcheck to reduce memory overhead
      backgroundThrottling: false  // Don't throttle background tabs for better responsiveness
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

  // Intercept window.open() calls to download files instead of opening in new tabs
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[Main] Window open intercepted:', url);

    // Check if URL is a downloadable file (PDF, images, videos, documents, etc.)
    const downloadableExtensions = [
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.zip', '.rar', '.7z', '.tar', '.gz',
      '.mp4', '.mov', '.avi', '.mkv', '.webm',
      '.mp3', '.wav', '.flac', '.ogg',
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
      '.txt', '.csv', '.json', '.xml'
    ];

    const urlLower = url.toLowerCase();
    const isDownloadable = downloadableExtensions.some(ext => urlLower.includes(ext));

    if (isDownloadable) {
      console.log('[Main] Downloadable file detected - triggering download instead of new window');

      // Trigger download by navigating to URL in hidden way
      // The will-download handler will catch this and handle the download
      mainWindow.webContents.downloadURL(url);

      // Deny the window.open() request
      return { action: 'deny' };
    }

    // For non-downloadable URLs, allow them to open in default browser
    console.log('[Main] Non-downloadable URL - opening in external browser');
    const { shell } = require('electron');
    shell.openExternal(url);

    // Deny the window.open() in Electron (already opened externally)
    return { action: 'deny' };
  });

  // Crash detection and recovery handlers
  // Handle renderer process crashes (grey screen, out of memory, etc.)
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[Main] Renderer process crashed:', details);
    console.error('[Main] Reason:', details.reason);
    console.error('[Main] Exit code:', details.exitCode);

    // Show error dialog to user
    const { dialog } = require('electron');
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'App Crashed',
      message: 'Kolbo Studio encountered an error and needs to reload',
      detail: `Reason: ${details.reason}\n\nThe app will reload automatically to recover.`,
      buttons: ['Reload Now']
    }).then(() => {
      // Reload the app
      mainWindow.reload();
      console.log('[Main] App reloaded after crash');
    });
  });

  // Handle unresponsive window (frozen UI)
  mainWindow.on('unresponsive', () => {
    console.warn('[Main] Window became unresponsive');

    const { dialog } = require('electron');
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'App Not Responding',
      message: 'Kolbo Studio is not responding',
      detail: 'The app may have run out of memory or encountered an error. Do you want to reload?',
      buttons: ['Wait', 'Reload'],
      defaultId: 1
    }).then(({ response }) => {
      if (response === 1) {
        // User chose to reload
        mainWindow.reload();
        console.log('[Main] App reloaded after becoming unresponsive');
      }
    });
  });

  // Handle when window becomes responsive again
  mainWindow.on('responsive', () => {
    console.log('[Main] Window became responsive again');
  });

  // On Windows: Close = quit the app
  // On macOS: Close = minimize to tray (keep running in background)
  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !app.isQuitting) {
      // macOS: minimize to tray
      event.preventDefault();
      mainWindow.hide();
      console.log('[Main] Window hidden to tray (macOS)');
    } else {
      // Windows/Linux: actually quit
      console.log('[Main] Window closing, app will quit');
    }
  });

  mainWindow.on('closed', () => {
    // MEMORY LEAK FIX: Clean up all event listeners when window closes
    // This prevents accumulation of listeners if multiple windows are created/destroyed
    if (mainWindow && mainWindow.webContents) {
      // Remove all webContents event listeners
      mainWindow.webContents.removeAllListeners('did-fail-load');
      mainWindow.webContents.removeAllListeners('did-finish-load');
      mainWindow.webContents.removeAllListeners('console-message');
      mainWindow.webContents.removeAllListeners('render-process-gone');
      console.log('[Main] Cleaned up window event listeners');
    }

    mainWindow = null;
    console.log('[Main] Window closed and cleaned up');
  });

  // Dev tools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    console.log('[Main] Dev tools opened (development mode)');
  }
}

function createTray() {
  // Create tray icon with proper Kolbo icon
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.ico');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  console.log('[Main] Tray icon loaded from:', iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Kolbo Studio',
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

  tray.setToolTip('Kolbo Studio');
  tray.setContextMenu(contextMenu);

  // Click tray icon to show window
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  console.log('[Main] System tray created');
}

// macOS Application Menu - enables Cmd+C/V/X, Cmd+Q, etc.
function createApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'Cmd+,',
          click: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.webContents.send('navigate-to-settings');
            }
          }
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    // Edit menu - IMPORTANT for copy/paste to work!
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
        ] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' }
        ])
      ]
    },
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  console.log('[Main] Application menu created');
}

// Window control handlers
function setupWindowHandlers() {
  const { ipcMain, shell } = require('electron');

  ipcMain.handle('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.handle('window:close', () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.handle('window:is-maximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
  });

  // Open cache folder in file explorer
  ipcMain.handle('cache:open-folder', async () => {
    try {
      const cachePath = path.join(app.getPath('userData'), 'MediaCache');

      // Ensure directory exists before opening
      const fs = require('fs');
      if (!fs.existsSync(cachePath)) {
        fs.mkdirSync(cachePath, { recursive: true });
      }

      const result = await shell.openPath(cachePath);

      if (result) {
        // result is an error string if it failed
        console.error('[Main] Failed to open cache folder:', result);
        return { success: false, error: result };
      }

      console.log('[Main] Opened cache folder:', cachePath);
      return { success: true, path: cachePath };
    } catch (error) {
      console.error('[Main] Error opening cache folder:', error);
      return { success: false, error: error.message };
    }
  });

  // Open any folder in file explorer
  ipcMain.handle('file:open-folder', async (event, folderPath) => {
    try {
      console.log('[Main] Opening folder:', folderPath);
      const result = await shell.openPath(folderPath);

      if (result) {
        // result is an error string if it failed
        console.error('[Main] Failed to open folder:', result);
        return { success: false, error: result };
      }

      console.log('[Main] Opened folder:', folderPath);
      return { success: true };
    } catch (error) {
      console.error('[Main] Error opening folder:', error);
      return { success: false, error: error.message };
    }
  });

  // Reveal specific file in Explorer
  ipcMain.handle('file:reveal-in-folder', async (event, filePath) => {
    try {
      console.log('[Main] Revealing file in folder:', filePath);

      const fs = require('fs');
      if (!fs.existsSync(filePath)) {
        console.error('[Main] File does not exist:', filePath);
        return { success: false, error: 'File does not exist' };
      }

      // Use shell.showItemInFolder to open Explorer with file selected
      shell.showItemInFolder(filePath);

      console.log('[Main] File revealed in folder:', filePath);
      return { success: true };
    } catch (error) {
      console.error('[Main] Error revealing file:', error);
      return { success: false, error: error.message };
    }
  });

  // Show folder picker dialog
  ipcMain.handle('file:pick-folder', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Download Folder'
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      return { success: true, folderPath: result.filePaths[0] };
    } catch (error) {
      console.error('[Main] Error picking folder:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('window:create-new', (event, url) => {
    // Create a new window with the specified URL
    const newWindow = new BrowserWindow({
      width: Math.floor(screen.getPrimaryDisplay().workAreaSize.width * 0.75),
      height: Math.floor(screen.getPrimaryDisplay().workAreaSize.height * 0.75),
      minWidth: 350,
      minHeight: 500,
      title: 'Kolbo Studio',
      backgroundColor: '#1e1e1e',
      frame: false,
      titleBarStyle: 'hidden',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        webSecurity: process.env.NODE_ENV === 'development' ? false : true,
        additionalArguments: url ? [`--tab-url=${url}`] : []
      }
    });

    // Intercept window.open() calls to download files instead of opening in new tabs
    newWindow.webContents.setWindowOpenHandler(({ url }) => {
      console.log('[Main] Window open intercepted (new window):', url);

      // Check if URL is a downloadable file (PDF, images, videos, documents, etc.)
      const downloadableExtensions = [
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        '.zip', '.rar', '.7z', '.tar', '.gz',
        '.mp4', '.mov', '.avi', '.mkv', '.webm',
        '.mp3', '.wav', '.flac', '.ogg',
        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
        '.txt', '.csv', '.json', '.xml'
      ];

      const urlLower = url.toLowerCase();
      const isDownloadable = downloadableExtensions.some(ext => urlLower.includes(ext));

      if (isDownloadable) {
        console.log('[Main] Downloadable file detected - triggering download instead of new window');

        // Trigger download by navigating to URL in hidden way
        // The will-download handler will catch this and handle the download
        newWindow.webContents.downloadURL(url);

        // Deny the window.open() request
        return { action: 'deny' };
      }

      // For non-downloadable URLs, allow them to open in default browser
      console.log('[Main] Non-downloadable URL - opening in external browser');
      shell.openExternal(url);

      // Deny the window.open() in Electron (already opened externally)
      return { action: 'deny' };
    });

    // Store URL in a global for this window to access
    if (url) {
      newWindow.webContents.once('did-finish-load', () => {
        newWindow.webContents.send('open-tab-url', url);
      });
    }

    // Load the app
    const htmlPath = path.join(__dirname, '..', 'renderer', 'index.html');
    newWindow.loadFile(htmlPath);

    return true;
  });

  // Auto-launch on startup handlers
  ipcMain.handle('autoLaunch:get', () => {
    const loginSettings = app.getLoginItemSettings();
    return loginSettings.openAtLogin;
  });

  ipcMain.handle('autoLaunch:set', (event, enabled) => {
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: false,
        args: []
      });
      console.log(`[Main] Auto-launch ${enabled ? 'enabled' : 'disabled'}`);
      return { success: true, enabled };
    } catch (error) {
      console.error('[Main] Failed to set auto-launch:', error);
      return { success: false, error: error.message };
    }
  });

  // Send maximize/unmaximize events to renderer
  if (mainWindow) {
    mainWindow.on('maximize', () => {
      mainWindow.webContents.send('window:maximized');
    });

    mainWindow.on('unmaximize', () => {
      mainWindow.webContents.send('window:unmaximized');
    });
  }
}

// Auto-updater configuration
let updateInfo = null; // Store update info for renderer access

function setupAutoUpdater() {
  // Configure auto-updater
  autoUpdater.autoDownload = true; // Automatically download updates in background
  autoUpdater.autoInstallOnAppQuit = true; // Install when app quits if user chose "Later"
  autoUpdater.allowDowngrade = false; // Only allow upgrades, not downgrades
  autoUpdater.allowPrerelease = false; // Only stable releases

  // Explicitly set GitHub provider to ensure proper redirect handling
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Zoharvan12',
    repo: 'kolbo-desktop',
    releaseType: 'release'
  });

  // Force check for latest release (not just any newer version)
  autoUpdater.channel = 'latest';

  console.log('[Updater] Configuration:');
  console.log('[Updater] - Current version:', app.getVersion());
  console.log('[Updater] - Channel: latest (always fetches newest release)');
  console.log('[Updater] - Provider: GitHub (explicit)');

  // Log all updater events
  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...');
    console.log('[Updater] Will fetch the LATEST release from GitHub');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] ✅ Update available!');
    console.log('[Updater] - Current version:', app.getVersion());
    console.log('[Updater] - Latest version:', info.version);
    console.log('[Updater] - Release date:', info.releaseDate);
    console.log('[Updater] This is the LATEST release from GitHub');

    // Store update info
    updateInfo = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
      available: true,
      downloaded: false
    };

    // Send to renderer for UI display
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('updater:available', updateInfo);
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] ✅ App is up to date!');
    console.log('[Updater] - Current version:', app.getVersion());
    console.log('[Updater] This is the LATEST version available');
    updateInfo = null;

    // Notify renderer
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('updater:not-available');
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err);

    // Send error to renderer
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('updater:error', err.message);
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent);
    console.log(`[Updater] Download progress: ${percent}%`);

    // Send progress to renderer for progress bar
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('updater:progress', {
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
        bytesPerSecond: progressObj.bytesPerSecond
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded:', info.version);

    // Update stored info
    if (updateInfo) {
      updateInfo.downloaded = true;
    }

    // Notify renderer that update is ready to install
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('updater:downloaded', {
        version: info.version,
        releaseNotes: info.releaseNotes
      });
    }

    // Show dialog asking user to restart now or later
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded`,
      detail: 'Would you like to restart the app now to install the update, or install it the next time you launch the app?',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) {
        // User chose "Restart Now" - quit and install
        autoUpdater.quitAndInstall();
      }
      // If "Later" (response === 1), do nothing - will install on next launch
    });
  });

  // Check for updates on startup (after 3 seconds)
  setTimeout(() => {
    console.log('[Updater] Checking for updates on startup...');
    autoUpdater.checkForUpdates().catch(err => {
      console.error('[Updater] Failed to check for updates:', err);
    });
  }, 3000);

  // Check for updates every 4 hours
  setInterval(() => {
    console.log('[Updater] Periodic update check...');
    autoUpdater.checkForUpdates().catch(err => {
      console.error('[Updater] Failed to check for updates:', err);
    });
  }, 4 * 60 * 60 * 1000); // 4 hours
}

// IPC handlers for updater
function setupUpdaterHandlers() {
  const { ipcMain } = require('electron');

  // Manual update check (triggered by user)
  ipcMain.handle('updater:check', async () => {
    try {
      console.log('[Updater] Manual update check requested');
      const result = await autoUpdater.checkForUpdates();
      return { success: true, updateInfo: result ? result.updateInfo : null };
    } catch (error) {
      console.error('[Updater] Manual check failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Get current update info
  ipcMain.handle('updater:get-info', () => {
    return updateInfo;
  });

  // Download installer to Downloads folder (no code signing needed!)
  ipcMain.handle('updater:download', async () => {
    try {
      console.log('[Updater] Download requested');

      if (!updateInfo || !updateInfo.version) {
        return { success: false, error: 'No update available' };
      }

      const { shell } = require('electron');
      const https = require('https');
      const fs = require('fs');
      const path = require('path');
      const { app } = require('electron');

      // Build download URL based on platform
      const version = updateInfo.version;
      const os = require('os');
      const platform = os.platform();

      // ⚠️ CRITICAL: Filename Convention ⚠️
      //
      // GitHub automatically converts SPACES to DOTS when uploading files:
      // electron-builder creates: "Kolbo Studio-Setup-1.0.2.exe" (with spaces)
      // GitHub uploads it as: "Kolbo.Studio-Setup-1.0.2.exe" (spaces become dots)
      //
      // Therefore, we MUST use DOTS in filenames here to match GitHub's behavior.
      //
      // DO NOT change to dashes or any other format - it will break downloads for
      // ALL existing users who have this code running on their machines!
      //
      // If you change electron-builder's output format (productName, artifactName),
      // you MUST update these filenames to match what GitHub will create.
      //
      let fileName;
      if (platform === 'darwin') {
        // Mac: Kolbo.Studio-1.0.8-universal.dmg (universal binary)
        // CRITICAL: Must include -universal suffix to match actual filename
        fileName = `Kolbo.Studio-${version}-universal.dmg`;
      } else if (platform === 'win32') {
        // Windows: Kolbo.Studio-Setup-1.0.2.exe
        fileName = `Kolbo.Studio-Setup-${version}.exe`;
      } else {
        // Linux (future support)
        fileName = `Kolbo.Studio-${version}.AppImage`;
      }

      const downloadUrl = `https://github.com/Zoharvan12/kolbo-desktop/releases/download/v${version}/${fileName}`;

      // Download to Downloads folder
      const downloadsPath = app.getPath('downloads');
      const savePath = path.join(downloadsPath, fileName);

      console.log('[Updater] Downloading from:', downloadUrl);
      console.log('[Updater] Saving to:', savePath);

      return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(savePath);

        https.get(downloadUrl, (response) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            // Follow redirect
            https.get(response.headers.location, (redirectResponse) => {
              const totalBytes = parseInt(redirectResponse.headers['content-length'], 10);
              let downloadedBytes = 0;

              redirectResponse.pipe(file);

              redirectResponse.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                const percent = (downloadedBytes / totalBytes) * 100;

                // Send progress to renderer
                if (mainWindow && mainWindow.webContents) {
                  mainWindow.webContents.send('updater:progress', {
                    percent: percent,
                    transferred: downloadedBytes,
                    total: totalBytes
                  });
                }
              });

              file.on('finish', () => {
                file.close();
                console.log('[Updater] Download complete:', savePath);

                // Show file in folder
                shell.showItemInFolder(savePath);

                resolve({
                  success: true,
                  path: savePath,
                  message: `Installer downloaded to Downloads folder. Run it to update.`
                });
              });
            }).on('error', (err) => {
              fs.unlink(savePath, () => {});
              reject({ success: false, error: err.message });
            });
          } else {
            const totalBytes = parseInt(response.headers['content-length'], 10);
            let downloadedBytes = 0;

            response.pipe(file);

            response.on('data', (chunk) => {
              downloadedBytes += chunk.length;
              const percent = (downloadedBytes / totalBytes) * 100;

              // Send progress to renderer
              if (mainWindow && mainWindow.webContents) {
                mainWindow.webContents.send('updater:progress', {
                  percent: percent,
                  transferred: downloadedBytes,
                  total: totalBytes
                });
              }
            });

            file.on('finish', () => {
              file.close();
              console.log('[Updater] Download complete:', savePath);

              // Show file in folder
              shell.showItemInFolder(savePath);

              resolve({
                success: true,
                path: savePath,
                message: `Installer downloaded to Downloads folder. Run it to update.`
              });
            });
          }
        }).on('error', (err) => {
          fs.unlink(savePath, () => {});
          reject({ success: false, error: err.message });
        });

        file.on('error', (err) => {
          fs.unlink(savePath, () => {});
          reject({ success: false, error: err.message });
        });
      });

    } catch (error) {
      console.error('[Updater] Download failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Open installer (no auto-install, user runs it manually)
  ipcMain.handle('updater:install', async () => {
    console.log('[Updater] User will install manually');
    const { dialog } = require('electron');
    const os = require('os');
    const platform = os.platform();

    let installInstructions;
    if (platform === 'darwin') {
      installInstructions = 'Open the DMG file and drag Kolbo Studio to your Applications folder. Your settings and data will be preserved.';
    } else if (platform === 'win32') {
      installInstructions = 'Run the installer to update to the latest version. Your settings and data will be preserved.';
    } else {
      installInstructions = 'Run the installer to update to the latest version. Your settings and data will be preserved.';
    }

    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Downloaded',
      message: 'The installer has been downloaded to your Downloads folder.',
      detail: installInstructions,
      buttons: ['OK']
    });

    return { success: true };
  });

  console.log('[Updater] IPC handlers registered');
}

// ============================================================================
// SCREENSHOT HANDLERS
// ============================================================================

function setupScreenshotHandlers() {
  const { ipcMain, dialog, clipboard, nativeImage } = require('electron');
  const fs = require('fs').promises;
  const path = require('path');

  // Capture screenshot
  ipcMain.handle('screenshot:capture', async (event, bounds) => {
    try {
      const win = mainWindow;
      if (!win) {
        throw new Error('No window available');
      }

      // Check window state
      const isMinimized = win.isMinimized();

      // Don't capture if window is minimized
      if (isMinimized) {
        throw new Error('Cannot capture screenshot while window is minimized');
      }

      // Capture the entire window content area (excluding window chrome)
      const image = await win.webContents.capturePage();

      // If bounds are provided, crop the image
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        // Get device pixel ratio from bounds (passed from renderer)
        // Default to 1 if not provided for backwards compatibility
        const dpr = bounds.devicePixelRatio || 1;

        console.log('[Screenshot] Capture details:', {
          originalBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
          devicePixelRatio: dpr,
          imageSize: { width: image.getSize().width, height: image.getSize().height }
        });

        const croppedImage = image.crop({
          x: Math.floor(bounds.x * dpr),
          y: Math.floor(bounds.y * dpr),
          width: Math.floor(bounds.width * dpr),
          height: Math.floor(bounds.height * dpr)
        });

        console.log('[Screenshot] Cropped to:', {
          x: Math.floor(bounds.x * dpr),
          y: Math.floor(bounds.y * dpr),
          width: Math.floor(bounds.width * dpr),
          height: Math.floor(bounds.height * dpr)
        });

        return {
          success: true,
          dataUrl: croppedImage.toDataURL()
        };
      }

      return {
        success: true,
        dataUrl: image.toDataURL()
      };
    } catch (error) {
      console.error('[Screenshot] Error capturing:', error);
      return { success: false, error: error.message };
    }
  });

  // Copy screenshot to clipboard
  ipcMain.handle('screenshot:copy-to-clipboard', async (event, dataUrl) => {
    try {
      const image = nativeImage.createFromDataURL(dataUrl);
      clipboard.writeImage(image);
      console.log('[Screenshot] Copied to clipboard');
      return { success: true };
    } catch (error) {
      console.error('[Screenshot] Error copying to clipboard:', error);
      return { success: false, error: error.message };
    }
  });

  // Copy image from URL to clipboard
  ipcMain.handle('clipboard:copy-image', async (event, imageUrl) => {
    try {
      console.log('[Clipboard] Copying image from URL:', imageUrl);

      const https = require('https');
      const http = require('http');

      // Helper function to download image (handles redirects)
      const downloadImage = (url) => {
        return new Promise((resolve, reject) => {
          const protocol = url.startsWith('https') ? https : http;

          protocol.get(url, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
              const redirectUrl = response.headers.location;
              console.log('[Clipboard] Following redirect to:', redirectUrl);
              // Recursively download from redirect URL
              return downloadImage(redirectUrl).then(resolve).catch(reject);
            }

            if (response.statusCode !== 200) {
              reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
              return;
            }

            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
              try {
                const buffer = Buffer.concat(chunks);
                resolve(buffer);
              } catch (error) {
                reject(error);
              }
            });
            response.on('error', reject);
          }).on('error', reject);
        });
      };

      // Download the image
      const buffer = await downloadImage(imageUrl);
      console.log('[Clipboard] Downloaded image, buffer size:', buffer.length, 'bytes');

      // Detect if it's WebP format
      const isWebP = imageUrl.toLowerCase().endsWith('.webp') ||
                     buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46; // RIFF header

      let imageBuffer = buffer;

      // Convert WebP to PNG using Sharp (Electron doesn't support WebP well)
      if (isWebP) {
        console.log('[Clipboard] WebP format detected, converting to PNG...');
        const sharp = require('sharp');
        imageBuffer = await sharp(buffer)
          .png()
          .toBuffer();
        console.log('[Clipboard] Converted to PNG, new buffer size:', imageBuffer.length, 'bytes');
      }

      // Create native image from buffer
      const image = nativeImage.createFromBuffer(imageBuffer);
      console.log('[Clipboard] Created image from buffer, isEmpty:', image.isEmpty());

      if (image.isEmpty()) {
        throw new Error('Failed to create image from buffer - image may be corrupted');
      }

      // Copy to clipboard
      clipboard.writeImage(image);
      console.log('[Clipboard] ✅ Image copied to clipboard successfully');

      return { success: true };

    } catch (error) {
      console.error('[Clipboard] ❌ Error copying image:', error);
      return { success: false, error: error.message };
    }
  });

  // Write text to clipboard
  ipcMain.handle('clipboard:write-text', async (event, text) => {
    try {
      clipboard.writeText(text);
      console.log('[Clipboard] Text written to clipboard');
      return { success: true };
    } catch (error) {
      console.error('[Clipboard] Error writing text:', error);
      return { success: false, error: error.message };
    }
  });

  // Save screenshot
  ipcMain.handle('screenshot:save', async (event, dataUrl, format = 'png') => {
    try {
      // Get download folder (custom or OS default)
      let downloadFolder = store.get('defaultDownloadFolder');

      if (!downloadFolder) {
        // Use OS default downloads folder
        downloadFolder = app.getPath('downloads');
      }

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const fileName = `Screenshot-${timestamp}.${format}`;
      const filePath = path.join(downloadFolder, fileName);

      // Convert data URL to buffer
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      // For JPG, we need to convert from PNG
      if (format === 'jpg') {
        const image = nativeImage.createFromDataURL(dataUrl);
        const jpgBuffer = image.toJPEG(90); // 90% quality
        await fs.writeFile(filePath, jpgBuffer);
      } else {
        await fs.writeFile(filePath, buffer);
      }

      console.log('[Screenshot] Saved to:', filePath);

      // Send download notification to renderer for banner display
      const targetWindow = BrowserWindow.getFocusedWindow() || mainWindow;
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('download-complete', {
          fileName: fileName,
          filePath: filePath,
          folderPath: downloadFolder
        });
      }

      return { success: true, filePath };
    } catch (error) {
      console.error('[Screenshot] Error saving:', error);

      // Send error notification to renderer
      const targetWindow = BrowserWindow.getFocusedWindow() || mainWindow;
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('download-failed', {
          fileName: `screenshot.${format}`,
          error: error.message
        });
      }

      return { success: false, error: error.message };
    }
  });

  console.log('[Screenshot] IPC handlers registered');
}

// ============================================================================
// DOWNLOAD HANDLER
// ============================================================================

/**
 * Setup download handler for webapp downloads
 * Intercepts downloads from the web app (iframes) and shows save dialog
 * Remembers last download location for convenience
 */
function setupDownloadHandler() {
  const { shell, session, ipcMain } = require('electron');
  const path = require('path');
  const fs = require('fs');

  // Track recent downloads to prevent duplicates
  const recentDownloads = new Map(); // filename -> timestamp
  const DUPLICATE_THRESHOLD = 1000; // 1 second

  // Track active dialogs to prevent showing multiple for same file
  const activeDialogs = new Set();

  // IPC handler to get default download folder
  ipcMain.handle('get-download-folder', async () => {
    return store.get('defaultDownloadFolder') || null;
  });

  // IPC handler to set default download folder
  ipcMain.handle('set-download-folder', async () => {
    const targetWindow = BrowserWindow.getFocusedWindow() || mainWindow;
    const result = await dialog.showOpenDialog(targetWindow, {
      title: 'Choose Download Folder',
      properties: ['openDirectory', 'createDirectory']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0];
      store.set('defaultDownloadFolder', folderPath);
      console.log('[Download] Default download folder set to:', folderPath);
      return folderPath;
    }
    return null;
  });

  // IPC handler to open folder in explorer
  ipcMain.handle('show-in-folder', async (event, filePath) => {
    shell.showItemInFolder(filePath);
  });

  // Use defaultSession to catch downloads from all windows and iframes
  session.defaultSession.on('will-download', async (event, item, webContents) => {
    const fileName = item.getFilename();
    const fileUrl = item.getURL();
    const now = Date.now();

    console.log('[Download] Event fired:', fileName, 'URL:', fileUrl);

    // Check if we're already showing a dialog for this file
    if (activeDialogs.has(fileName)) {
      console.log('[Download] Dialog already active for:', fileName, '- canceling duplicate');
      item.cancel();
      return;
    }

    // Check if this is a duplicate download (same filename within 1 second)
    const lastDownload = recentDownloads.get(fileName);
    if (lastDownload && (now - lastDownload) < DUPLICATE_THRESHOLD) {
      console.log('[Download] Ignoring duplicate download (recent):', fileName);
      item.cancel();
      return;
    }

    // Mark as active
    activeDialogs.add(fileName);

    // Track this download
    recentDownloads.set(fileName, now);

    // Clean up old entries (older than threshold)
    for (const [name, timestamp] of recentDownloads.entries()) {
      if (now - timestamp > DUPLICATE_THRESHOLD) {
        recentDownloads.delete(name);
      }
    }

    console.log('[Download] Download started:', fileName);
    console.log('[Download] File URL:', fileUrl);

    // Get default download folder from store
    let downloadFolder = store.get('defaultDownloadFolder');

    // If no default folder set, ask user to choose one
    if (!downloadFolder) {
      const targetWindow = BrowserWindow.getFocusedWindow() || mainWindow;
      const result = await dialog.showOpenDialog(targetWindow, {
        title: 'Choose Download Folder',
        defaultPath: app.getPath('downloads'),
        properties: ['openDirectory', 'createDirectory'],
        message: 'Choose a folder for downloaded files. You can change this later in settings.'
      });

      if (result.canceled || !result.filePaths.length) {
        console.log('[Download] Download canceled - no folder selected');
        activeDialogs.delete(fileName);
        item.cancel();
        return;
      }

      downloadFolder = result.filePaths[0];
      store.set('defaultDownloadFolder', downloadFolder);
      console.log('[Download] Default download folder set to:', downloadFolder);
    }

    // Generate unique filename if file already exists
    let savePath = path.join(downloadFolder, fileName);
    let counter = 1;
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);

    while (fs.existsSync(savePath)) {
      savePath = path.join(downloadFolder, `${base} (${counter})${ext}`);
      counter++;
    }

    console.log('[Download] Saving to:', savePath);

    // Remove from active dialogs
    activeDialogs.delete(fileName);

    // Set save path
    item.setSavePath(savePath);

    // Track download progress
    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        console.log('[Download] Download interrupted');
      } else if (state === 'progressing') {
        if (item.isPaused()) {
          console.log('[Download] Download paused');
        } else {
          const percent = Math.round((item.getReceivedBytes() / item.getTotalBytes()) * 100);
          console.log(`[Download] Progress: ${percent}% (${item.getReceivedBytes()}/${item.getTotalBytes()} bytes)`);
        }
      }
    });

    // Handle download completion
    item.once('done', (event, state) => {
      if (state === 'completed') {
        console.log('[Download] Download completed:', savePath);

        // Send download notification to renderer for banner display
        const targetWindow = BrowserWindow.getFocusedWindow() || mainWindow;
        if (targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send('download-complete', {
            fileName: fileName,
            filePath: savePath,
            folderPath: path.dirname(savePath)
          });
        }
      } else if (state === 'interrupted') {
        console.error('[Download] Download interrupted');

        // Send error notification to renderer
        const targetWindow = BrowserWindow.getFocusedWindow() || mainWindow;
        if (targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send('download-failed', {
            fileName: fileName,
            error: 'Download interrupted'
          });
        }

        const { Notification } = require('electron');
        if (Notification.isSupported()) {
          const notification = new Notification({
            title: 'Download Failed',
            body: `${fileName} download was interrupted`,
            silent: true
          });
          notification.show();
        }
      } else if (state === 'cancelled') {
        console.log('[Download] Download cancelled');
      }
    });
  });

  console.log('[Download] Download handler registered');
}

// ============================================================================
// PERMISSION REQUEST HANDLER (Critical for Mac file uploads)
// ============================================================================

/**
 * Setup permission request handler to allow file access in iframes
 * This is CRITICAL for Mac - without this, file uploads crash the app
 */
function setupPermissionHandlers() {
  const { session, systemPreferences } = require('electron');

  // Track if we've already requested system permissions to prevent infinite loops
  const requestedPermissions = new Set();

  // Handle permission requests from web content (iframes)
  session.defaultSession.setPermissionRequestHandler(async (webContents, permission, callback) => {
    console.log('[Permissions] Permission requested:', permission);

    // Auto-grant permissions needed for file uploads and media access
    const allowedPermissions = [
      'media',              // File input dialogs
      'mediaKeySystem',     // DRM content
      'geolocation',        // Location services
      'notifications',      // Browser notifications
      'midi',              // MIDI device access
      'midiSysex',         // MIDI system exclusive
      'pointerLock',       // Pointer lock API
      'fullscreen',        // Fullscreen API
      'openExternal',      // Open external links
      'clipboard-read',    // Read clipboard
      'clipboard-write',   // Write clipboard
      'camera',            // Camera access (for file uploads)
      'microphone'         // Microphone access (for file uploads)
    ];

    if (!allowedPermissions.includes(permission)) {
      console.log(`[Permissions] ❌ Denied: ${permission}`);
      callback(false);
      return;
    }

    // For macOS, check system-level permissions for media devices
    // This prevents the infinite popup loop by only requesting once
    if (process.platform === 'darwin' && (permission === 'media' || permission === 'camera' || permission === 'microphone')) {
      const mediaType = permission === 'microphone' ? 'microphone' : 'camera';

      // Create a unique key for this permission request
      const permissionKey = `${mediaType}_${Date.now()}`;

      // Check if we've already requested this permission in the last 5 seconds
      const recentRequest = Array.from(requestedPermissions).find(key => {
        const [type, timestamp] = key.split('_');
        return type === mediaType && (Date.now() - parseInt(timestamp)) < 5000;
      });

      if (recentRequest) {
        // We already requested this recently, just grant without asking again
        console.log(`[Permissions] ✅ Granted (cached): ${permission}`);
        callback(true);
        return;
      }

      // Mark this permission as requested
      requestedPermissions.add(permissionKey);

      // Clean up old entries (older than 5 seconds)
      setTimeout(() => {
        requestedPermissions.delete(permissionKey);
      }, 5000);

      try {
        // Check macOS system permission status
        const status = systemPreferences.getMediaAccessStatus(mediaType);
        console.log(`[Permissions] macOS ${mediaType} status:`, status);

        if (status === 'granted') {
          // Already granted at system level
          console.log(`[Permissions] ✅ Granted (system): ${permission}`);
          callback(true);
        } else if (status === 'denied') {
          // User denied at system level - show helpful message
          console.log(`[Permissions] ❌ Denied (system): ${permission}`);

          const { dialog } = require('electron');
          dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: `${mediaType === 'camera' ? 'Camera' : 'Microphone'} Access Denied`,
            message: `Kolbo Studio needs ${mediaType} access`,
            detail: `Please enable ${mediaType} access in System Preferences → Security & Privacy → Privacy → ${mediaType === 'camera' ? 'Camera' : 'Microphone'}`,
            buttons: ['OK']
          });

          callback(false);
        } else if (status === 'not-determined' || status === 'restricted') {
          // Need to request permission - this will show the system dialog ONCE
          console.log(`[Permissions] 🔄 Requesting macOS ${mediaType} permission...`);

          // Request access - this triggers the macOS system dialog
          const granted = await systemPreferences.askForMediaAccess(mediaType);

          console.log(`[Permissions] ${granted ? '✅' : '❌'} macOS ${mediaType} permission ${granted ? 'granted' : 'denied'}`);
          callback(granted);
        } else {
          // Unknown status, grant anyway
          console.log(`[Permissions] ✅ Granted (unknown status): ${permission}`);
          callback(true);
        }
      } catch (error) {
        console.error(`[Permissions] Error checking ${mediaType} permission:`, error);
        // On error, grant anyway (might not be macOS)
        callback(true);
      }
    } else {
      // For non-macOS or other permissions, just grant
      console.log(`[Permissions] ✅ Granted: ${permission}`);
      callback(true);
    }
  });

  // Handle permission checks (synchronous version)
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    console.log('[Permissions] Permission check:', permission, 'from', requestingOrigin);

    // Same permissions as above
    const allowedPermissions = [
      'media',
      'mediaKeySystem',
      'geolocation',
      'notifications',
      'midi',
      'midiSysex',
      'pointerLock',
      'fullscreen',
      'openExternal',
      'clipboard-read',
      'clipboard-write',
      'camera',
      'microphone'
    ];

    return allowedPermissions.includes(permission);
  });

  console.log('[Permissions] Permission handlers registered');
}

// ============================================================================
// ADOBE PLUGIN DETECTION
// ============================================================================

/**
 * Detect if Kolbo Adobe Plugin is installed
 * Checks CEP extensions folder on both Windows and Mac
 */
function detectAdobePlugin() {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  console.log('[Plugin Detection] Checking for Adobe plugin...');

  // CEP extension paths
  const pluginPaths = process.platform === 'win32'
    ? [
        // Windows - CEP extensions folder
        path.join(process.env.APPDATA || '', 'Adobe', 'CEP', 'extensions', 'com.kolbo.ai.adobe'),
        path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Adobe', 'CEP', 'extensions', 'com.kolbo.ai.adobe')
      ]
    : [
        // macOS - CEP extensions folder
        path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions', 'com.kolbo.ai.adobe'),
        '/Library/Application Support/Adobe/CEP/extensions/com.kolbo.ai.adobe'
      ];

  // Check each possible path
  for (const pluginPath of pluginPaths) {
    console.log('[Plugin Detection] Checking:', pluginPath);

    if (fs.existsSync(pluginPath)) {
      // Verify it's actually the Kolbo plugin by checking for manifest
      const manifestPath = path.join(pluginPath, 'CSXS', 'manifest.xml');

      if (fs.existsSync(manifestPath)) {
        console.log('[Plugin Detection] ✅ Plugin found at:', pluginPath);
        return {
          hasPlugin: true,
          pluginPath: pluginPath,
          manifestPath: manifestPath
        };
      }
    }
  }

  console.log('[Plugin Detection] ❌ Plugin not found');
  return {
    hasPlugin: false,
    pluginPath: null,
    manifestPath: null
  };
}

// ============================================================================
// MEDIA CACHE SYSTEM (for drag-and-drop)
// ============================================================================

/**
 * MediaCache - Manages local cache of media files for drag-and-drop
 * Downloads files in background and provides local file paths
 */
class MediaCache {
  constructor() {
    const path = require('path');
    // Use unified cache location under app.getPath('userData') for consistency with FileManager
    this.cachePath = path.join(app.getPath('userData'), 'MediaCache');
    this.thumbnailCachePath = path.join(app.getPath('userData'), 'ThumbnailCache');
    this.cacheIndex = new Map(); // id -> { filePath, lastAccessed, size, type }
    this.thumbnailIndex = new Map(); // id -> { filePath, lastAccessed, size }
    this.maxCacheSize = 5 * 1024 * 1024 * 1024; // 5GB
    // PERFORMANCE FIX: Increased from 100 to 500 to prevent cache thrashing
    // (100 was too small, causing constant download→evict→re-download cycles)
    this.maxCacheItems = 500;
    this.downloadQueue = new Map(); // id -> Promise
    this.thumbnailQueue = new Map(); // id -> Promise

    this.ensureCacheFolderExists();
    this.loadCacheIndex();
  }

  ensureCacheFolderExists() {
    const fs = require('fs');
    if (!fs.existsSync(this.cachePath)) {
      fs.mkdirSync(this.cachePath, { recursive: true });
      console.log('[MediaCache] Created cache folder:', this.cachePath);
    }
    if (!fs.existsSync(this.thumbnailCachePath)) {
      fs.mkdirSync(this.thumbnailCachePath, { recursive: true });
      console.log('[MediaCache] Created thumbnail cache folder:', this.thumbnailCachePath);
    }
  }

  loadCacheIndex() {
    const fs = require('fs');
    const path = require('path');

    // Load media cache
    if (fs.existsSync(this.cachePath)) {
      const files = fs.readdirSync(this.cachePath);
      console.log(`[MediaCache] Found ${files.length} cached files`);

      for (const fileName of files) {
        const filePath = path.join(this.cachePath, fileName);

        try {
          const stats = fs.statSync(filePath);

          // Extract ID from filename (e.g., "kolbo-123.mp4" -> "123")
          const id = fileName.replace(/^kolbo-/, '').replace(/\.[^.]+$/, '');

          this.cacheIndex.set(id, {
            filePath,
            lastAccessed: stats.mtime.getTime(),
            size: stats.size,
            fileName
          });
        } catch (error) {
          // Skip files that can't be accessed (locked, permission denied, etc.)
          // This commonly happens on Windows when files are open in other apps
          if (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EACCES') {
            console.warn(`[MediaCache] Skipping inaccessible file: ${fileName} (${error.code})`);
          } else {
            console.error(`[MediaCache] Error getting file stats for ${fileName}:`, error);
          }
        }
      }
    }

    // Load thumbnail cache
    if (fs.existsSync(this.thumbnailCachePath)) {
      const thumbFiles = fs.readdirSync(this.thumbnailCachePath);
      console.log(`[MediaCache] Found ${thumbFiles.length} cached thumbnails`);

      for (const fileName of thumbFiles) {
        const filePath = path.join(this.thumbnailCachePath, fileName);

        try {
          const stats = fs.statSync(filePath);

          // Extract ID from filename (e.g., "thumb-123.jpg" -> "123")
          const id = fileName.replace(/^thumb-/, '').replace(/\.[^.]+$/, '');

          this.thumbnailIndex.set(id, {
            filePath,
            lastAccessed: stats.mtime.getTime(),
            size: stats.size,
            fileName
          });
        } catch (error) {
          // Skip files that can't be accessed (locked, permission denied, etc.)
          if (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EACCES') {
            console.warn(`[MediaCache] Skipping inaccessible thumbnail: ${fileName} (${error.code})`);
          } else {
            console.error(`[MediaCache] Error getting thumbnail stats for ${fileName}:`, error);
          }
        }
      }
    }
  }

  async getCachedFilePath(mediaId) {
    const fs = require('fs');

    // Check if already cached
    if (this.cacheIndex.has(mediaId)) {
      const cached = this.cacheIndex.get(mediaId);

      // Validate file still exists and is accessible before returning
      try {
        // Check if file exists and is readable
        fs.accessSync(cached.filePath, fs.constants.R_OK);

        // Update last accessed time
        cached.lastAccessed = Date.now();

        console.log(`[MediaCache] Cache HIT for ${mediaId}`);
        return cached.filePath;
      } catch (error) {
        // File no longer exists or is not accessible
        if (error.code === 'ENOENT') {
          console.warn(`[MediaCache] Cached file no longer exists: ${cached.filePath}`);
          this.cacheIndex.delete(mediaId);
        } else if (error.code === 'EPERM' || error.code === 'EACCES') {
          // File is locked/inaccessible - try to wait and retry
          console.warn(`[MediaCache] File temporarily locked: ${cached.filePath} (${error.code})`);

          // Return the path anyway - might be unlocked by the time it's used
          // The drag handler will have its own retry logic
          return cached.filePath;
        } else {
          console.error(`[MediaCache] Error accessing cached file: ${cached.filePath}:`, error);
          this.cacheIndex.delete(mediaId);
        }
      }
    }

    console.log(`[MediaCache] Cache MISS for ${mediaId}`);
    return null;
  }

  async preloadMedia(items) {
    console.log(`[MediaCache] Preloading ${items.length} items...`);

    const downloadPromises = items.map(item => this.downloadToCache(item));
    const results = await Promise.allSettled(downloadPromises);

    const successful = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[MediaCache] Preloaded ${successful}/${items.length} items`);

    return { successful, total: items.length };
  }

  async downloadToCache(item) {
    const { id, fileName, url, type } = item;

    // Check if already downloading
    if (this.downloadQueue.has(id)) {
      console.log(`[MediaCache] Already downloading ${id}`);
      return this.downloadQueue.get(id);
    }

    // Check if already cached
    if (this.cacheIndex.has(id)) {
      console.log(`[MediaCache] Already cached ${id}`);
      return this.cacheIndex.get(id).filePath;
    }

    const path = require('path');
    const fs = require('fs');

    // Generate unique filename if file already exists
    let filePath = path.join(this.cachePath, fileName);
    let counter = 1;
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);

    while (fs.existsSync(filePath)) {
      filePath = path.join(this.cachePath, `${base} (${counter})${ext}`);
      counter++;
    }

    // If filename was changed, log it
    if (counter > 1) {
      console.log(`[MediaCache] File exists, using unique name: ${path.basename(filePath)}`);
    }

    // Start download
    const downloadPromise = this.downloadFile(url, filePath)
      .then(() => {
        const stats = fs.statSync(filePath);
        const actualFileName = path.basename(filePath);

        // Add to cache index
        this.cacheIndex.set(id, {
          filePath,
          lastAccessed: Date.now(),
          size: stats.size,
          fileName: actualFileName,
          type
        });

        console.log(`[MediaCache] Downloaded ${actualFileName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

        // Check cache size and evict if needed
        this.evictOldItemsIfNeeded();

        this.downloadQueue.delete(id);
        return filePath;
      })
      .catch(err => {
        console.error(`[MediaCache] Failed to download ${path.basename(filePath)}:`, err);
        this.downloadQueue.delete(id);
        throw err;
      });

    this.downloadQueue.set(id, downloadPromise);
    return downloadPromise;
  }

  downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
      const fs = require('fs');
      const https = require('https');
      const http = require('http');

      const file = fs.createWriteStream(outputPath);
      const protocol = url.startsWith('https') ? https : http;

      const request = protocol.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          file.close();
          try {
            fs.unlinkSync(outputPath);
          } catch (unlinkErr) {
            console.warn('[Download] Could not delete redirect file (may be locked):', unlinkErr.message);
          }
          return this.downloadFile(redirectUrl, outputPath).then(resolve).catch(reject);
        }

        if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        } else {
          file.close();
          try {
            fs.unlinkSync(outputPath);
          } catch (unlinkErr) {
            console.warn('[Download] Could not delete failed file (may be locked):', unlinkErr.message);
          }
          reject(new Error(`HTTP ${response.statusCode}`));
        }
      });

      request.on('error', (err) => {
        file.close();
        // Try to delete partial file, but don't fail if it's locked
        try {
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch (unlinkErr) {
          console.warn('[Download] Could not delete partial file (may be locked):', unlinkErr.message);
        }
        reject(err);
      });

      file.on('error', (err) => {
        file.close();
        // Try to delete partial file, but don't fail if it's locked
        try {
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch (unlinkErr) {
          console.warn('[Download] Could not delete partial file (may be locked):', unlinkErr.message);
        }

        // Check if it's a disk space error
        if (err.code === 'ENOSPC') {
          const fileName = require('path').basename(outputPath);
          dialog.showErrorBox(
            'Disk Full',
            `Your disk is full. Cannot download ${fileName}.\n\nPlease free up disk space and try again, or clear cached files in Settings.`
          );
        }

        reject(err);
      });
    });
  }

  evictOldItemsIfNeeded() {
    const fs = require('fs');

    // Check if we exceed max items
    if (this.cacheIndex.size <= this.maxCacheItems) return;

    console.log(`[MediaCache] Cache size ${this.cacheIndex.size} exceeds max ${this.maxCacheItems}, evicting...`);

    // Sort by last accessed time (oldest first)
    const sorted = Array.from(this.cacheIndex.entries())
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    // Evict oldest items
    const toEvict = sorted.slice(0, sorted.length - this.maxCacheItems);

    for (const [id, cached] of toEvict) {
      try {
        fs.unlinkSync(cached.filePath);
        this.cacheIndex.delete(id);
        console.log(`[MediaCache] Evicted ${cached.fileName}`);
      } catch (err) {
        console.error(`[MediaCache] Failed to evict ${cached.fileName}:`, err);
      }
    }
  }

  getCacheStats() {
    let totalSize = 0;
    for (const cached of this.cacheIndex.values()) {
      totalSize += cached.size || 0;
    }

    let thumbnailSize = 0;
    for (const thumb of this.thumbnailIndex.values()) {
      thumbnailSize += thumb.size || 0;
    }

    return {
      itemCount: this.cacheIndex.size,
      totalSize,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      maxItems: this.maxCacheItems,
      thumbnailCount: this.thumbnailIndex.size,
      thumbnailSize,
      thumbnailSizeMB: (thumbnailSize / 1024 / 1024).toFixed(2)
    };
  }

  // ============================================================================
  // THUMBNAIL CACHE METHODS
  // ============================================================================

  async getCachedThumbnailPath(mediaId) {
    // Check if already cached
    if (this.thumbnailIndex.has(mediaId)) {
      const cached = this.thumbnailIndex.get(mediaId);
      cached.lastAccessed = Date.now();
      console.log(`[ThumbnailCache] Cache HIT for ${mediaId}`);
      return cached.filePath;
    }

    console.log(`[ThumbnailCache] Cache MISS for ${mediaId}`);
    return null;
  }

  async preloadThumbnails(items) {
    console.log(`[ThumbnailCache] Preloading ${items.length} thumbnails...`);

    const downloadPromises = items.map(item => this.downloadThumbnailToCache(item));
    const results = await Promise.allSettled(downloadPromises);

    const successful = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[ThumbnailCache] Preloaded ${successful}/${items.length} thumbnails`);

    return { successful, total: items.length };
  }

  async downloadThumbnailToCache(item) {
    const { id, thumbnailUrl } = item;

    // Skip if no thumbnail URL
    if (!thumbnailUrl) {
      console.log(`[ThumbnailCache] No thumbnail URL for ${id}`);
      return null;
    }

    // Check if already downloading
    if (this.thumbnailQueue.has(id)) {
      console.log(`[ThumbnailCache] Already downloading ${id}`);
      return this.thumbnailQueue.get(id);
    }

    // Check if already cached
    if (this.thumbnailIndex.has(id)) {
      console.log(`[ThumbnailCache] Already cached ${id}`);
      return this.thumbnailIndex.get(id).filePath;
    }

    const path = require('path');
    const fs = require('fs');

    // Determine file extension from URL or default to .jpg
    const urlExt = thumbnailUrl.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i);
    const ext = urlExt ? urlExt[1] : 'jpg';
    const fileName = `thumb-${id}.${ext}`;
    const filePath = path.join(this.thumbnailCachePath, fileName);

    // Start download
    const downloadPromise = this.downloadFile(thumbnailUrl, filePath)
      .then(() => {
        const stats = fs.statSync(filePath);

        // Add to thumbnail index
        this.thumbnailIndex.set(id, {
          filePath,
          lastAccessed: Date.now(),
          size: stats.size,
          fileName
        });

        console.log(`[ThumbnailCache] Downloaded ${fileName} (${(stats.size / 1024).toFixed(1)} KB)`);

        this.thumbnailQueue.delete(id);
        return filePath;
      })
      .catch(err => {
        console.error(`[ThumbnailCache] Failed to download ${fileName}:`, err.message);
        this.thumbnailQueue.delete(id);
        // Don't throw - just return null so we can continue with other thumbnails
        return null;
      });

    this.thumbnailQueue.set(id, downloadPromise);
    return downloadPromise;
  }

  clearThumbnailCache() {
    const fs = require('fs');
    const path = require('path');

    if (!fs.existsSync(this.thumbnailCachePath)) {
      return { success: true, deletedFiles: 0 };
    }

    let deletedCount = 0;
    for (const [id, thumb] of this.thumbnailIndex.entries()) {
      try {
        fs.unlinkSync(thumb.filePath);
        deletedCount++;
      } catch (err) {
        console.error(`[ThumbnailCache] Failed to delete ${thumb.fileName}:`, err);
      }
    }

    this.thumbnailIndex.clear();
    console.log(`[ThumbnailCache] Cleared ${deletedCount} thumbnails`);

    return { success: true, deletedFiles: deletedCount };
  }
}

// Global cache instance
let mediaCache = null;

function getMediaCache() {
  if (!mediaCache) {
    mediaCache = new MediaCache();
  }
  return mediaCache;
}

// ============================================================================
// PREMIERE IMPORT HANDLER
// ============================================================================

// Premiere import handler
function setupPremiereImportHandler() {
  const { ipcMain } = require('electron');
  const path = require('path');
  const fs = require('fs');
  const https = require('https');
  const http = require('http');

  ipcMain.handle('premiere:import', async (event, items) => {
    try {
      console.log('[Premiere Import] Received request for', items.length, 'items');

      // Check if Adobe plugin is installed
      const pluginStatus = detectAdobePlugin();

      if (!pluginStatus.hasPlugin) {
        console.log('[Premiere Import] Plugin not detected - returning early');
        return {
          success: false,
          hasPlugin: false,
          error: 'Adobe plugin not installed'
        };
      }

      console.log('[Premiere Import] Plugin detected - proceeding with import');

      // Create ImportQueue folder
      const importQueuePath = path.join(
        app.getPath('appData'),
        'Kolbo.AI',
        'ImportQueue'
      );

      if (!fs.existsSync(importQueuePath)) {
        fs.mkdirSync(importQueuePath, { recursive: true });
        console.log('[Premiere Import] Created ImportQueue folder:', importQueuePath);
      }

      // Create timestamped subfolder
      const timestamp = Date.now();
      const batchFolder = path.join(importQueuePath, timestamp.toString());
      fs.mkdirSync(batchFolder, { recursive: true });
      console.log('[Premiere Import] Created batch folder:', batchFolder);

      // Download all files
      const downloadedFiles = [];
      let successCount = 0;

      for (const item of items) {
        try {
          const fileName = item.fileName || `media_${item.id}`;
          const filePath = path.join(batchFolder, fileName);

          console.log(`[Premiere Import] Downloading ${fileName}...`);

          // Download file
          await downloadFile(item.url, filePath);

          downloadedFiles.push({
            filePath: filePath,
            fileName: fileName,
            mediaType: item.type // 'video', 'image', 'audio'
          });

          successCount++;
          console.log(`[Premiere Import] Downloaded ${successCount}/${items.length}: ${fileName}`);

        } catch (downloadError) {
          console.error(`[Premiere Import] Failed to download ${item.fileName}:`, downloadError);
        }
      }

      if (downloadedFiles.length === 0) {
        return {
          success: false,
          error: 'All downloads failed'
        };
      }

      // Create manifest file
      const manifest = {
        app: 'PPRO',
        timestamp: timestamp,
        files: downloadedFiles
      };

      const manifestPath = path.join(importQueuePath, `import-${timestamp}.json`);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      console.log(`[Premiere Import] Created manifest: ${manifestPath}`);
      console.log(`[Premiere Import] Downloaded ${downloadedFiles.length}/${items.length} files`);

      return {
        success: true,
        hasPlugin: true,
        count: downloadedFiles.length,
        manifestPath: manifestPath
      };

    } catch (error) {
      console.error('[Premiere Import] Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Helper function to download file
  function downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(outputPath);
      const protocol = url.startsWith('https') ? https : http;

      console.log(`[Download] ${url} -> ${outputPath}`);

      const request = protocol.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          console.log(`[Download] Redirecting to ${redirectUrl}`);
          file.close();
          fs.unlinkSync(outputPath);

          // Retry with redirect URL
          downloadFile(redirectUrl, outputPath).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        } else {
          file.close();
          fs.unlinkSync(outputPath);
          reject(new Error(`HTTP ${response.statusCode}`));
        }
      });

      request.on('error', (err) => {
        file.close();
        fs.unlinkSync(outputPath);
        reject(err);
      });

      file.on('error', (err) => {
        file.close();
        fs.unlinkSync(outputPath);
        reject(err);
      });
    });
  }

  console.log('[Premiere Import] Handler registered');
}

// ============================================================================
// MEDIA CACHE IPC HANDLERS
// ============================================================================

// Helper: Retry file access with exponential backoff (for locked files)
async function retryFileAccess(filePath, maxRetries = 3, initialDelay = 100) {
  const fs = require('fs');

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Try to access the file
      fs.accessSync(filePath, fs.constants.R_OK);
      return { success: true, filePath };
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;

      if (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EACCES') {
        if (isLastAttempt) {
          console.error(`[FileAccess] File locked after ${maxRetries} retries: ${filePath}`);
          return { success: false, error: error.code, filePath };
        }

        // Wait with exponential backoff
        const delay = initialDelay * Math.pow(2, attempt);
        console.log(`[FileAccess] File locked, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries}): ${filePath}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // Different error (file not found, etc.) - fail immediately
        console.error(`[FileAccess] File access error: ${filePath}:`, error);
        return { success: false, error: error.code, filePath };
      }
    }
  }

  return { success: false, error: 'MAX_RETRIES', filePath };
}

function setupMediaCacheHandlers() {
  const { ipcMain } = require('electron');

  // Get cached file path
  ipcMain.handle('cache:get-file-path', async (event, mediaId) => {
    try {
      const cache = getMediaCache();
      const filePath = await cache.getCachedFilePath(mediaId);

      return {
        success: true,
        cached: filePath !== null,
        filePath: filePath
      };
    } catch (error) {
      console.error('[MediaCache] Error getting file path:', error);
      return {
        success: false,
        cached: false,
        error: error.message
      };
    }
  });

  // Preload media items to cache
  ipcMain.handle('cache:preload', async (event, items) => {
    try {
      const cache = getMediaCache();
      const result = await cache.preloadMedia(items);

      return {
        success: true,
        ...result
      };
    } catch (error) {
      console.error('[MediaCache] Error preloading:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Get cache stats
  ipcMain.handle('cache:get-stats', async (event) => {
    try {
      const cache = getMediaCache();
      const stats = cache.getCacheStats();

      return {
        success: true,
        ...stats
      };
    } catch (error) {
      console.error('[MediaCache] Error getting stats:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Helper: Extract video thumbnail (first frame)
  async function extractVideoThumbnail(videoPath) {
    const { nativeImage } = require('electron');
    const path = require('path');
    const fs = require('fs');
    const { promisify } = require('util');
    const exec = promisify(require('child_process').exec);

    try {
      // Create temp thumbnail path
      const tempDir = app.getPath('temp');
      const thumbPath = path.join(tempDir, `thumb_${Date.now()}.jpg`);

      // Try using ffmpeg if available, otherwise return null
      try {
        await exec(`ffmpeg -i "${videoPath}" -vframes 1 -f image2 "${thumbPath}"`, { timeout: 3000 });
        const thumb = nativeImage.createFromPath(thumbPath);
        fs.unlinkSync(thumbPath); // Clean up
        return thumb.resize({ width: 200, height: 200, quality: 'good' });
      } catch (ffmpegErr) {
        console.log('[Native Drag] ffmpeg not available, using default video icon');
        return null;
      }
    } catch (err) {
      console.warn('[Native Drag] Failed to extract video thumbnail:', err);
      return null;
    }
  }

  // Helper: Create audio icon
  function createAudioIcon() {
    const { nativeImage } = require('electron');
    const path = require('path');

    // Try to use a music/audio icon if available, otherwise use default
    const audioIconPath = path.join(__dirname, '../../assets/audio-icon.png');
    const fs = require('fs');

    if (fs.existsSync(audioIconPath)) {
      return audioIconPath;
    }

    // Fallback to default icon
    return path.join(__dirname, '../../assets/icon-source.png');
  }

  // Start native file drag (supports single file or multiple files)
  ipcMain.on('file:start-drag', async (event, filePaths) => {
    const path = require('path');
    const { nativeImage } = require('electron');

    // Convert single path to array for consistent handling
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];

    console.log('[Native Drag] Starting drag for', paths.length, 'file(s):', paths);

    // Validate and retry access for all files before starting drag
    const validatedPaths = [];
    const failedPaths = [];

    for (const filePath of paths) {
      const result = await retryFileAccess(filePath, 3, 50);
      if (result.success) {
        validatedPaths.push(filePath);
      } else {
        console.error(`[Native Drag] Cannot access file: ${filePath} (${result.error})`);
        failedPaths.push({ path: filePath, error: result.error });
      }
    }

    // If all files failed validation, abort drag
    if (validatedPaths.length === 0) {
      console.error('[Native Drag] All files are inaccessible, aborting drag');
      console.error('[Native Drag] Failed files:', failedPaths);

      // Send error back to renderer
      event.sender.send('drag:error', {
        message: 'Cannot access selected files. They may be locked by another application.',
        failedFiles: failedPaths
      });
      return;
    }

    // If some files failed, warn but continue with accessible files
    if (failedPaths.length > 0) {
      console.warn(`[Native Drag] ${failedPaths.length} file(s) inaccessible, continuing with ${validatedPaths.length} accessible file(s)`);
      console.warn('[Native Drag] Failed files:', failedPaths);

      // Notify renderer about partial failure
      event.sender.send('drag:warning', {
        message: `${failedPaths.length} file(s) could not be accessed and will be skipped`,
        accessibleCount: validatedPaths.length,
        failedCount: failedPaths.length
      });
    }

    // Use validated paths for drag operation
    const dragPaths = validatedPaths;

    // Use the actual file as icon if it's an image, extract frame for video, or use audio icon
    let dragIcon;
    const firstFile = dragPaths[0]; // Use validated path
    const ext = path.extname(firstFile).toLowerCase();

    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
      // Use the actual image file as drag icon
      try {
        dragIcon = nativeImage.createFromPath(firstFile);
        // Resize to reasonable thumbnail size for drag preview
        dragIcon = dragIcon.resize({ width: 200, height: 200, quality: 'good' });
        console.log('[Native Drag] Using actual image as drag icon');
      } catch (err) {
        console.warn('[Native Drag] Failed to load image icon, using default:', err);
        dragIcon = path.join(__dirname, '../../assets/icon-source.png');
      }
    } else if (['.mp4', '.mov', '.avi', '.webm', '.mkv'].includes(ext)) {
      // Try to extract video first frame
      const videoThumb = await extractVideoThumbnail(firstFile);
      if (videoThumb) {
        dragIcon = videoThumb;
        console.log('[Native Drag] Using video first frame as drag icon');
      } else {
        // Fallback to default
        dragIcon = path.join(__dirname, '../../assets/icon-source.png');
      }
    } else if (['.mp3', '.wav', '.aac', '.ogg', '.m4a'].includes(ext)) {
      // Use audio icon
      dragIcon = createAudioIcon();
      console.log('[Native Drag] Using audio icon for drag');
    } else {
      // For unknown types, use default icon
      dragIcon = path.join(__dirname, '../../assets/icon-source.png');
    }

    // Use 'file' for single, 'files' for multiple
    // Note: According to Electron docs, 'files' array should work for multiple files
    // but some apps (Premiere) may not accept it properly
    if (dragPaths.length === 1) {
      event.sender.startDrag({
        file: dragPaths[0],
        icon: dragIcon
      });
      console.log('[Native Drag] Single file drag started');
    } else {
      event.sender.startDrag({
        files: dragPaths,
        icon: dragIcon
      });
      console.log(`[Native Drag] Multi-file drag started (${dragPaths.length} files)`);
    }
  });

  // Thumbnail cache handlers
  ipcMain.handle('cache:get-thumbnail-path', async (event, mediaId) => {
    try {
      const cache = getMediaCache();
      const filePath = await cache.getCachedThumbnailPath(mediaId);

      return {
        success: true,
        cached: filePath !== null,
        filePath: filePath
      };
    } catch (error) {
      console.error('[ThumbnailCache] Error getting thumbnail path:', error);
      return {
        success: false,
        cached: false,
        error: error.message
      };
    }
  });

  ipcMain.handle('cache:preload-thumbnails', async (event, items) => {
    try {
      const cache = getMediaCache();
      const result = await cache.preloadThumbnails(items);

      return {
        success: true,
        ...result
      };
    } catch (error) {
      console.error('[ThumbnailCache] Error preloading thumbnails:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  ipcMain.handle('cache:clear-thumbnails', async (event) => {
    try {
      const cache = getMediaCache();
      const result = cache.clearThumbnailCache();

      return result;
    } catch (error) {
      console.error('[ThumbnailCache] Error clearing thumbnails:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  console.log('[MediaCache] IPC handlers registered');
}

// First-time setup: Enable auto-launch by default
function setupFirstTimeDefaults() {
  const isFirstRun = !store.has('app_initialized');

  if (isFirstRun) {
    console.log('[Main] First time setup - enabling auto-launch by default');

    try {
      app.setLoginItemSettings({
        openAtLogin: true,
        openAsHidden: false,
        args: []
      });
      console.log('[Main] Auto-launch enabled successfully');
    } catch (error) {
      console.error('[Main] Failed to enable auto-launch:', error);
    }

    // Mark app as initialized
    store.set('app_initialized', true);
    console.log('[Main] First-time setup complete');
  } else {
    console.log('[Main] App already initialized, skipping first-time setup');
  }
}

// ============================================================================
// MEMORY MONITORING SYSTEM
// ============================================================================

/**
 * Proactive memory monitoring to prevent crashes before they happen
 * Monitors V8 heap usage and triggers cleanup at safe thresholds
 */
function setupMemoryMonitoring() {
  const MEMORY_CHECK_INTERVAL = 60 * 1000; // Check every 60 seconds
  const CLEANUP_THRESHOLD = 80; // Start cleanup at 80%
  const WARNING_THRESHOLD = 90; // Warn user at 90%
  const CRITICAL_THRESHOLD = 95; // Critical warning at 95%

  let lastWarningTime = 0;
  const WARNING_COOLDOWN = 5 * 60 * 1000; // Only warn every 5 minutes

  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    try {
      const memUsage = process.memoryUsage();
      const heapUsedMB = memUsage.heapUsed / (1024 * 1024);
      const heapUsedGB = heapUsedMB / 1024;
      const heapLimitGB = heapSizeGB; // From our dynamic calculation
      const usagePercent = (heapUsedGB / heapLimitGB) * 100;

      // Log detailed stats every check (only in debug)
      if (process.env.NODE_ENV === 'development') {
        console.log('[Memory Monitor]', {
          heapUsed: `${heapUsedGB.toFixed(2)} GB`,
          heapLimit: `${heapLimitGB} GB`,
          percentage: `${usagePercent.toFixed(1)}%`,
          rss: `${(memUsage.rss / 1024 / 1024 / 1024).toFixed(2)} GB`,
          external: `${(memUsage.external / 1024 / 1024).toFixed(0)} MB`
        });
      }

      // Send memory status to renderer for display
      mainWindow.webContents.send('memory:status', {
        heapUsedGB: parseFloat(heapUsedGB.toFixed(2)),
        heapLimitGB: heapLimitGB,
        usagePercent: parseFloat(usagePercent.toFixed(1)),
        rss: parseFloat((memUsage.rss / 1024 / 1024 / 1024).toFixed(2))
      });

      // CRITICAL: 95%+ - Show dialog and offer to reload
      if (usagePercent >= CRITICAL_THRESHOLD) {
        const now = Date.now();
        if (now - lastWarningTime > WARNING_COOLDOWN) {
          lastWarningTime = now;

          console.error(`[Memory Monitor] 🚨 CRITICAL: Memory at ${usagePercent.toFixed(1)}%`);

          // Force cleanup first
          mainWindow.webContents.send('memory:force-cleanup');

          // Show dialog
          dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Memory Critically High',
            message: `Memory usage is at ${usagePercent.toFixed(0)}% (${heapUsedGB.toFixed(1)}GB / ${heapLimitGB}GB)`,
            detail: 'The app has cleaned up inactive tabs, but memory is still very high. Reloading will free all memory.\n\nDo you want to reload now?',
            buttons: ['Reload Now', 'Continue'],
            defaultId: 0,
            cancelId: 1
          }).then(({ response }) => {
            if (response === 0) {
              // User chose to reload
              console.log('[Memory Monitor] User chose to reload app');
              mainWindow.reload();
            }
          });
        }
      }
      // WARNING: 90%+ - Notify user and force cleanup
      else if (usagePercent >= WARNING_THRESHOLD) {
        const now = Date.now();
        if (now - lastWarningTime > WARNING_COOLDOWN) {
          lastWarningTime = now;

          console.warn(`[Memory Monitor] ⚠️ WARNING: Memory at ${usagePercent.toFixed(1)}%`);

          // Trigger forced cleanup
          mainWindow.webContents.send('memory:force-cleanup');
        }
      }
      // CLEANUP: 80%+ - Silent auto-cleanup
      else if (usagePercent >= CLEANUP_THRESHOLD) {
        console.log(`[Memory Monitor] 🧹 Auto-cleanup triggered at ${usagePercent.toFixed(1)}%`);

        // Trigger cleanup in renderer
        mainWindow.webContents.send('memory:auto-cleanup');
      }
    } catch (error) {
      console.error('[Memory Monitor] Error checking memory:', error);
    }
  }, MEMORY_CHECK_INTERVAL);

  console.log('[Memory Monitor] Monitoring enabled (check every 60s, cleanup at 80%, warn at 90%, critical at 95%)');
}

// Setup session to modify CSP headers for iframe compatibility
function setupSessionCSP() {
  const { session } = require('electron');
  const defaultSession = session.defaultSession;

  // Intercept headers to modify CSP for iframe compatibility
  // PERFORMANCE: Use URL filter to avoid processing non-Kolbo URLs (reduces overhead)
  defaultSession.webRequest.onHeadersReceived(
    { urls: ['*://localhost/*', '*://*.kolbo.ai/*', '*://staging.kolbo.ai/*'] },
    (details, callback) => {
      // Only modify CSP for localhost (development) or web app URLs
      // URL filtering already done by filter above, so we know this is a Kolbo URL
      try {
        if (details.responseHeaders) {
          // Helper function to modify CSP header
          const modifyCSP = (headerName) => {
            if (details.responseHeaders[headerName]) {
              const cspArray = Array.isArray(details.responseHeaders[headerName])
                ? details.responseHeaders[headerName]
                : [details.responseHeaders[headerName]];

              const modifiedCSP = cspArray.map(csp => {
                // Replace frame-ancestors * with explicit protocols including file://
                // Also handle cases where frame-ancestors might be missing
                if (csp.includes('frame-ancestors')) {
                  return csp.replace(
                    /frame-ancestors\s+[^;]+/gi,
                    "frame-ancestors * file:// app:// http:// https://"
                  );
                } else if (csp.includes("'self'") || csp.includes('*')) {
                  // If no frame-ancestors directive, add it
                  return csp + "; frame-ancestors * file:// app:// http:// https://";
                }
                return csp;
              });

              details.responseHeaders[headerName] = modifiedCSP;
            }
          };

          // Modify both lowercase and mixed-case CSP headers
          modifyCSP('content-security-policy');
          modifyCSP('Content-Security-Policy');
        }
      } catch (error) {
        // Error processing headers, just pass through
        console.warn('[Main] Error modifying CSP headers:', error);
      }

      callback({ responseHeaders: details.responseHeaders });
    }
  );

  console.log('[Main] Session CSP modification enabled for iframe compatibility (optimized with URL filters)');
}

// App ready
app.whenReady().then(() => {
  console.log('[Main] App ready, creating window and tray');

  // PERFORMANCE FIX: Clear corrupted GPU cache to fix rendering issues
  // GPU cache can become corrupted and cause "Unable to create cache" errors
  const gpuCachePath = path.join(app.getPath('userData'), 'GPUCache');
  try {
    if (require('fs').existsSync(gpuCachePath)) {
      require('fs').rmSync(gpuCachePath, { recursive: true, force: true });
      console.log('[Main] Cleared GPU cache to prevent corruption issues');
    }
  } catch (error) {
    console.error('[Main] Could not clear GPU cache:', error.message);
    // Non-fatal, continue anyway
  }

  // Setup session CSP modification (must be before creating window)
  setupSessionCSP();

  // Run first-time setup (enables auto-launch on first install)
  setupFirstTimeDefaults();

  createWindow();
  createTray();
  createApplicationMenu();

  // Setup IPC handlers
  AuthManager.setupHandlers();
  FileManager.setupHandlers();
  DragHandler.setupHandlers();
  setupWindowHandlers();
  setupPremiereImportHandler();
  setupMediaCacheHandlers();

  // Setup context menu handler
  const contextMenuHandler = new ContextMenuHandler(mainWindow, store);
  contextMenuHandler.setupHandlers(require('electron').ipcMain);

  console.log('[Main] IPC handlers registered');

  // Setup download handler for webapp downloads
  setupDownloadHandler();

  // Setup permission handlers (CRITICAL for Mac file uploads)
  setupPermissionHandlers();

  // Setup screenshot handlers
  setupScreenshotHandlers();

  // Setup auto-updater (only in production)
  // TEMPORARY: Enable in development for testing
  const ENABLE_UPDATER_IN_DEV = true; // Set to false after testing

  if (process.env.NODE_ENV !== 'development' || ENABLE_UPDATER_IN_DEV) {
    setupAutoUpdater();
    setupUpdaterHandlers();
    console.log('[Main] Auto-updater enabled');
  } else {
    // In development, still setup handlers but don't check for updates
    setupUpdaterHandlers();
    console.log('[Main] Auto-updater disabled (development mode)');
  }

  // Setup proactive memory monitoring
  setupMemoryMonitoring();
});

// Window all closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Activate (macOS) - Re-show window when clicking dock icon
app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  } else if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Quit handler
app.on('before-quit', () => {
  app.isQuitting = true;
});

console.log('[Main] Kolbo Studio starting...');
console.log('[Main] App version:', app.getVersion());
console.log('[Main] Electron version:', process.versions.electron);
console.log('[Main] Node version:', process.versions.node);
console.log('[Main] User data path:', app.getPath('userData'));
