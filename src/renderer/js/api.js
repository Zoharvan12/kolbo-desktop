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
   * Get favorites
   * NOTE: Main process currently doesn't have a separate favorites endpoint
   * This passes isFavorited=true to getMedia
   */
  async getFavorites(options = {}) {
    if (this.DEBUG_MODE) {
      console.log('[API] Get favorites via IPC');
    }

    return this.getMedia({
      ...options,
      isFavorited: true
    });
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
}

// Global instance
const kolboAPI = new KolboAPI();
