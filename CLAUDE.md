# Kolbo Studio Desktop - Project Context for Claude

## Memory Hierarchy (READ FIRST)
At the start of every session, read `C:\Users\Zohar\.claude\memory\MEMORY.md` for the global peer card, user preferences, and cross-project rules that apply to all Kolbo repos.

## Full-Stack Tool Map
Read `C:\Users\Zohar\.claude\KOLBO-STACK.md` when working on any feature — maps every tool's frontend ↔ backend files across all repos (kolbo-map, kolbo-api, kolbo-desktop, kolbo-adobe-plugin).

**MANDATORY**: When you add, remove, or rename a key file in kolbo-desktop, update KOLBO-STACK.md in the same step. Do not wait to be asked.

## Project Overview

Kolbo Studio is an Electron-based desktop application for video editors. It provides AI-powered creative tools and integrates with video editing software.

## Tech Stack

- **Framework**: Electron 28.x
- **Build System**: electron-builder 24.x
- **Auto-Updates**: electron-updater
- **CI/CD**: GitHub Actions

## Key Files

### Configuration
- `package.json` - App config, dependencies, and electron-builder settings
- `.github/workflows/release.yml` - CI/CD workflow for building and releasing
- `entitlements.mac.plist` - macOS app entitlements
- `entitlements.mac.inherit.plist` - macOS inherited entitlements

### Main Code
- `src/main/main.js` - Main Electron process
- `src/renderer/` - Renderer process (UI)

## macOS Code Signing & Notarization (WORKING)

As of February 2026, macOS builds are **fully signed and notarized**.

### Configuration in package.json
```json
"mac": {
  "hardenedRuntime": true,
  "gatekeeperAssess": true,
  "entitlements": "entitlements.mac.plist",
  "entitlementsInherit": "entitlements.mac.inherit.plist",
  "notarize": {
    "teamId": "DPVW9Z2L9Y"
  }
}
```

### Required GitHub Secrets
- `CSC_LINK` - Base64-encoded .p12 certificate file
- `CSC_KEY_PASSWORD` - Certificate password
- `APPLE_ID` - Apple ID email (malcazohar@gmail.com)
- `APPLE_APP_SPECIFIC_PASSWORD` - App-specific password from appleid.apple.com
- `APPLE_TEAM_ID` - Apple Developer Team ID (DPVW9Z2L9Y)

### Environment Variables for CI
The workflow sets these for the macOS build:
```yaml
CSC_NAME: "Zohar Vanunu Productions, LLC (DPVW9Z2L9Y)"
CSC_LINK: ${{ secrets.CSC_LINK }}
CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
APPLE_ID: ${{ secrets.APPLE_ID }}
APPLE_ID_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
```

### Local Build with Notarization
```bash
export APPLE_ID="malcazohar@gmail.com"
export APPLE_ID_PASSWORD="<app-specific-password>"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific-password>"
export APPLE_TEAM_ID="DPVW9Z2L9Y"
npm run build:prod:mac
```

### Verify Notarization
```bash
spctl --assess --verbose dist/mac-universal/Kolbo\ Studio.app
# Should show: source=Notarized Developer ID
```

## Release Process

### Automated Release
```bash
npm run version:patch   # 1.1.6 -> 1.1.7
# This automatically:
# 1. Bumps version in package.json
# 2. Creates git commit and tag
# 3. Pushes to GitHub
# 4. Triggers GitHub Actions build
# 5. Creates GitHub Release with all installers
```

### Manual Release
1. Update version in `package.json`
2. Commit and push to master
3. GitHub Actions will build and create release

## Common Issues & Solutions

### Notarization "hangs" or fails
1. Check Apple Developer System Status: https://developer.apple.com/system-status/
2. Verify credentials with: `xcrun notarytool history --apple-id EMAIL --team-id TEAM_ID --password PASSWORD`
3. Check for submission errors: `xcrun notarytool log SUBMISSION_ID --apple-id EMAIL --team-id TEAM_ID --password PASSWORD`

### CSC_NAME error: "Please remove prefix 'Developer ID Application:'"
- Use just the company name: `"Zohar Vanunu Productions, LLC (DPVW9Z2L9Y)"`
- NOT: `"Developer ID Application: Zohar Vanunu Productions, LLC (DPVW9Z2L9Y)"`

### Release upload fails with "already_exists"
- Assets already exist on the release
- Delete existing assets: `gh release delete-asset vX.X.X "filename" --yes`
- Re-run the build

## File Naming Convention

GitHub converts spaces to dots in uploaded filenames:
- electron-builder creates: `Kolbo Studio-Setup-1.1.6.exe`
- GitHub uploads as: `Kolbo.Studio-Setup-1.1.6.exe`

This is expected behavior - don't try to "fix" it.

## Developer Identity

- **Company**: Zohar Vanunu Productions, LLC
- **Team ID**: DPVW9Z2L9Y
- **Certificate**: Developer ID Application: Zohar Vanunu Productions, LLC (DPVW9Z2L9Y)

## Useful Commands

```bash
# List code signing identities
security find-identity -v -p codesigning

# Check notarization history
xcrun notarytool history --apple-id EMAIL --team-id TEAM_ID --password PASSWORD

# Verify app signature
codesign -dv --verbose=2 "path/to/App.app"

# Check Gatekeeper status
spctl --assess --verbose "path/to/App.app"

# Test credentials
xcrun notarytool info SUBMISSION_ID --apple-id EMAIL --team-id TEAM_ID --password PASSWORD
```

## Internationalization (i18n)

### ALWAYS Use Translation Keys
When adding any user-facing text (buttons, labels, messages, etc.), ALWAYS:
1. Add a translation key to `src/renderer/i18n/locales/en.json`
2. Use `window.t('key')` in JavaScript or `data-i18n="key"` in HTML
3. NEVER hardcode visible strings

### Translation Script
When adding new strings or updating translations, use the Gemini translation script:

```javascript
// translate-locales.js - creates/updates all locale files
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

// To run translations:
node translate-locales.js
```

### Locale Files Location
- `src/renderer/i18n/locales/en.json` - Source (English)
- `src/renderer/i18n/locales/he.json` - Hebrew (RTL)
- `src/renderer/i18n/locales/ar.json` - Arabic (RTL)
- Plus: ru, es, fr, de, zh, pt, ja, ko, hi

### RTL Languages
Hebrew and Arabic automatically flip layout to RTL when selected.

## Video Studio Sub-App

`src/renderer/ltx-studio/` is a vendored copy of [Lightricks/LTX-Desktop](https://github.com/Lightricks/LTX-Desktop) (Apache 2.0), built as a static React+Vite sub-app and loaded by `main.js::_loadVideoStudioIframe()` into a tab driven by `src/renderer/index.html#video-studio-view`.

- Build: `npm run build:ltx-studio` — outputs `src/renderer/ltx-studio/dist/`. Chained into `build:prod:win` and `build:prod:mac`.
- LTX's Electron main process and Python backend were removed. A stub at `src/renderer/ltx-studio/frontend/lib/electron-api-stub.ts` provides safe no-op defaults so the React app boots.
- Generation is NOT yet wired — needs a Kolbo API adapter in `frontend/lib/backend.ts`. See `src/renderer/ltx-studio/KOLBO-VENDORING-NOTES.md` for the full follow-up list.
- electron-builder `files` glob in `package.json` excludes the LTX source folders (`frontend/`, `shared/`, `node_modules/`, etc.) and includes only `dist/`.
- Third-party attribution at root `THIRD-PARTY.md`.

## Synci Music Library

The **Synci** tab (after "My Media") is the licensed-music browser ported from the Adobe plugin. Backend is the shared `/api/synci/*` (in `kolbo-api`) — no backend changes.

- **Ported verbatim from the plugin** → `src/renderer/js/`: `synci-manager.js` (the `SynciManager` UI class), `waveform.js` (`KolboWaveform` — real-peak canvas waveform with two-tone progress + click-to-seek. **Decode fix vs the plugin**: Chromium's native Web Audio `decodeAudioData` crashes the Electron renderer (access violation `0xC0000005`) from a `file://` origin — with **both** `AudioContext` (also fires a `media` permission + opens an audio output device) and `OfflineAudioContext`. So the desktop computes peaks in the **main process via the bundled FFmpeg**: IPC `synci:waveform-peaks` (main.js `setupScreenshotHandlers`) fetches the audio, pipes it through FFmpeg → mono f32 PCM @ 8 kHz, returns normalized RMS peaks. Exposed via `preload.js` `synciWaveformPeaks`; `waveform.js::_decodePeaks` calls it when `window.kolboDesktop` is present (Web Audio `OfflineAudioContext` remains only as a non-Electron fallback). Peaks are cached per-URL in mem + IndexedDB so each track decodes once. (kolbo-map gets away with renderer Web Audio because it runs on an `https` origin, not `file://`.) Peaks fetched via browser `fetch` (Node-`require` branch is dead under `contextIsolation`) → in production this needs the audio CDN to allow the `null`/`file://` origin for CORS; if not, it falls back to the deterministic skeleton (no crash). Row `<audio>` uses `preload="none"`), `dropdown.js` (`KolboDropdown` — the plugin's portal dropdown; the desktop had no equivalent, required by the quality/project/suggest menus).
- **Desktop bridge**: `src/renderer/js/synci-desktop-bridge.js` defines `window.kolboDesktopSynciBridge` with only `addMusicTracksToTimeline(urls, filenames)` → calls `window.kolboDesktop.synciDownloadToDisk` (IPC `synci:download-to-disk` in `main.js` `setupScreenshotHandlers`, saves to `defaultDownloadFolder`/Downloads, reuses the `download-complete` banner). It intentionally omits `exportFrameAsBase64`/`exportAudioToTemp`/`getProjectFolder`, so the Premiere-only AI-suggest options (timeline frame / timeline audio) auto-hide.
- **Now-playing dock + drag-to-timeline**: playing a track opens a bottom dock (`#synci-dock`, built in `_build`) — the **single player** for the tab (rows delegate playback to it). Large waveform, play head (▶/⏸ toggle), time + in/out labels, quality picker, and a primary action button. The dock's `KolboWaveform` is `noInteract` so the dock owns all pointer input (`_wireDockSeek`); the selection region is **purely visual** (masks dim outside it).
  - **Waveform interaction (one unified handler, `_wireDockSeek`)**: a plain **click** seeks + plays (clicking *outside* an existing selection clears it back to full track; clicking inside scrubs within it); a **horizontal drag** creates/re-creates the in/out selection (even over an existing one) and plays from the new in-point; **dragging *out* of the waveform vertically** (past `DRAG_OUT_PX`) starts the native drag-to-timeline export. In/out handles fine-tune the edges. A sub-selection **loops** in→out during playback (`LOOP_EPS_SEC`). **Spacebar** toggles play/pause while the dock is open (ignored while typing). Tuning constants live at the top of the file (`DOCK_FULL_EPS`, `DOCK_MIN_GAP`, `DRAG_MOVE_PX`, `DRAG_OUT_PX`, `LOOP_EPS_SEC`).
  - **Row → dock sync**: clicking a row's waveform in the list calls `_playInDockAt(track, pct)` — loads it into the dock and plays from the clicked position. Row waveforms use `noAudioPrefetch` (their `<audio>` never plays) so the list doesn't fetch every preview on hover.
  - **Drag sources** (all → `_startExportDrag` → native `file:start-drag`/`synciStartDrag`): the primary button, the artwork, and the vertical drag-out gesture.
  - **Prepare-on-demand** (`_ensureDragReady`): caches the track (`synci:cache-track` → `userData/SynciCache`, `synciCacheTrack`) and, if in/out ≠ full, trims via `ff:export-trimmed` (`synciExportTrimmed` → `userData/TrimmedFiles`). A loading **overlay** (`#synci-dock-loading`) shows while preparing; result is coalesced/cached per selection key; pre-warmed on play + on `mousedown`. Since `dragstart`/drag-out can't await, an unready file shows the overlay, prepares, and toasts "ready — drag again."
  - **Primary button** = click-to-download (copies the prepared full/trimmed file into Downloads via `synci:save-to-downloads` / `synciSaveToDownloads`) **and** drag-to-timeline. Dynamic label: **"Download"** (full) / **"Download & Trim"** (selection set).
  - Dragging/downloading requires auth and logs a download (`synciLogDownload`). i18n under `synci.dock.*` (+ `synci.download`/`downloadTrim`) translated across all 12 locales.
  - **Styling**: neutral white-alpha surfaces matching the desktop design system, with the brand blue gradient (`#3b82f6→#60a5fa`) reserved for the single primary CTA (`.synci-dock-*` in `synci.css`).
- **Shared main-process helpers** (`main.js`, near `setupScreenshotHandlers`): `synciHttpGetFollow` (redirect-following GET → `IncomingMessage`), `synciDownloadToFile`, `synciFetchToBuffer` — used by the `synci:download-to-disk`/`cache-track`/`waveform-peaks` handlers instead of three inline copies.
- **API**: `synci*` methods in `src/renderer/js/api.js` use **direct `window.fetch`** against `${getApiUrl()}/synci…` (not IPC — endpoints are public/optional-auth; gated ones get the Bearer token). Names/shapes mirror the plugin so `synci-manager.js` runs unchanged.
- **CSS**: `src/renderer/css/synci.css` = plugin CSS + a `#synci-view` var-alias block (the desktop lacks `--glass-*`, `--radius-sm/md/full`, `--accent-purple/green`) + the `.kdd-*` dropdown CSS.
- **Wiring**: tab button + `#synci-view` container + css/script includes in `index.html`; tab listener + `switchView('synci')` branch in `main.js` (lazy-inits `new window.SynciManager(window.kolboDesktopSynciBridge, window.kolboAPI)`).
- **i18n**: nested `synci.*` block (+ `tabs.synci`) in `src/renderer/i18n/locales/*.json` (en full; others get the literal brand `tabs.synci` — `SynciManager.FALLBACK` covers English strings until translated). Brand "Synci" is never translated.

## Last Updated
- **Date**: June 8, 2026
- **Version**: 1.6.2
- **Status**: v1.6.2 — embedded-webapp performance: inactive iframe tabs no longer hold permanent GPU compositor layers (`will-change` scoped to the active iframe in `styles.css`) and `MAX_LOADED_TABS` lowered 5→2 (`tab-manager.js`) to cut GPU/main-thread contention. Pairs with the kolbo-map service worker (network-first HTML + cache-first hashed assets) now live on app.kolbo.ai/sapir — the embedded view, Adobe-plugin webapp area, and web all get cached repeat loads (mobile Capacitor excluded). Prior: Synci music library (browse/search/favorites/downloads/AI-suggest, FFmpeg waveforms, now-playing dock with in/out selection + drag-to-timeline). Video Studio sub-app vendored from LTX-Desktop (scaffold only — API adapter pending)
