// Paths this app itself saved (PT-043): file:open-downloaded may only open these,
// never an arbitrary path (e.g. UNC) supplied by the renderer.
const path = require('path');

const downloaded = new Set();
const key = (p) => path.resolve(String(p)).toLowerCase();

// Only types a default app opens harmlessly. Anything else is revealed in the folder, never launched.
const OPENABLE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|mp4|mov|webm|mkv|avi|m4v|mp3|wav|flac|aac|ogg|m4a|pdf|txt|md|csv|json|srt|vtt|zip|glb|gltf|obj|fbx)$/i;

function recordDownload(p) {
  if (typeof p === 'string' && path.isAbsolute(p) && !p.startsWith('\\')) downloaded.add(key(p));
}
const wasDownloaded = (p) => typeof p === 'string' && downloaded.has(key(p));
const isOpenable = (p) => OPENABLE.test(String(p));

// shell.openPath launches whatever it is given (an .exe, a UNC share). Folder buttons may only open an
// existing local DIRECTORY, so a renderer-supplied path can never start a program or touch a network share.
// macOS app bundles (.app etc.) are directories that openPath would LAUNCH, so they are not folders here.
const BUNDLE = /\.(app|bundle|command|pkg|framework|prefpane|saver|workflow|action)$/i;
// Windows: only a drive-letter path is local. UNC (\\host), NT-prefixed (\??\UNC\...) and root-relative paths can reach
// an SMB host (NTLM leak) when stat'ed or revealed. Network shares must be used through a mapped drive letter.
function isLocalPath(p, platform = process.platform) {
  if (typeof p !== 'string' || /[\x00-\x1f]/.test(p) || /^[\\/]{2}/.test(p)) return false;
  return platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(p) : path.isAbsolute(p);
}

// Files that run code when opened: a download of one of these needs an explicit user confirmation, whatever
// filename the server chose (Content-Disposition can name any file after a harmless-looking URL).
const DANGEROUS_EXT = /\.(exe|bat|cmd|com|ps1|psm1|lnk|scr|msi|msp|hta|js|jse|vbs|vbe|wsf|wsh|jar|reg|cpl|dll|sys|pif|appx|msix|dmg|pkg|app|command|sh|py|url|iso|inf|gadget|msc|chm|appref-ms|application|xbap|settingcontent-ms|library-ms|search-ms|rdp|diagcab|msu|pyw|rb|pl|vb|docm|xlsm|pptm|html?|xhtml|terminal|webloc|jnlp|action|workflow|bundle|prefpane|saver)$/i;
const isDangerousFileName = (name) => DANGEROUS_EXT.test(String(name).trim().replace(/[. ]+$/, ''));
function isLocalDirectory(p) {
  try {
    if (!isLocalPath(p) || path.resolve(p).split(path.sep).some((seg) => BUNDLE.test(seg))) return false;
    return require('fs').statSync(p).isDirectory();
  } catch (_) { return false; }
}

// Folders the user picked in the native folder dialog (file:pick-folder): the only targets a batch download may write to.
const approvedFolders = new Set();
const approveFolder = (p) => { if (isLocalPath(p)) approvedFolders.add(key(p)); };
const isApprovedFolder = (p) => isLocalPath(p) && approvedFolders.has(key(p));

module.exports = { recordDownload, wasDownloaded, isOpenable, isLocalDirectory, isLocalPath, isDangerousFileName, approveFolder, isApprovedFolder };
