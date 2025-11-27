// Kolbo Desktop - Main Process Entry Point
// Handles window creation, system tray, and IPC setup

const { app, BrowserWindow, Tray, Menu, nativeImage, screen, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

// Import IPC handlers
const AuthManager = require('./auth-manager');
const FileManager = require('./file-manager');
const DragHandler = require('./drag-handler');

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
// app.commandLine.appendSwitch('in-process-gpu');
// app.commandLine.appendSwitch('disable-gpu');
// app.commandLine.appendSwitch('disable-gpu-compositing');
// app.commandLine.appendSwitch('disable-gpu-sandbox');

// Ignore certificate errors ONLY in development
if (process.env.NODE_ENV === 'development') {
  app.commandLine.appendSwitch('ignore-certificate-errors');
  console.log('[Main] Certificate validation disabled (development mode)');
}

// Set permanent user data path for persistent settings
const userDataPath = path.join(app.getPath('appData'), 'kolbo-desktop');
app.setPath('userData', userDataPath);
console.log('[Main] User data path:', userDataPath);

// Allow multiple instances - users can open as many windows as they want
// No single instance lock needed

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
    frame: false,                   // Remove default frame for custom title bar
    titleBarStyle: 'hidden',        // Hide default title bar
    webPreferences: {
      nodeIntegration: false,      // Security: no Node.js in renderer
      contextIsolation: true,       // Security: isolate contexts
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: process.env.NODE_ENV === 'development' ? false : true  // Enabled in production
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
  // Create tray icon with proper Kolbo icon
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.ico');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  console.log('[Main] Tray icon loaded from:', iconPath);

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
      title: 'Kolbo Desktop',
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
  autoUpdater.autoDownload = false; // Manual download via UI
  autoUpdater.autoInstallOnAppQuit = true; // Install when app quits

  // Log all updater events
  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);

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
    console.log('[Updater] App is up to date');
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

  // Start download
  ipcMain.handle('updater:download', async () => {
    try {
      console.log('[Updater] Download requested');
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      console.error('[Updater] Download failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Quit and install
  ipcMain.handle('updater:install', () => {
    console.log('[Updater] Install requested, quitting and installing...');
    setImmediate(() => autoUpdater.quitAndInstall());
    return { success: true };
  });

  console.log('[Updater] IPC handlers registered');
}

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

// App ready
app.whenReady().then(() => {
  console.log('[Main] App ready, creating window and tray');

  createWindow();
  createTray();

  // Setup IPC handlers
  AuthManager.setupHandlers();
  FileManager.setupHandlers();
  DragHandler.setupHandlers();
  setupWindowHandlers();
  setupPremiereImportHandler();

  console.log('[Main] IPC handlers registered');

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
