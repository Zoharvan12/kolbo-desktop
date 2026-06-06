// Receives the init payload posted by kolbo-desktop's main.js right after the
// iframe loads. Populates window.KOLBO_VIDEO_STUDIO_CONFIG so backend.ts can
// authenticate Kolbo API calls and so brand-aware UI elements can read the
// dynamic brand name / logo.
//
// Also installs a small change-event so React components can re-render when
// the config arrives (postMessage races React mount).

import type { KolboVideoStudioConfig } from './backend'

const READY_EVENT = 'kolbo-video-studio:config-ready'

declare global {
  interface WindowEventMap {
    'kolbo-video-studio:config-ready': CustomEvent<KolboVideoStudioConfig>
  }
}

function applyConfig(config: KolboVideoStudioConfig) {
  window.KOLBO_VIDEO_STUDIO_CONFIG = config
  window.dispatchEvent(new CustomEvent(READY_EVENT, { detail: config }))
}

export function installKolboInitBridge() {
  if (typeof window === 'undefined') return
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string; payload?: Partial<KolboVideoStudioConfig> } | undefined
    if (!data || data.type !== 'kolbo-video-studio:init' || !data.payload) return
    const p = data.payload
    const config: KolboVideoStudioConfig = {
      token: typeof p.token === 'string' ? p.token : '',
      apiBaseUrl: typeof p.apiBaseUrl === 'string' && p.apiBaseUrl ? p.apiBaseUrl : 'https://api.kolbo.ai',
      brandName: typeof p.brandName === 'string' && p.brandName ? p.brandName : 'Kolbo Studio',
      brandLogoUrl: typeof p.brandLogoUrl === 'string' && p.brandLogoUrl ? p.brandLogoUrl : undefined,
    }
    applyConfig(config)
  })

  // Tell the parent we're alive, in case it wants to (re)post the init payload.
  try {
    window.parent?.postMessage({ type: 'kolbo-video-studio:ready' }, '*')
  } catch {
    // No parent (standalone dev) — ignore.
  }
}

export function getCurrentBrand(): { name: string; logoUrl?: string } {
  const cfg = window.KOLBO_VIDEO_STUDIO_CONFIG
  return {
    name: cfg?.brandName ?? 'Kolbo Studio',
    logoUrl: cfg?.brandLogoUrl,
  }
}

export const KOLBO_CONFIG_READY_EVENT = READY_EVENT
