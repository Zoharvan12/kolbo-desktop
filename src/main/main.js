// Kolbo Studio - Main Process Entry Point
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

      // Build download URL
      const version = updateInfo.version;
      const fileName = `Kolbo.Studio-Setup-${version}.exe`;
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

    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Downloaded',
      message: 'The installer has been downloaded to your Downloads folder.',
      detail: 'Run the installer to update to the latest version. Your settings and data will be preserved.',
      buttons: ['OK']
    });

    return { success: true };
  });

  console.log('[Updater] IPC handlers registered');
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
    this.cachePath = path.join(app.getPath('appData'), 'Kolbo.AI', 'MediaCache');
    this.cacheIndex = new Map(); // id -> { filePath, lastAccessed, size, type }
    this.maxCacheSize = 5 * 1024 * 1024 * 1024; // 5GB
    this.maxCacheItems = 100;
    this.downloadQueue = new Map(); // id -> Promise

    this.ensureCacheFolderExists();
    this.loadCacheIndex();
  }

  ensureCacheFolderExists() {
    const fs = require('fs');
    if (!fs.existsSync(this.cachePath)) {
      fs.mkdirSync(this.cachePath, { recursive: true });
      console.log('[MediaCache] Created cache folder:', this.cachePath);
    }
  }

  loadCacheIndex() {
    const fs = require('fs');
    const path = require('path');

    if (!fs.existsSync(this.cachePath)) return;

    const files = fs.readdirSync(this.cachePath);
    console.log(`[MediaCache] Found ${files.length} cached files`);

    for (const fileName of files) {
      const filePath = path.join(this.cachePath, fileName);
      const stats = fs.statSync(filePath);

      // Extract ID from filename (e.g., "kolbo-123.mp4" -> "123")
      const id = fileName.replace(/^kolbo-/, '').replace(/\.[^.]+$/, '');

      this.cacheIndex.set(id, {
        filePath,
        lastAccessed: stats.mtime.getTime(),
        size: stats.size,
        fileName
      });
    }
  }

  async getCachedFilePath(mediaId) {
    // Check if already cached
    if (this.cacheIndex.has(mediaId)) {
      const cached = this.cacheIndex.get(mediaId);

      // Update last accessed time
      cached.lastAccessed = Date.now();

      console.log(`[MediaCache] Cache HIT for ${mediaId}`);
      return cached.filePath;
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

    const filePath = path.join(this.cachePath, fileName);

    // Start download
    const downloadPromise = this.downloadFile(url, filePath)
      .then(() => {
        const stats = fs.statSync(filePath);

        // Add to cache index
        this.cacheIndex.set(id, {
          filePath,
          lastAccessed: Date.now(),
          size: stats.size,
          fileName,
          type
        });

        console.log(`[MediaCache] Downloaded ${fileName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

        // Check cache size and evict if needed
        this.evictOldItemsIfNeeded();

        this.downloadQueue.delete(id);
        return filePath;
      })
      .catch(err => {
        console.error(`[MediaCache] Failed to download ${fileName}:`, err);
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
          fs.unlinkSync(outputPath);
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
          fs.unlinkSync(outputPath);
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

    return {
      itemCount: this.cacheIndex.size,
      totalSize,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      maxItems: this.maxCacheItems
    };
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

    // Use the actual file as icon if it's an image, extract frame for video, or use audio icon
    let dragIcon;
    const firstFile = paths[0];
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
    if (paths.length === 1) {
      event.sender.startDrag({
        file: paths[0],
        icon: dragIcon
      });
      console.log('[Native Drag] Single file drag started');
    } else {
      event.sender.startDrag({
        files: paths,
        icon: dragIcon
      });
      console.log('[Native Drag] Multi-file drag started');
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

// App ready
app.whenReady().then(() => {
  console.log('[Main] App ready, creating window and tray');

  // Run first-time setup (enables auto-launch on first install)
  setupFirstTimeDefaults();

  createWindow();
  createTray();

  // Setup IPC handlers
  AuthManager.setupHandlers();
  FileManager.setupHandlers();
  DragHandler.setupHandlers();
  setupWindowHandlers();
  setupPremiereImportHandler();
  setupMediaCacheHandlers();

  console.log('[Main] IPC handlers registered');

  // Setup download handler for webapp downloads
  setupDownloadHandler();

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

console.log('[Main] Kolbo Studio starting...');
console.log('[Main] App version:', app.getVersion());
console.log('[Main] Electron version:', process.versions.electron);
console.log('[Main] Node version:', process.versions.node);
console.log('[Main] User data path:', app.getPath('userData'));
