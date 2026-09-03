// Kolbo Studio - Main Process Entry Point
// Handles window creation, system tray, and IPC setup

// ── Critical-path imports (needed before first paint) ──────────────────────
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, dialog, webContents } = require('electron');
const path = require('path');
const config = require('../config');
const IS_UI_AUDIT = process.env.KOLBO_UI_AUDIT === '1';

// ── Deferred imports — loaded lazily after splash is visible ───────────────
let Store, store, autoUpdater, checkDiskSpace;
let AuthManager, FileManager, DragHandler, ContextMenuHandler;
let FFmpegHandler, YtdlpHandler, FileExplorerHandler;

function loadDeferredModules() {
  Store = require('electron-store');
  store = new Store();

  if (IS_UI_AUDIT) {
    const authKeys = ['token', 'kolbo_token', 'kolbo_access_token'];
    const isIsolatedSignInAudit = process.env.KOLBO_UI_AUDIT_ISOLATED === '1';

    // Every audit runs in its own profile. For a full audit, seed only the saved
    // auth token from the real profile; all subsequent renderer/storage writes
    // and any 401 logout stay inside the audit profile.
    let sourceAuth = {};
    if (!isIsolatedSignInAudit) {
      try {
        const fs = require('fs');
        const sourcePath = path.join(app.getPath('appData'), 'kolbo-desktop', 'config.json');
        sourceAuth = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
      } catch (error) {
        console.warn('[UI Audit] Saved authentication was unavailable:', error.code || error.message);
      }
    }

    for (const key of authKeys) {
      if (!isIsolatedSignInAudit && typeof sourceAuth[key] === 'string' && sourceAuth[key]) {
        store.set(key, sourceAuth[key]);
      } else {
        store.delete(key);
      }
    }
    console.log(isIsolatedSignInAudit
      ? '[UI Audit] Using an isolated signed-out profile'
      : '[UI Audit] Seeded the isolated audit profile from saved authentication');
  }

  autoUpdater = require('electron-updater').autoUpdater;
  checkDiskSpace = require('check-disk-space').default;

  AuthManager = require('./auth-manager');
  FileManager = require('./file-manager');
  DragHandler = require('./drag-handler');
  ContextMenuHandler = require('./context-menu-handler');
  FFmpegHandler = require('./ffmpeg-handler');
  YtdlpHandler = require('./ytdlp-handler');
  FileExplorerHandler = require('./file-explorer-handler');
}

let mainWindow = null;
let splashWindow = null;
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

// Hardware acceleration flags for better rendering performance.
// (Former enable-features list — NetworkService, CanvasOopRasterization,
// VaapiVideoDecoder — removed: all shipped-by-default or deleted in modern
// Chromium, so the switches were no-ops.)
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

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

// All V8 flags must be in a SINGLE appendSwitch call (later calls override earlier ones in Electron/Chromium)
// Cap heap at 8GB max — 50% of RAM on large machines could starve the OS, GPU, and other apps
const heapSizeMBCapped = Math.min(heapSizeMB, 8192);
app.commandLine.appendSwitch('js-flags',
  `--max-old-space-size=${heapSizeMBCapped} --expose-gc`
);

// Prevent Chromium from aggressively killing the renderer under memory pressure.
// Without this, Chromium's internal OOM heuristics can terminate the renderer even when
// the system has plenty of free RAM — because the *process* working set looks large
// (decoded images, video buffers, canvas bitmaps are all counted as native memory).
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity,MemoryPressureBasedSourceBufferGC');
// NOTE: --gc-interval=100 was intentionally removed — it triggered GC every 100 V8 allocations
// (default is ~100,000+), causing constant GC pauses that blocked the JS event loop.

console.log('[Main] System RAM:', totalRAM.toFixed(2), 'GB');
console.log('[Main] V8 heap limit (50% of RAM, capped 8GB):', (heapSizeMBCapped / 1024).toFixed(1), 'GB (', heapSizeMBCapped, 'MB)');
console.log('[Main] Remaining RAM for native memory, GPU, OS:', (totalRAM - heapSizeMBCapped / 1024).toFixed(2), 'GB');

// Prevent EPIPE errors from crashing the app (broken stdout/stderr pipe)
process.stdout?.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });
process.stderr?.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });

// Ignore certificate errors ONLY in development
if (process.env.NODE_ENV === 'development') {
  app.commandLine.appendSwitch('ignore-certificate-errors');
  console.log('[Main] Certificate validation disabled (development mode)');
}

// Set permanent user data path for persistent settings
const userDataPath = path.join(
  app.getPath('appData'),
  IS_UI_AUDIT
    ? (process.env.KOLBO_UI_AUDIT_ISOLATED === '1'
      ? 'kolbo-desktop-ui-audit-signed-out'
      : 'kolbo-desktop-ui-audit')
    : 'kolbo-desktop'
);
app.setPath('userData', userDataPath);
console.log('[Main] User data path:', userDataPath);
if (IS_UI_AUDIT) console.log('[Main] Background UI audit mode enabled');

// Single instance lock removed - allow multiple instances
// Users can now open multiple windows of the app simultaneously
console.log('[Main] Multiple instances allowed');

function createSplashWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Match the main window size exactly so the splash covers the same area
  const windowWidth = Math.floor(screenWidth * 0.75);
  const windowHeight = Math.floor(screenHeight * 0.75);
  const x = Math.floor((screenWidth - windowWidth) / 2);
  const y = Math.floor((screenHeight - windowHeight) / 2);

  splashWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x,
    y,
    frame: false,
    resizable: false,
    movable: false,
    show: false,           // Show only after content is painted (avoids white flash)
    skipTaskbar: false,    // Show in taskbar so user sees the app immediately
    alwaysOnTop: false,
    backgroundColor: '#000000',
    title: 'Kolbo Studio',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // Show as soon as the splash HTML is painted (near-instant — it's tiny inline HTML)
  splashWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.show();
    }
  });
  splashWindow.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html'));
}

function closeSplash() {
  if (!splashWindow || splashWindow.isDestroyed()) return;

  // Close immediately — the main window is ready, no need for a slow fade
  splashWindow.close();
  splashWindow = null;
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
    title: 'Kolbo Studio',
    skipTaskbar: IS_UI_AUDIT,
    backgroundColor: '#000000',     // Match splash screen — no white flash during swap
    frame: false,                   // Remove default frame for custom title bar
    titleBarStyle: 'hidden',        // Hide default title bar
    webPreferences: {
      nodeIntegration: false,      // Security: no Node.js in renderer
      contextIsolation: true,       // Security: isolate contexts
      // Electron 42's sandboxed preload can fail to receive startupData when a
      // remote debugging target attaches before first paint. Audit mode still
      // has context isolation + no Node integration, but runs this trusted local
      // preload outside the renderer sandbox so the read-only capture bridge loads.
      sandbox: !IS_UI_AUDIT,
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
      backgroundThrottling: !IS_UI_AUDIT // Audit frames must repaint while off-screen
    },
    show: false // Stay hidden until ready-to-show fires (prevents blank window flash)
  });

  // Load the main application HTML
  const htmlPath = path.join(__dirname, '..', 'renderer', 'index.html');
  console.log('[Main] Loading HTML:', htmlPath);

  // Apply user-chosen UI zoom to any newly created webContents (tab iframes
  // spawned after the initial load — e.g. when opening a webapp tab).
  app.on('web-contents-created', (_, wc) => {
    applyZoomToWebContents(wc, getEffectiveUiZoom());
  });

  mainWindow.loadFile(htmlPath)
    .then(() => {
      console.log('[Main] HTML loaded successfully');
      // Apply UI zoom once the renderer + all initial child webContents exist.
      applyUiZoomEverywhere(getEffectiveUiZoom());
    })
    .catch((err) => {
      console.error('[Main] Failed to load HTML file:', err);
    });

  // Show window only when the renderer signals its UI is ready.
  // This keeps the splash visible until the actual login/app screen is painted,
  // instead of flashing white while scripts are still executing.
  let windowShown = false;
  const showWindow = () => {
    if (windowShown) return;
    windowShown = true;
    clearTimeout(showWindowTimer);
    closeSplash();
    if (IS_UI_AUDIT) {
      // Windows does not composite a BrowserWindow that has never been shown,
      // which makes background screenshots blank. Present it far outside every
      // practical desktop bound and without activation: no focus, taskbar item,
      // pointer interception, or visible pixels on the user's workspace.
      mainWindow.setPosition(-32000, -32000, false);
      mainWindow.showInactive();
      console.log('[Main] Audit window ready off-screen without activation');
      return;
    }
    mainWindow.show();
    console.log('[Main] Window shown');
  };
  // Fallback: force-show after 8s in case renderer signal never arrives
  const showWindowTimer = setTimeout(showWindow, 8000);
  // Listen for the renderer's "I'm ready" signal
  const { ipcMain } = require('electron');
  ipcMain.once('renderer-ready', showWindow);

  // Add error listener for renderer process
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Main] Failed to load page:', errorCode, errorDescription);
  });

  // Log when page finishes loading
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Page finished loading');
  });

  // Log console messages from renderer (development only — in production this causes
  // an IPC round-trip + console write for every single renderer log statement)
  if (process.env.NODE_ENV === 'development' && !IS_UI_AUDIT) {
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log('[Renderer]', message);
    });
  }

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

    if (details.reason !== 'clean-exit') {
      try {
        require('./crash-telemetry').reportProcessGone('main-window', details);
      } catch {}
    }

    // Show error dialog to user
    const { dialog } = require('electron');
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'App Crashed',
      message: 'Kolbo Studio encountered an error and needs to reload',
      detail: `Reason: ${details.reason}\n\nThe app will reload automatically to recover.`,
      buttons: ['Reload Now']
    }).then(() => {
      // Reload the app (check if window still exists)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.reload();
        console.log('[Main] App reloaded after crash');
      }
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
        // User chose to reload (check if window still exists)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.reload();
          console.log('[Main] App reloaded after becoming unresponsive');
        }
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
      // MEMORY LEAK FIX: Clean up all event listeners when window closes
      // This must be done in 'close' event (before destruction), not 'closed' event
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        // Remove all webContents event listeners
        mainWindow.webContents.removeAllListeners('did-fail-load');
        mainWindow.webContents.removeAllListeners('did-finish-load');
        mainWindow.webContents.removeAllListeners('console-message');
        mainWindow.webContents.removeAllListeners('render-process-gone');
        console.log('[Main] Cleaned up window event listeners');
      }
      console.log('[Main] Window closing, app will quit');
    }
  });

  mainWindow.on('closed', () => {
    // Window is already destroyed at this point, just clean up the reference
    mainWindow = null;
    console.log('[Main] Window closed and cleaned up');
  });

  // Dev tools in development. The background audit already has a private CDP
  // connection and must not create a second renderer window.
  if (process.env.NODE_ENV === 'development' && !IS_UI_AUDIT) {
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

  // Show message dialog from renderer
  ipcMain.handle('dialog:show-message', async (event, options) => {
    try {
      const result = await dialog.showMessageBox(mainWindow, {
        type: options.type || 'info',
        title: options.title || 'Kolbo Studio',
        message: options.message || '',
        detail: options.detail || '',
        buttons: options.buttons || ['OK']
      });
      return { success: true, response: result.response };
    } catch (error) {
      console.error('[Main] Error showing dialog:', error);
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

function setupUiAuditHandlers() {
  if (!IS_UI_AUDIT) return;
  const { ipcMain } = require('electron');
  ipcMain.handle('ui-audit:capture-page', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Audit window is unavailable');
    }
    mainWindow.webContents.invalidate();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const image = await mainWindow.webContents.capturePage();
    return image.toPNG().toString('base64');
  });
}

// ============================================================================
// UI ZOOM / DPI COMPENSATION
// ============================================================================
//
// Windows display scaling (125%, 150%, ...) shrinks the UI on machines where
// users report the navbar buttons look "too small". Electron's renderer does
// NOT auto-zoom to compensate, so we apply `setZoomFactor(1 / scaleFactor)`
// to every webContents (main + every OOPIF tab iframe). Default mode is "auto"
// so most users get a fix without touching Settings.
//
// Stored key: `ui_zoom_mode` — 'auto' | '0.75' | '0.9' | '1' | '1.1' | '1.25' | '1.5'
// ============================================================================

const UI_ZOOM_PRESETS = ['auto', '0.75', '0.9', '1', '1.1', '1.25', '1.5'];

function getAutoUiZoomFactor() {
  // IMPORTANT: Chromium already honors the OS device scale factor for the
  // top-level window, so a 32px CSS button is already the correct physical
  // size on a 150% display. Applying `1 / scaleFactor` here DOUBLE-corrected
  // and shrank the whole app to ~67% on scaled laptops (the opposite of the
  // intended fix). Auto therefore means "no zoom"; users who want larger UI
  // opt in via the manual UI Scale control in Settings.
  return 1;
}

function getEffectiveUiZoom() {
  const stored = store.get('ui_zoom_mode', 'auto');
  if (stored === 'auto' || !stored) return getAutoUiZoomFactor();
  const n = parseFloat(stored);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function applyZoomToWebContents(wc, factor) {
  if (!wc || wc.isDestroyed?.()) return;
  try { wc.setZoomFactor(factor); } catch (e) { /* ignore guest view hosts */ }
}

function applyUiZoomEverywhere(factor) {
  // webContents.getAllWebContents() includes main + every OOPIF (tab iframes).
  for (const wc of webContents.getAllWebContents()) {
    applyZoomToWebContents(wc, factor);
  }
}

function setupUiZoomHandlers() {
  const { ipcMain } = require('electron');
  ipcMain.handle('settings:get-ui-zoom', () => {
    const mode = store.get('ui_zoom_mode', 'auto');
    const effectiveZoom = getEffectiveUiZoom();
    const displayScale = screen.getPrimaryDisplay().scaleFactor || 1;
    return { mode, effectiveZoom, displayScale, presets: UI_ZOOM_PRESETS };
  });

  ipcMain.handle('settings:set-ui-zoom', (event, mode) => {
    if (!UI_ZOOM_PRESETS.includes(String(mode))) {
      return { success: false, error: 'Invalid ui zoom mode' };
    }
    store.set('ui_zoom_mode', String(mode));
    const factor = getEffectiveUiZoom();
    applyUiZoomEverywhere(factor);
    console.log(`[Main] UI zoom set: mode=${mode} factor=${factor}`);
    return { success: true, mode, effectiveZoom: factor };
  });
}

// Auto-updater configuration
let updateInfo = null; // Store update info for renderer access

function setupAutoUpdater() {
  // Configure auto-updater
  autoUpdater.autoDownload = true; // Automatically download updates in background
  autoUpdater.autoInstallOnAppQuit = true; // Install when app quits if user chose "Later"
  autoUpdater.allowDowngrade = false; // Only allow upgrades, not downgrades
  autoUpdater.allowPrerelease = false; // Only stable releases

  // NO setFeedURL here. electron-builder bakes app-update.yml from each build's own
  // `publish` config, so Kolbo Studio reads kolbo-desktop-releases and the Sapir
  // whitelabel reads kolbo-desktop-sapir. Hardcoding a feed made every Sapir install
  // poll the Kolbo feed and update itself into Kolbo Studio.
  autoUpdater.channel = 'latest';

  console.log('[Updater] Configuration:');
  console.log('[Updater] - Current version:', app.getVersion());
  console.log('[Updater] - Channel: latest (always fetches newest release)');
  console.log('[Updater] - Feed: from app-update.yml (per-build publish config)');

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

    // UI (renderer) handles install prompt via "Restart to Update" button.
    // If window is already closed, install immediately.
    if (!mainWindow || mainWindow.isDestroyed()) {
      autoUpdater.quitAndInstall(true, true);
    }
  });

  // Check for updates on startup (after 3 seconds)
  setTimeout(() => {
    console.log('[Updater] Checking for updates on startup...');
    autoUpdater.checkForUpdates().catch(err => {
      console.error('[Updater] Failed to check for updates:', err);
    });
  }, 3000);

  // Check for updates every 4 hours, but only when the window is visible/focused
  let lastUpdateCheck = Date.now();
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) return; // Skip if app is hidden/minimized
    lastUpdateCheck = Date.now();
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

  // Silent install: `isSilent=true` passes /S to the NSIS installer — no wizard,
  // and it is the ONLY branch where an assisted (oneClick:false) installer honors
  // --force-run and relaunches the app itself (app-builder-lib installSection.nsh).
  ipcMain.handle('updater:install', async (event, force) => {
    // quitAndInstall is a hard kill. autoInstallOnAppQuit already lands the update on
    // the next normal quit, so deferring costs the user nothing — losing a 40-minute
    // export does.
    const busy =
      (ffmpegHandler && ffmpegHandler.activeJobs ? ffmpegHandler.activeJobs.size : 0) +
      (ytdlpHandler && ytdlpHandler.activeDownloads ? ytdlpHandler.activeDownloads.size : 0);
    if (busy > 0 && !force) {
      console.log(`[Updater] Install deferred — ${busy} job(s) still running`);
      return { blocked: true, count: busy };
    }
    console.log('[Updater] User triggered install — quitting and installing silently');
    autoUpdater.quitAndInstall(true, true);
    return { blocked: false };
  });

  console.log('[Updater] IPC handlers registered');
}

// ============================================================================
// FFMPEG HANDLERS
// ============================================================================

let ffmpegHandler = null;

function setupFFmpegHandlers() {
  const { ipcMain } = require('electron');

  // Initialize FFmpeg handler
  ffmpegHandler = new FFmpegHandler(mainWindow);
  console.log('[FFmpeg] Handler initialized');

  // Get GPU information
  ipcMain.handle('ff:get-gpu-info', async () => {
    try {
      const gpuInfo = ffmpegHandler.getGPUInfo();
      return { success: true, gpuInfo };
    } catch (error) {
      console.error('[FFmpeg] Failed to get GPU info:', error);
      return { success: false, error: error.message };
    }
  });

  // Convert a single file
  ipcMain.handle('ff:convert-job', async (event, job) => {
    try {
      console.log('[FFmpeg] Convert job requested:', job.id);
      const outputPath = await ffmpegHandler.convertFile(job);
      return { success: true, outputPath };
    } catch (error) {
      console.error('[FFmpeg] Conversion failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Cancel a job
  ipcMain.handle('ff:cancel-job', async (event, jobId) => {
    try {
      const result = ffmpegHandler.cancelJob(jobId);
      return { success: result };
    } catch (error) {
      console.error('[FFmpeg] Failed to cancel job:', error);
      return { success: false, error: error.message };
    }
  });

  // Cancel all jobs
  ipcMain.handle('ff:cancel-all', async () => {
    try {
      ffmpegHandler.cancelAll();
      return { success: true };
    } catch (error) {
      console.error('[FFmpeg] Failed to cancel all jobs:', error);
      return { success: false, error: error.message };
    }
  });

  // Select output folder
  ipcMain.handle('ff:select-output-folder', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Output Folder',
        properties: ['openDirectory', 'createDirectory']
      });

      if (result.canceled) {
        return { success: false, canceled: true };
      }

      return { success: true, folderPath: result.filePaths[0] };
    } catch (error) {
      console.error('[FFmpeg] Failed to select folder:', error);
      return { success: false, error: error.message };
    }
  });

  // Probe file for metadata
  ipcMain.handle('ff:probe-file', async (event, filePath) => {
    try {
      const metadata = await ffmpegHandler.probeFile(filePath);
      return { success: true, metadata };
    } catch (error) {
      console.error('[FFmpeg] Failed to probe file:', error);
      return { success: false, error: error.message };
    }
  });

  // Extract waveform data from audio file
  ipcMain.handle('ff:extract-waveform', async (event, { filePath, samples }) => {
    try {
      const waveformData = await ffmpegHandler.extractWaveformData(filePath, samples || 100);
      return { success: true, waveformData };
    } catch (error) {
      console.error('[FFmpeg] Failed to extract waveform:', error);
      return { success: false, error: error.message };
    }
  });

  // Get saved output folder preference
  ipcMain.handle('ff:get-output-folder', async () => {
    try {
      const outputFolder = store.get('ff_output_folder') || null;
      return { success: true, outputFolder };
    } catch (error) {
      console.error('[FFmpeg] Failed to get output folder:', error);
      return { success: false, error: error.message };
    }
  });

  // Set output folder preference
  ipcMain.handle('ff:set-output-folder', async (event, folderPath) => {
    try {
      if (folderPath) {
        store.set('ff_output_folder', folderPath);
        console.log('[FFmpeg] Output folder saved:', folderPath);
      } else {
        store.delete('ff_output_folder');
        console.log('[FFmpeg] Output folder cleared (will use source folder)');
      }
      return { success: true, folderPath };
    } catch (error) {
      console.error('[FFmpeg] Failed to set output folder:', error);
      return { success: false, error: error.message };
    }
  });

  // Get output mode preference ('source' or 'custom')
  ipcMain.handle('ff:get-output-mode', async () => {
    try {
      const outputMode = store.get('ff_output_mode') || 'source';
      return { success: true, outputMode };
    } catch (error) {
      console.error('[FFmpeg] Failed to get output mode:', error);
      return { success: false, error: error.message, outputMode: 'source' };
    }
  });

  // Set output mode preference
  ipcMain.handle('ff:set-output-mode', async (event, mode) => {
    try {
      if (mode !== 'source' && mode !== 'custom') {
        throw new Error('Invalid mode. Must be "source" or "custom"');
      }
      store.set('ff_output_mode', mode);
      console.log('[FFmpeg] Output mode saved:', mode);
      return { success: true, mode };
    } catch (error) {
      console.error('[FFmpeg] Failed to set output mode:', error);
      return { success: false, error: error.message };
    }
  });

  // Export trimmed segment (for drag-and-drop with in/out points)
  ipcMain.handle('ff:export-trimmed', async (event, job) => {
    try {
      console.log('[FFmpeg] Export trimmed requested:', job.inputPath);
      const outputPath = await ffmpegHandler.exportTrimmed(job);
      return { success: true, outputPath };
    } catch (error) {
      console.error('[FFmpeg] Export trimmed failed:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[FFmpeg] IPC handlers registered');
}

// ============================================================================
// QUICK TOOLS HANDLERS
// ============================================================================

function setupQuickToolsHandlers() {
  const { ipcMain } = require('electron');

  // Merge multiple videos
  ipcMain.handle('qt:merge-videos', async (event, job) => {
    try {
      console.log('[Quick Tools] Merge videos requested:', job.id);
      const outputPath = await ffmpegHandler.mergeVideos(job);
      return { success: true, outputPath };
    } catch (error) {
      console.error('[Quick Tools] Merge failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Timeline sync (PluralEyes-style): analyze only — the XML is written by qt:audio-sync-save
  ipcMain.handle('qt:audio-sync', async (event, job) => {
    try {
      const { analyze } = require('./audio-sync-handler');
      const files = (job.files || []).filter(Boolean);
      if (!files.length) return { success: false, error: 'No files' };
      const result = await analyze(files, {
        ffmpegPath: ffmpegHandler.ffmpegPath,
        onProgress: (message) => event.sender.send('qt:audio-sync-progress', { message })
      });
      if (result.items.filter((i) => i.synced).length < 2) return { success: false, error: 'no-match', result };
      return { success: true, result };
    } catch (error) {
      console.error('[Quick Tools] Audio sync failed:', error);
      return { success: false, error: error.message };
    }
  });

  // User confirms + picks where to save the FCP7 XML
  ipcMain.handle('qt:audio-sync-save', async (event, { items }) => {
    try {
      const fs = require('fs');
      const { dialog } = require('electron');
      const { buildXmeml } = require('./timeline-xml');
      const first = items.find((i) => i.synced);
      const defaultDir = first ? path.dirname(first.file) : app.getPath('documents');
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: path.join(defaultDir, 'kolbo-synced.xml'),
        filters: [{ name: 'Final Cut Pro XML', extensions: ['xml'] }]
      });
      if (canceled || !filePath) return { success: false, canceled: true };
      fs.writeFileSync(filePath, buildXmeml({ name: path.basename(filePath, '.xml'), items }));
      return { success: true, outputPath: filePath };
    } catch (error) {
      console.error('[Quick Tools] Audio sync save failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Crop video
  ipcMain.handle('qt:crop-video', async (event, job) => {
    try {
      console.log('[Quick Tools] Crop video requested:', job.id);
      const outputPath = await ffmpegHandler.cropVideo(job);
      return { success: true, outputPath };
    } catch (error) {
      console.error('[Quick Tools] Crop failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Extract single frame
  ipcMain.handle('qt:extract-frame', async (event, job) => {
    try {
      console.log('[Quick Tools] Extract frame requested:', job.timestamp);
      const outputPath = await ffmpegHandler.extractFrame(job);
      return { success: true, outputPath };
    } catch (error) {
      console.error('[Quick Tools] Frame extraction failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Save frame (from blob/buffer)
  ipcMain.handle('qt:save-frame', async (event, job) => {
    try {
      console.log('[Quick Tools] Saving frame:', job.filename);
      const outputPath = await ffmpegHandler.saveFrame(job);
      return { success: true, outputPath };
    } catch (error) {
      console.error('[Quick Tools] Save frame failed:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Quick Tools] IPC handlers registered');
}

// ============================================================================
// YT-DLP DOWNLOADER HANDLERS
// ============================================================================

let ytdlpHandler = null;

function setupDownloaderHandlers() {
  const { ipcMain } = require('electron');

  // Initialize yt-dlp handler
  ytdlpHandler = new YtdlpHandler(mainWindow);
  console.log('[Downloader] Handler initialized');

  // Get media info from URL
  ipcMain.handle('dl:get-info', async (event, url) => {
    try {
      console.log('[Downloader] Getting info for:', url);
      const info = await ytdlpHandler.getMediaInfo(url);
      return { success: true, info };
    } catch (error) {
      console.error('[Downloader] Failed to get info:', error);
      return {
        success: false,
        error: error.message || 'Failed to fetch media info',
        errorType: error.type || 'unknown'
      };
    }
  });

  // Start download
  ipcMain.handle('dl:start', async (event, job) => {
    try {
      console.log('[Downloader] Starting download:', job.id);
      const outputPath = await ytdlpHandler.downloadMedia(job);
      return { success: true, outputPath };
    } catch (error) {
      console.error('[Downloader] Download failed:', error);
      return {
        success: false,
        error: error.message || 'Download failed',
        errorType: error.type || 'unknown'
      };
    }
  });

  // Cancel a download
  ipcMain.handle('dl:cancel', async (event, jobId) => {
    try {
      const result = ytdlpHandler.cancelDownload(jobId);
      return { success: result };
    } catch (error) {
      console.error('[Downloader] Failed to cancel:', error);
      return { success: false, error: error.message };
    }
  });

  // Cancel all downloads
  ipcMain.handle('dl:cancel-all', async () => {
    try {
      const count = ytdlpHandler.cancelAll();
      return { success: true, cancelled: count };
    } catch (error) {
      console.error('[Downloader] Failed to cancel all:', error);
      return { success: false, error: error.message };
    }
  });

  // Force update yt-dlp (useful when YouTube changes break downloads)
  ipcMain.handle('dl:update-ytdlp', async () => {
    try {
      console.log('[Downloader] Forcing yt-dlp update...');
      const result = await ytdlpHandler.forceUpdate();
      return { success: result };
    } catch (error) {
      console.error('[Downloader] Failed to update yt-dlp:', error);
      return { success: false, error: error.message };
    }
  });

  // Select output folder
  ipcMain.handle('dl:select-output-folder', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Download Folder',
        properties: ['openDirectory', 'createDirectory']
      });

      if (result.canceled) {
        return { success: false, canceled: true };
      }

      // Save the selection
      store.set('dl_output_folder', result.filePaths[0]);
      return { success: true, folderPath: result.filePaths[0] };
    } catch (error) {
      console.error('[Downloader] Failed to select folder:', error);
      return { success: false, error: error.message };
    }
  });

  // Get saved output folder
  ipcMain.handle('dl:get-output-folder', async () => {
    try {
      const outputFolder = store.get('dl_output_folder') || app.getPath('downloads');
      return { success: true, outputFolder };
    } catch (error) {
      console.error('[Downloader] Failed to get output folder:', error);
      return { success: false, error: error.message, outputFolder: app.getPath('downloads') };
    }
  });

  // Set output folder
  ipcMain.handle('dl:set-output-folder', async (event, folderPath) => {
    try {
      if (folderPath) {
        store.set('dl_output_folder', folderPath);
        console.log('[Downloader] Output folder saved:', folderPath);
      } else {
        store.delete('dl_output_folder');
        console.log('[Downloader] Output folder reset to downloads');
      }
      return { success: true, folderPath };
    } catch (error) {
      console.error('[Downloader] Failed to set output folder:', error);
      return { success: false, error: error.message };
    }
  });

  // Open folder in file explorer
  ipcMain.handle('dl:open-folder', async (event, folderPath) => {
    try {
      const { shell } = require('electron');
      await shell.openPath(folderPath);
      return { success: true };
    } catch (error) {
      console.error('[Downloader] Failed to open folder:', error);
      return { success: false, error: error.message };
    }
  });

  // Show file in folder
  ipcMain.handle('dl:show-in-folder', async (event, filePath) => {
    try {
      const { shell } = require('electron');
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch (error) {
      console.error('[Downloader] Failed to show in folder:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Downloader] IPC handlers registered');
}

// ============================================================================
// SCREENSHOT HANDLERS
// ============================================================================

// Follow up to 5 redirects and resolve with the final http(s) IncomingMessage.
// Shared by the Synci download/cache/peak handlers (signed CDN urls 30x often).
// Forwards the logged-in user's bearer token to our own API (stock/synci
// routes gate paid audio on req.user) — never to third-party redirect targets.
function synciHttpGetFollow(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('Too many redirects'));
    const mod = url.indexOf('https:') === 0 ? require('https') : require('http');
    const token = store.get('token') || store.get('kolbo_access_token') || store.get('kolbo_token');
    const isOwnApi = token && url.indexOf(config.apiUrl) === 0;
    const opts = isOwnApi ? { headers: { Authorization: `Bearer ${token}` } } : {};
    mod.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let next = res.headers.location;
        if (next.indexOf('http') !== 0) next = new URL(next, url).toString();
        return synciHttpGetFollow(next, depth + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      resolve(res);
    }).on('error', reject);
  });
}

// Stream a URL to a file (follows redirects); cleans up a partial file on error.
async function synciDownloadToFile(url, destPath) {
  const fs = require('fs');
  const res = await synciHttpGetFollow(url);
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    res.pipe(file);
    file.on('finish', () => file.close(() => resolve()));
    file.on('error', (err) => { try { fs.unlinkSync(destPath); } catch (e) {} reject(err); });
  });
}

// Buffer a URL fully into memory (follows redirects).
async function synciFetchToBuffer(url) {
  const res = await synciHttpGetFollow(url);
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  });
}

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

  // ── Synci: download a licensed track to disk ──────────────────────────────
  // SynciManager's desktop bridge calls this in place of "add to timeline".
  // Saves to the user's configured download folder (or the OS Downloads dir).
  ipcMain.handle('synci:download-to-disk', async (event, { url, filename }) => {
    const fsSync = require('fs');
    try {
      if (!url) return { success: false, error: 'No URL provided' };

      let downloadFolder = store.get('defaultDownloadFolder');
      if (!downloadFolder) downloadFolder = app.getPath('downloads');

      // Sanitize the filename and guarantee an extension.
      let safeName = String(filename || 'Synci Track')
        .replace(/[\\/:*?"<>|]/g, '')
        .trim() || 'Synci Track';
      if (!/\.[a-z0-9]{2,4}$/i.test(safeName)) safeName += '.mp3';

      // Avoid clobbering an existing file with the same suggested name
      // (different tracks/generations can share a generic title).
      const ext = path.extname(safeName);
      const base = path.basename(safeName, ext);
      let savePath = path.join(downloadFolder, safeName);
      let counter = 1;
      while (fsSync.existsSync(savePath)) {
        savePath = path.join(downloadFolder, `${base} (${counter})${ext}`);
        counter++;
      }
      safeName = path.basename(savePath);

      await synciDownloadToFile(url, savePath);

      console.log('[Synci] Downloaded to:', savePath);

      // Reuse the existing download banner in the renderer.
      const targetWindow = BrowserWindow.getFocusedWindow() || mainWindow;
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('download-complete', {
          fileName: safeName,
          filePath: savePath,
          folderPath: downloadFolder
        });
      }

      return { success: true, filePath: savePath };
    } catch (error) {
      console.error('[Synci] Download failed:', error);
      const targetWindow = BrowserWindow.getFocusedWindow() || mainWindow;
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('download-failed', {
          fileName: filename || 'track',
          error: error.message
        });
      }
      return { success: false, error: error.message };
    }
  });

  // ── Synci: cache a track to a local file (for drag-to-timeline) ───────────
  // Native OS drag (startFileDrag) and ffmpeg trim both need a real local file.
  // We download the chosen-quality audio into a hidden SynciCache dir, keyed by
  // url hash so repeated plays/drags reuse the same file.
  ipcMain.handle('synci:cache-track', async (event, { url, filename }) => {
    const fsSync = require('fs');
    const crypto = require('crypto');

    try {
      if (!url) return { success: false, error: 'No URL' };
      const cacheDir = path.join(app.getPath('userData'), 'SynciCache');
      if (!fsSync.existsSync(cacheDir)) fsSync.mkdirSync(cacheDir, { recursive: true });

      const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 16);
      let safe = String(filename || 'synci-track').replace(/[\\/:*?"<>|]/g, '').trim() || 'synci-track';
      if (!/\.[a-z0-9]{2,4}$/i.test(safe)) safe += '.mp3';
      const savePath = path.join(cacheDir, hash + '_' + safe);

      // Already cached?
      if (fsSync.existsSync(savePath) && fsSync.statSync(savePath).size > 0) {
        return { success: true, filePath: savePath, cached: true };
      }

      await synciDownloadToFile(url, savePath);

      return { success: true, filePath: savePath, cached: false };
    } catch (error) {
      console.warn('[Synci] cache-track failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // ── Synci: copy an already-local file (cached/trimmed) into Downloads ─────
  ipcMain.handle('synci:save-to-downloads', async (event, { filePath, filename }) => {
    const fsSync = require('fs');
    try {
      if (!filePath || !fsSync.existsSync(filePath)) return { success: false, error: 'File not found' };
      const folder = store.get('defaultDownloadFolder') || app.getPath('downloads');
      let safe = String(filename || path.basename(filePath)).replace(/[\\/:*?"<>|]/g, '').trim() || path.basename(filePath);
      const ext = path.extname(safe);
      const base = path.basename(safe, ext);
      let dest = path.join(folder, safe);
      let i = 1;
      while (fsSync.existsSync(dest)) { dest = path.join(folder, base + ' (' + i + ')' + ext); i++; }
      fsSync.copyFileSync(filePath, dest);

      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      if (win && !win.isDestroyed()) {
        win.webContents.send('download-complete', { fileName: path.basename(dest), filePath: dest, folderPath: folder });
      }
      return { success: true, savedPath: dest };
    } catch (error) {
      console.warn('[Synci] save-to-downloads failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // ── Synci: compute waveform peaks in the main process (FFmpeg) ────────────
  // Web Audio decodeAudioData crashes the renderer natively (access violation
  // 0xC0000005) from a file:// origin. So we fetch the audio here, pipe it
  // through the bundled FFmpeg to mono f32 PCM, and return normalized RMS peaks
  // for the canvas waveform. Renderer never touches Web Audio.
  ipcMain.handle('synci:waveform-peaks', async (event, { url, numPeaks }) => {
    const { spawn } = require('child_process');
    let ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    if (ffmpegPath.includes('app.asar')) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');

    const N = Math.max(32, Math.min(800, numPeaks || 400));
    const SR = 8000; // mono @ 8 kHz is plenty of detail for a thin waveform

    try {
      if (!url) return { success: false, error: 'No URL' };
      const audioBuf = await synciFetchToBuffer(url);

      const pcm = await new Promise((resolve, reject) => {
        const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1']);
        const out = []; let size = 0; const MAX = 80 * 1024 * 1024; let err = '';
        proc.stdout.on('data', (c) => { size += c.length; if (size > MAX) { try { proc.kill('SIGKILL'); } catch (e) {} } else out.push(c); });
        proc.stderr.on('data', (c) => { err += c.toString(); });
        proc.on('error', reject);
        proc.on('close', (code) => {
          if (code === 0 && out.length) resolve(Buffer.concat(out));
          else reject(new Error('ffmpeg exit ' + code + ' ' + err.slice(0, 200)));
        });
        proc.stdin.on('error', () => {}); // ignore EPIPE if ffmpeg bails early
        proc.stdin.write(audioBuf);
        proc.stdin.end();
      });

      const usable = pcm.length - (pcm.length % 4);
      const f32 = new Float32Array(pcm.buffer, pcm.byteOffset, usable / 4);
      const sampleCount = f32.length;
      if (!sampleCount) return { success: false, error: 'No PCM decoded' };

      const block = Math.max(1, Math.floor(sampleCount / N));
      const peaks = new Array(N); let max = 0;
      for (let i = 0; i < N; i++) {
        const s = i * block, e = Math.min(s + block, sampleCount); let sum = 0;
        for (let j = s; j < e; j++) { const v = f32[j]; sum += v * v; }
        const rms = Math.sqrt(sum / Math.max(1, e - s));
        peaks[i] = rms; if (rms > max) max = rms;
      }
      if (max > 0) for (let k = 0; k < N; k++) peaks[k] = peaks[k] / max;

      return { success: true, peaks, duration: sampleCount / SR };
    } catch (error) {
      console.warn('[Synci] waveform-peaks failed:', error.message);
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

  // Track recent downloads to prevent duplicates. Keyed by URL, not filename —
  // Kolbo audio generations often share a generic suggested filename (e.g. every
  // TTS take suggests "audio.mp3"), so two genuinely different downloads firing
  // within the threshold must not be mistaken for the same event double-firing.
  const recentDownloads = new Map(); // url -> timestamp
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

    // Check if we're already showing a dialog for this exact download
    if (activeDialogs.has(fileUrl)) {
      console.log('[Download] Dialog already active for:', fileUrl, '- canceling duplicate');
      item.cancel();
      return;
    }

    // Check if this is a duplicate download event (same URL within 1 second —
    // Electron can double-fire will-download for one click/redirect)
    const lastDownload = recentDownloads.get(fileUrl);
    if (lastDownload && (now - lastDownload) < DUPLICATE_THRESHOLD) {
      console.log('[Download] Ignoring duplicate download (recent):', fileUrl);
      item.cancel();
      return;
    }

    // Mark as active
    activeDialogs.add(fileUrl);

    // Track this download
    recentDownloads.set(fileUrl, now);

    // Clean up old entries (older than threshold)
    for (const [url, timestamp] of recentDownloads.entries()) {
      if (now - timestamp > DUPLICATE_THRESHOLD) {
        recentDownloads.delete(url);
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
        activeDialogs.delete(fileUrl);
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
    activeDialogs.delete(fileUrl);

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

  // Track permission states to prevent infinite loops
  // State can be: 'idle', 'requesting', 'granted', 'denied'
  const permissionState = {
    camera: 'idle',
    microphone: 'idle'
  };

  // Queue of pending callbacks waiting for permission result
  const pendingCallbacks = {
    camera: [],
    microphone: []
  };

  // Track if we've shown the "denied" dialog to avoid spamming
  const deniedDialogShown = {
    camera: false,
    microphone: false
  };

  // Handle permission requests from web content (iframes)
  session.defaultSession.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
    console.log('[Permissions] Permission requested:', permission, 'details:', details);

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
      // Determine what media type is being requested
      // details.mediaTypes is an array like ['audio'] or ['video'] or ['audio', 'video']
      let mediaType = 'camera'; // default
      if (permission === 'microphone') {
        mediaType = 'microphone';
      } else if (permission === 'media' && details && details.mediaTypes) {
        // Check what the web content is actually requesting
        const hasAudio = details.mediaTypes.includes('audio');
        const hasVideo = details.mediaTypes.includes('video');
        if (hasAudio && !hasVideo) {
          mediaType = 'microphone';
        }
        // If both or just video, we'll check camera (mediaType stays 'camera')
        console.log(`[Permissions] Media request types: ${details.mediaTypes.join(', ')} -> checking ${mediaType}`);
      }

      // If we've already determined the permission, return cached result immediately
      if (permissionState[mediaType] === 'granted') {
        console.log(`[Permissions] ✅ Granted (cached): ${permission}`);
        callback(true);
        return;
      }

      if (permissionState[mediaType] === 'denied') {
        console.log(`[Permissions] ❌ Denied (cached): ${permission}`);
        // Show dialog only once per session
        if (!deniedDialogShown[mediaType]) {
          deniedDialogShown[mediaType] = true;
          const { dialog } = require('electron');
          if (mainWindow && !mainWindow.isDestroyed()) {
            dialog.showMessageBox(mainWindow, {
              type: 'warning',
              title: `${mediaType === 'camera' ? 'Camera' : 'Microphone'} Access Denied`,
              message: `Kolbo Studio needs ${mediaType} access`,
              detail: `Please enable ${mediaType} access in System Preferences → Security & Privacy → Privacy → ${mediaType === 'camera' ? 'Camera' : 'Microphone'}`,
              buttons: ['OK']
            });
          }
        }
        callback(false);
        return;
      }

      // If a request is already in progress, queue this callback
      if (permissionState[mediaType] === 'requesting') {
        console.log(`[Permissions] ⏳ Request in progress, queuing callback for: ${mediaType}`);
        pendingCallbacks[mediaType].push(callback);
        return;
      }

      try {
        // Check macOS system permission status
        const status = systemPreferences.getMediaAccessStatus(mediaType);
        console.log(`[Permissions] macOS ${mediaType} status:`, status);

        if (status === 'granted') {
          // Already granted at system level - cache and return
          permissionState[mediaType] = 'granted';
          console.log(`[Permissions] ✅ Granted (system): ${permission}`);
          callback(true);
        } else if (status === 'denied') {
          // User denied at system level - cache and show helpful message
          permissionState[mediaType] = 'denied';
          console.log(`[Permissions] ❌ Denied (system): ${permission}`);

          if (!deniedDialogShown[mediaType]) {
            deniedDialogShown[mediaType] = true;
            const { dialog } = require('electron');
            if (mainWindow && !mainWindow.isDestroyed()) {
              dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: `${mediaType === 'camera' ? 'Camera' : 'Microphone'} Access Denied`,
                message: `Kolbo Studio needs ${mediaType} access`,
                detail: `Please enable ${mediaType} access in System Preferences → Security & Privacy → Privacy → ${mediaType === 'camera' ? 'Camera' : 'Microphone'}`,
                buttons: ['OK']
              });
            }
          }

          callback(false);
        } else if (status === 'not-determined' || status === 'restricted') {
          // Need to request permission - mark as requesting to prevent concurrent requests
          permissionState[mediaType] = 'requesting';
          console.log(`[Permissions] 🔄 Requesting macOS ${mediaType} permission...`);

          try {
            // Request access - this triggers the macOS system dialog ONCE
            const granted = await systemPreferences.askForMediaAccess(mediaType);

            // Update state based on result
            permissionState[mediaType] = granted ? 'granted' : 'denied';
            console.log(`[Permissions] ${granted ? '✅' : '❌'} macOS ${mediaType} permission ${granted ? 'granted' : 'denied'}`);

            // Respond to this callback
            callback(granted);

            // Respond to all queued callbacks with the same result
            const queued = pendingCallbacks[mediaType];
            pendingCallbacks[mediaType] = [];
            console.log(`[Permissions] Resolving ${queued.length} queued callbacks for ${mediaType}`);
            queued.forEach(queuedCallback => queuedCallback(granted));
          } catch (requestError) {
            console.error(`[Permissions] Error requesting ${mediaType} permission:`, requestError);
            // Reset state so it can be tried again
            permissionState[mediaType] = 'idle';
            // Grant on error (fallback behavior)
            callback(true);
            // Resolve queued callbacks too
            const queued = pendingCallbacks[mediaType];
            pendingCallbacks[mediaType] = [];
            queued.forEach(queuedCallback => queuedCallback(true));
          }
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
    // Paths claimed by an in-flight download but not yet written to disk.
    // preloadMedia() fires every item's download concurrently, so two items
    // that share a generic suggested filename (e.g. every TTS take names
    // itself "audio.mp3") can both pass fs.existsSync before either file
    // actually lands — this closes that race. See downloadToCache().
    this.reservedPaths = new Set();

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

    // Generate unique filename if file already exists (or is claimed by an
    // in-flight download this same batch — see this.reservedPaths above).
    let filePath = path.join(this.cachePath, fileName);
    let counter = 1;
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);

    while (fs.existsSync(filePath) || this.reservedPaths.has(filePath)) {
      filePath = path.join(this.cachePath, `${base} (${counter})${ext}`);
      counter++;
    }
    this.reservedPaths.add(filePath);

    // If filename was changed, log it
    if (counter > 1) {
      console.log(`[MediaCache] File exists, using unique name: ${path.basename(filePath)}`);
    }

    // Start download
    const downloadPromise = this.downloadFile(url, filePath)
      .then(() => {
        this.reservedPaths.delete(filePath);
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

        // Auto-eviction disabled — users manage cache manually via Settings
        // (prevents NLE project corruption from automatic file deletion)

        this.downloadQueue.delete(id);
        return filePath;
      })
      .catch(err => {
        this.reservedPaths.delete(filePath);
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

  // Simple native file drag - just like Windows Explorer
  ipcMain.on('file:start-drag', (event, filePaths) => {
    const { nativeImage } = require('electron');
    const path = require('path');

    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
    console.log('[Native Drag] Dragging:', paths);

    // Simple icon - just load it once
    const iconPath = path.join(__dirname, '../../assets/icon-source.png');
    const icon = nativeImage.createFromPath(iconPath);

    try {
      if (paths.length === 1) {
        event.sender.startDrag({ file: paths[0], icon });
      } else {
        event.sender.startDrag({ files: paths, icon });
      }
      console.log('[Native Drag] Done');
    } catch (err) {
      console.error('[Native Drag] Error:', err);
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

  // ========================================================================
  // Memory Management IPC Handlers
  // ========================================================================

  // Manual memory cleanup trigger
  ipcMain.handle('memory:cleanup', async (event, options = {}) => {
    const { aggressive = false } = options;
    console.log(`[Memory] Manual cleanup requested (aggressive: ${aggressive})`);

    try {
      await cleanupSessionCache(aggressive);

      // Request garbage collection if exposed
      if (global.gc) {
        global.gc();
        console.log('[Memory] Manual GC triggered');
      }

      return { success: true };
    } catch (error) {
      console.error('[Memory] Manual cleanup error:', error);
      return { success: false, error: error.message };
    }
  });

  // Get current memory stats
  ipcMain.handle('memory:get-stats', async () => {
    try {
      const mainMem = process.memoryUsage();
      const rendererMem = getRendererMemoryKB();

      return {
        main: {
          heapUsed: mainMem.heapUsed,
          heapTotal: mainMem.heapTotal,
          rss: mainMem.rss,
          external: mainMem.external
        },
        renderer: {
          workingSetSize: rendererMem.workingSetSize * 1024, // KB to bytes
          private: rendererMem.private * 1024
        },
        heapLimitMB: heapSizeGB * 1024
      };
    } catch (error) {
      console.error('[Memory] Error getting stats:', error);
      return null;
    }
  });

  // Clear all caches aggressively
  ipcMain.handle('memory:clear-all-caches', async () => {
    // (storages list below: 'appcache' and the 'quotas' option were removed from
    // Electron's clearStorageData — passing them made the whole call reject.)
    console.log('[Memory] Clearing all caches...');
    try {
      const { session } = require('electron');
      const defaultSession = session.defaultSession;

      await defaultSession.clearCache();
      await defaultSession.clearCodeCaches({});
      await defaultSession.clearStorageData({
        storages: ['shadercache', 'serviceworkers', 'cachestorage']
      });

      console.log('[Memory] All caches cleared');
      return { success: true };
    } catch (error) {
      console.error('[Memory] Error clearing caches:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Memory] IPC handlers registered');
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
 * Monitors BOTH main process AND renderer process memory
 * Also includes session cache cleanup
 */
function setupMemoryMonitoring() {
  const MEMORY_CHECK_INTERVAL = 60 * 1000; // Check every 60 seconds
  const CLEANUP_THRESHOLD = 70; // Start cleanup at 70% (was 80)
  const WARNING_THRESHOLD = 85; // Warn user at 85% (was 90)
  const CRITICAL_THRESHOLD = 92; // Critical warning at 92% (was 95)

  // Absolute memory limits (in MB) - trigger cleanup regardless of percentage.
  // These scale with system RAM so a rich AI web app doesn't false-alarm on capable machines.
  // Renderer working set includes decoded images, video buffers, canvas — not just JS heap.
  // Floor: renderer=3GB, total=6GB. On 16GB machine: renderer=6.4GB, total=9.6GB.
  const RENDERER_MEMORY_LIMIT_MB = Math.max(3072, Math.floor(totalRAM * 1024 * 0.4));
  const TOTAL_MEMORY_LIMIT_MB = Math.max(6144, Math.floor(totalRAM * 1024 * 0.6));

  let lastWarningTime = 0;
  let lastCacheCleanupTime = 0;
  const WARNING_COOLDOWN = 3 * 60 * 1000; // Warn every 3 minutes (was 5)
  const CACHE_CLEANUP_INTERVAL = 10 * 60 * 1000; // Clean cache every 10 minutes

  setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    // When the window is hidden/minimized, skip renderer IPC entirely.
    // Periodic cache cleanup still runs (below) — it's I/O-only, no renderer wakeup.
    const windowVisible = mainWindow.isVisible();

    try {
      // Get main process memory
      const mainMemUsage = process.memoryUsage();
      const mainHeapUsedMB = mainMemUsage.heapUsed / (1024 * 1024);
      const mainRssMB = mainMemUsage.rss / (1024 * 1024);

      // Get renderer process memory only when visible (avoids waking the renderer process)
      let rendererMemoryMB = 0;
      let rendererPrivateMB = 0;
      if (windowVisible) {
        const rendererMemInfo = getRendererMemoryKB();
        rendererMemoryMB = rendererMemInfo.workingSetSize / 1024; // KB to MB
        rendererPrivateMB = rendererMemInfo.private / 1024;
      }

      // Total memory = main RSS + renderer working set
      const totalMemoryMB = mainRssMB + rendererMemoryMB;
      const heapLimitGB = heapSizeGB;
      const heapLimitMB = heapLimitGB * 1024;

      // Calculate percentage based on renderer memory (more accurate for iframe-heavy app)
      const rendererUsagePercent = (rendererMemoryMB / RENDERER_MEMORY_LIMIT_MB) * 100;
      const totalUsagePercent = (totalMemoryMB / TOTAL_MEMORY_LIMIT_MB) * 100;

      // Use the higher of the two percentages for triggering actions
      const usagePercent = Math.max(rendererUsagePercent, totalUsagePercent);

      // Log detailed stats every check (only in debug)
      if (process.env.NODE_ENV === 'development') {
        console.log('[Memory Monitor]', {
          mainHeap: `${(mainHeapUsedMB / 1024).toFixed(2)} GB`,
          mainRSS: `${(mainRssMB / 1024).toFixed(2)} GB`,
          rendererWorkingSet: `${(rendererMemoryMB / 1024).toFixed(2)} GB`,
          rendererPrivate: `${(rendererPrivateMB / 1024).toFixed(2)} GB`,
          totalMemory: `${(totalMemoryMB / 1024).toFixed(2)} GB`,
          usagePercent: `${usagePercent.toFixed(1)}%`
        });
      }

      // Periodic session cache cleanup (every 10 minutes) — runs regardless of visibility
      const now = Date.now();
      if (now - lastCacheCleanupTime > CACHE_CLEANUP_INTERVAL) {
        lastCacheCleanupTime = now;
        await cleanupSessionCache();
      }

      // All renderer IPC and warnings are skipped when the window is hidden
      if (!windowVisible) return;

      // Send memory status to renderer for display
      mainWindow.webContents.send('memory:status', {
        heapUsedGB: parseFloat((mainHeapUsedMB / 1024).toFixed(2)),
        heapLimitGB: heapLimitGB,
        rendererMemoryMB: parseFloat(rendererMemoryMB.toFixed(0)),
        totalMemoryMB: parseFloat(totalMemoryMB.toFixed(0)),
        usagePercent: parseFloat(usagePercent.toFixed(1)),
        rss: parseFloat((mainRssMB / 1024).toFixed(2))
      });

      // CRITICAL: 92%+ - Show dialog and offer to reload
      if (usagePercent >= CRITICAL_THRESHOLD || totalMemoryMB > TOTAL_MEMORY_LIMIT_MB) {
        if (now - lastWarningTime > WARNING_COOLDOWN) {
          lastWarningTime = now;

          console.error(`[Memory Monitor] 🚨 CRITICAL: Memory at ${usagePercent.toFixed(1)}% (${(totalMemoryMB / 1024).toFixed(1)}GB)`);

          // Force cleanup first
          mainWindow.webContents.send('memory:force-cleanup');

          // Also clean session cache
          await cleanupSessionCache(true); // aggressive=true

          // Show dialog
          dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Memory Critically High',
            message: `Memory usage is at ${usagePercent.toFixed(0)}% (${(totalMemoryMB / 1024).toFixed(1)}GB)`,
            detail: 'The app has cleaned up inactive tabs and cache, but memory is still very high. Reloading will free all memory.\n\nDo you want to reload now?',
            buttons: ['Reload Now', 'Continue'],
            defaultId: 0,
            cancelId: 1
          }).then(({ response }) => {
            if (response === 0) {
              console.log('[Memory Monitor] User chose to reload app');
              mainWindow.reload();
            }
          });
        }
      }
      // WARNING: 85%+ - Notify user and force cleanup
      else if (usagePercent >= WARNING_THRESHOLD || rendererMemoryMB > RENDERER_MEMORY_LIMIT_MB) {
        if (now - lastWarningTime > WARNING_COOLDOWN) {
          lastWarningTime = now;

          console.warn(`[Memory Monitor] ⚠️ WARNING: Memory at ${usagePercent.toFixed(1)}% (renderer: ${(rendererMemoryMB / 1024).toFixed(2)}GB)`);

          // Trigger forced cleanup
          mainWindow.webContents.send('memory:force-cleanup');

          // Clean session cache
          await cleanupSessionCache();
        }
      }
      // CLEANUP: 70%+ - Silent auto-cleanup
      else if (usagePercent >= CLEANUP_THRESHOLD) {
        console.log(`[Memory Monitor] 🧹 Auto-cleanup triggered at ${usagePercent.toFixed(1)}%`);

        // Trigger cleanup in renderer
        mainWindow.webContents.send('memory:auto-cleanup');
      }
    } catch (error) {
      console.error('[Memory Monitor] Error checking memory:', error);
    }
  }, MEMORY_CHECK_INTERVAL);

  console.log('[Memory Monitor] Enhanced monitoring enabled (check every 30s, cleanup at 70%, warn at 85%, critical at 92%)');
}

/**
 * Memory of the main window's renderer process, in KB (same shape/units as the
 * old webContents.getProcessMemoryInfo(), which Electron removed). Sums nothing
 * across processes — matches the renderer by OS pid via app.getAppMetrics().
 */
function getRendererMemoryKB() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return { workingSetSize: 0, private: 0 };
    const pid = mainWindow.webContents.getOSProcessId();
    const metric = app.getAppMetrics().find(m => m.pid === pid);
    if (!metric || !metric.memory) return { workingSetSize: 0, private: 0 };
    return {
      workingSetSize: metric.memory.workingSetSize || 0, // already KB
      private: metric.memory.privateBytes || 0 // already KB despite the name
    };
  } catch (e) {
    return { workingSetSize: 0, private: 0 };
  }
}

/**
 * Clean up session cache to free memory
 * @param {boolean} aggressive - If true, clear all cache. If false, only clear storage.
 */
async function cleanupSessionCache(aggressive = false) {
  try {
    const { session } = require('electron');
    const defaultSession = session.defaultSession;

    function safeLog(...args) {
      try { console.log(...args); } catch (e) {}
    }

    if (aggressive) {
      // Clear all cache (HTTP cache, code cache, etc.)
      safeLog('[Memory Monitor] 🧹 Aggressive cache cleanup...');
      await defaultSession.clearCache();
      await defaultSession.clearCodeCaches({});
      safeLog('[Memory Monitor] ✅ Cache cleared');
    } else {
      // Just clear storage data that's not essential
      safeLog('[Memory Monitor] 🧹 Light cache cleanup (storage data)...');
      // No 'quotas' option: it was removed from clearStorageData, and passing it
      // made this light cleanup silently reject every 10 minutes.
      await defaultSession.clearStorageData({
        storages: ['shadercache', 'serviceworkers', 'cachestorage']
      });
    }
  } catch (error) {
    // Silently ignore cache cleanup errors (e.g., EPIPE when stdout is broken)
    if (error.code !== 'EPIPE') {
      try { console.error('[Memory Monitor] Error cleaning cache:', error); } catch (e) {}
    }
  }
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
      const headers = details.responseHeaders;
      if (!headers) return callback({ responseHeaders: headers });

      // Always strip X-Frame-Options — SAMEORIGIN blocks file:// parent in Electron
      delete headers['x-frame-options'];
      delete headers['X-Frame-Options'];

      // Strip CSP frame-ancestors (file:// isn't a valid frame-ancestors source per spec)
      if (headers['content-security-policy'] || headers['Content-Security-Policy']) {
        try {
          const modifyCSP = (headerName) => {
            if (headers[headerName]) {
              const cspArray = Array.isArray(headers[headerName])
                ? headers[headerName]
                : [headers[headerName]];

              const modifiedCSP = cspArray.map(csp => {
                // IMPORTANT: frame-ancestors directive does NOT support file://, app://, or
                // non-network schemes per CSP spec. The wildcard * only matches http/https.
                // Solution: REMOVE any frame-ancestors directive entirely for Electron compatibility.
                if (csp.includes('frame-ancestors')) {
                  return csp.replace(/frame-ancestors\s+[^;]+;?\s*/gi, '').trim();
                }
                return csp;
              });

              headers[headerName] = modifiedCSP;
            }
          };

          modifyCSP('content-security-policy');
          modifyCSP('Content-Security-Policy');
        } catch (error) {
          console.warn('[Main] Error modifying CSP headers:', error);
        }
      }

      callback({ responseHeaders: headers });
    }
  );

  console.log('[Main] Session CSP modification enabled for iframe compatibility (optimized with URL filters)');
}

// App ready
app.whenReady().then(() => {
  console.log(IS_UI_AUDIT ? '[Main] App ready for background UI audit' : '[Main] App ready, showing splash');

  // ── Phase 1: Show splash immediately ─────────────────────────────────────
  // Create splash and YIELD the event loop so Chromium can paint it.
  // Everything else runs after the splash is confirmed visible.
  if (!IS_UI_AUDIT) createSplashWindow();

  // Wait for splash to actually paint before doing heavy work
  function onSplashVisible() {
    console.log('[Main] Splash visible, loading app...');

    // ── Phase 2: Load modules + create main window ───────────────────────
    loadDeferredModules();
    console.log('[Main] Deferred modules loaded');

    setupSessionCSP();
    setupFirstTimeDefaults();

    createWindow();

    // ── Phase 3: Non-critical setup (yield between batches) ──────────────
    // Register IPC handlers that the renderer needs before it can work
    AuthManager.setupHandlers();
    FileManager.setupHandlers();
    DragHandler.setupHandlers();
    setupWindowHandlers();
    setupUiAuditHandlers();
    setupUiZoomHandlers();
    setupPremiereImportHandler();
    setupMediaCacheHandlers();

    const contextMenuHandler = new ContextMenuHandler(mainWindow, store);
    contextMenuHandler.setupHandlers(require('electron').ipcMain);
    console.log('[Main] IPC handlers registered');

    setupDownloadHandler();
    setupPermissionHandlers();
    setupScreenshotHandlers();
    setupQuickToolsHandlers();

    // FFmpeg, Downloader, FileExplorer — IPC handlers must be registered
    // BEFORE the renderer loads, otherwise deferred scripts get "No handler" errors
    setupFFmpegHandlers();
    setupDownloaderHandlers();
    const fileExplorerHandler = FileExplorerHandler.setupHandlers(mainWindow);
    if (ffmpegHandler) {
      fileExplorerHandler.setFFmpegHandler(ffmpegHandler);
    }

    const { setupAgentTerminalHandlers, warmUpAgentTerminal } = require('./agent-terminal-handler');
    setupAgentTerminalHandlers();
    // Pre-warm agent terminal in background (load node-pty + find CLI binary)
    warmUpAgentTerminal();

    // ── Phase 4: Post-show cleanup (after main window content is loaded) ──
    mainWindow.webContents.once('did-finish-load', () => {
      setImmediate(() => {
        // GPU cache cleanup
        const fs = require('fs');
        const gpuCachePath = path.join(app.getPath('userData'), 'GPUCache');
        try {
          if (fs.existsSync(gpuCachePath)) {
            fs.rmSync(gpuCachePath, { recursive: true, force: true });
          }
        } catch (e) {
          // Non-fatal — GPU cache lock by another process is expected on Windows
        }
      });
    });

    // Tray, menu, updater, memory monitor — none block the renderer
    if (!IS_UI_AUDIT) setImmediate(() => {
      createTray();
      createApplicationMenu();
      setupMemoryMonitoring();

      const ENABLE_UPDATER_IN_DEV = true;
      if (process.env.NODE_ENV !== 'development' || ENABLE_UPDATER_IN_DEV) {
        setupAutoUpdater();
        setupUpdaterHandlers();
        console.log('[Main] Auto-updater enabled');
      } else {
        setupUpdaterHandlers();
        console.log('[Main] Auto-updater disabled (development mode)');
      }
    });
  }

  // If splash is ready, it's already shown via ready-to-show handler.
  // Use did-finish-load as the signal that its content is painted.
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.once('did-finish-load', onSplashVisible);
  } else {
    onSplashVisible();
  }
});

// Detect crashes in ANY renderer process — including out-of-process iframes
// (cross-origin <iframe src="app.kolbo.ai">). The webContents-level handler
// in createWindow() only fires for the top-level renderer; OOPIF subframe
// crashes (grey-screen-on-iframe-only) surface here instead.
app.on('render-process-gone', (event, webContents, details) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return;

    // The top-level renderer is handled separately (shows dialog + reloads window).
    if (webContents === mainWindow.webContents) return;

    const url = (() => { try { return webContents.getURL(); } catch { return ''; } })();
    console.error('[Main] Subframe renderer crashed:', details?.reason, 'exit:', details?.exitCode, 'url:', url);

    // Tell the renderer to reload any iframe whose origin matches the dead one.
    // 'clean-exit' fires on normal navigation/teardown — ignore it.
    if (details?.reason && details.reason !== 'clean-exit') {
      try {
        require('./crash-telemetry').reportProcessGone('webapp-iframe', details, { crashed_url: url });
      } catch {}
      mainWindow.webContents.send('iframe-renderer-crashed', { url, reason: details.reason });
    }
  } catch (err) {
    console.error('[Main] Error in app render-process-gone handler:', err);
  }
});

// Child-process-gone fires for utility/GPU/plugin/audio service crashes too.
// We only care about renderer-type crashes here; the rest are recoverable by Chromium.
app.on('child-process-gone', (event, details) => {
  if (details?.type === 'GPU' || details?.type === 'Utility') {
    console.warn('[Main] Child process gone:', details.type, details.reason, 'name:', details.name);
    // GPU-process deaths are a prime suspect for "the app suddenly went grey/blank"
    // reports — count them so we can separate GPU crashes from renderer OOMs.
    if (details.reason && details.reason !== 'clean-exit' && details.reason !== 'killed') {
      try {
        require('./crash-telemetry').reportProcessGone('child-process', details, {
          child_type: details.type,
          child_name: details.name
        });
      } catch {}
    }
  }
});

// Window all closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Activate (macOS) - Re-show window when clicking dock icon
app.on('activate', () => {
  if (IS_UI_AUDIT) return;
  if (mainWindow) {
    mainWindow.show();
  } else if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Quit handler
app.on('before-quit', () => {
  app.isQuitting = true;

  // Clean up tray to release system resources and prevent listener accumulation
  if (tray && !tray.isDestroyed()) {
    tray.removeAllListeners();
    tray.destroy();
    tray = null;
  }
});

console.log('[Main] Kolbo Studio starting...');
console.log('[Main] App version:', app.getVersion());
console.log('[Main] Electron version:', process.versions.electron);
console.log('[Main] Node version:', process.versions.node);
console.log('[Main] User data path:', app.getPath('userData'));
