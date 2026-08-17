// Kolbo Studio - yt-dlp Download Handler
// Handles video/audio downloads from YouTube, Instagram, Twitter, TikTok, and 1000+ sites

const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { app } = require('electron');

// Platform detection mappings
const PLATFORM_PATTERNS = {
  youtube: /(?:youtube\.com|youtu\.be)/i,
  instagram: /instagram\.com/i,
  twitter: /(?:twitter\.com|x\.com)/i,
  tiktok: /tiktok\.com/i,
  facebook: /facebook\.com/i,
  linkedin: /linkedin\.com/i,
  vimeo: /vimeo\.com/i,
  twitch: /twitch\.tv/i,
  dailymotion: /dailymotion\.com/i,
  soundcloud: /soundcloud\.com/i,
  wikimedia: /(?:upload\.wikimedia\.org|commons\.wikimedia\.org)/i
};

// Direct media file extensions that can be downloaded directly
const DIRECT_MEDIA_EXTENSIONS = /\.(mp4|webm|mkv|avi|mov|flv|wmv|m4v|mp3|m4a|wav|ogg|flac|aac)$/i;

// Error classification
const ERROR_TYPES = {
  INVALID_URL: 'invalid_url',
  GEO_RESTRICTED: 'geo_restricted',
  PRIVATE_CONTENT: 'private_content',
  BOT_BLOCKED: 'bot_blocked',
  UNAVAILABLE: 'unavailable',
  FORMAT_UNAVAILABLE: 'format_unavailable',
  NETWORK_ERROR: 'network_error',
  UNKNOWN: 'unknown'
};

// User-friendly error messages
const ERROR_MESSAGES = {
  [ERROR_TYPES.INVALID_URL]: 'Please enter a valid video URL',
  [ERROR_TYPES.GEO_RESTRICTED]: 'This content is not available in your region',
  [ERROR_TYPES.PRIVATE_CONTENT]: 'This content requires sign-in or is age-restricted',
  [ERROR_TYPES.BOT_BLOCKED]: "The site is asking us to verify we're not a bot. Sign into this site (YouTube/Instagram/etc.) in your browser (Chrome, Edge, Brave or Firefox), then try the download again.",
  [ERROR_TYPES.UNAVAILABLE]: 'This content is no longer available',
  [ERROR_TYPES.FORMAT_UNAVAILABLE]: 'Requested quality not available, downloading best alternative',
  [ERROR_TYPES.NETWORK_ERROR]: 'Connection failed. Please check your internet',
  [ERROR_TYPES.UNKNOWN]: 'An unexpected error occurred'
};

// Shared browser-like headers help every extractor look less like a scraper.
const COMMON_EXTRACTOR_ARGS = [
  '--no-check-certificates',
  '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
];

// NOTE: we deliberately do NOT pin youtube:player_client. yt-dlp's own default
// client selection is adaptive and kept current by its maintainers — hardcoding
// clients (tv/web_safari/mweb/…) is routinely WORSE (e.g. the `tv` client is DRM-
// poisoned as of mid-2026, ref yt-dlp#12563). We let the default pick the client and
// solve the real blockers (bot/age/login walls) with the browser-cookie tiers below.

// Platforms that increasingly require a logged-in session — they get the full
// retry ladder (default fetch → yt-dlp update → browser cookies).
const SOCIAL_PLATFORMS = ['youtube', 'instagram', 'facebook', 'twitter', 'tiktok'];

class YtdlpHandler {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.activeDownloads = new Map(); // id -> { process, aborted }
    this.YTDlpWrap = null;
    this.ytdlp = null;
    this.initialized = false;
    this._updatingPromise = null; // dedupe concurrent forceUpdate calls

    // Deno JS runtime state (for YouTube signature/nsig descrambling)
    this._denoReady = false;
    this._denoPath = null;
    this._denoProvisioning = null; // dedupe concurrent ensureDeno calls

    // Initialize yt-dlp
    this.initialize();
  }

  /**
   * Detect whether an error looks like an extractor breakage (YouTube/etc rotated
   * something and the current yt-dlp can't parse it). These are the failures a
   * fresh yt-dlp binary typically fixes.
   */
  isExtractionFailure(errorMessage) {
    const msg = (errorMessage || '').toLowerCase();
    return (
      msg.includes('nsig') ||
      msg.includes('signature') ||
      msg.includes('unable to extract') ||
      msg.includes('failed to extract') ||
      msg.includes('no video formats') ||
      msg.includes('player_response') ||
      msg.includes('http error 403') ||
      msg.includes('http error 429') ||
      msg.includes('precondition check failed') ||
      msg.includes('failed to extract any player response') ||
      msg.includes('unable to download webpage') ||
      // Bot / login gating — a fresh binary or the user's browser cookies usually clears these.
      msg.includes('confirm you') ||           // "Sign in to confirm you're not a bot"
      msg.includes('not a bot') ||
      msg.includes('sign in to confirm') ||
      msg.includes('login required') ||
      msg.includes('requires authentication') ||
      msg.includes('rate-limit') ||
      msg.includes('rate limit') ||
      // Instagram/TikTok "login" walls and generic "temporarily unavailable"
      msg.includes('login') ||
      msg.includes('empty media response') ||
      msg.includes('this video is unavailable') ||
      msg.includes('video is unavailable') ||
      msg.includes('content isn') ||            // "content isn't available"
      msg.includes('temporarily')
    );
  }

  /**
   * A genuinely dead video — no client rotation or cookie will bring it back.
   * We stop the retry ladder early on these to fail fast with an honest message.
   */
  isPermanentlyUnavailable(errorMessage) {
    const msg = (errorMessage || '').toLowerCase();
    return (
      msg.includes('has been removed') ||
      msg.includes('removed by the uploader') ||
      msg.includes('this video has been removed') ||
      msg.includes('account associated with this video has been terminated') ||
      msg.includes('account has been terminated') ||
      msg.includes('video does not exist') ||
      msg.includes('this video is no longer available') ||
      msg.includes('post may have been deleted') ||
      msg.includes('page not found') ||
      msg.includes('http error 404')
    );
  }

  isSocialPlatform(platform) {
    return SOCIAL_PLATFORMS.includes(platform);
  }

  /**
   * Detect which browsers have a profile on this machine so we can pull the user's
   * logged-in session for the cookie fallback tier. Ordered by how reliably yt-dlp
   * can read the cookie store on each OS (Firefox is unencrypted; Chromium on
   * Windows uses App-Bound Encryption which can fail if the browser is running).
   */
  detectInstalledCookieBrowsers() {
    if (this._cookieBrowsersCache) return this._cookieBrowsersCache;

    const home = app.getPath('home');
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

    // name = yt-dlp browser identifier, probe = a path that exists when it's installed
    let candidates;
    if (process.platform === 'win32') {
      candidates = [
        { name: 'firefox', probe: path.join(roaming, 'Mozilla', 'Firefox', 'Profiles') },
        { name: 'brave',   probe: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
        { name: 'edge',    probe: path.join(local, 'Microsoft', 'Edge', 'User Data') },
        { name: 'chrome',  probe: path.join(local, 'Google', 'Chrome', 'User Data') },
      ];
    } else if (process.platform === 'darwin') {
      const appSup = path.join(home, 'Library', 'Application Support');
      candidates = [
        { name: 'firefox', probe: path.join(appSup, 'Firefox', 'Profiles') },
        { name: 'brave',   probe: path.join(appSup, 'BraveSoftware', 'Brave-Browser') },
        { name: 'chrome',  probe: path.join(appSup, 'Google', 'Chrome') },
        { name: 'edge',    probe: path.join(appSup, 'Microsoft Edge') },
        { name: 'safari',  probe: path.join(home, 'Library', 'Cookies') },
      ];
    } else {
      candidates = [
        { name: 'firefox', probe: path.join(home, '.mozilla', 'firefox') },
        { name: 'brave',   probe: path.join(home, '.config', 'BraveSoftware', 'Brave-Browser') },
        { name: 'chrome',  probe: path.join(home, '.config', 'google-chrome') },
      ];
    }

    const found = [];
    for (const c of candidates) {
      try { if (fs.existsSync(c.probe)) found.push(c.name); } catch (_) {}
    }
    console.log('[yt-dlp Handler] Cookie-capable browsers detected:', found.join(', ') || '(none)');
    this._cookieBrowsersCache = found;
    return found;
  }

  /**
   * Build the ordered retry ladder for a URL:
   *   1. robust extractor args (no cookies)  — fast path, fixes most cases
   *   2. same, but with each installed browser's logged-in session (cookies)
   * Non-social platforms get a single plain attempt.
   */
  buildAttempts(platform) {
    // Include the Deno JS runtime when ready — required for reliable YouTube
    // extraction (nsig/signature descrambling). Harmless for other sites.
    const base = [...COMMON_EXTRACTOR_ARGS, ...this.getJsRuntimeArgs()];

    const attempts = [{ label: 'default', args: base }];

    if (this.isSocialPlatform(platform)) {
      for (const browser of this.detectInstalledCookieBrowsers()) {
        attempts.push({
          label: `cookies:${browser}`,
          args: [...base, '--cookies-from-browser', browser]
        });
      }
    }

    return attempts;
  }

  /**
   * Fetch media info through the retry ladder (used for social platforms).
   * Refreshes yt-dlp once on the first extractor breakage, then keeps escalating.
   */
  async getInfoWithLadder(url, platform) {
    // YouTube needs the JS runtime to descramble signatures — make sure Deno is
    // ready before building the attempt args (usually already provisioned on launch).
    if (platform === 'youtube' && !this._denoReady) {
      try { await this.ensureDeno(); } catch (_) {}
    }
    const attempts = this.buildAttempts(platform);
    let i = 0;
    let updated = false;
    let primaryError = null;  // the first (genuine content-access) failure — best for messaging

    while (i < attempts.length) {
      const attempt = attempts[i];
      try {
        console.log(`[yt-dlp Handler] Info attempt ${i + 1}/${attempts.length}: ${attempt.label}`);
        return await this.getVideoInfoWithOptions(url, attempt.args);
      } catch (err) {
        const msg = (err && err.message) || String(err);
        // A cookie tier that can't even read the cookie store (e.g. Windows DPAPI) is an
        // infra failure — don't let it mask the real reason tier 1 failed.
        if (!primaryError || !this.isCookieInfraFailure(msg)) {
          if (!primaryError) primaryError = err;
        }
        console.warn(`[yt-dlp Handler] Info attempt "${attempt.label}" failed:`, msg.substring(0, 200));

        if (this.isPermanentlyUnavailable(msg)) break;

        if (!updated && this.isExtractionFailure(msg)) {
          updated = true;
          try { await this.ensureUpdate(); } catch (_) {}
          continue; // retry the SAME tier against the fresh binary
        }
        i++;
      }
    }

    throw primaryError || new Error('Unable to fetch media info');
  }

  /** A failure to READ a browser's cookie store (not a content problem). */
  isCookieInfraFailure(errorMessage) {
    const msg = (errorMessage || '').toLowerCase();
    return (
      msg.includes('dpapi') ||
      msg.includes('could not copy') ||
      msg.includes('failed to decrypt') ||
      msg.includes('unable to open') && msg.includes('cookie') ||
      msg.includes('could not find') && msg.includes('cookie') ||
      msg.includes('no such') && msg.includes('cookie')
    );
  }

  /**
   * Strip macOS Gatekeeper quarantine attribute from the downloaded binary.
   * Without this, freshly-downloaded yt-dlp_macos can be silently blocked
   * from executing on user machines.
   */
  stripMacQuarantine(binaryPath) {
    if (process.platform !== 'darwin') return;
    try {
      const { execFileSync } = require('child_process');
      execFileSync('xattr', ['-dr', 'com.apple.quarantine', binaryPath], { timeout: 5000 });
      console.log('[yt-dlp Handler] Stripped quarantine attribute from binary');
    } catch (error) {
      // Non-fatal: xattr may not be present or the attribute may not exist
      console.warn('[yt-dlp Handler] xattr cleanup skipped:', error.message);
    }
  }

  /**
   * Dedupe concurrent forceUpdate calls — multiple failing downloads should
   * only trigger one update, then all retry against the freshened binary.
   */
  ensureUpdate() {
    if (!this._updatingPromise) {
      this._updatingPromise = this.forceUpdate().finally(() => {
        this._updatingPromise = null;
      });
    }
    return this._updatingPromise;
  }

  /**
   * Initialize yt-dlp binary
   */
  async initialize() {
    try {
      const YTDlpWrap = require('yt-dlp-wrap').default;
      this.YTDlpWrap = YTDlpWrap;

      // Get binary path - prefer bundled, fallback to download
      const binaryPath = this.getBinaryPath();

      if (fs.existsSync(binaryPath)) {
        console.log('[yt-dlp Handler] Found existing binary:', binaryPath);

        // Defensive: ensure macOS quarantine isn't blocking the existing binary
        this.stripMacQuarantine(binaryPath);

        // Validate the binary works (catches Python version issues, corrupted files, etc.)
        const isValid = await this.validateBinary(binaryPath);
        if (!isValid) {
          console.log('[yt-dlp Handler] Existing binary is invalid, re-downloading...');
          await this.downloadLatestBinary(binaryPath);
        }

        this.ytdlp = new YTDlpWrap(binaryPath);
        this.initialized = true;

        // Always check for latest version on launch (non-blocking)
        this.updateToLatest();
      } else {
        console.log('[yt-dlp Handler] Binary not found, downloading latest...');
        await this.downloadLatestBinary(binaryPath);
        this.ytdlp = new YTDlpWrap(binaryPath);
        this.initialized = true;
      }

      // Provision the Deno JS runtime in the background so YouTube extraction
      // stays first-class (yt-dlp deprecated no-JS-runtime YouTube). Non-blocking.
      this.ensureDeno();

      console.log('[yt-dlp Handler] Initialized successfully');
    } catch (error) {
      console.error('[yt-dlp Handler] Initialization failed:', error);
      this.initialized = false;
    }
  }

  /**
   * Validate that the yt-dlp binary works correctly.
   * Returns false if the binary has issues (wrong Python version, corrupted, etc.)
   */
  async validateBinary(binaryPath) {
    try {
      const { execFileSync } = require('child_process');
      execFileSync(binaryPath, ['--version'], { timeout: 10000 });
      console.log('[yt-dlp Handler] Binary validation passed');
      return true;
    } catch (error) {
      const errorMsg = error.message || error.toString();
      console.warn('[yt-dlp Handler] Binary validation failed:', errorMsg);

      // Check for common issues
      if (errorMsg.includes('unsupported version of Python') ||
          errorMsg.includes('Python') ||
          errorMsg.includes('ImportError') ||
          errorMsg.includes('ModuleNotFoundError')) {
        console.log('[yt-dlp Handler] Binary requires Python - need standalone version');
      }

      return false;
    }
  }

  /**
   * Get the currently installed yt-dlp version
   */
  async getInstalledVersion() {
    try {
      const binaryPath = this.getBinaryPath();
      if (!fs.existsSync(binaryPath)) return null;

      const { execFileSync } = require('child_process');
      const version = execFileSync(binaryPath, ['--version'], { timeout: 10000 }).toString().trim();
      return version;
    } catch (error) {
      console.warn('[yt-dlp Handler] Could not get installed version:', error.message);
      return null;
    }
  }

  /**
   * Get the latest yt-dlp version from GitHub API
   */
  async getLatestVersion() {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: '/repos/yt-dlp/yt-dlp/releases/latest',
        headers: { 'User-Agent': 'KolboStudio' },
        timeout: 15000
      };

      const req = https.get(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const release = JSON.parse(data);
            resolve(release.tag_name || null);
          } catch {
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  }

  /**
   * Update yt-dlp to latest version on every launch (non-blocking).
   * Compares installed version to GitHub latest — re-downloads if different.
   */
  async updateToLatest() {
    try {
      const installedVersion = await this.getInstalledVersion();
      const latestVersion = await this.getLatestVersion();

      console.log(`[yt-dlp Handler] Installed: ${installedVersion}, Latest: ${latestVersion}`);

      if (!latestVersion) {
        console.log('[yt-dlp Handler] Could not check latest version (offline?), skipping update');
        return;
      }

      if (installedVersion === latestVersion) {
        console.log('[yt-dlp Handler] Already up to date');
        return;
      }

      console.log('[yt-dlp Handler] New version available, updating...');
      const binaryPath = this.getBinaryPath();
      await this.downloadLatestBinary(binaryPath);

      // Re-initialize with new binary
      this.ytdlp = new this.YTDlpWrap(binaryPath);
      console.log('[yt-dlp Handler] Updated to latest version');
    } catch (error) {
      console.warn('[yt-dlp Handler] Background update failed (non-critical):', error.message);
      // Non-critical — the existing binary still works
    }
  }

  /**
   * Get the correct yt-dlp binary filename for the current platform.
   * - Windows: yt-dlp.exe
   * - macOS: yt-dlp_macos (standalone binary, no Python required)
   * - Linux: yt-dlp_linux
   */
  getPlatformBinaryName() {
    switch (process.platform) {
      case 'win32':
        return 'yt-dlp.exe';
      case 'darwin':
        return 'yt-dlp_macos';  // Standalone binary, no Python required
      case 'linux':
        return 'yt-dlp_linux';
      default:
        return 'yt-dlp';
    }
  }

  /**
   * Download the latest yt-dlp binary from GitHub releases.
   * Downloads platform-specific standalone binary (no Python required on macOS/Linux).
   * Deletes old binary first to avoid stale/locked file issues.
   */
  async downloadLatestBinary(binaryPath) {
    // Remove old binary if it exists
    try {
      if (fs.existsSync(binaryPath)) {
        fs.unlinkSync(binaryPath);
      }
    } catch (error) {
      // On Windows the file might be locked — rename it instead
      console.warn('[yt-dlp Handler] Could not delete old binary, renaming:', error.message);
      const oldPath = binaryPath + '.old';
      try { fs.unlinkSync(oldPath); } catch {}
      fs.renameSync(binaryPath, oldPath);
    }

    // Download the correct platform-specific binary
    const binaryName = this.getPlatformBinaryName();
    const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binaryName}`;

    console.log(`[yt-dlp Handler] Downloading ${binaryName} from:`, downloadUrl);

    await this.downloadFile(downloadUrl, binaryPath);

    // Make executable on Unix systems
    if (process.platform !== 'win32') {
      fs.chmodSync(binaryPath, 0o755);
    }

    // macOS: strip Gatekeeper quarantine so the binary can actually execute
    this.stripMacQuarantine(binaryPath);

    console.log('[yt-dlp Handler] Downloaded latest binary to:', binaryPath);
  }

  /**
   * Download a file from URL to local path, following redirects.
   */
  downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);

      const request = https.get(url, {
        headers: { 'User-Agent': 'KolboStudio' },
        timeout: 60000 // arms the 'timeout' handler below so a stalled download can't hang
      }, (response) => {
        // Handle redirects (GitHub releases redirect to CDN)
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlinkSync(destPath);
          this.downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });

        file.on('error', (err) => {
          file.close();
          fs.unlinkSync(destPath);
          reject(err);
        });
      });

      request.on('error', (err) => {
        file.close();
        if (fs.existsSync(destPath)) {
          fs.unlinkSync(destPath);
        }
        reject(err);
      });

      request.on('timeout', () => {
        request.destroy();
        file.close();
        if (fs.existsSync(destPath)) {
          fs.unlinkSync(destPath);
        }
        reject(new Error('Download timeout'));
      });
    });
  }

  /**
   * Force update yt-dlp (called after extraction failures)
   */
  async forceUpdate() {
    try {
      console.log('[yt-dlp Handler] Forcing yt-dlp update...');
      const binaryPath = this.getBinaryPath();
      await this.downloadLatestBinary(binaryPath);
      this.ytdlp = new this.YTDlpWrap(binaryPath);
      console.log('[yt-dlp Handler] yt-dlp force-updated successfully');
      return true;
    } catch (error) {
      console.error('[yt-dlp Handler] Failed to force-update yt-dlp:', error);
      return false;
    }
  }

  /**
   * Get yt-dlp binary path
   */
  getBinaryPath() {
    const isWin = process.platform === 'win32';
    const binaryName = isWin ? 'yt-dlp.exe' : 'yt-dlp';

    // Store in app's user data directory
    const userDataPath = app.getPath('userData');
    const binariesPath = path.join(userDataPath, 'binaries');

    // Ensure directory exists
    if (!fs.existsSync(binariesPath)) {
      fs.mkdirSync(binariesPath, { recursive: true });
    }

    return path.join(binariesPath, binaryName);
  }

  // ── Deno JS runtime (YouTube signature/nsig descrambling) ──────────────────
  // As of mid-2026 yt-dlp deprecated no-JS-runtime YouTube extraction: without a
  // JS runtime, formats go missing and downloads fail → the app escalates to the
  // browser-cookie tier (which can't even read Chrome/Edge cookies on Windows,
  // DPAPI). We self-download a Deno binary (same pattern as the yt-dlp binary
  // itself — no installer bloat) and pass `--js-runtimes deno:PATH` so YouTube
  // stays first-class and the browser fallback is rarely needed.

  getDenoBinaryName() {
    return process.platform === 'win32' ? 'deno.exe' : 'deno';
  }

  getDenoPath() {
    const binariesPath = path.join(app.getPath('userData'), 'binaries');
    if (!fs.existsSync(binariesPath)) fs.mkdirSync(binariesPath, { recursive: true });
    return path.join(binariesPath, this.getDenoBinaryName());
  }

  /** GitHub release asset (Deno ships as a per-platform .zip). */
  getDenoAssetName() {
    if (process.platform === 'win32') {
      // No official Windows arm64 build; x64 runs under emulation.
      return 'deno-x86_64-pc-windows-msvc.zip';
    }
    if (process.platform === 'darwin') {
      return process.arch === 'arm64'
        ? 'deno-aarch64-apple-darwin.zip'
        : 'deno-x86_64-apple-darwin.zip';
    }
    return 'deno-x86_64-unknown-linux-gnu.zip';
  }

  /** yt-dlp args enabling the Deno JS runtime, or [] if it isn't ready yet. */
  getJsRuntimeArgs() {
    return this._denoReady && this._denoPath
      ? ['--js-runtimes', `deno:${this._denoPath}`]
      : [];
  }

  validateDeno(denoPath) {
    try {
      const { execFileSync } = require('child_process');
      execFileSync(denoPath, ['--version'], { timeout: 10000 });
      return true;
    } catch (error) {
      console.warn('[yt-dlp Handler] Deno validation failed:', error.message);
      return false;
    }
  }

  /**
   * Ensure a working Deno binary exists (downloads + extracts once, deduped).
   * Sets this._denoReady/_denoPath on success. NEVER throws — YouTube still
   * works via yt-dlp's fallback clients if Deno can't be provisioned.
   */
  ensureDeno() {
    if (this._denoReady) return Promise.resolve(true);
    if (!this._denoProvisioning) {
      this._denoProvisioning = this._provisionDeno().finally(() => {
        this._denoProvisioning = null;
      });
    }
    return this._denoProvisioning;
  }

  async _provisionDeno() {
    try {
      const denoPath = this.getDenoPath();

      // Already downloaded on a previous launch?
      if (fs.existsSync(denoPath) && this.validateDeno(denoPath)) {
        this._denoPath = denoPath;
        this._denoReady = true;
        console.log('[yt-dlp Handler] Deno JS runtime ready:', denoPath);
        return true;
      }

      const asset = this.getDenoAssetName();
      const url = `https://github.com/denoland/deno/releases/latest/download/${asset}`;
      const binariesPath = path.dirname(denoPath);
      const zipPath = path.join(binariesPath, asset);

      console.log('[yt-dlp Handler] Downloading Deno JS runtime:', url);
      await this.downloadFile(url, zipPath);
      await this._extractDeno(zipPath, binariesPath);
      try { fs.unlinkSync(zipPath); } catch (_) {}

      if (process.platform !== 'win32') {
        try { fs.chmodSync(denoPath, 0o755); } catch (_) {}
      }
      this.stripMacQuarantine(denoPath);

      if (fs.existsSync(denoPath) && this.validateDeno(denoPath)) {
        this._denoPath = denoPath;
        this._denoReady = true;
        console.log('[yt-dlp Handler] Deno JS runtime provisioned:', denoPath);
        return true;
      }

      console.warn('[yt-dlp Handler] Deno provisioning did not yield a working binary');
      return false;
    } catch (error) {
      console.warn('[yt-dlp Handler] Deno provisioning failed (non-critical):', error.message);
      return false;
    }
  }

  /**
   * Extract the deno binary from its release .zip using the platform's bundled
   * bsdtar (Windows System32 tar.exe + macOS /usr/bin/tar are both libarchive,
   * which unpacks .zip). Extracts just the binary; falls back to a full extract.
   */
  _extractDeno(zipPath, destDir) {
    return new Promise((resolve, reject) => {
      const { execFile } = require('child_process');
      const tarBin = process.platform === 'win32'
        ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
        : 'tar';
      const denoName = this.getDenoBinaryName();

      execFile(tarBin, ['-xf', zipPath, '-C', destDir, denoName], { timeout: 60000 }, (error) => {
        if (!error) return resolve();
        // Fallback: extract the whole archive (still just contains the binary)
        execFile(tarBin, ['-xf', zipPath, '-C', destDir], { timeout: 60000 }, (err2) => {
          if (err2) reject(new Error('Deno unzip failed: ' + (err2.message || error.message)));
          else resolve();
        });
      });
    });
  }

  /**
   * Detect platform from URL
   */
  detectPlatform(url) {
    for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
      if (pattern.test(url)) {
        return platform;
      }
    }
    return 'other';
  }

  /**
   * Check if URL is a direct media file
   */
  isDirectMediaUrl(url) {
    return DIRECT_MEDIA_EXTENSIONS.test(url);
  }

  /**
   * Get file extension from direct URL
   */
  getExtensionFromUrl(url) {
    const match = url.match(DIRECT_MEDIA_EXTENSIONS);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Classify error type from yt-dlp error message
   */
  classifyError(errorMessage) {
    const msg = errorMessage.toLowerCase();

    if (msg.includes('is not a valid url') || msg.includes('unsupported url')) {
      return ERROR_TYPES.INVALID_URL;
    }
    // Bot / "confirm you're not a bot" gating — check BEFORE private/unavailable so it
    // isn't mislabeled "no longer available". This is fixable by the user's browser session.
    if (msg.includes('not a bot') || msg.includes('confirm you') || msg.includes('sign in to confirm') ||
        msg.includes('rate-limit') || msg.includes('rate limit') || msg.includes('too many requests')) {
      return ERROR_TYPES.BOT_BLOCKED;
    }
    if (msg.includes('geo') || msg.includes('not available in your country') || msg.includes('blocked in your')) {
      return ERROR_TYPES.GEO_RESTRICTED;
    }
    // Genuinely removed/dead content (checked before the softer auth wall so a truly
    // deleted video reports honestly rather than "please sign in").
    if (msg.includes('has been removed') || msg.includes('removed by the uploader') ||
        msg.includes('account associated') || msg.includes('account has been terminated') ||
        msg.includes('does not exist') || msg.includes('no longer available') ||
        msg.includes('deleted') || msg.includes('http error 404')) {
      return ERROR_TYPES.UNAVAILABLE;
    }
    // Auth/age walls — often clearable with a logged-in browser session.
    if (msg.includes('private') || msg.includes('sign in') || msg.includes('login') ||
        msg.includes('authentication') || msg.includes('age') || msg.includes('confirm your age') ||
        msg.includes('members only') || msg.includes('join this channel') ||
        msg.includes('log in') || msg.includes('requires authentication')) {
      return ERROR_TYPES.PRIVATE_CONTENT;
    }
    if (msg.includes('unavailable') || msg.includes('video is unavailable')) {
      return ERROR_TYPES.UNAVAILABLE;
    }
    if (msg.includes('format') || msg.includes('quality')) {
      return ERROR_TYPES.FORMAT_UNAVAILABLE;
    }
    if (msg.includes('network') || msg.includes('connection') || msg.includes('timeout') ||
        msg.includes('unable to download') || msg.includes('urlopen error') || msg.includes('getaddrinfo')) {
      return ERROR_TYPES.NETWORK_ERROR;
    }

    return ERROR_TYPES.UNKNOWN;
  }

  /**
   * Get detailed error message with hints
   */
  getDetailedErrorMessage(errorMessage, url) {
    const errorType = this.classifyError(errorMessage);
    const baseMessage = this.getErrorMessage(errorType);
    const platform = this.detectPlatform(url);

    // Bot-block is the most common social-download failure — give a clear next step.
    if (errorType === ERROR_TYPES.BOT_BLOCKED) {
      return baseMessage;
    }

    if (this.isSocialPlatform(platform)) {
      if (errorType === ERROR_TYPES.UNKNOWN) {
        const lower = (errorMessage || '').toLowerCase();
        if (this.isExtractionFailure(lower)) {
          return "We couldn't reach this content. Try again in a moment — if it keeps failing, sign into the site in your browser (Chrome/Edge/Brave/Firefox) and retry.";
        }
      }
    }

    return baseMessage;
  }

  /**
   * Get user-friendly error message
   */
  getErrorMessage(errorType) {
    return ERROR_MESSAGES[errorType] || ERROR_MESSAGES[ERROR_TYPES.UNKNOWN];
  }

  /**
   * Fetch media information from URL
   */
  async getMediaInfo(url, _retried = false) {
    console.log('[yt-dlp Handler] Fetching info for:', url, _retried ? '(retry)' : '');

    // For direct media URLs, we can provide basic info without yt-dlp
    if (this.isDirectMediaUrl(url)) {
      console.log('[yt-dlp Handler] Direct media URL detected, providing basic info');
      return this.getDirectMediaInfo(url);
    }

    if (!this.initialized || !this.ytdlp) {
      await this.initialize();
      if (!this.initialized || !this.ytdlp) {
        throw new Error('yt-dlp is not initialized');
      }
    }

    const platform = this.detectPlatform(url);

    try {
      let info;

      // Social platforms (YouTube/Instagram/TikTok/…) run the full retry ladder:
      // robust extractor args → yt-dlp self-update → the user's browser session.
      if (this.isSocialPlatform(platform)) {
        console.log('[yt-dlp Handler] Using retry ladder for', platform);
        info = await this.getInfoWithLadder(url, platform);
      } else {
        info = await this.ytdlp.getVideoInfo(url);
      }

      // Parse available formats
      const formats = this.parseFormats(info.formats || []);

      const mediaInfo = {
        id: info.id,
        title: info.title || 'Untitled',
        description: info.description || '',
        thumbnail: info.thumbnail || this.getBestThumbnail(info.thumbnails),
        duration: info.duration || 0,
        uploader: info.uploader || info.channel || 'Unknown',
        uploadDate: info.upload_date || null,
        viewCount: info.view_count || 0,
        platform: platform,
        url: url,
        originalUrl: info.original_url || url,
        formats: formats,
        isLive: info.is_live || false
      };

      console.log('[yt-dlp Handler] Media info fetched:', {
        title: mediaInfo.title,
        duration: mediaInfo.duration,
        platform: mediaInfo.platform,
        formatsCount: formats.videoFormats.length + formats.audioFormats.length
      });

      return mediaInfo;
    } catch (error) {
      console.error('[yt-dlp Handler] Failed to fetch info:', error);
      const errorMessage = error.message || error.toString();
      const errorType = this.classifyError(errorMessage);

      // Self-heal: extractor breakage → update yt-dlp and retry once.
      // Social platforms already updated inside the ladder, so only do this for the rest.
      if (!_retried && !this.isSocialPlatform(platform) && this.isExtractionFailure(errorMessage)) {
        console.log('[yt-dlp Handler] Extraction failure detected, updating yt-dlp and retrying...');
        try {
          const updated = await this.ensureUpdate();
          if (updated) {
            return await this.getMediaInfo(url, true);
          }
        } catch (updateError) {
          console.warn('[yt-dlp Handler] Update during getMediaInfo failed:', updateError.message);
        }
      }

      throw {
        type: errorType,
        message: this.getDetailedErrorMessage(errorMessage, url),
        originalError: errorMessage
      };
    }
  }

  /**
   * Get video info with custom options (for YouTube, etc.)
   * Uses child_process.execFile directly for reliable stdout/stderr capture.
   */
  async getVideoInfoWithOptions(url, extraOptions = []) {
    const binaryPath = this.getBinaryPath();
    if (!fs.existsSync(binaryPath)) {
      throw new Error('yt-dlp binary not found');
    }

    const args = [
      '--dump-json',
      '--no-playlist',
      ...extraOptions,
      url
    ];

    console.log('[yt-dlp Handler] Running:', binaryPath, args.join(' '));

    return new Promise((resolve, reject) => {
      const { execFile } = require('child_process');

      execFile(binaryPath, args, { maxBuffer: 50 * 1024 * 1024, timeout: 60000 }, (error, stdout, stderr) => {
        if (stderr) {
          console.warn('[yt-dlp Handler] stderr:', stderr.substring(0, 500));
        }

        if (error) {
          console.error('[yt-dlp Handler] getVideoInfo error (code ' + error.code + '):', stderr || error.message);
          reject(new Error(stderr || error.message));
          return;
        }

        try {
          if (stdout && stdout.trim()) {
            const info = JSON.parse(stdout);
            resolve(info);
          } else {
            console.error('[yt-dlp Handler] No stdout. stderr:', stderr);
            reject(new Error(stderr || 'No output from yt-dlp'));
          }
        } catch (parseError) {
          console.error('[yt-dlp Handler] JSON parse error:', parseError.message);
          console.error('[yt-dlp Handler] Raw stdout (first 500 chars):', (stdout || '').substring(0, 500));
          reject(new Error(stderr || 'Failed to parse video info'));
        }
      });
    });
  }

  /**
   * Get basic media info for direct URLs (without yt-dlp)
   */
  getDirectMediaInfo(url) {
    try {
      const parsedUrl = new URL(url);
      const pathname = parsedUrl.pathname;
      const filename = path.basename(pathname);
      const ext = this.getExtensionFromUrl(url);

      // Extract title from filename (remove extension)
      const title = filename.replace(DIRECT_MEDIA_EXTENSIONS, '') || 'Direct Media';

      // Determine if it's audio or video based on extension
      const audioExtensions = ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac'];
      const isAudio = audioExtensions.includes(ext);

      return {
        id: Buffer.from(url).toString('base64').substring(0, 16),
        title: decodeURIComponent(title.replace(/_/g, ' ')),
        description: 'Direct media file',
        thumbnail: null,
        duration: 0,
        uploader: parsedUrl.hostname,
        uploadDate: null,
        viewCount: 0,
        platform: this.detectPlatform(url),
        url: url,
        originalUrl: url,
        formats: {
          videoFormats: isAudio ? [] : [{
            formatId: 'direct',
            quality: 'Original',
            height: 0,
            ext: ext || 'mp4',
            filesize: null,
            hasAudio: true
          }],
          audioFormats: isAudio ? [{
            formatId: 'direct',
            quality: 'Original',
            bitrate: 0,
            ext: ext || 'mp3',
            filesize: null
          }] : []
        },
        isLive: false,
        isDirectUrl: true
      };
    } catch (error) {
      console.error('[yt-dlp Handler] Error parsing direct URL:', error);
      throw {
        type: ERROR_TYPES.INVALID_URL,
        message: this.getErrorMessage(ERROR_TYPES.INVALID_URL),
        originalError: error.message
      };
    }
  }

  /**
   * Get best thumbnail from thumbnails array
   */
  getBestThumbnail(thumbnails) {
    if (!thumbnails || !thumbnails.length) return null;

    // Sort by preference (maxres > high > medium > default)
    const sorted = thumbnails.sort((a, b) => {
      const aSize = (a.width || 0) * (a.height || 0);
      const bSize = (b.width || 0) * (b.height || 0);
      return bSize - aSize;
    });

    return sorted[0]?.url || null;
  }

  /**
   * Parse available formats from yt-dlp
   */
  parseFormats(formats) {
    const videoFormats = [];
    const audioFormats = [];

    const seenVideoQualities = new Set();
    const seenAudioQualities = new Set();

    for (const format of formats) {
      // Skip formats without proper codec info
      if (!format.vcodec && !format.acodec) continue;

      const hasVideo = format.vcodec && format.vcodec !== 'none';
      const hasAudio = format.acodec && format.acodec !== 'none';

      if (hasVideo) {
        const height = format.height || 0;
        const quality = this.getVideoQualityLabel(height);

        // Only add unique quality levels
        if (quality && !seenVideoQualities.has(quality)) {
          seenVideoQualities.add(quality);
          videoFormats.push({
            formatId: format.format_id,
            quality: quality,
            height: height,
            ext: format.ext || 'mp4',
            filesize: format.filesize || format.filesize_approx || null,
            hasAudio: hasAudio
          });
        }
      }

      if (hasAudio && !hasVideo) {
        const abr = format.abr || format.tbr || 0;
        const quality = this.getAudioQualityLabel(abr);

        if (quality && !seenAudioQualities.has(quality)) {
          seenAudioQualities.add(quality);
          audioFormats.push({
            formatId: format.format_id,
            quality: quality,
            bitrate: abr,
            ext: format.ext || 'mp3',
            filesize: format.filesize || format.filesize_approx || null
          });
        }
      }
    }

    // Sort by quality (highest first)
    videoFormats.sort((a, b) => b.height - a.height);
    audioFormats.sort((a, b) => b.bitrate - a.bitrate);

    return {
      videoFormats,
      audioFormats
    };
  }

  /**
   * Get video quality label
   */
  getVideoQualityLabel(height) {
    if (height >= 2160) return '4K (2160p)';
    if (height >= 1440) return '1440p';
    if (height >= 1080) return '1080p';
    if (height >= 720) return '720p';
    if (height >= 480) return '480p';
    if (height >= 360) return '360p';
    if (height > 0) return `${height}p`;
    return null;
  }

  /**
   * Get audio quality label
   */
  getAudioQualityLabel(bitrate) {
    if (bitrate >= 256) return 'High (320kbps)';
    if (bitrate >= 160) return 'Standard (192kbps)';
    if (bitrate >= 96) return 'Low (128kbps)';
    if (bitrate > 0) return `${Math.round(bitrate)}kbps`;
    return null;
  }

  /** Notify the renderer that we're escalating to another download strategy. */
  _sendRetry(jobId, reason) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('dl:retry', { jobId, reason });
    }
  }

  /**
   * Download media through the retry ladder.
   *   Tier 1: robust extractor args (no cookies)
   *   Tier 2: first extractor breakage → refresh yt-dlp once, retry same tier
   *   Tier 3+: the user's logged-in browser session (one tier per installed browser)
   * The direct-HTTP fallback and genuine-removal fast-fail are handled around the ladder.
   */
  async downloadMedia(job) {
    const { id, url, outputFolder, title } = job;

    console.log('[yt-dlp Handler] Starting download:', {
      id, url, format: job.outputFormat, quality: job.quality, outputFolder
    });

    // Direct media URL — try a plain HTTP download first for efficiency
    if (this.isDirectMediaUrl(url)) {
      console.log('[yt-dlp Handler] Direct media URL detected, using direct download');
      try {
        return await this.downloadDirectUrl(job);
      } catch (directError) {
        console.warn('[yt-dlp Handler] Direct download failed, falling back to yt-dlp:', directError.message);
      }
    }

    if (!this.initialized || !this.ytdlp) {
      await this.initialize();
      if (!this.initialized || !this.ytdlp) {
        if (this.isDirectMediaUrl(url)) return this.downloadDirectUrl(job);
        throw new Error('yt-dlp is not initialized');
      }
    }

    const platform = this.detectPlatform(url);

    // YouTube needs the Deno JS runtime for signature descrambling — ensure it's
    // ready before building attempts (background-provisioned on launch already).
    if (platform === 'youtube' && !this._denoReady) {
      try { await this.ensureDeno(); } catch (_) {}
    }
    const attempts = this.buildAttempts(platform);

    let i = 0;
    let updated = false;
    let primaryError = null;  // first genuine failure — best for the final user message

    while (i < attempts.length) {
      const attempt = attempts[i];
      try {
        if (i > 0) {
          this._sendRetry(id, attempt.label.startsWith('cookies')
            ? 'Trying with your browser sign-in…'
            : 'Retrying with a more robust method…');
        }
        console.log(`[yt-dlp Handler] Download attempt ${i + 1}/${attempts.length} [${id}]: ${attempt.label}`);

        const outputPath = await this._runDownloadAttempt(job, attempt.args);

        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('dl:complete', { jobId: id, outputPath });
        }
        return outputPath;
      } catch (err) {
        if (err && err.aborted) throw err; // cancelled — dl:cancelled already sent
        const msg = (err && (err.originalError || err.message)) || String(err);
        // Ignore cookie-store read failures (e.g. Windows DPAPI) for messaging — keep the
        // first real content-access error as the reported cause.
        if (!primaryError && !this.isCookieInfraFailure(msg)) primaryError = err;
        console.warn(`[yt-dlp Handler] Attempt "${attempt.label}" failed [${id}]:`, msg.substring(0, 200));

        // Direct-HTTP fallback for simple media URLs
        if (this.isDirectMediaUrl(url)) {
          try {
            const outputPath = await this.downloadDirectUrl(job);
            return outputPath; // downloadDirectUrl sends its own dl:complete
          } catch (_) {}
        }

        // Genuinely removed → no tier will help, fail fast
        if (this.isPermanentlyUnavailable(msg)) break;

        // First extractor breakage → refresh yt-dlp once, retry the SAME tier
        if (!updated && this.isExtractionFailure(msg)) {
          updated = true;
          this._sendRetry(id, 'Updating extractor and retrying…');
          try { await this.ensureUpdate(); } catch (_) {}
          continue;
        }
        i++;
      }
    }

    // Ladder exhausted — report an honest, actionable error
    const finalMsg = (primaryError && (primaryError.originalError || primaryError.message)) || 'Download failed';
    const errorType = this.classifyError(finalMsg);
    const userMsg = this.getDetailedErrorMessage(finalMsg, url);

    const sanitizedTitle = title ? title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100) : '';
    if (sanitizedTitle) this.cleanupTempFiles(outputFolder, sanitizedTitle);

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('dl:error', { jobId: id, error: userMsg, errorType });
    }
    throw { type: errorType, message: userMsg, originalError: finalMsg };
  }

  /**
   * Run a single download attempt with the given extra yt-dlp args.
   * Resolves with the finished output path, or rejects with { message, originalError }
   * (or { aborted:true } if the user cancelled). Does NOT send dl:complete/dl:error —
   * the ladder in downloadMedia owns final success/failure reporting.
   */
  _runDownloadAttempt(job, extraArgs = []) {
    const { id, url, outputFormat, quality, outputFolder, title } = job;

    const sanitizedTitle = title ? title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100) : '%(title)s';
    const outputTemplate = path.join(outputFolder, `${sanitizedTitle}.%(ext)s`);

    const options = this.buildDownloadOptions(outputFormat, quality, outputTemplate);
    if (extraArgs && extraArgs.length) options.push(...extraArgs);

    return new Promise((resolve, reject) => {
      try {
        const downloadState = { aborted: false };
        let hasError = false; // prevent 'close' from firing a false complete after an error

        // ── Progress phase tracking ─────────────────────────────────────────────
        // yt-dlp downloads separate streams sequentially (e.g. video then audio).
        // Each stream resets the percentage from 0. We detect resets and scale the
        // reported progress across all phases so the bar never jumps backward.
        const isAudioOnly = outputFormat === 'mp3';
        let downloadPhase = 0;    // increments when we detect a reset
        let prevRawPercent = -1;

        const scalePercent = (rawPercent) => {
          if (isAudioOnly) return Math.round(rawPercent * 0.80);   // download 0-80%, convert after
          if (downloadPhase === 0) return Math.round(rawPercent * 0.60);  // video → 0-60%
          return Math.round(60 + rawPercent * 0.20);               // audio → 60-80%
        };

        const sendProgress = (scaledPercent, extra = {}) => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('dl:progress', { jobId: id, progress: scaledPercent, ...extra });
          }
        };

        // Locate the finished file and convert/remux it to the requested format.
        // Shared by the clean-exit path AND the error path below — yt-dlp can exit
        // non-zero on a trailing post-processing hiccup (thumbnail embed, metadata
        // write, temp-file cleanup racing a Windows AV lock) even though the actual
        // media finished downloading intact, so both paths need to check for a
        // real output file before deciding success or failure.
        const finalizeOutput = async () => {
          sendProgress(82, { status: 'Finalizing...' });

          let outputPath = this.findOutputFile(outputFolder, sanitizedTitle, outputFormat);

          if (outputFormat === 'mp3') {
            // yt-dlp normally handles m4a→mp3 internally; if it left a non-mp3, convert it.
            if (outputPath && !outputPath.endsWith('.mp3') && fs.existsSync(outputPath)) {
              const mp3Target = path.join(outputFolder, `${sanitizedTitle}.mp3`);
              try {
                outputPath = await this.convertToMp3WithFfmpeg(outputPath, mp3Target, id, quality);
              } catch (convErr) {
                console.warn('[yt-dlp Handler] ffmpeg MP3 conversion failed, keeping original:', convErr.message);
              }
            }
          } else {
            // If yt-dlp left a .webm/.mkv (merge failed internally), remux to mp4.
            if (outputPath && !outputPath.endsWith('.mp4') && fs.existsSync(outputPath)) {
              const remuxTarget = path.join(outputFolder, `${sanitizedTitle}.mp4`);
              try {
                outputPath = await this.remuxWithFfmpeg(outputPath, remuxTarget, id);
              } catch (remuxErr) {
                console.warn('[yt-dlp Handler] ffmpeg remux failed, keeping original:', remuxErr.message);
              }
            }
          }

          return outputPath;
        };

        const downloadProcess = this.ytdlp.exec([url, ...options])
          .on('progress', (progress) => {
            if (downloadState.aborted || hasError) return;

            const rawPercent = progress.percent || 0;
            // Detect stream reset: a big drop in percentage means a new stream started
            if (prevRawPercent > 10 && rawPercent < prevRawPercent - 10) {
              downloadPhase++;
              console.log(`[yt-dlp Handler] Phase reset detected [${id}], now phase ${downloadPhase}`);
            }
            prevRawPercent = rawPercent;

            const scaledPercent = scalePercent(rawPercent);
            sendProgress(scaledPercent, {
              downloadedBytes: this.parseSize(progress.totalSize),
              speed: progress.currentSpeed || null,
              eta: progress.eta || null
            });
          })
          .on('ytDlpEvent', (eventType, eventData) => {
            console.log(`[yt-dlp Handler] Event [${id}]:`, eventType, eventData);
          })
          .on('error', async (error) => {
            if (downloadState.aborted) { reject({ aborted: true }); return; }
            hasError = true;
            this.activeDownloads.delete(id);

            // yt-dlp exited non-zero — but check whether the media actually
            // finished before reporting a failure the user didn't really have.
            const outputPath = await finalizeOutput().catch(() => null);
            if (outputPath && this.validateOutputFile(outputPath)) {
              console.warn('[yt-dlp Handler] Non-zero exit but a valid output file exists — treating as success:', outputPath);
              resolve(outputPath);
              return;
            }

            console.error('[yt-dlp Handler] Download attempt error:', error);
            this.cleanupTempFiles(outputFolder, sanitizedTitle);

            const errorMessage = error.message || error.toString();
            reject({ message: errorMessage, originalError: errorMessage });
          })
          .on('close', async () => {
            if (downloadState.aborted) { reject({ aborted: true }); return; }
            if (hasError) return;

            console.log('[yt-dlp Handler] yt-dlp process closed:', id);
            this.activeDownloads.delete(id);

            const outputPath = await finalizeOutput();

            // Validate the produced file; a missing/tiny file is a failed attempt.
            if (!this.validateOutputFile(outputPath)) {
              console.error('[yt-dlp Handler] Output file missing or invalid:', outputPath);
              this.cleanupTempFiles(outputFolder, sanitizedTitle);
              reject({ message: 'Output file missing after download', originalError: 'output file missing or corrupt' });
              return;
            }

            resolve(outputPath);
          });

        this.activeDownloads.set(id, { process: downloadProcess, state: downloadState });

      } catch (error) {
        console.error('[yt-dlp Handler] Setup error:', error);
        reject({ message: error.message || String(error), originalError: error.message || String(error) });
      }
    });
  }

  /**
   * Build download options based on format and quality
   */
  buildDownloadOptions(outputFormat, quality, outputTemplate) {
    const options = [
      '-o', outputTemplate,
      '--no-playlist',
      '--no-mtime',
      '--progress',
      // ── Resilience: ride out transient failures (429, 5xx, fragment drops) ──
      '--retries', '10',
      '--fragment-retries', '20',
      '--extractor-retries', '5',
      '--retry-sleep', '3',
      '--socket-timeout', '30',
      '--concurrent-fragments', '4',
      '--newline', // flush one progress line per update — required for real-time reporting
    ];

    // Always provide the bundled ffmpeg so merging always works
    const ffmpegPath = this.getFfmpegPath();
    if (ffmpegPath) {
      options.push('--ffmpeg-location', ffmpegPath);
    }

    if (outputFormat === 'mp3') {
      options.push(
        '-x',
        '--audio-format', 'mp3'
      );

      if (quality === 'high' || quality === '320') {
        options.push('--audio-quality', '0');
      } else if (quality === 'standard' || quality === '192') {
        options.push('--audio-quality', '5');
      } else if (quality === 'low' || quality === '128') {
        options.push('--audio-quality', '9');
      } else {
        options.push('--audio-quality', '0');
      }
    } else {
      options.push(
        '--merge-output-format', 'mp4',
        '--remux-video', 'mp4',
        '--embed-metadata',
        '--no-keep-video'
      );

      // ── Format selection strategy ────────────────────────────────────────────
      // YouTube 4K/1440p is VP9 (vp09) or AV1 (av01) only — H.264 (avc1) doesn't
      // exist at those resolutions. For 1080p and below, H.264 is available and
      // preferred for editor compatibility. Always fall back to bestvideo+bestaudio
      // so merging (with ffmpeg above) is the last resort rather than nothing.
      let formatString;

      if (quality === 'best' || quality === 'Best Available' || quality === 'Best Available (Auto)') {
        // Prefer combined H.264+AAC, then best separate streams
        formatString = 'best[vcodec^=avc1][acodec^=mp4a]/bestvideo[vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo+bestaudio[ext=m4a]/bestvideo+bestaudio/best';

      } else if (quality === '4k' || quality === '2160' || quality === '4K (2160p)') {
        // 4K on YouTube is VP9 (313) or AV1 (401) + m4a (140) — never H.264
        formatString = [
          'bestvideo[height<=2160][vcodec^=vp09]+bestaudio[ext=m4a]',
          'bestvideo[height<=2160][vcodec^=av01]+bestaudio[ext=m4a]',
          'bestvideo[height<=2160][vcodec^=vp09]+bestaudio',
          'bestvideo[height<=2160]+bestaudio[ext=m4a]',
          'bestvideo[height<=2160]+bestaudio',
          'bestvideo+bestaudio',
          'best'
        ].join('/');

      } else if (quality === '1440' || quality === '1440p') {
        // 1440p is also usually VP9 on YouTube
        formatString = [
          'bestvideo[height<=1440][vcodec^=vp09]+bestaudio[ext=m4a]',
          'bestvideo[height<=1440][vcodec^=av01]+bestaudio[ext=m4a]',
          'bestvideo[height<=1440]+bestaudio[ext=m4a]',
          'bestvideo[height<=1440]+bestaudio',
          'bestvideo+bestaudio',
          'best'
        ].join('/');

      } else if (quality === '1080' || quality === '1080p') {
        // 1080p: prefer H.264, fall back gracefully
        formatString = [
          'bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]',
          'bestvideo[height<=1080][vcodec^=avc1]+bestaudio',
          'bestvideo[height<=1080]+bestaudio[ext=m4a]',
          'bestvideo[height<=1080]+bestaudio',
          'best[height<=1080]',
          'best'
        ].join('/');

      } else if (quality === '720' || quality === '720p') {
        formatString = [
          'best[height<=720][vcodec^=avc1][acodec^=mp4a]',
          'bestvideo[height<=720][vcodec^=avc1]+bestaudio[ext=m4a]',
          'bestvideo[height<=720]+bestaudio[ext=m4a]',
          'bestvideo[height<=720]+bestaudio',
          'best[height<=720]',
          'best'
        ].join('/');

      } else if (quality === '480' || quality === '480p') {
        formatString = [
          'best[height<=480][vcodec^=avc1][acodec^=mp4a]',
          'bestvideo[height<=480][vcodec^=avc1]+bestaudio[ext=m4a]',
          'bestvideo[height<=480]+bestaudio',
          'best[height<=480]',
          'best'
        ].join('/');

      } else {
        // Fallback / unknown quality: best available with merge support
        formatString = 'bestvideo[vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo+bestaudio[ext=m4a]/bestvideo+bestaudio/best';
      }

      options.push('-f', formatString);
    }

    return options;
  }

  /**
   * Parse size string to bytes
   */
  parseSize(sizeStr) {
    if (!sizeStr) return null;
    if (typeof sizeStr === 'number') return sizeStr;

    const match = sizeStr.match(/^([\d.]+)\s*(KiB|MiB|GiB|B)?$/i);
    if (!match) return null;

    const value = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();

    switch (unit) {
      case 'GIB': return value * 1024 * 1024 * 1024;
      case 'MIB': return value * 1024 * 1024;
      case 'KIB': return value * 1024;
      default: return value;
    }
  }

  /**
   * Find the actual output file after download.
   * yt-dlp may produce .mp4, .webm, .mkv, or .mp3 depending on what was available.
   * Returns null if nothing found (caller should treat that as an error).
   */
  findOutputFile(folder, baseName, format) {
    // Exact expected path first
    const preferredExt = format === 'mp3' ? 'mp3' : 'mp4';
    const expectedPath = path.join(folder, `${baseName}.${preferredExt}`);
    if (fs.existsSync(expectedPath)) return expectedPath;

    // Scan folder for any file matching the base name with a video/audio extension.
    // Exclude .part files — those are incomplete downloads.
    const videoExts = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v'];
    const audioExts = ['mp3', 'm4a', 'ogg', 'opus', 'aac', 'flac', 'wav'];
    const allowedExts = format === 'mp3' ? audioExts : [...videoExts, ...audioExts];

    try {
      const prefix = baseName.substring(0, 50);
      const files = fs.readdirSync(folder);

      // First pass: prefer mp4/mp3 exact match anywhere in the listing
      for (const f of files) {
        if (f.startsWith(prefix) && f.endsWith(`.${preferredExt}`) && !f.includes('.part')) {
          return path.join(folder, f);
        }
      }

      // Second pass: any allowed extension.
      // Sort: preferred extension first, then by size descending (largest = most likely merged).
      const candidates = files
        .filter(f => {
          if (!f.startsWith(prefix)) return false;
          if (f.includes('.part') || /\.f\d+\./.test(f)) return false;
          const ext = f.split('.').pop().toLowerCase();
          return allowedExts.includes(ext);
        })
        .map(f => {
          try {
            const p = path.join(folder, f);
            const ext = f.split('.').pop().toLowerCase();
            return { f, p, size: fs.statSync(p).size, isPreferred: ext === preferredExt };
          } catch (_) { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => {
          // Preferred extension beats any other regardless of size
          if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1;
          return b.size - a.size;
        });

      if (candidates.length > 0) {
        console.log('[yt-dlp Handler] findOutputFile found via scan:', candidates[0].f);
        return candidates[0].p;
      }
    } catch (err) {
      console.error('[yt-dlp Handler] Error scanning output folder:', err.message);
    }

    // Return the expected path so callers can report a meaningful missing-file error
    return expectedPath;
  }

  /**
   * Cancel a download
   */
  cancelDownload(id) {
    const download = this.activeDownloads.get(id);
    if (download) {
      console.log('[yt-dlp Handler] Cancelling download:', id);
      download.state.aborted = true;

      try {
        // Handle yt-dlp process
        if (download.process && download.process.ytDlpProcess) {
          download.process.ytDlpProcess.kill('SIGKILL');
        }

        // Handle direct download (http request)
        if (download.request) {
          download.request.destroy();
        }
        if (download.file) {
          download.file.close();
        }
        // Clean up partial file from direct download
        if (download.outputPath && fs.existsSync(download.outputPath)) {
          fs.unlinkSync(download.outputPath);
        }
      } catch (error) {
        console.error('[yt-dlp Handler] Error killing process:', error);
      }

      this.activeDownloads.delete(id);

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('dl:cancelled', { jobId: id });
      }

      return true;
    }
    return false;
  }

  /**
   * Cancel all active downloads
   */
  cancelAll() {
    console.log('[yt-dlp Handler] Cancelling all downloads');

    const ids = Array.from(this.activeDownloads.keys());
    ids.forEach(id => this.cancelDownload(id));

    return ids.length;
  }

  /**
   * Get list of active downloads
   */
  getActiveDownloads() {
    return Array.from(this.activeDownloads.keys());
  }

  /**
   * Returns the path to the ffmpeg binary.
   * Priority: bundled @ffmpeg-installer → common system locations → null (let yt-dlp find it)
   */
  getFfmpegPath() {
    try {
      const installer = require('@ffmpeg-installer/ffmpeg');
      if (installer.path && fs.existsSync(installer.path)) {
        return installer.path;
      }
    } catch (_) {}

    if (process.platform === 'win32') {
      const candidates = [
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ffmpeg', 'bin', 'ffmpeg.exe'),
        path.join(process.env.ProgramFiles || '', 'ffmpeg', 'bin', 'ffmpeg.exe'),
      ];
      for (const p of candidates) {
        try { if (fs.existsSync(p)) return p; } catch (_) {}
      }
    } else {
      const candidates = ['/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'];
      for (const p of candidates) {
        try { if (fs.existsSync(p)) return p; } catch (_) {}
      }
    }

    return null; // yt-dlp will look on PATH
  }

  /**
   * Clean up leftover temp files after a failed download.
   * Removes .part files, .ytdl temps, and per-format stream files (e.g. title.f313.webm).
   */
  cleanupTempFiles(folder, baseName) {
    try {
      const files = fs.readdirSync(folder);
      const prefix = baseName.substring(0, 50);
      for (const file of files) {
        if (!file.startsWith(prefix)) continue;
        if (/\.(part|ytdl|temp)$|\.f\d+\.(webm|mp4|m4a|ogg|opus|aac|mkv)$/i.test(file)) {
          try {
            fs.unlinkSync(path.join(folder, file));
            console.log('[yt-dlp Handler] Cleaned up temp file:', file);
          } catch (_) {}
        }
      }
    } catch (err) {
      console.warn('[yt-dlp Handler] cleanupTempFiles error:', err.message);
    }
  }

  /**
   * Losslessly remux any media file to mp4 using ffmpeg.
   * Reports real-time progress via dl:progress events (mapped to 82–99%).
   * jobId is optional — omit it when calling outside a download context.
   */
  remuxWithFfmpeg(inputPath, outputPath, jobId = null) {
    const ffmpegPath = this.getFfmpegPath();
    if (!ffmpegPath) return Promise.reject(new Error('ffmpeg not found for remux'));

    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');

      // -progress pipe:1 writes key=value progress lines to stdout.
      // We parse out_time_ms and total_duration_ms to get a real percentage.
      const args = [
        '-y',
        '-i', inputPath,
        '-c', 'copy',
        '-movflags', '+faststart',
        '-progress', 'pipe:1',
        '-nostats',
        outputPath
      ];

      console.log('[yt-dlp Handler] Remuxing with ffmpeg:', [ffmpegPath, ...args].join(' '));

      const proc = spawn(ffmpegPath, args);
      let stderr = '';
      let totalDurationMs = 0;

      // Parse total duration from ffmpeg stderr header (e.g. "Duration: 01:23:45.67")
      const parseDuration = (text) => {
        const m = text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
        if (m) {
          totalDurationMs = (parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3])) * 1000;
        }
      };

      // ffmpeg -progress pipe:1 output → parse out_time_ms for real percentage
      let stdoutBuf = '';
      proc.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop(); // keep incomplete last line

        for (const line of lines) {
          const [key, val] = line.split('=');
          if (key === 'out_time_ms' && val) {
            const posMs = parseInt(val) / 1000; // microseconds → ms
            let pct = totalDurationMs > 0
              ? Math.min(99, (posMs / totalDurationMs) * 100)
              : 0;
            // Map to the 82–99% window so it follows yt-dlp's 0-82% download progress
            const scaled = Math.round(82 + pct * 0.17);
            if (jobId && this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('dl:progress', {
                jobId,
                progress: scaled,
                status: 'Remuxing...'
              });
            }
          }
        }
      });

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        if (!totalDurationMs) parseDuration(text);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          try { fs.unlinkSync(inputPath); } catch (_) {}
          // Final 99% before caller sends 'complete'
          if (jobId && this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('dl:progress', { jobId, progress: 99, status: 'Remuxing...' });
          }
          resolve(outputPath);
        } else {
          reject(new Error('ffmpeg remux failed (code ' + code + '): ' + stderr.slice(-300)));
        }
      });

      proc.on('error', (err) => {
        reject(new Error('ffmpeg spawn error: ' + err.message));
      });
    });
  }

  /**
   * Convert any audio file to MP3 using ffmpeg with libmp3lame.
   * Fallback for when yt-dlp's internal -x --audio-format mp3 conversion fails.
   * Reports real-time progress via dl:progress events (82–99% window).
   *
   * quality: 'high'|'320' → VBR q:a 0 (~320kbps)
   *          'standard'|'192' → VBR q:a 5 (~192kbps)
   *          'low'|'128' → VBR q:a 9 (~128kbps)
   */
  convertToMp3WithFfmpeg(inputPath, outputPath, jobId = null, quality = 'high') {
    const ffmpegPath = this.getFfmpegPath();
    if (!ffmpegPath) return Promise.reject(new Error('ffmpeg not found for MP3 conversion'));

    const vbrQ = (quality === 'standard' || quality === '192') ? '5'
                : (quality === 'low'      || quality === '128') ? '9'
                : '0'; // high/320/default

    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');

      const args = [
        '-y',
        '-i', inputPath,
        '-vn',                    // strip video stream if any
        '-codec:a', 'libmp3lame',
        '-q:a', vbrQ,
        '-progress', 'pipe:1',
        '-nostats',
        outputPath
      ];

      console.log('[yt-dlp Handler] Converting to MP3:', [ffmpegPath, ...args].join(' '));

      const proc = spawn(ffmpegPath, args);
      let stderr = '';
      let totalDurationMs = 0;

      const parseDuration = (text) => {
        const m = text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
        if (m) totalDurationMs = (parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3])) * 1000;
      };

      let stdoutBuf = '';
      proc.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop();
        for (const line of lines) {
          const [key, val] = line.split('=');
          if (key === 'out_time_ms' && val) {
            const posMs = parseInt(val) / 1000;
            const pct = totalDurationMs > 0 ? Math.min(99, (posMs / totalDurationMs) * 100) : 0;
            const scaled = Math.round(82 + pct * 0.17);
            if (jobId && this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('dl:progress', { jobId, progress: scaled, status: 'Converting to MP3...' });
            }
          }
        }
      });

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        if (!totalDurationMs) parseDuration(text);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          try { fs.unlinkSync(inputPath); } catch (_) {}
          if (jobId && this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('dl:progress', { jobId, progress: 99, status: 'Converting to MP3...' });
          }
          resolve(outputPath);
        } else {
          reject(new Error('ffmpeg MP3 conversion failed (code ' + code + '): ' + stderr.slice(-300)));
        }
      });

      proc.on('error', (err) => {
        reject(new Error('ffmpeg spawn error: ' + err.message));
      });
    });
  }

  /**
   * Validate that the output file actually exists and is not a stub/empty file.
   */
  validateOutputFile(outputPath) {
    if (!outputPath || !fs.existsSync(outputPath)) return false;
    try {
      const stat = fs.statSync(outputPath);
      return stat.size > 4096; // anything under 4KB is certainly wrong
    } catch (_) {
      return false;
    }
  }

  /**
   * Download a direct media URL (fallback for URLs yt-dlp can't handle)
   */
  downloadDirectUrl(job) {
    const { id, url, outputFolder, title, outputFormat } = job;

    console.log('[yt-dlp Handler] Attempting direct download:', url);

    return new Promise((resolve, reject) => {
      try {
        // Determine extension from URL or use specified format
        const urlExt = this.getExtensionFromUrl(url);
        const ext = outputFormat === 'mp3' ? 'mp3' : (urlExt || 'mp4');

        // Build output path
        const sanitizedTitle = title ? title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100) : 'download';
        const outputPath = path.join(outputFolder, `${sanitizedTitle}.${ext}`);

        // Create write stream
        const file = fs.createWriteStream(outputPath);
        const downloadState = { aborted: false };

        // Choose http or https based on URL
        const httpModule = url.startsWith('https') ? https : http;

        const request = httpModule.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        }, (response) => {
          // Handle redirects
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            file.close();
            fs.unlinkSync(outputPath);
            // Retry with new URL
            this.downloadDirectUrl({
              ...job,
              url: response.headers.location
            }).then(resolve).catch(reject);
            return;
          }

          if (response.statusCode !== 200) {
            file.close();
            fs.unlinkSync(outputPath);
            reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
            return;
          }

          const totalSize = parseInt(response.headers['content-length'], 10) || 0;
          let downloadedSize = 0;

          response.on('data', (chunk) => {
            if (downloadState.aborted) return;

            downloadedSize += chunk.length;
            const progress = totalSize > 0 ? (downloadedSize / totalSize) * 100 : 0;

            // Send progress
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('dl:progress', {
                jobId: id,
                progress: Math.round(progress),
                downloadedBytes: downloadedSize,
                totalBytes: totalSize
              });
            }
          });

          response.pipe(file);

          file.on('finish', () => {
            file.close();
            if (downloadState.aborted) {
              fs.unlinkSync(outputPath);
              return;
            }

            console.log('[yt-dlp Handler] Direct download complete:', outputPath);
            this.activeDownloads.delete(id);

            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('dl:complete', {
                jobId: id,
                outputPath: outputPath
              });
            }

            resolve(outputPath);
          });
        });

        request.on('error', (error) => {
          file.close();
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
          this.activeDownloads.delete(id);

          console.error('[yt-dlp Handler] Direct download error:', error);

          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('dl:error', {
              jobId: id,
              error: 'Failed to download file: ' + error.message,
              errorType: ERROR_TYPES.NETWORK_ERROR
            });
          }

          reject(error);
        });

        // Store reference for cancellation
        this.activeDownloads.set(id, {
          request: request,
          state: downloadState,
          file: file,
          outputPath: outputPath
        });

      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = YtdlpHandler;
