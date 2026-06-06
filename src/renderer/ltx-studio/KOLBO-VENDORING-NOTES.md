# Kolbo Video Studio — Vendoring Notes

This folder is vendored from [Lightricks/LTX-Desktop](https://github.com/Lightricks/LTX-Desktop) (Apache 2.0) and adapted to run as a static sub-app inside kolbo-desktop.

## What was removed
- `electron/` — LTX's Electron main process. kolbo-desktop's main process hosts the sub-app instead (loaded via `file://` in an iframe).
- `backend/` — LTX's Python FastAPI service. Generation will route through Kolbo's developer API.
- `scripts/`, `build-resources/`, `electron-builder.yml`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.node.json` — packaging and toolchain artifacts not needed for a static sub-app.

## What was changed
- `package.json` — replaced. Now name `kolbo-video-studio`, only React/Vite/Tailwind deps. No Electron, no pnpm.
- `vite.config.ts` — replaced. Removed `vite-plugin-electron` / `vite-plugin-electron-renderer`. Builds pure static output to `dist/`.
- `tsconfig.json` — relaxed `noUnusedLocals`/`noUnusedParameters` to avoid failing on imported-but-unused electron-only modules.
- `frontend/main.tsx` — calls `installElectronApiStub()` before `installProjectStorageDevtools()`.
- `frontend/lib/electron-api-stub.ts` — new. Installs a Proxy on `window.electronAPI` that returns safe defaults for all of LTX's 60+ IPC methods so the app boots inside a plain web page.

## Kolbo API integration (DONE)

`frontend/lib/backend.ts` is a real adapter against the **kolbo-api SDK** at
`G:/Projects/Kolbo.AI/github/kolbo-api/src/modules/sdk/`, mounted at
`/api/v1`. That module is treated as a public, version-locked contract (see
the big warning header in `kolbo-api/src/modules/sdk/index.js`) — routes
won't be renamed without coordination, so this adapter is stable.

Routes the adapter calls:
- `POST /api/v1/generate/video` — text-to-video
- `POST /api/v1/generate/video/from-image` — image-to-video (when LTX sends `imagePath`)
- `POST /api/v1/generate/image` — image gen
- `POST /api/v1/generate/first-last-frame` — gap-fill between two clip frames
- `GET  /api/v1/generate/:id/status` — async poll loop (uses `poll_url` + `poll_interval_hint` from initial response)
- `GET  /api/v1/models?type=<type>` — `fetchKolboModels()` for the (still TODO) UI picker
- `GET  /api/v1/account/credits` — `fetchKolboCredits()` for the (still TODO) credit widget

Auth: `Authorization: Bearer <JWT>`. kolbo-api's auth middleware accepts
either `X-API-Key` or JWT (see `src/middlewares/authentication.middleware.js`
line 171/247). kolbo-desktop forwards `kolboAPI.getToken()` via `postMessage`.

## What is NOT yet wired (planned follow-up)
1. **Model picker UI** — `fetchKolboModels()` is exported and ready; need a dropdown in LTX's generation panel.
2. **Credit balance widget** — `fetchKolboCredits()` is exported and ready; need a small widget in the top-right.
3. **File / asset upload** — when the user drops a local image into the editor as a reference, LTX sends `imagePath` as a local path. The adapter currently rejects non-http URLs with `IMAGE_NOT_UPLOADED`. Next step: auto-upload via `POST /api/v1/media/upload` (multipart), then substitute the returned `media.url`.
4. **Asset / FFmpeg IPC** — `addVisualAssetToProject`, `extractVideoFrame`, `exportNative` etc. should bridge to kolbo-desktop's existing native FFmpeg + file dialog handlers via window.parent.postMessage.
5. **PostHog analytics** — `video_studio_opened`, `generation_started`, etc.

## How to build
From the kolbo-desktop root:
```
npm run build:ltx-studio
```
Outputs `src/renderer/ltx-studio/dist/`. This is chained automatically into `build:prod:win` and `build:prod:mac`.

## License
Apache 2.0. See `LICENSE.txt` and `NOTICES.md` in this folder, and `THIRD-PARTY.md` at the kolbo-desktop repo root.
