# Third-Party Notices

## Kolbo Video Studio (vendored from LTX-Desktop)

The `src/renderer/ltx-studio/` sub-app is derived from
[Lightricks/LTX-Desktop](https://github.com/Lightricks/LTX-Desktop), licensed
under the Apache License, Version 2.0.

Apache 2.0 license text is preserved at
`src/renderer/ltx-studio/LICENSE.txt`. Upstream third-party notices are at
`src/renderer/ltx-studio/NOTICES.md`.

Modifications made by Kolbo.AI:
- Removed `electron/` and `backend/` directories (LTX's Electron main process
  and Python FastAPI service). Kolbo Video Studio runs as a static sub-app
  loaded by kolbo-desktop's existing main process; the Python backend is
  replaced with calls to Kolbo's developer API.
- Replaced `package.json` and `vite.config.ts` to build as a pure static React
  + Vite app (no Electron plugins).
- Added `frontend/lib/electron-api-stub.ts` providing safe no-op defaults for
  LTX's `window.electronAPI` IPC bridge while a real Kolbo adapter is wired in.
- Renamed package to `kolbo-video-studio` for clarity.

Upstream attribution and Apache 2.0 obligations are preserved.
