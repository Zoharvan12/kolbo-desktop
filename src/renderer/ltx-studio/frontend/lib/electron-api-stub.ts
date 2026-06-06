// Stub implementation of LTX-Desktop's window.electronAPI for the Kolbo Video
// Studio sub-app. The original IPC bridge talks to LTX's deleted main process +
// Python backend. Here we install no-op / safe-default handlers so the React
// app can mount inside a file:// page hosted by kolbo-desktop.
//
// TODO(kolbo-video-studio): replace these stubs with real implementations that
// go through kolbo-desktop's IPC bridge for file dialogs / asset copy / etc.,
// and that route HTTP via a Kolbo API adapter instead of a localhost backend.

import type { ElectronAPI, BackendHealthStatus } from '../../shared/electron-api-schema'

type AnyFn = (...args: unknown[]) => unknown
type ListenerMap<T> = Set<(value: T) => void>

const backendHealthListeners: ListenerMap<BackendHealthStatus> = new Set()

function notImplemented(method: string) {
  return async (..._args: unknown[]) => {
    console.warn(`[kolbo-video-studio] electronAPI.${method}() called but not yet wired up.`)
    throw new Error(`electronAPI.${method}() is not implemented in Kolbo Video Studio yet.`)
  }
}

function emptyOk() {
  return async () => ({ success: true as const })
}

function ok(payload: Record<string, unknown> = {}) {
  return async () => ({ success: true as const, ...payload })
}

// Concrete safe defaults for the methods the app calls during boot.
const defaults: Partial<Record<keyof ElectronAPI, AnyFn>> = {
  getAppInfo: async () => ({
    version: '0.1.0-wip',
    isPackaged: true,
    modelsPath: '',
    userDataPath: '',
  }),
  getBackend: async () => ({
    // Placeholder. The Kolbo API adapter (TODO) will replace backendFetch so
    // this URL is never actually hit.
    url: 'http://kolbo-api-adapter.invalid',
    token: '',
  }),
  getModelsPath: async () => '',
  getResourcePath: async () => null,
  getDownloadsPath: async () => '',
  getProjectAssetsPath: async () => '',
  checkPythonReady: async () => ({ ready: true }),
  startPythonSetup: async () => undefined,
  startPythonBackend: async () => undefined,
  getBackendHealthStatus: async (): Promise<BackendHealthStatus> => ({ status: 'alive' }),
  checkFirstRun: async () => ({ needsSetup: false, needsLicense: false }),
  acceptLicense: async () => true,
  completeSetup: async () => true,
  fetchLicenseText: async () => '',
  getNoticesText: async () => '',
  checkGpu: async () => ({ available: false }),
  getAnalyticsState: async () => ({ analyticsEnabled: false, installationId: 'kolbo-video-studio' }),
  setAnalyticsEnabled: async () => undefined,
  sendAnalyticsEvent: async () => undefined,
  writeLog: async () => undefined,
  getLogs: async () => ({ logPath: '', lines: [] }),
  getLogPath: async () => ({ logPath: '', logDir: '' }),
  openLogFolder: async () => true,
  openLtxApiKeyPage: async () => true,
  openLtxBillingPage: async () => true,
  openFalApiKeyPage: async () => true,
  openHuggingFaceRepo: async () => true,
  openHuggingFaceAuth: async () => true,
  openParentFolderOfFile: async () => undefined,
  showItemInFolder: async () => undefined,
  checkFilesExist: async () => ({}),
  searchDirectoryForFiles: async () => ({}),
  showOpenFileDialog: async () => null,
  showOpenDirectoryDialog: async () => null,
  showSaveDialog: async () => null,
  saveFile: emptyOk() as AnyFn,
  saveBinaryFile: emptyOk() as AnyFn,
  exportCancel: emptyOk() as AnyFn,
  openModelsDirChangeDialog: ok({ path: '' }) as AnyFn,
  openProjectAssetsPathChangeDialog: ok({ path: '' }) as AnyFn,
  addVisualAssetToProject: notImplemented('addVisualAssetToProject'),
  addGenericAssetToProject: notImplemented('addGenericAssetToProject'),
  makeThumbnailsForProjectAsset: notImplemented('makeThumbnailsForProjectAsset'),
  makeDimensionsForProjectAsset: notImplemented('makeDimensionsForProjectAsset'),
  extractVideoFrame: notImplemented('extractVideoFrame'),
  exportNative: notImplemented('exportNative'),
  readLocalFile: notImplemented('readLocalFile'),
}

export function installElectronApiStub() {
  if (typeof window === 'undefined') return
  // If the host (kolbo-desktop preload, eventually) already installed a real
  // bridge, leave it alone.
  const existing = (window as unknown as { electronAPI?: unknown }).electronAPI
  if (existing) return

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === 'platform') return navigator.platform || 'kolbo'
      if (prop === 'hfGatingEnabled') return false
      if (prop === 'getPathForFile') return (_file: File) => ''
      if (prop === 'onPythonSetupProgress') return (_cb: (data: unknown) => void) => undefined
      if (prop === 'removePythonSetupProgress') return () => undefined
      if (prop === 'onBackendHealthStatus') {
        return (cb: (data: BackendHealthStatus) => void) => {
          backendHealthListeners.add(cb)
          return () => backendHealthListeners.delete(cb)
        }
      }

      const key = prop as keyof ElectronAPI
      const concrete = defaults[key]
      if (concrete) return concrete
      return notImplemented(String(prop))
    },
  }

  ;(window as unknown as { electronAPI: unknown }).electronAPI = new Proxy({}, handler)
}
