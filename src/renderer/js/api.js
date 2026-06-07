// ============================================================================
// KOLBO.AI API CLIENT - ELECTRON VERSION
// ============================================================================
//
// PURPOSE:
// API client for Electron renderer process
// Wraps IPC calls to main process which makes actual HTTP requests
//
// KEY DIFFERENCES FROM PLUGIN:
// - No direct HTTP requests (all proxied through main process)
// - Authentication handled by main process (auth-manager.js)
// - Media API calls proxied through main process (file-manager.js)
// - Token management still in localStorage for UI state
//
// ARCHITECTURE:
// Renderer (this file) → IPC → Main Process → HTTP → Kolbo API
//
// API ENDPOINTS (proxied):
// - login(email, password) - Email/password login via IPC
// - googleLogin() - Google OAuth via IPC (opens browser)
// - getMedia(options) - Fetch media via IPC
// - getProjects() - Fetch projects via IPC
// - logout() - Clear token via IPC
//
// ============================================================================

/**
 * Get API base URL from centralized config
 * NOTE: In Electron, the actual API URL is managed by main process via config.js
 * This is just for UI display purposes
 */
function getApiBaseUrl() {
  // Use centralized config
  if (typeof window.KOLBO_CONFIG !== 'undefined') {
    return window.KOLBO_CONFIG.apiUrl;
  }

  // Fallback to localStorage (for compatibility)
  const stored = localStorage.getItem('API_BASE_URL');
  if (stored) {
    return stored;
  }

  // Final fallback
  return 'http://localhost:5050/api';
}

const API_BASE_URL = getApiBaseUrl();

class KolboAPI {
  constructor() {
    this.token = this.getToken();
    this.apiBaseUrl = API_BASE_URL;
    this.DEBUG_MODE = localStorage.getItem('KOLBO_DEBUG') === 'true';
    this._syncPromise = null;
  }

  // Sync token from main process (electron-store) to renderer (localStorage)
  // This ensures tokens persist across app restarts
  // MUST be called before isAuthenticated() check on app startup
  async syncTokenFromMainProcess() {
    // Return existing promise if already syncing
    if (this._syncPromise) {
      return this._syncPromise;
    }

    this._syncPromise = (async () => {
      try {
        if (window.kolboDesktop && window.kolboDesktop.getToken) {
          const mainProcessToken = await window.kolboDesktop.getToken();
          if (mainProcessToken) {
            // Sync to localStorage
            localStorage.setItem('token', mainProcessToken);
            localStorage.setItem('kolbo_token', mainProcessToken);
            localStorage.setItem('kolbo_access_token', mainProcessToken);

            // Update instance token
            this.token = mainProcessToken;

            if (this.DEBUG_MODE) {
              console.log('[API] Token synced from main process to renderer');
            }
          }
        }
      } catch (error) {
        console.error('[API] Failed to sync token from main process:', error);
      }
    })();

    return this._syncPromise;
  }

  // Set API URL (for switching between staging/production)
  // NOTE: This updates localStorage but main process reads from electron-store
  setApiUrl(url) {
    if (this.DEBUG_MODE) {
      console.log('[API] Setting API URL to:', url);
    }
    this.apiBaseUrl = url;
    localStorage.setItem('API_BASE_URL', url);
  }

  // Get current API URL
  getApiUrl() {
    return this.apiBaseUrl || getApiBaseUrl();
  }

  // Get token from multiple possible locations (for UI state only)
  // Actual authentication is handled by main process
  getToken() {
    // Try 'token' first (primary location)
    let token = localStorage.getItem('token');
    let source = 'token';

    // Fallback to 'kolbo_access_token'
    if (!token) {
      token = localStorage.getItem('kolbo_access_token');
      source = 'kolbo_access_token';
    }

    // Fallback to old 'kolbo_token'
    if (!token) {
      token = localStorage.getItem('kolbo_token');
      source = 'kolbo_token';
    }

    if (token && this.DEBUG_MODE) {
      console.log(`[API] Token found in localStorage key: ${source}`);
      console.log(`[API] Token value: ${token.substring(0, 20)}...`);
    } else if (!token && this.DEBUG_MODE) {
      console.log('[API] No token found in localStorage');
    }

    return token;
  }

  setToken(token) {
    if (this.DEBUG_MODE) {
      console.log('[API] setToken called with:', token ? token.substring(0, 20) + '...' : 'NULL');
    }
    this.token = token;

    try {
      // Store in 'token' key
      localStorage.setItem('token', token);

      // Also store in kolbo_token for backwards compatibility
      localStorage.setItem('kolbo_token', token);

      // And kolbo_access_token
      localStorage.setItem('kolbo_access_token', token);

      if (this.DEBUG_MODE) {
        console.log('[API] Token stored in localStorage');
      }
    } catch (e) {
      console.error('[API] localStorage.setItem FAILED:', e);
    }
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('token');
    localStorage.removeItem('kolbo_token');
    localStorage.removeItem('kolbo_access_token');
  }

  isAuthenticated() {
    return !!this.token;
  }

  // ============================================================================
  // AUTHENTICATION (via IPC to main process)
  // ============================================================================

  /**
   * Email/password login
   * Calls main process auth-manager.js
   */
  async login(email, password) {
    if (this.DEBUG_MODE) {
      console.log('[API] Login attempt via IPC:', email);
    }

    try {
      const response = await window.kolboDesktop.login(email, password);

      if (this.DEBUG_MODE) {
        console.log('[API] Login response:', response);
      }

      if (response.success && response.token) {
        this.setToken(response.token);
        return { success: true, token: response.token };
      } else {
        return { success: false, error: response.error || 'Login failed' };
      }
    } catch (error) {
      console.error('[API] Login error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Google OAuth login
   * Opens browser and polls for token
   * Calls main process auth-manager.js
   */
  async googleLogin() {
    if (this.DEBUG_MODE) {
      console.log('[API] Google login via IPC');
    }

    // Check if Electron bridge is available
    if (!window.kolboDesktop || !window.kolboDesktop.googleLogin) {
      console.error('[API] window.kolboDesktop is not available. Make sure preload.js is loaded correctly.');
      console.error('[API] window.kolboDesktop:', window.kolboDesktop);
      return {
        success: false,
        error: 'Electron bridge not available. Please restart the app.'
      };
    }

    try {
      const response = await window.kolboDesktop.googleLogin();

      if (this.DEBUG_MODE) {
        console.log('[API] Google login response:', response);
      }

      if (response.success && response.token) {
        this.setToken(response.token);
        return { success: true, token: response.token };
      } else {
        return { success: false, error: response.error || 'Google login failed' };
      }
    } catch (error) {
      console.error('[API] Google login error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Logout
   * Clears token from main process and renderer
   */
  async logout() {
    if (this.DEBUG_MODE) {
      console.log('[API] Logout via IPC');
    }

    try {
      await window.kolboDesktop.logout();
      this.clearToken();
      return { success: true };
    } catch (error) {
      console.error('[API] Logout error:', error);
      // Still clear local token even if IPC fails
      this.clearToken();
      return { success: false, error: error.message };
    }
  }

  // ============================================================================
  // PROJECTS (via IPC to main process)
  // ============================================================================

  /**
   * Get user projects
   * Calls main process file-manager.js → Kolbo API
   */
  async getProjects() {
    if (this.DEBUG_MODE) {
      console.log('[API] Get projects via IPC');
    }

    try {
      const response = await window.kolboDesktop.getProjects();

      if (this.DEBUG_MODE) {
        console.log('[API] Get projects response:', response);
      }

      if (response.success) {
        return response.data;
      } else {
        throw new Error(response.error || 'Failed to fetch projects');
      }
    } catch (error) {
      console.error('[API] Get projects error:', error);
      throw error;
    }
  }

  // ============================================================================
  // MEDIA (via IPC to main process)
  // ============================================================================

  /**
   * Get user media with filters
   * Calls main process file-manager.js → Kolbo API
   */
  async getMedia(options = {}) {
    if (this.DEBUG_MODE) {
      console.log('[API] Get media via IPC:', options);
    }

    try {
      const response = await window.kolboDesktop.getMedia(options);

      if (this.DEBUG_MODE) {
        console.log('[API] Get media response:', response);
      }

      if (response.success) {
        return response.data;
      } else {
        throw new Error(response.error || 'Failed to fetch media');
      }
    } catch (error) {
      console.error('[API] Get media error:', error);
      throw error;
    }
  }

  /**
   * Get trash (soft-deleted items, 30-day retention)
   */
  async getTrash(options = {}) {
    if (this.DEBUG_MODE) console.log('[API] Get trash via IPC');
    try {
      const response = await window.kolboDesktop.getTrash(options);
      if (response.success) return response.data;
      throw new Error(response.error || 'Failed to fetch trash');
    } catch (error) {
      console.error('[API] Get trash error:', error);
      throw error;
    }
  }

  async favoriteMedia(id) {
    const response = await window.kolboDesktop.favoriteMedia(id);
    if (!response.success) throw new Error(response.error || 'Favorite failed');
    return response.data;
  }

  async unfavoriteMedia(id) {
    const response = await window.kolboDesktop.unfavoriteMedia(id);
    if (!response.success) throw new Error(response.error || 'Unfavorite failed');
    return response.data;
  }

  async deleteMedia(id) {
    const response = await window.kolboDesktop.deleteMedia(id);
    if (!response.success) throw new Error(response.error || 'Delete failed');
    return response.data;
  }

  async bulkDeleteMedia(fileIds) {
    const response = await window.kolboDesktop.bulkDeleteMedia(fileIds);
    if (!response.success) throw new Error(response.error || 'Bulk delete failed');
    return response.data;
  }

  async restoreMedia(id) {
    const response = await window.kolboDesktop.restoreMedia(id);
    if (!response.success) throw new Error(response.error || 'Restore failed');
    return response.data;
  }

  async permanentDeleteMedia(id) {
    const response = await window.kolboDesktop.permanentDeleteMedia(id);
    if (!response.success) throw new Error(response.error || 'Permanent delete failed');
    return response.data;
  }

  async bulkPermanentDeleteMedia(mediaIds) {
    const response = await window.kolboDesktop.bulkPermanentDeleteMedia(mediaIds);
    if (!response.success) throw new Error(response.error || 'Bulk permanent delete failed');
    return response.data;
  }

  /**
   * Get recent media
   * NOTE: This is a simplified version - just gets first page
   */
  async getRecentMedia() {
    if (this.DEBUG_MODE) {
      console.log('[API] Get recent media via IPC');
    }

    return this.getMedia({
      page: 1,
      pageSize: 20,
      sort: '-created'
    });
  }

  // ==========================================================================
  // Synci licensed-music library
  // ==========================================================================
  // Thin client over the shared /synci/* backend endpoints. Read endpoints are
  // public (work for guests); favorites/downloads/analyze-script require auth.
  // Unlike the rest of KolboAPI (which proxies via IPC), these use direct
  // fetch() — the renderer is a normal Chromium context and the Synci endpoints
  // accept the same file://-origin requests the Adobe (CEP) plugin already makes.
  // Method names + request/response shapes mirror the plugin's api.js so the
  // ported SynciManager runs unchanged.

  _synciHeaders(json = true) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  _synciQuery(params) {
    const usp = new URLSearchParams();
    Object.keys(params || {}).forEach((key) => {
      const value = params[key];
      if (value !== undefined && value !== null && value !== '') usp.set(key, value);
    });
    const qs = usp.toString();
    return qs ? '?' + qs : '';
  }

  async _synciGet(path) {
    const r = await fetch(`${this.getApiUrl()}/synci${path}`, { headers: this._synciHeaders(false) });
    return r.json();
  }

  async _synciPost(path, body) {
    const r = await fetch(`${this.getApiUrl()}/synci${path}`, {
      method: 'POST',
      headers: this._synciHeaders(),
      body: JSON.stringify(body || {})
    });
    return r.json();
  }

  /** POST /synci/search — relevance search with optional filters. */
  synciSearch(params = {}) {
    return this._synciPost('/search', params || {});
  }

  /** GET /synci/catalog — paginated browse (no query). */
  synciCatalog(params = {}) {
    return this._synciGet('/catalog' + this._synciQuery({ limit: params.limit, offset: params.offset, sort: params.sort }));
  }

  /** GET /synci/facets — distinct genres/moods + bpm/duration ranges. */
  synciFacets() {
    return this._synciGet('/facets');
  }

  /** GET /synci/audio/:id — fresh signed urls { "128","320","wav" }. */
  synciAudioById(id) {
    return this._synciGet('/audio/' + encodeURIComponent(id));
  }

  /** POST /synci/analyze-script (auth) — script → { query, mood, genre, keywords }. */
  synciAnalyzeScript(script) {
    return this._synciPost('/analyze-script', { script: String(script || '').slice(0, 8000) });
  }

  /** GET /synci/favorites (auth) — favorites list, optional project scope. */
  synciListFavorites(params = {}) {
    return this._synciGet('/favorites' + this._synciQuery({ limit: params.limit, offset: params.offset, projectId: params.projectId }));
  }

  /** GET /synci/favorites/ids (auth) — array of favorited track ids. */
  async synciListFavoriteIds() {
    try {
      const res = await this._synciGet('/favorites/ids');
      return Array.isArray(res && res.trackIds) ? res.trackIds : [];
    } catch (err) {
      console.warn('[API] synciListFavoriteIds failed:', err && err.message);
      return [];
    }
  }

  /** POST /synci/favorites (auth) — favorite a track. */
  synciAddFavorite(track, projectId) {
    return this._synciPost('/favorites', { trackId: track.id, track, projectId: projectId || undefined });
  }

  /** DELETE /synci/favorites/:trackId (auth) — unfavorite a track. */
  async synciRemoveFavorite(trackId) {
    const r = await fetch(`${this.getApiUrl()}/synci/favorites/${encodeURIComponent(trackId)}`, {
      method: 'DELETE',
      headers: this._synciHeaders(false)
    });
    return r.json();
  }

  /** GET /synci/downloads (auth) — download history, optional project scope. */
  synciListDownloads(params = {}) {
    return this._synciGet('/downloads' + this._synciQuery({ limit: params.limit, offset: params.offset, projectId: params.projectId }));
  }

  /** POST /synci/downloads (auth) — log a download. Fire-and-forget. */
  async synciLogDownload(track, quality, projectId) {
    try {
      return await this._synciPost('/downloads', { trackId: track.id, track, quality, projectId: projectId || undefined });
    } catch (err) {
      console.warn('[API] synciLogDownload failed (non-fatal):', err && err.message);
      return { status: false };
    }
  }

  /**
   * POST /musicGeneration/analyze-media (auth) — analyze an image/video/audio
   * file and return music descriptors. Multipart upload (no JSON Content-Type).
   * @returns {{ mood, genre, style, tempo, energy, prompt, suggestedTitle, mediaType }}
   */
  async analyzeMediaForMusic(file, guidance) {
    const fd = new FormData();
    fd.append('media', file);
    if (guidance) fd.append('userGuidance', String(guidance).slice(0, 500));
    const r = await fetch(`${this.getApiUrl()}/musicGeneration/analyze-media`, {
      method: 'POST',
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      body: fd
    });
    const res = await r.json();
    return (res && res.data) || res;
  }
}

// Global instance
const kolboAPI = new KolboAPI();

// Make explicitly available globally for tab-manager and other components
window.kolboAPI = kolboAPI;
