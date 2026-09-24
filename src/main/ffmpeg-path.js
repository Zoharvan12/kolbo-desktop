// Kolbo Studio — single source of truth for the bundled FFmpeg binary.
//
// Every main-process module that shells out to FFmpeg (directly, via fluent-ffmpeg, or
// by handing a path to another tool like yt-dlp) must resolve it through here.
//
// The failure this exists to prevent: `require('@ffmpeg-installer/ffmpeg').path` resolves
// INSIDE app.asar in a packaged build. Electron patches `fs` so `existsSync()` returns true
// for that path — but no process can *execute* a file inside an archive. electron-builder
// unpacks @ffmpeg-installer (see `asarUnpack` in package.json), so the real binary is always
// the same path with `app.asar` → `app.asar.unpacked`. Four modules each carried their own
// copy of that rewrite; the downloader's copy was missing, so yt-dlp was handed an
// unexecutable path, reported "ffmpeg is not installed", and skipped the merge — every
// multi-stream download (YouTube 1080p+, LinkedIn/Instagram DASH) landed as separate
// video-only and audio-only files.
//
// Pure Node — no `electron` require, so scripts/ can use it too.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const EXE = process.platform === 'win32' ? '.exe' : '';

let cachedPath;        // undefined = not resolved yet; null = genuinely unavailable
let verifyPromise;     // cached result of the one-time `-version` probe

/** app.asar paths are not executable; electron-builder unpacks them next door. */
function unpacked(p) {
  return p ? p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1') : p;
}

function isExecutableFile(p) {
  try {
    return !!p && fs.statSync(p).isFile();
  } catch (_) {
    return false;
  }
}

function systemCandidates() {
  if (process.platform === 'win32') {
    return [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ffmpeg', 'bin', 'ffmpeg.exe'),
      path.join(process.env.ProgramFiles || '', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    ];
  }
  return ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
}

/**
 * Absolute path to a runnable ffmpeg, or null if none was found.
 * Order: KOLBO_FFMPEG override → bundled (asar-aware) → common system installs.
 * Callers that can fall back to a PATH lookup should treat null as "use bare `ffmpeg`".
 */
function getFfmpegPath() {
  if (cachedPath !== undefined) return cachedPath;

  const override = process.env.KOLBO_FFMPEG;
  if (override && isExecutableFile(override)) return (cachedPath = override);

  try {
    const bundled = unpacked(require('@ffmpeg-installer/ffmpeg').path);
    if (isExecutableFile(bundled)) return (cachedPath = bundled);
    console.warn('[ffmpeg-path] Bundled ffmpeg missing at', bundled, '— check asarUnpack');
  } catch (err) {
    console.warn('[ffmpeg-path] @ffmpeg-installer unavailable:', err.message);
  }

  for (const candidate of systemCandidates()) {
    if (isExecutableFile(candidate)) return (cachedPath = candidate);
  }

  return (cachedPath = null);
}

/**
 * Actually run the binary once and cache the verdict. `getFfmpegPath()` only proves a file
 * exists — an unpacked-but-corrupt binary, a blocked exe, or a missing VC++ runtime all
 * still pass that check and then fail at the worst moment (mid-merge, mid-export).
 * Resolves to { ok, path, version, error } and never rejects.
 */
function verifyFfmpeg() {
  if (verifyPromise) return verifyPromise;

  verifyPromise = new Promise((resolve) => {
    const bin = getFfmpegPath() || `ffmpeg${EXE}`; // bare name = last-resort PATH lookup
    execFile(bin, ['-hide_banner', '-version'], { timeout: 15000 }, (err, stdout) => {
      if (err) {
        console.error('[ffmpeg-path] ffmpeg is NOT runnable at', bin, '—', err.message);
        resolve({ ok: false, path: bin, version: null, error: err.message });
        return;
      }
      const version = (/^ffmpeg version (\S+)/.exec(stdout) || [])[1] || 'unknown';
      console.log('[ffmpeg-path] ffmpeg', version, 'at', bin);
      resolve({ ok: true, path: bin, version, error: null });
    });
  });

  return verifyPromise;
}

module.exports = { getFfmpegPath, verifyFfmpeg };
