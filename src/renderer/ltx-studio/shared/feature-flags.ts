// Single source of truth for HuggingFace gating. Imported by both the
// Electron main process (python-backend.ts) and the preload bridge, so it
// must stay free of electron/main-process APIs.
//
// When true, the app enforces HF OAuth + per-repo access checks before
// downloading model checkpoints. When false, downloads proceed anonymously
// (public repos only) and the HF auth UI is hidden.
export const HF_GATING_ENABLED = false
