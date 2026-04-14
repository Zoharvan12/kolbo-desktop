// Kolbo Studio - Agent Terminal Handler
// Spawns the kolbo CLI in a pseudo-terminal and pipes to/from the renderer
// Handles auto-install and auto-update of the CLI

const { ipcMain, app } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const CLI_NPM_PACKAGE = '@kolbo/kolbo-code';
let ptyProcess = null;

// Pre-warm cache: populated by warmUp(), consumed by ensureCli()/getPty()
let _warmCliResult = null;  // { path, status, version } from ensureCli()
let _warmPty = null;        // node-pty module, pre-loaded

function setupAgentTerminalHandlers() {
  // Lazy-load node-pty (uses pre-warmed module if available)
  let pty = _warmPty || null;
  function getPty() {
    if (!pty) {
      try {
        pty = require('node-pty');
        console.log('[AgentTerminal] node-pty loaded successfully');
      } catch (err) {
        console.error('[AgentTerminal] Failed to load node-pty:', err.message);
        throw err;
      }
    }
    return pty;
  }

  // Find the kolbo CLI binary
  function findKolboCli() {
    // 1. Bundled in app resources (packaged app)
    const resourcesDir = process.resourcesPath || path.join(__dirname, '..', '..', 'resources');
    const binaryName = process.platform === 'win32' ? 'kolbo.exe' : 'kolbo';
    const resourcePath = path.join(resourcesDir, binaryName);
    if (fs.existsSync(resourcePath)) {
      console.log('[AgentTerminal] Found CLI in resources:', resourcePath);
      return resourcePath;
    }

    // 2. Common install locations (npm global paths first — they get updated by auto-update)
    const homeDir = os.homedir();
    // Get npm global prefix
    let npmPrefix = '';
    try {
      npmPrefix = execSync('npm config get prefix', { encoding: 'utf-8', timeout: 5000 }).trim();
    } catch (_) {}

    const candidates = process.platform === 'win32'
      ? [
          // npm global installs (updated by auto-update)
          ...(npmPrefix ? [path.join(npmPrefix, 'kolbo.cmd'), path.join(npmPrefix, 'kolbo')] : []),
          path.join(homeDir, '.npm-global', 'kolbo.cmd'),
          path.join(homeDir, 'AppData', 'Roaming', 'npm', 'kolbo.cmd'),
          path.join(homeDir, 'AppData', 'Roaming', 'npm', 'kolbo'),
          // Manual installs (fallback)
          path.join(homeDir, 'bin', 'kolbo.exe'),
          path.join(homeDir, 'bin', 'kolbo'),
          path.join(homeDir, '.kolbo', 'bin', 'kolbo.exe'),
        ]
      : [
          ...(npmPrefix ? [path.join(npmPrefix, 'bin', 'kolbo')] : []),
          '/opt/homebrew/bin/kolbo',       // Homebrew on Apple Silicon
          '/usr/local/bin/kolbo',          // Homebrew on Intel / manual installs
          path.join(homeDir, 'bin', 'kolbo'),
          path.join(homeDir, '.kolbo', 'bin', 'kolbo'),
        ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        console.log('[AgentTerminal] Found CLI at:', p);
        return p;
      }
    }

    // 3. Search PATH
    try {
      const cmd = process.platform === 'win32' ? 'cmd /c where kolbo 2>nul' : 'which kolbo';
      const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim().split('\n')[0].trim();
      if (result && fs.existsSync(result)) {
        console.log('[AgentTerminal] Found CLI in PATH:', result);
        return result;
      }
    } catch (_) {}

    return null;
  }

  // Get installed CLI version
  function getInstalledVersion(cliPath) {
    try {
      const result = execSync(`"${cliPath}" --version`, {
        encoding: 'utf-8',
        timeout: 10000,
        env: { ...process.env, KOLBO_SKIP_UPDATE_CHECK: '1' },
      }).trim();
      // Extract version number (e.g., "1.1.72" from various output formats)
      const match = result.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : null;
    } catch (_) {
      return null;
    }
  }

  // Get latest npm version
  function getLatestNpmVersion() {
    try {
      const result = execSync(`npm view ${CLI_NPM_PACKAGE} version`, {
        encoding: 'utf-8',
        timeout: 15000,
      }).trim();
      return result;
    } catch (_) {
      return null;
    }
  }

  // Install or update CLI via npm
  function installCli() {
    console.log(`[AgentTerminal] Installing/updating ${CLI_NPM_PACKAGE}...`);
    try {
      execSync(`npm i -g ${CLI_NPM_PACKAGE}@latest`, {
        encoding: 'utf-8',
        timeout: 120000,
        stdio: 'pipe',
      });
      console.log('[AgentTerminal] CLI installed/updated successfully');
      return true;
    } catch (err) {
      console.error('[AgentTerminal] Failed to install CLI:', err.message);
      return false;
    }
  }

  // Ensure CLI is installed and up-to-date
  // Returns: { path, status: 'ready'|'updated'|'installed'|'failed', version }
  function ensureCli() {
    // Use pre-warmed result if available (skips expensive findKolboCli + npm prefix lookup)
    let cliPath = (_warmCliResult && _warmCliResult.path) || findKolboCli();

    if (cliPath) {
      const installed = getInstalledVersion(cliPath);
      console.log('[AgentTerminal] Installed version:', installed);

      // Check for updates in background (don't block startup)
      const latest = getLatestNpmVersion();
      console.log('[AgentTerminal] Latest npm version:', latest);

      if (latest && installed && latest !== installed) {
        console.log(`[AgentTerminal] Update available: ${installed} → ${latest}`);
        if (installCli()) {
          // Re-find in case path changed
          cliPath = findKolboCli() || cliPath;
          return { path: cliPath, status: 'updated', version: latest };
        }
      }
      return { path: cliPath, status: 'ready', version: installed };
    }

    // Not installed — install it
    console.log('[AgentTerminal] CLI not found, installing...');
    if (installCli()) {
      cliPath = findKolboCli();
      if (cliPath) {
        const version = getInstalledVersion(cliPath);
        return { path: cliPath, status: 'installed', version };
      }
    }

    return { path: null, status: 'failed', version: null };
  }

  // --- IPC Handlers ---

  // Check/install/update CLI (called before spawn, can show progress to user)
  ipcMain.handle('agent-terminal:ensure-cli', async () => {
    try {
      const result = ensureCli();
      return result;
    } catch (err) {
      return { path: null, status: 'failed', version: null, error: err.message };
    }
  });

  // Spawn the terminal
  ipcMain.handle('agent-terminal:spawn', (event) => {
    if (ptyProcess) {
      return { success: true, message: 'Already running' };
    }

    const { path: kolboPath, status } = ensureCli();
    console.log('[AgentTerminal] CLI path:', kolboPath, 'status:', status);

    if (!kolboPath) {
      return {
        success: false,
        error: 'Kolbo CLI could not be installed.\nMake sure npm is available and try: npm i -g @kolbo-cli/kolbo'
      };
    }

    try {
      const nodePty = getPty();
      const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');

      ptyProcess = nodePty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: os.homedir(),
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          FORCE_COLOR: '3',
        },
      });

      // Launch kolbo CLI
      if (process.platform === 'win32') {
        ptyProcess.write(`& '${kolboPath}'\r`);
      } else {
        ptyProcess.write(`"${kolboPath}"\r`);
      }

      // Forward PTY output to renderer
      ptyProcess.onData((data) => {
        try {
          event.sender.send('agent-terminal:data', data);
        } catch (_) {}
      });

      ptyProcess.onExit(({ exitCode }) => {
        console.log(`[AgentTerminal] Process exited (code=${exitCode})`);
        ptyProcess = null;
        try {
          event.sender.send('agent-terminal:exit', exitCode);
        } catch (_) {}
      });

      console.log('[AgentTerminal] PTY spawned, kolbo starting...');
      return { success: true, status };
    } catch (err) {
      console.error('[AgentTerminal] Failed to spawn:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Input from renderer → PTY
  ipcMain.on('agent-terminal:input', (event, data) => {
    if (ptyProcess) ptyProcess.write(data);
  });

  // Resize
  ipcMain.on('agent-terminal:resize', (event, { cols, rows }) => {
    if (ptyProcess) {
      try { ptyProcess.resize(cols, rows); } catch (_) {}
    }
  });

  // Kill
  ipcMain.handle('agent-terminal:kill', () => {
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }
    return { success: true };
  });

  // Kill on app quit
  app.on('before-quit', () => {
    if (ptyProcess) {
      try { ptyProcess.kill(); } catch (_) {}
      ptyProcess = null;
    }
  });

  console.log('[AgentTerminal] IPC handlers registered');
}

/**
 * Pre-warm the agent terminal in the background:
 * - Load node-pty native module
 * - Find/install the kolbo CLI binary
 * This runs on app startup so the agent tab opens instantly.
 */
function warmUpAgentTerminal() {
  // Run in a setImmediate chain so it doesn't block the event loop
  setImmediate(() => {
    console.log('[AgentTerminal] Background warm-up: loading node-pty...');
    try {
      _warmPty = require('node-pty');
      console.log('[AgentTerminal] Background warm-up: node-pty loaded');
    } catch (err) {
      console.warn('[AgentTerminal] Background warm-up: node-pty failed:', err.message);
    }

    setImmediate(() => {
      console.log('[AgentTerminal] Background warm-up: ensuring CLI...');
      try {
        // Re-implement ensureCli logic here since it's inside setupHandlers scope
        // We just need to find the binary and check versions
        const homeDir = os.homedir();
        const binaryName = process.platform === 'win32' ? 'kolbo.exe' : 'kolbo';
        const resourcesDir = process.resourcesPath || path.join(__dirname, '..', '..', 'resources');
        const resourcePath = path.join(resourcesDir, binaryName);

        let cliPath = null;

        if (fs.existsSync(resourcePath)) {
          cliPath = resourcePath;
        } else {
          // Check common install locations
          let npmPrefix = '';
          try {
            npmPrefix = execSync('npm config get prefix', { encoding: 'utf-8', timeout: 5000 }).trim();
          } catch (_) {}

          const candidates = process.platform === 'win32'
            ? [
                ...(npmPrefix ? [path.join(npmPrefix, 'kolbo.cmd'), path.join(npmPrefix, 'kolbo')] : []),
                path.join(homeDir, '.npm-global', 'kolbo.cmd'),
                path.join(homeDir, 'AppData', 'Roaming', 'npm', 'kolbo.cmd'),
                path.join(homeDir, 'AppData', 'Roaming', 'npm', 'kolbo'),
                path.join(homeDir, 'bin', 'kolbo.exe'),
                path.join(homeDir, 'bin', 'kolbo'),
                path.join(homeDir, '.kolbo', 'bin', 'kolbo.exe'),
              ]
            : [
                ...(npmPrefix ? [path.join(npmPrefix, 'bin', 'kolbo')] : []),
                '/opt/homebrew/bin/kolbo',       // Homebrew on Apple Silicon
                '/usr/local/bin/kolbo',          // Homebrew on Intel / manual installs
                path.join(homeDir, 'bin', 'kolbo'),
                path.join(homeDir, '.kolbo', 'bin', 'kolbo'),
              ];

          for (const p of candidates) {
            if (fs.existsSync(p)) {
              cliPath = p;
              break;
            }
          }

          if (!cliPath) {
            try {
              const cmd = process.platform === 'win32' ? 'cmd /c where kolbo 2>nul' : 'which kolbo';
              const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim().split('\n')[0].trim();
              if (result && fs.existsSync(result)) cliPath = result;
            } catch (_) {}
          }
        }

        if (cliPath) {
          _warmCliResult = { path: cliPath, status: 'ready', version: null };
          console.log('[AgentTerminal] Background warm-up: CLI found at', cliPath);
        } else {
          console.log('[AgentTerminal] Background warm-up: CLI not found (will install on first use)');
        }
      } catch (err) {
        console.warn('[AgentTerminal] Background warm-up: CLI check failed:', err.message);
      }
    });
  });
}

module.exports = { setupAgentTerminalHandlers, warmUpAgentTerminal };
