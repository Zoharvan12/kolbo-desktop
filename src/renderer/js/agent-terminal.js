// Kolbo Studio - Agent Terminal (xterm.js frontend)
// Renders the kolbo CLI TUI inside the Agent tab
console.log('[AgentTerminal] Script loaded. Terminal class:', typeof Terminal, 'window.Terminal:', typeof window.Terminal);

class AgentTerminal {
  constructor() {
    this.terminal = null;
    this.fitAddon = null;
    this.initialized = false;
    this.resizeObserver = null;
    this.kolboReady = false;
    this.kolboReadyResolve = null;
    this.kolboReadyPromise = new Promise(resolve => { this.kolboReadyResolve = resolve; });
  }

  async init(container) {
    console.log('[AgentTerminal] init() called, container:', container?.id, 'initialized:', this.initialized);
    if (this.initialized) return;

    // Resolve xterm classes (UMD module may export to different places)
    const TerminalClass = window.Terminal || (typeof Terminal !== 'undefined' ? Terminal : null);
    console.log('[AgentTerminal] TerminalClass:', TerminalClass ? 'found' : 'NOT FOUND');
    if (!TerminalClass) {
      container.innerHTML = '<div style="padding:20px;color:#ef4444;font-family:monospace;">Error: xterm.js Terminal class not found. Check console.</div>';
      console.error('[AgentTerminal] Terminal class not available. window.Terminal =', window.Terminal);
      return;
    }

    // Create terminal
    this.terminal = new TerminalClass({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
      theme: {
        background: '#0a0a0a',
        foreground: '#e4e4e7',
        cursor: '#e4e4e7',
        cursorAccent: '#0a0a0a',
        selectionBackground: 'rgba(255, 255, 255, 0.2)',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e4e4e7',
        brightBlack: '#52525b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#fafafa',
      },
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: true,
    });

    // Fit addon — auto-resize terminal to container
    const FitAddonClass = (window.FitAddon || {}).FitAddon;
    if (FitAddonClass) {
      this.fitAddon = new FitAddonClass();
      this.terminal.loadAddon(this.fitAddon);
    } else {
      console.warn('[AgentTerminal] FitAddon not available');
    }

    // Try WebGL renderer for performance (falls back to canvas)
    try {
      const WebglAddonClass = (window.WebglAddon || {}).WebglAddon;
      if (WebglAddonClass) {
        const webglAddon = new WebglAddonClass();
        webglAddon.onContextLoss(() => webglAddon.dispose());
        this.terminal.loadAddon(webglAddon);
      }
    } catch (e) {
      console.log('[AgentTerminal] WebGL not available, using canvas renderer');
    }

    // Mount terminal to DOM
    console.log('[AgentTerminal] Opening terminal in container...');
    this.terminal.open(container);
    console.log('[AgentTerminal] Terminal opened');

    // Observe container resizes and fit terminal
    this.resizeObserver = new ResizeObserver(() => {
      this._fit();
    });
    this.resizeObserver.observe(container);

    // Delayed fit — container needs to be visible and have real dimensions
    setTimeout(() => this._fit(), 100);
    setTimeout(() => this._fit(), 500);

    // Drag and drop — paste file/folder paths into terminal
    this._setupDragDrop(container);

    // Handle user input → send to PTY
    this.terminal.onData((data) => {
      window.kolboDesktop.agent.sendInput(data);
    });

    // Handle resize → notify PTY
    this.terminal.onResize(({ cols, rows }) => {
      window.kolboDesktop.agent.resize(cols, rows);
    });

    // Receive PTY output → write to terminal
    let recvCount = 0;
    let kolboReadyTimeout = null;
    window.kolboDesktop.agent.onData((data) => {
      recvCount++;
      if (recvCount <= 5) {
        console.log(`[AgentTerminal] Received data #${recvCount} (${data.length} bytes)`);
      }
      this.terminal.write(data);

      // Detect Kolbo Code ready state: wait for first substantial output with text
      if (!this.kolboReady && data.length > 0) {
        // Clear any existing timeout
        if (kolboReadyTimeout) {
          clearTimeout(kolboReadyTimeout);
        }
        // Kolbo Code is ready after we receive data (CLI has started outputting)
        // Wait a small delay to ensure initial PowerShell/Shell output settles
        kolboReadyTimeout = setTimeout(() => {
          if (!this.kolboReady) {
            this.kolboReady = true;
            console.log('[AgentTerminal] Kolbo Code ready (first output received)');
            if (this.kolboReadyResolve) {
              this.kolboReadyResolve();
            }
          }
        }, 800);
      }
    });

    // Handle PTY exit
    window.kolboDesktop.agent.onExit((exitCode) => {
      this.terminal.write(`\r\n\x1b[90m[Agent exited with code ${exitCode}. Click to restart.]\x1b[0m\r\n`);
      // Allow clicking to restart
      container.style.cursor = 'pointer';
      const restart = () => {
        container.style.cursor = '';
        container.removeEventListener('click', restart);
        this.terminal.clear();
        this.terminal.write('\x1b[90mRestarting agent...\x1b[0m\r\n');
        this._spawn();
      };
      container.addEventListener('click', restart, { once: true });
    });

    // Spawn the PTY process
    const codeLabel = window.KOLBO_WHITELABEL_CODE_LABEL || 'Kolbo Code';
    this.terminal.write(`\x1b[36mChecking ${codeLabel} CLI...\x1b[0m\r\n`);
    await this._spawn();
    this.initialized = true;
  }

  async _spawn() {
    const result = await window.kolboDesktop.agent.spawn();
    if (!result.success) {
      this.terminal.write(`\x1b[31mError: ${result.error}\x1b[0m\r\n`);
    } else if (result.status === 'installed') {
      const cl = window.KOLBO_WHITELABEL_CODE_LABEL || 'Kolbo Code';
      this.terminal.write(`\x1b[32m${cl} CLI installed successfully.\x1b[0m\r\n`);
    } else if (result.status === 'updated') {
      const cl = window.KOLBO_WHITELABEL_CODE_LABEL || 'Kolbo Code';
      this.terminal.write(`\x1b[32m${cl} CLI updated to latest version.\x1b[0m\r\n`);
    }
  }

  _setupDragDrop(container) {
    // Prevent default browser behavior
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.style.outline = '2px solid #3b82f6';
      container.style.outlineOffset = '-2px';
    });

    container.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.style.outline = '';
      container.style.outlineOffset = '';
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.style.outline = '';
      container.style.outlineOffset = '';

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      // Collect all paths (File.path was removed from Electron — resolve via
      // the preload's webUtils bridge, with the legacy property as fallback)
      const paths = [];
      for (let i = 0; i < files.length; i++) {
        const p = window.kolboDesktop?.getPathForFile?.(files[i]) || files[i].path;
        if (p) paths.push(p);
      }

      if (paths.length === 0) return;

      // Type each path into the terminal, space-separated
      // Quote paths that contain spaces
      const formatted = paths.map(p => p.includes(' ') ? `"${p}"` : p).join(' ');
      window.kolboDesktop.agent.sendInput(formatted);

      // Focus the terminal after drop
      this.terminal?.focus();
    });
  }

  _fit() {
    if (this.fitAddon) {
      try {
        this.fitAddon.fit();
      } catch (_) {}
    }
  }

  focus() {
    if (this.terminal) {
      this.terminal.focus();
    }
  }

  dispose() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.terminal) {
      this.terminal.dispose();
    }
    if (window.kolboDesktop?.agent?.kill) {
      window.kolboDesktop.agent.kill();
    }
    this.initialized = false;
  }
}

// Export for use in main.js
window.AgentTerminal = AgentTerminal;
