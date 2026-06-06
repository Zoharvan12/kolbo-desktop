// Kolbo API adapter for Kolbo Video Studio.
//
// Verified against the kolbo-api SDK module (G:/Projects/Kolbo.AI/github/
// kolbo-api/src/modules/sdk/) — the public, version-locked Developer API:
//
//   POST /api/v1/generate/video               text-to-video
//   POST /api/v1/generate/video/from-image    image-to-video
//   POST /api/v1/generate/image               text-to-image
//   POST /api/v1/generate/first-last-frame    gap-fill (start+end frames)
//   POST /api/v1/edit/video                   video edit
//   POST /api/v1/media/upload                 reference image/video upload
//   GET  /api/v1/generate/:generationId/status   async poll
//   GET  /api/v1/models?type=text_to_video    model listing
//   GET  /api/v1/account/credits              credit balance
//
// Auth: kolbo-api accepts EITHER `X-API-Key: kolbo_live_...` OR
// `Authorization: Bearer <JWT>`. kolbo-desktop already has the user JWT
// (window.kolboAPI.getToken()) so we forward that — no separate API-key
// provisioning needed.
//
// Generation flow: kolbo-api returns 200 immediately with
// `{success, generation_id, poll_url, poll_interval_hint}`. We then GET the
// poll_url every `poll_interval_hint` seconds until `state === 'completed'`,
// at which point `result.urls[0]` is the URL we hand back to LTX's UI as
// `video_path`.

export type KolboVideoStudioConfig = {
  /** Kolbo user JWT (kolbo-desktop forwards what kolboAPI.getToken() returns) */
  token: string
  /** Origin only, e.g. https://api.kolbo.ai — no path. Adapter appends /api/v1. */
  apiBaseUrl: string
  /** Dynamic brand label ("Kolbo Studio", whitelabel name, ...) */
  brandName: string
  /** Optional brand logo URL shown in the home banner */
  brandLogoUrl?: string
}

declare global {
  interface Window {
    KOLBO_VIDEO_STUDIO_CONFIG?: KolboVideoStudioConfig
    KOLBO_CONFIG?: { apiUrl?: string; webappUrl?: string; environment?: string }
  }
}

function readConfig(): KolboVideoStudioConfig {
  const injected = window.KOLBO_VIDEO_STUDIO_CONFIG
  if (injected) return injected
  const parentCfg = window.KOLBO_CONFIG
  // KOLBO_CONFIG.apiUrl is typically already ".../api" — strip the trailing
  // /api so we can append /api/v1 ourselves.
  const raw = parentCfg?.apiUrl ?? 'https://api.kolbo.ai'
  const apiBaseUrl = raw.replace(/\/api\/?$/, '')
  return { token: '', apiBaseUrl, brandName: 'Kolbo Studio' }
}

export function getKolboConfig(): KolboVideoStudioConfig {
  return readConfig()
}

export function resetBackendCredentials(): void {
  // No-op. Config is read fresh from window each call.
}

export async function backendWsUrl(_path: string): Promise<string> {
  // No WebSocket transport — the SDK is HTTP-poll. Return a non-connecting URL
  // so existing WS cleanup paths don't crash.
  return 'wss://kolbo-video-studio.invalid'
}

// ---- Helpers ---------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function notImplemented(path: string, method: string): Response {
  console.warn(`[kolbo-video-studio] ${method} ${path} — not implemented in Kolbo adapter`)
  return jsonResponse(
    { code: 'NOT_IMPLEMENTED', message: `${method} ${path} is not implemented in Kolbo Video Studio yet.` },
    501,
  )
}

async function readJsonBody(init?: RequestInit): Promise<Record<string, unknown> | undefined> {
  if (!init?.body) return undefined
  if (typeof init.body !== 'string') return undefined
  try {
    return JSON.parse(init.body)
  } catch {
    return undefined
  }
}

// ---- Kolbo API calls -------------------------------------------------------

type KolboSdkState = 'processing' | 'completed' | 'failed' | 'cancelled'

type KolboSdkStatusResponse = {
  success: boolean
  generation_id: string
  type: string
  state: KolboSdkState
  progress?: number
  result?: { urls?: string[]; thumbnail_url?: string | null; duration?: number | null; aspect_ratio?: string | null; prompt_used?: string }
  error?: string
  credits_used?: number
}

type KolboSdkGenerationResponse = {
  success: boolean
  generation_id?: string
  type?: string
  model?: string
  credits_charged?: number | null
  poll_url?: string
  poll_interval_hint?: number
  error?: string
  code?: string
}

function v1Path(path: string): string {
  const cfg = readConfig()
  return `${cfg.apiBaseUrl.replace(/\/$/, '')}/api/v1${path}`
}

function authHeaders(extra: HeadersInit = {}): Headers {
  const cfg = readConfig()
  const headers = new Headers(extra)
  if (cfg.token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${cfg.token}`)
  }
  return headers
}

async function kolboFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = authHeaders(init.headers)
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(v1Path(path), { ...init, headers })
}

async function pollUntilDone(pollUrl: string, intervalSec: number, signal?: AbortSignal): Promise<KolboSdkStatusResponse> {
  // kolbo-api returns poll_url as "/v1/generate/:id/status" — strip the leading
  // /v1 since v1Path already adds /api/v1.
  const path = pollUrl.replace(/^\/?v1/, '').replace(/^\/?api\/v1/, '') || pollUrl
  const interval = Math.max(2, Math.min(intervalSec || 8, 30)) * 1000
  // Cap at 15 minutes — Kolbo video gen can be slow on busy queues.
  const TIMEOUT_MS = 15 * 60 * 1000
  const startedAt = Date.now()
  while (Date.now() - startedAt < TIMEOUT_MS) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const response = await kolboFetch(path, { method: 'GET', signal })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Status poll failed (${response.status}): ${text || response.statusText}`)
    }
    const payload = (await response.json()) as KolboSdkStatusResponse
    if (payload.state === 'completed' || payload.state === 'failed' || payload.state === 'cancelled') {
      return payload
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  throw new Error('Generation timed out')
}

function firstResultUrl(status: KolboSdkStatusResponse): string | undefined {
  return status.result?.urls?.find(Boolean)
}

async function runKolboVideoGeneration(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  // LTX UI sends camelCase ({prompt, model, duration, resolution, fps, audio,
  // cameraMotion, negativePrompt, aspectRatio, imagePath?, audioPath?}). Map
  // to Kolbo SDK snake_case. We drop fps/cameraMotion/audio — Kolbo's API
  // doesn't expose those at the SDK layer (the underlying model picks them).
  const isImageToVideo = typeof body.imagePath === 'string' && body.imagePath
  const endpoint = isImageToVideo ? '/generate/video/from-image' : '/generate/video'

  const kolboBody: Record<string, unknown> = {
    prompt: body.prompt,
    duration: typeof body.duration === 'number' ? body.duration : 5,
    aspect_ratio: typeof body.aspectRatio === 'string' ? body.aspectRatio : '16:9',
  }
  if (typeof body.resolution === 'string') kolboBody.resolution = body.resolution
  // Pass user-selected Kolbo model identifier only — drop LTX-internal tokens.
  if (typeof body.model === 'string' && body.model && !['pro', 'fast', 'distilled', 'auto'].includes(body.model)) {
    kolboBody.model = body.model
  }
  if (isImageToVideo) {
    const imagePath = body.imagePath as string
    if (!/^https?:\/\//i.test(imagePath)) {
      return jsonResponse(
        {
          code: 'IMAGE_NOT_UPLOADED',
          message: 'Reference image must be a public URL. Upload it via /api/v1/media/upload first or pick from the Media Library.',
        },
        400,
      )
    }
    kolboBody.image_url = imagePath
  } else if (Array.isArray((body as { reference_images?: unknown }).reference_images)) {
    kolboBody.reference_images = (body as { reference_images: string[] }).reference_images
  }

  let initial: Response
  try {
    initial = await kolboFetch(endpoint, { method: 'POST', body: JSON.stringify(kolboBody), signal })
  } catch (err) {
    return jsonResponse(
      { code: 'KOLBO_NETWORK_ERROR', message: err instanceof Error ? err.message : 'Network error contacting Kolbo API' },
      502,
    )
  }
  const initialText = await initial.text().catch(() => '')
  if (!initial.ok) {
    return jsonResponse(
      { code: `KOLBO_HTTP_${initial.status}`, message: initialText || initial.statusText || 'Kolbo rejected the request' },
      initial.status >= 400 && initial.status < 500 ? 400 : 502,
    )
  }
  let initialPayload: KolboSdkGenerationResponse
  try {
    initialPayload = JSON.parse(initialText) as KolboSdkGenerationResponse
  } catch {
    return jsonResponse({ code: 'KOLBO_BAD_JSON', message: initialText }, 502)
  }
  if (!initialPayload.success || !initialPayload.generation_id) {
    return jsonResponse(
      { code: initialPayload.code ?? 'KOLBO_REJECTED', message: initialPayload.error ?? 'Kolbo returned no generation_id' },
      400,
    )
  }

  let status: KolboSdkStatusResponse
  try {
    status = await pollUntilDone(
      initialPayload.poll_url ?? `/generate/${initialPayload.generation_id}/status`,
      initialPayload.poll_interval_hint ?? 8,
      signal,
    )
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return jsonResponse({ status: 'cancelled' })
    }
    return jsonResponse(
      { code: 'KOLBO_POLL_ERROR', message: err instanceof Error ? err.message : 'Polling failed' },
      502,
    )
  }

  if (status.state === 'cancelled') return jsonResponse({ status: 'cancelled' })
  if (status.state === 'failed') {
    return jsonResponse({ code: 'KOLBO_FAILED', message: status.error ?? 'Generation failed' }, 500)
  }
  const url = firstResultUrl(status)
  if (!url) {
    return jsonResponse({ code: 'KOLBO_NO_RESULT', message: 'Completed with no video URL' }, 500)
  }
  return jsonResponse({ status: 'complete', video_path: url })
}

async function runKolboImageGeneration(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const kolboBody: Record<string, unknown> = {
    prompt: body.prompt,
    aspect_ratio: typeof body.aspectRatio === 'string' ? body.aspectRatio : '1:1',
  }
  if (typeof body.resolution === 'string') kolboBody.resolution = body.resolution
  if (typeof body.model === 'string' && body.model && !['pro', 'fast', 'auto'].includes(body.model)) {
    kolboBody.model = body.model
  }

  let initial: Response
  try {
    initial = await kolboFetch('/generate/image', { method: 'POST', body: JSON.stringify(kolboBody), signal })
  } catch (err) {
    return jsonResponse({ code: 'KOLBO_NETWORK_ERROR', message: err instanceof Error ? err.message : 'Network error' }, 502)
  }
  if (!initial.ok) {
    const text = await initial.text().catch(() => '')
    return jsonResponse({ code: `KOLBO_HTTP_${initial.status}`, message: text || initial.statusText }, 400)
  }
  const initialPayload = (await initial.json()) as KolboSdkGenerationResponse
  if (!initialPayload.success || !initialPayload.generation_id) {
    return jsonResponse({ code: initialPayload.code ?? 'KOLBO_REJECTED', message: initialPayload.error ?? 'No generation_id' }, 400)
  }
  let status: KolboSdkStatusResponse
  try {
    status = await pollUntilDone(
      initialPayload.poll_url ?? `/generate/${initialPayload.generation_id}/status`,
      initialPayload.poll_interval_hint ?? 3,
      signal,
    )
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return jsonResponse({ status: 'cancelled' })
    return jsonResponse({ code: 'KOLBO_POLL_ERROR', message: err instanceof Error ? err.message : 'Polling failed' }, 502)
  }
  if (status.state === 'failed') return jsonResponse({ code: 'KOLBO_FAILED', message: status.error ?? 'Image gen failed' }, 500)
  const urls = status.result?.urls ?? []
  const primary = urls[0]
  if (!primary) return jsonResponse({ code: 'KOLBO_NO_RESULT', message: 'No image URL' }, 500)
  return jsonResponse({ status: 'complete', image_path: primary, image_paths: urls })
}

async function runKolboFirstLastFrame(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  // Used by LTX's "AI gap-fill" between two clips. The clip thumbnails get
  // sent as URLs; if those are local file paths we surface a clear error.
  const firstFrame = body.firstFrameUrl as string | undefined
  const lastFrame = body.lastFrameUrl as string | undefined
  if (!firstFrame || !lastFrame) {
    return jsonResponse({ code: 'MISSING_FRAMES', message: 'firstFrameUrl and lastFrameUrl are required' }, 400)
  }
  if (!/^https?:\/\//i.test(firstFrame) || !/^https?:\/\//i.test(lastFrame)) {
    return jsonResponse(
      { code: 'FRAMES_NOT_UPLOADED', message: 'Both frames must be public URLs. Upload via /api/v1/media/upload first.' },
      400,
    )
  }
  const kolboBody: Record<string, unknown> = {
    first_frame_url: firstFrame,
    last_frame_url: lastFrame,
    prompt: typeof body.prompt === 'string' ? body.prompt : '',
    duration: typeof body.duration === 'number' ? body.duration : 5,
    aspect_ratio: typeof body.aspectRatio === 'string' ? body.aspectRatio : '16:9',
  }
  if (typeof body.model === 'string' && body.model) kolboBody.model = body.model

  let initial: Response
  try {
    initial = await kolboFetch('/generate/first-last-frame', { method: 'POST', body: JSON.stringify(kolboBody), signal })
  } catch (err) {
    return jsonResponse({ code: 'KOLBO_NETWORK_ERROR', message: err instanceof Error ? err.message : 'Network error' }, 502)
  }
  if (!initial.ok) {
    const text = await initial.text().catch(() => '')
    return jsonResponse({ code: `KOLBO_HTTP_${initial.status}`, message: text || initial.statusText }, 400)
  }
  const initialPayload = (await initial.json()) as KolboSdkGenerationResponse
  if (!initialPayload.success || !initialPayload.generation_id) {
    return jsonResponse({ code: 'KOLBO_REJECTED', message: initialPayload.error ?? 'No generation_id' }, 400)
  }
  let status: KolboSdkStatusResponse
  try {
    status = await pollUntilDone(
      initialPayload.poll_url ?? `/generate/${initialPayload.generation_id}/status`,
      initialPayload.poll_interval_hint ?? 8,
      signal,
    )
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return jsonResponse({ status: 'cancelled' })
    return jsonResponse({ code: 'KOLBO_POLL_ERROR', message: err instanceof Error ? err.message : 'Polling failed' }, 502)
  }
  if (status.state === 'failed') return jsonResponse({ code: 'KOLBO_FAILED', message: status.error ?? 'Failed' }, 500)
  const url = firstResultUrl(status)
  if (!url) return jsonResponse({ code: 'KOLBO_NO_RESULT', message: 'No URL' }, 500)
  return jsonResponse({ status: 'complete', video_path: url })
}

// ---- Exposed Kolbo helpers (consumed by Kolbo-specific UI like model picker
//      and credits widget — not by LTX's ApiClient). -------------------------

export type KolboModel = {
  identifier: string
  name: string
  provider: string
  types: string[]
  credit: number | null
  supported_aspect_ratios: string[]
  supported_durations: number[] | null
  supported_resolutions: string[]
  default_duration: number | null
  max_video_duration: number | null
  max_reference_images: number | null
}

export async function fetchKolboModels(type?: string): Promise<KolboModel[]> {
  const path = type ? `/models?type=${encodeURIComponent(type)}` : '/models'
  const response = await kolboFetch(path, { method: 'GET' })
  if (!response.ok) throw new Error(`Failed to list models (${response.status})`)
  const payload = (await response.json()) as { success: boolean; models: KolboModel[] }
  return payload.models ?? []
}

export async function fetchKolboCredits(): Promise<{ total: number; planCredits: number; creditPack: number; redemption: number } | null> {
  const response = await kolboFetch('/account/credits', { method: 'GET' })
  if (!response.ok) return null
  const payload = (await response.json()) as { success: boolean; credits?: { total: number; plan_credits: number; credit_pack: number; redemption: number } }
  if (!payload.success || !payload.credits) return null
  return {
    total: payload.credits.total,
    planCredits: payload.credits.plan_credits,
    creditPack: payload.credits.credit_pack,
    redemption: payload.credits.redemption,
  }
}

// ---- Synthetic boot-time responses -----------------------------------------

function settingsDefaults() {
  // Matches SettingsResponse from kolbo-api's vendored OpenAPI schema. All
  // fields optional — listed for explicit shape parity. hasLtxApiKey=true
  // skips LTX's API-key gate (real auth is the Kolbo JWT we forward).
  return {
    hasLtxApiKey: true,
    hasFalApiKey: true,
    hasGeminiApiKey: false,
    userPrefersLtxApiVideoGenerations: true,
    promptEnhancerEnabledT2V: false,
    promptEnhancerEnabledI2V: false,
    promptCacheSize: 0,
    seedLocked: false,
    lockedSeed: 0,
    modelsDir: '',
    useLocalTextEncoder: false,
    useTorchCompile: false,
  }
}

function runtimePolicyDefaults() {
  // RuntimePolicyResponse only requires `force_api_generations`.
  return { force_api_generations: false }
}

// ---- Router ----------------------------------------------------------------

export async function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const cleanPath = path.split('?')[0]

  // 1. Real Kolbo generation routes ----------------------------------------
  if (method === 'POST' && cleanPath === '/api/generate') {
    const body = (await readJsonBody(init)) ?? {}
    return runKolboVideoGeneration(body, init?.signal ?? undefined)
  }
  if (method === 'POST' && cleanPath === '/api/generate-image') {
    const body = (await readJsonBody(init)) ?? {}
    return runKolboImageGeneration(body, init?.signal ?? undefined)
  }
  if (method === 'POST' && cleanPath === '/api/retake') {
    // Retake = re-run the same video gen with a (possibly tweaked) prompt.
    const body = (await readJsonBody(init)) ?? {}
    return runKolboVideoGeneration(body, init?.signal ?? undefined)
  }
  if (method === 'POST' && cleanPath === '/api/ic-lora/generate') {
    // LTX's gap-fill modal calls this with start/end frame URLs.
    const body = (await readJsonBody(init)) ?? {}
    return runKolboFirstLastFrame(body, init?.signal ?? undefined)
  }
  if (method === 'POST' && cleanPath === '/api/generate/cancel') {
    return jsonResponse({ ok: true })
  }
  if (method === 'GET' && cleanPath === '/api/generation/progress') {
    // GenerationProgressResponse requires status + phase + progress +
    // currentStep + totalSteps. Kolbo's SDK only exposes coarse state, so
    // expose constant inference snapshot; LTX's UI does its own time-based
    // progress interpolation on top.
    return jsonResponse({
      status: 'in_progress',
      phase: 'inference',
      progress: 0,
      currentStep: 0,
      totalSteps: 0,
    })
  }

  // 2. Boot-time stubs ------------------------------------------------------
  // All shapes below match the schemas in frontend/generated/backend-openapi.json
  // exactly (required keys present, types correct) so the OpenAPI-typed
  // ApiClient never reads `.length` on undefined.
  if (cleanPath === '/health') return jsonResponse({ status: 'ok' })
  if (method === 'GET' && cleanPath === '/api/runtime-policy') return jsonResponse(runtimePolicyDefaults())
  if (method === 'GET' && cleanPath === '/api/settings') return jsonResponse(settingsDefaults())
  if (method === 'POST' && cleanPath === '/api/settings') return jsonResponse({ status: 'ok' }) // StatusResponse
  if (cleanPath === '/api/gpu-info') {
    // GpuInfoResponse: cuda_available, gpu_name, vram_gb, gpu_info required.
    return jsonResponse({
      cuda_available: false,
      mps_available: false,
      gpu_available: false,
      gpu_name: null,
      vram_gb: null,
      gpu_info: { vendor: null, name: null, vram_gb: null, driver: null },
    })
  }
  if (cleanPath === '/api/models/ltx-recommendation') {
    // LtxOkRecommendationResponse: { status: 'ok' } — App.tsx checks status !== 'download'.
    return jsonResponse({ status: 'ok' })
  }
  if (cleanPath === '/api/models/img-gen-recommendation') {
    // ImageGenRecommendationResponse: cp_to_download required (null = nothing to download).
    return jsonResponse({ cp_to_download: null })
  }
  if (cleanPath === '/api/models/ltx-ic-lora-recommendation') {
    // LtxIcLoraRecommendationResponse: cps_to_download required (array).
    return jsonResponse({ cps_to_download: [] })
  }
  if (cleanPath === '/api/models/text-encoder-recommendation') {
    // TextEncoderRecommendationResponse: cp_to_download + expected_size_bytes + expected_size_gb required.
    return jsonResponse({ cp_to_download: null, expected_size_bytes: 0, expected_size_gb: 0 })
  }
  if (cleanPath === '/api/models/check-access') {
    // CheckModelAccessResponse: { access }.
    return jsonResponse({ access: true })
  }
  if (cleanPath === '/api/models/download') {
    // ModelDownloadStartResponse: status + message + sessionId required.
    return jsonResponse({ status: 'already_present', message: 'Model is hosted by Kolbo', sessionId: 'kolbo-noop' })
  }
  if (cleanPath === '/api/models/download/progress') {
    // DownloadProgressCompleteResponse: { status: 'complete' }.
    return jsonResponse({ status: 'complete' })
  }
  if (cleanPath === '/api/models/delete') return jsonResponse({ status: 'ok' })
  if (cleanPath === '/api/generate/models-specs') {
    // GenerateVideoModelsSpecsResponse requires both arrays. Empty is fine —
    // getVideoGenerationModelSpecs() short-circuits cleanly on [].
    return jsonResponse({ api_models: [], local_models: [] })
  }
  if (cleanPath === '/api/suggest-gap-prompt') {
    // SuggestGapPromptResponse: suggested_prompt required.
    const body = (await readJsonBody(init)) ?? {}
    const ctx = typeof body.context_prompt === 'string' ? body.context_prompt : ''
    return jsonResponse({ status: 'ok', suggested_prompt: ctx })
  }
  if (cleanPath.startsWith('/api/auth/huggingface/')) {
    return jsonResponse({ logged_in: false, status: 'logged_out' })
  }
  if (cleanPath === '/api/system/shutdown') return jsonResponse({ status: 'ok' })
  if (cleanPath.startsWith('/api/ic-lora/')) {
    return notImplemented(cleanPath, method)
  }

  // 3. Unknown — log and fail soft -----------------------------------------
  return notImplemented(cleanPath, method)
}

// Back-compat alias for any caller still importing the old name.
export async function getBackendCredentials(): Promise<{ url: string; token: string }> {
  const cfg = readConfig()
  return { url: cfg.apiBaseUrl, token: cfg.token }
}
