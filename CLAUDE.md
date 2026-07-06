# Kolbo Studio Desktop - Project Context for Claude

## Memory Hierarchy (READ FIRST)
At the start of every session, read `C:\Users\Zohar\.claude\memory\MEMORY.md` for the global peer card, user preferences, and cross-project rules that apply to all Kolbo repos.

## Full-Stack Tool Map
Read `C:\Users\Zohar\.claude\KOLBO-STACK.md` when working on any feature — maps every tool's frontend ↔ backend files across all repos (kolbo-map, kolbo-api, kolbo-desktop, kolbo-adobe-plugin).

**MANDATORY**: When you add, remove, or rename a key file in kolbo-desktop, update KOLBO-STACK.md in the same step. Do not wait to be asked.

## Project Overview

Kolbo Studio is an Electron-based desktop application for video editors. It provides AI-powered creative tools and integrates with video editing software.

## Tech Stack

- **Framework**: Electron 42.x (upgraded from 28 in July 2026 — brings ~2.5 years of Chromium stability/memory fixes; the root-cause fix for "web app crashes in desktop but not in browser")
- **Build System**: electron-builder 26.x
- **Auto-Updates**: electron-updater 6.8+
- **CI/CD**: GitHub Actions (Node 22; explicit `node node_modules/electron/install.js` step because Electron ≥42 doesn't guarantee binary download via postinstall in CI)

### Electron 42 migration notes (July 2026)
- `webContents.getProcessMemoryInfo()` was removed → `getRendererMemoryKB()` in `main.js` (matches renderer by pid via `app.getAppMetrics()`; values in KB, `privateBytes` is KB despite the name). The memory monitor + `memory:get-stats` use it.
- `session.clearStorageData`: `quotas` option + `'appcache'` storage removed — both cleanup call sites fixed (they were silently rejecting even on 28).
- `File.path` removed → preload exposes `getPathForFile(file)` (wraps `webUtils.getPathForFile`). Re-attached at every OS-file entry point: quick-tools-manager `handleFilesDropped`, format-factory `handleFiles`, video-merger drop handler, agent-terminal drop handler. **Any new drop/file-picker feature that needs a filesystem path must use this bridge.**
- Dead Chromium switches pruned from main.js (`NetworkService*`, `CanvasOopRasterization`, `VaapiVideoDecoder`, `enable-accelerated-video-decode`).
- **Webapp tab zoom** (`tab-manager.js applyZoom`): uses CSS `zoom` on the iframe, NOT `transform: scale()`. On Chromium ≥ Electron 42, `zoom` propagates into the cross-origin iframe and re-rasterizes crisply; `transform: scale` stretched rendered pixels → blurry tab, made *permanent* by the persisted per-tab zoomLevel. Never reintroduce transform-based zoom (verified empirically with a side-by-side capture). Related: the iframe GPU-layer hints (`translateZ(0)`/`will-change`) were removed from `styles.css` for the same blur reason.
- electron-builder 26 config: `mac.notarize` is boolean now (teamId comes from `APPLE_TEAM_ID` env — export it for local mac builds), `win.publisherName` removed, `dmg.background: null` removed.
- `sharp` moved devDependencies → dependencies (main.js requires it at runtime for WebP→PNG clipboard copy; as a devDep it was never packaged, so that feature was broken in production builds).
- electron-store must stay on 8.x (9+ is ESM-only; main process uses require()).
- Local Windows builds need the VS 2022 "Spectre-mitigated libraries" component (node-pty rebuild); GitHub runners already have it.
- macOS floor is now macOS 12 Monterey (Electron 38 dropped Big Sur).

### Crash telemetry
`src/main/crash-telemetry.js` sends a `desktop_renderer_crash` event to PostHog (project Kolbo.AI, US cloud) whenever a process dies: `crash_kind` = `main-window` | `webapp-iframe` (OOPIF, includes `crashed_url`) | `child-process` (GPU/utility, includes `child_type`), plus `reason` (`oom`/`crashed`/`gpu`...), `exit_code`, app/electron/chrome versions, RAM, uptime. Distinct id = anonymous per-install id in electron-store (`telemetry_anonymous_id`). Fire-and-forget HTTPS — never throws, never blocks recovery. Wired into all three `render-process-gone`/`child-process-gone` handlers in `main.js`.

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

> **July 2026**: the standalone Synci tab button was removed from the sidebar — Synci music is now browsed through the **Stock Library** tab (Synci is one of its sources). Everything below (files, IPC handlers, `synci*` API, waveform/dropdown modules) stays in place: `waveform.js` + `dropdown.js` are reused by the Stock Library, and the `#synci-view` + `switchView('synci')` wiring remains so the tab can be restored by re-adding the button in `index.html`.

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

## Stock Media Library

The **Stock Library** tab is a multi-source stock browser (Pexels / Unsplash / Pixabay / Coverr / Freesound / Sketchfab / Kolbo AI / Synci) over the shared `/api/stock/*` backend (kolbo-api).

- **Shared component**: `src/renderer/js/stock-library-manager.js` is the SAME vanilla-JS `StockLibraryManager` class as the Adobe plugin's (`kolbo-adobe-plugin/com.kolbo.ai.adobe/client/js/stock-library-manager.js`) — the plugin's copy is the **canonical/newest** one; when fixing stock issues, port from there (July 2026: desktop re-synced verbatim). Host differences are runtime-gated: plugin-only paths check `bridge.placeAsset` / `bridge.exportFrameAsBase64` (desktop passes `bridge = null` in `main.js`, so it uses `window.kolboDesktop` drag-to-disk/import paths instead, and keeps the 3D tab which NLE hosts hide).
- **Features**: browse/favorites/downloaded sections; media-type + source chips; category chips + music facets (genre/mood/theme/instrument/vocals); sort + "Surprise me" shuffle; BPM/duration dual-range sliders (bounds from `stockMusicBounds`); **album view** for music collections (`stockGetCollection(slug)` → hero + tracks + similar, mirrors kolbo-map's StockAlbumPage); AI search (vision upload + script analyze); masonry grid / audio waveform rows; now-playing dock with in/out trim; play beacon `stockTrackPlay` (feeds "popular" sort).
- **State persistence**: `_saveState`/`_restoreState` via localStorage `kolbo_stock_state` — last media type, source, query, filters, sort, and section survive app restarts; the search query also carries across media-type switches. The manager instance is kept alive by `main.js`, so switching desktop tabs never resets it.
- **API**: `stock*` methods in `src/renderer/js/api.js` (direct `window.fetch`, public/optional-auth like Synci; search is GET). Method names/shapes mirror the plugin so the shared manager runs unchanged.
- **CSS**: `src/renderer/css/stock-library.css` — self-contained (`#stock-view` defines its own `--glass-*`/`--radius-*` aliases), also synced from the plugin.
- **i18n**: nested `stock.*` block (+ `tabs.stock`) fully translated across all 12 locales (synced from the plugin's locales); `StockLibraryManager.FALLBACK` covers English as a safety net. Provider brand names render literally (licence attribution requirement).
- **Footer** (kolbo-map `StockFooter` parity): a distinct "Stock Library Terms" chip (→ app.kolbo.ai/legal/stock-library-terms) + divider, then EITHER "Powered by [source]" when a specific source is selected in Browse (Kolbo-owned sources get the mark without a link) OR the full descriptive credits row ("Photos & videos provided by Pexels" + Terms links) on All sources / Favorites / Downloaded. Credits table: `StockLibraryManager.CREDITS`; re-rendered on source/section change.
- **Audio waveforms**: rows/dock pass the backend's precomputed peaks (`asset.meta.waveform`, ~64 gain-normalized floats — same data kolbo-map draws) via the new `peaks` option on `KolboWaveform.create` (`waveform.js`, added in BOTH repos), so tracks render their real shapes instantly with no decode. FFmpeg-IPC decode stays as fallback for sources without shipped peaks; only then can the shared index-based skeleton appear.

## Social / Video Downloader (yt-dlp)

`src/main/ytdlp-handler.js` powers the Downloader tab (`src/renderer/js/downloader-manager.js`, IPC `dl:*` in `main.js`). It wraps a self-updating yt-dlp binary (stored in `userData/binaries/`, refreshed to the latest GitHub release on launch + on extractor breakage) with bundled ffmpeg for merge/remux/mp3.

### Reliability: the retry ladder (July 2026)
Root cause of the recurring **"video not available anymore"** complaints was NOT dead videos — it was (a) YouTube/Instagram **bot/login gating** being **mislabeled** as "no longer available", (b) those failures **not triggering** the auto-heal, and (c) no fallback. Fixed with a tiered ladder in BOTH `getMediaInfo` (via `getInfoWithLadder`) and `downloadMedia` (via `_runDownloadAttempt`), applied to `SOCIAL_PLATFORMS` (youtube/instagram/facebook/twitter/tiktok):
1. **Tier 1** — yt-dlp's own **default (adaptive) player-client** + browser-like UA. *Do NOT pin `youtube:player_client`* — hardcoding clients (tv/web_safari/mweb) is empirically WORSE (verified: `default`=11 formats, all pinned clients FAIL; the `tv` client is DRM-poisoned, yt-dlp#12563). yt-dlp keeps `default` current.
2. **Tier 2** — first extractor breakage → `ensureUpdate()` the binary once, retry the same tier.
3. **Tier 3+** — the user's logged-in **browser session** via `--cookies-from-browser` (auto-detects installed Firefox/Brave/Edge/Chrome/Safari through `detectInstalledCookieBrowsers()`), one tier per browser. Solves bot / age / region / Instagram-login walls.

Support methods: `isExtractionFailure` (widened to catch bot/login/"confirm you're not a bot"/rate-limit), `isPermanentlyUnavailable` (genuine removals → fail fast, no wasted tiers), `classifyError` adds `BOT_BLOCKED` (checked BEFORE private/unavailable so bot-blocks aren't shown as "gone"), `isCookieInfraFailure` (keeps `primaryError` = the real content-access cause instead of a cookie-read failure).

### Known limitation — Windows Chrome/Edge cookies
`--cookies-from-browser chrome|edge` **fails on Windows** with `Failed to decrypt with DPAPI` (App-Bound Encryption, yt-dlp#10927). So the cookie tier is reliable on **macOS + Firefox**, but Chrome/Edge on Windows can't be auto-read. The ladder degrades gracefully (that tier just fails silently and the honest tier-1 error is reported). An in-app login-capture flow (Electron `session.cookies` → cookies.txt → `--cookies`) *would* fix Windows Chrome/Edge, but was **deliberately declined** (July 2026, Zohar) to keep the feature simple — the cookie tier stays an invisible internal fallback, no login UI.

## Last Updated
- **Date**: July 6, 2026
- **Version**: 1.6.3
- **Status**: v1.6.3 — Social/Video **Downloader reliability**: yt-dlp handler rebuilt around a retry ladder (adaptive default client → auto-update → browser-cookie fallback) so YouTube/Instagram bot/login blocks stop surfacing as false "video not available"; honest error classification (`BOT_BLOCKED`), fail-fast on genuine removals. See "Social / Video Downloader" above. Also folds in the previously-uncommitted **Stock Media Library** feature + **crash telemetry** + in-flight tool edits. Prior v1.6.2 — embedded-webapp blur fix: ALL GPU-layer hints (`transform: translateZ(0)`, `backface-visibility`, `will-change`) removed from the webapp iframes in `styles.css` — forcing a compositor layer made Chromium scale a cached texture instead of re-rasterizing, so the embedded webapp rendered blurry and page zoom (Ctrl +) magnified the blur; cross-origin iframes composite in their own process anyway. Prior v1.6.2 perf work stands: `MAX_LOADED_TABS` lowered 5→2 (`tab-manager.js`) to cut GPU/main-thread contention. Pairs with the kolbo-map service worker (network-first HTML + cache-first hashed assets) now live on app.kolbo.ai/sapir — the embedded view, Adobe-plugin webapp area, and web all get cached repeat loads (mobile Capacitor excluded). Prior: Synci music library (browse/search/favorites/downloads/AI-suggest, FFmpeg waveforms, now-playing dock with in/out selection + drag-to-timeline). Video Studio sub-app vendored from LTX-Desktop (scaffold only — API adapter pending)
