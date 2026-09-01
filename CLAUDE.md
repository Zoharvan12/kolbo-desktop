# Kolbo Studio Desktop - Project Context for Claude

## Memory
Global memory index: `C:\Users\Zohar\.claude\memory\MEMORY.md` — consult when prior decisions or cross-project history are relevant (per global routing rules; do not preload for self-contained tasks).

## Full-Stack Tool Map
Read `C:\Users\Zohar\.claude\KOLBO-STACK.md` when working on any feature — maps every tool's frontend ↔ backend files across all repos (kolbo-map, kolbo-api, kolbo-desktop, kolbo-adobe-plugin).

**MANDATORY**: When you add, remove, or rename a key file in kolbo-desktop, update KOLBO-STACK.md in the same step. Do not wait to be asked.

## Codebase Graph
A graphify knowledge graph exists at `graphify-out/graph.json` (auto-rebuilds via git hook). Use `/graphify` or `graphify query|affected|explain|god-nodes` for "what calls X" / blast-radius questions before grepping cold.

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
- `.github/workflows/release.yml` - CI/CD: builds BOTH Windows and macOS on every master push, creates the release, and fixes yml filenames
- `.github/workflows/release-sapir.yml` - CI/CD for the Sapir AI Studio whitelabel build (also every master push)
- `entitlements.mac.plist` - macOS app entitlements
- `entitlements.mac.inherit.plist` - macOS inherited entitlements

### Whitelabel (Sapir AI Studio)
Every push to master builds TWO branded desktop apps: Kolbo Studio (`release.yml`) and Sapir AI Studio (`release-sapir.yml`, backed by `scripts/build-whitelabel.js`; preview locally with `scripts/preview-whitelabel.js`).

### Windows signing
Windows currently ships UNSIGNED. An SSL.com eSigner step exists in `release.yml` but is hardcoded off (`if: ${{ false }}` — disabled to prevent eSigner overage charges), which also makes the workflow's `sign` dispatch input dead. `verifyUpdateCodeSignature: false` in `package.json` is load-bearing for auto-update while unsigned — do not re-enable verification before signing is re-enabled. The latest.yml SHA512-regeneration step in the workflow exists because signing mutates the exe.

### Auto-update (silent, Aug 2026)
Flow: launch → check after 3s → `autoDownload` pulls it in the background → header button
turns into **"Restart to Update"** → one click quits, installs silently, relaunches.
Never clicked? `autoInstallOnAppQuit` lands it on the next normal quit.

**`quitAndInstall(true, true)` — the first argument (`isSilent`) is load-bearing, do not set it back to `false`.**
It was `false`, which is why updates felt broken: electron-updater only appends `/S` when
`isSilent`, so users got the full NSIS wizard, *and* — per app-builder-lib's
`templates/nsis/installSection.nsh` — an assisted installer (`oneClick: false`) only honors
`--force-run` **when `${Silent}`**, so the app never relaunched itself; the user had to tick
"Run Kolbo Studio" on the finish page. Silent fixes both. Install dir is preserved either way
(`multiUser.nsh` reads `HKCU InstallLocation` into `$INSTDIR` before any page logic), and the
old-version uninstaller was always invoked `/S /KEEP_APP_DATA`.
Consequence: nothing is on screen during the ~15s swap, so `handleInstallUpdate()` in the
renderer raises `#loading-overlay` with `settings.updates.installing` first — otherwise the app
just vanishes and reads as a crash.

**No `setFeedURL` — do not add one back.** electron-builder bakes `app-update.yml` from each
build's own `publish` block, so Kolbo Studio reads kolbo-desktop-releases and Sapir reads
`kolbo-desktop-sapir`. The old hardcoded feed pointed every build at `Zoharvan12/kolbo-desktop`,
which meant **Sapir installs updated themselves into Kolbo Studio**. `build-whitelabel.js` sets
the publish block but has never patched `main.js`, so any hardcoded feed silently breaks the
whitelabel.

Two more rules the UI depends on:
- The header button appears **only** on `update-downloaded`, never on `update-available` — a
  download in flight is not actionable and a badge for it is noise. Progress lives in Settings.
- `updater:install` returns `{ blocked, count }` instead of quitting when
  `ffmpegHandler.activeJobs` / `ytdlpHandler.activeDownloads` are non-empty; the renderer
  confirms and re-invokes with `force`. `quitAndInstall` is a hard kill and would drop a
  running export. `updater:download` (manual save-to-Downloads) is a **fallback only** — its
  button stays hidden unless `updater:error` fires while an update is actually known.

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
  "notarize": true
}
```
(electron-builder 26: `notarize` is boolean — the teamId comes from the `APPLE_TEAM_ID` env var, see the Electron 42 migration notes above.)

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
3. GitHub Actions builds BOTH platforms (Windows + macOS) on every master push, creates the release, and fixes the latest*.yml filenames automatically — no local release builds needed

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

### Locale Files Location
- `src/renderer/i18n/locales/en.json` - Source (English)
- `src/renderer/i18n/locales/he.json` - Hebrew (RTL)
- `src/renderer/i18n/locales/ar.json` - Arabic (RTL)
- Plus: ru, es, fr, de, zh, pt, ja, ko, hi

### RTL Languages
Hebrew and Arabic automatically flip layout to RTL when selected.

## Video Studio Sub-App

`src/renderer/ltx-studio/` is a vendored copy of [Lightricks/LTX-Desktop](https://github.com/Lightricks/LTX-Desktop) (Apache 2.0), built as a static React+Vite sub-app and loaded by `src/renderer/js/main.js::_loadVideoStudioIframe()` (the RENDERER main.js, not `src/main/main.js`) into a tab driven by `src/renderer/index.html#video-studio-view`.

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
- **Wiring**: tab button + `#synci-view` container + css/script includes in `index.html`; tab listener + `switchView('synci')` branch in `src/renderer/js/main.js` (the renderer main.js; lazy-inits `new window.SynciManager(window.kolboDesktopSynciBridge, window.kolboAPI)`).
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

### Deno JS runtime — YouTube signature descrambling (July 2026)
Root cause of a resurgence of "keeps trying to sign into the browser": as of mid-2026 **yt-dlp deprecated no-JS-runtime YouTube extraction** (`WARNING: No supported JavaScript runtime could be found`). Without a JS runtime, YouTube's `nsig`/signature challenge can't be solved → formats go missing / downloads fail → the retry ladder escalates to the **browser-cookie tier**, which on Windows can't even read Chrome/Edge cookies (DPAPI). Net effect: users see repeated "Trying with your browser sign-in…" that then fails.

**Fix:** `ytdlp-handler.js` now self-downloads a **Deno** binary (same pattern as the yt-dlp binary — to `userData/binaries/deno.exe|deno`, **not** bundled, so no installer bloat) and passes `--js-runtimes deno:<path>` to every extractor attempt. YouTube then resolves on **tier 1 (no cookies)** and the browser fallback is rarely needed.
- Methods (near `getBinaryPath`): `getDenoPath()`, `getDenoAssetName()` (per-platform GitHub `.zip`: win x64 / mac arm64+x64 / linux x64), `getJsRuntimeArgs()` (returns `['--js-runtimes','deno:PATH']` when ready else `[]`), `validateDeno()`, `ensureDeno()` (deduped, never throws), `_provisionDeno()` (download→extract→validate), `_extractDeno()` (unzips via the platform's bundled **bsdtar** — Windows `System32\tar.exe` + macOS `/usr/bin/tar` are both libarchive and handle `.zip`; no new npm dependency).
- Provisioned **in the background on launch** from `initialize()`; the YouTube paths in `getInfoWithLadder`/`downloadMedia` also `await ensureDeno()` so the first-ever YouTube action after a fresh install still gets it (falls back to yt-dlp's built-in clients if Deno can't be fetched — no crash).
- `--js-runtimes deno:PATH` is passed as an argv array element (no shell), so the Windows drive-colon (`deno:C:\...`) and spaces in "Kolbo Studio" are safe — yt-dlp splits on the first colon only. Verified live: `[youtube] [jsc:deno] Solving JS challenges using deno`.
- `downloadFile()` now sets an https `timeout: 60000` so a stalled binary download can't hang the awaited `ensureDeno()`.

### Known limitation — Windows Chrome/Edge cookies
`--cookies-from-browser chrome|edge` **fails on Windows** with `Failed to decrypt with DPAPI` (App-Bound Encryption, yt-dlp#10927). So the cookie tier is reliable on **macOS + Firefox**, but Chrome/Edge on Windows can't be auto-read. The ladder degrades gracefully (that tier just fails silently and the honest tier-1 error is reported). An in-app login-capture flow (Electron `session.cookies` → cookies.txt → `--cookies`) *would* fix Windows Chrome/Edge, but was **deliberately declined** (July 2026, Zohar) to keep the feature simple — the cookie tier stays an invisible internal fallback, no login UI.

## UI Scale / DPI Compensation (July 2026)

The 32×32px navbar buttons in `.header` looked "fine on some computers, tiny on others" because Electron's renderer does **not** auto-zoom to compensate for Windows display scaling (125%, 150%, ... — the default on most HiDPI laptops set to "scaled" mode). On a 150%-scaled display a 32px CSS button renders physically smaller than on a 100% display; same CSS, different perceived size.

**Fix:** apply `setZoomFactor(1 / scaleFactor)` to every webContents (main + every OOPIF tab iframe), with a manual override in Settings → General → UI Scale.

- `main.js` helpers (just below `setupWindowHandlers`): `getAutoUiZoomFactor()` (inverse of `screen.getPrimaryDisplay().scaleFactor`), `getEffectiveUiZoom()` (stored mode or auto), `applyZoomToWebContents()` (safe wrapper, swallows `isDestroyed` / guest-view hosts), `applyUiZoomEverywhere()` (cascades to `webContents.getAllWebContents()`).
- IPC `setupUiZoomHandlers()`: `settings:get-ui-zoom` → `{ mode, effectiveZoom, displayScale, presets }`; `settings:set-ui-zoom` (validates against `UI_ZOOM_PRESETS` = `['auto','0.75','0.9','1','1.1','1.25','1.5']`, persists to `electron-store` key `ui_zoom_mode`, then re-applies everywhere).
- Zoom is applied (a) once after `mainWindow.loadFile` resolves, AND (b) via `app.on('web-contents-created', ...)` so every tab iframe spawned later (opening a webapp tab) inherits the current zoom automatically. Both call sites live next to each other in `main.js` around `mainWindow.loadFile(...)`.
- Renderer: `<select id="ui-scale-select">` in Settings → General, after the download-folder item. Wired in `js/main.js`'s `initSettings()`. Sublabel dynamically shows the detected display scale when in Auto mode (e.g. "Detected display scaling: 150%.") or the effective percentage in manual mode.
- i18n: `settings.general.uiScale*` keys (full translations in en/he/ar/es/fr/de/zh/ru/pt/ja/ko/hi). Toast on change uses `window.toastManager.show`.
- **Default is Auto** — most users get the fix without ever touching Settings; the sublabel makes it transparent.
- Persistence: `electron-store` key `ui_zoom_mode`. Survives app restarts. First-run uses the detected scale; manual picks are sticky.
- Note: per the July 2026 webapp zoom work, the **tab webapp iframe** already uses CSS `zoom` (not `transform: scale`) for its per-tab zoom — so applying `setZoomFactor` at the parent level stacks correctly and the iframe re-rasterizes crisply.

## Last Updated
Version history lives in git tags (`git tag -l` / GitHub Releases). The durable rules from recent releases are embedded in their sections above (CSS zoom not transform, getPathForFile bridge, electron-store 8.x pin, do-not-pin youtube player_client, Deno JS runtime, UI Scale).
