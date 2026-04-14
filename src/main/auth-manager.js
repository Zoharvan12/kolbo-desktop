// Kolbo Studio - Authentication Manager
// Handles email/password login and Google OAuth (same flow as plugin)

const { ipcMain, shell, app } = require('electron');
const Store = require('electron-store');
const crypto = require('crypto');
const config = require('../config');

const store = new Store();

// Cloudflare SBFM flags the default Node.js UA ("node") as "definitely automated".
// A proper UA prevents managed_challenge responses that break login/polling.
const APP_UA = `KolboStudio/${app.getVersion()} (Electron)`;

class AuthManager {
  static setupHandlers() {
    ipcMain.handle('auth:login', this.handleEmailLogin);
    ipcMain.handle('auth:google-login', this.handleGoogleLogin);
    ipcMain.handle('auth:sso-login', this.handleSSOLogin);
    ipcMain.handle('auth:logout', this.handleLogout);
    ipcMain.handle('auth:get-token', this.getToken);
    ipcMain.handle('auth:update-token', this.handleUpdateToken);
    ipcMain.handle('app:get-version', () => app.getVersion());
    ipcMain.handle('app:open-external', (event, url) => shell.openExternal(url));

    console.log('[AuthManager] IPC handlers registered');
  }

  // Store token in all keys used across desktop + plugin for compatibility.
  static storeToken(token) {
    store.set('token', token);
    store.set('kolbo_token', token);
    store.set('kolbo_access_token', token);
  }

  static async handleEmailLogin(event, { email, password }) {
    try {
      console.log('[AuthManager] Email login attempt for:', email);

      const API_BASE_URL = config.apiUrl;

      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': APP_UA },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error('[AuthManager] Login failed:', error);
        return {
          success: false,
          error: error.message || `Login failed: ${response.status}`
        };
      }

      const data = await response.json();
      const token = data.token || data.data?.token;

      if (token) {
        AuthManager.storeToken(token);

        console.log('[AuthManager] Login successful, token stored');
        return { success: true, token };
      }

      console.error('[AuthManager] No token in response');
      return { success: false, error: 'No token in response' };

    } catch (error) {
      console.error('[AuthManager] Login error:', error);
      return { success: false, error: error.message };
    }
  }

  static async handleGoogleLogin() {
    try {
      console.log('[AuthManager] Google OAuth login initiated');

      // Generate random 16-char hex auth code (for desktop app)
      const authCode = crypto.randomBytes(8).toString('hex');

      const API_BASE_URL = config.apiUrl;
      // Use desktop_auth_code instead of plugin_auth_code to differentiate
      const authUrl = `${API_BASE_URL}/auth/google?desktop_auth_code=${authCode}`;

      console.log('[AuthManager] Opening browser with auth code:', authCode);

      // Open system browser
      await shell.openExternal(authUrl);

      console.log('[AuthManager] Browser opened, starting polling...');

      // Poll for token (30 attempts, 1 second interval)
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
          const response = await fetch(
            `${API_BASE_URL}/auth/google/check-auth-code?auth_code=${authCode}`,
            { headers: { 'User-Agent': APP_UA } }
          );

          if (response.ok) {
            const data = await response.json();
            const token = data.token || data.data?.token;

            if (token) {
              AuthManager.storeToken(token);

              console.log('[AuthManager] Google OAuth successful, token received');
              return { success: true, token };
            }
          }
        } catch (error) {
          // Continue polling on error
          console.log(`[AuthManager] Poll attempt ${i + 1}/30 failed:`, error.message);
        }
      }

      console.error('[AuthManager] Google OAuth timeout after 30 seconds');
      return { success: false, error: 'OAuth timeout after 30 seconds' };

    } catch (error) {
      console.error('[AuthManager] Google OAuth error:', error);
      return { success: false, error: error.message };
    }
  }

  static async handleSSOLogin(event, { slug }) {
    try {
      console.log('[AuthManager] SSO login initiated for org:', slug);

      const authCode = crypto.randomBytes(8).toString('hex');
      const API_BASE_URL = config.apiUrl;
      const authUrl = `${API_BASE_URL}/api/saml/login/${slug}?desktop_auth_code=${authCode}`;

      console.log('[AuthManager] Opening browser for SSO with auth code:', authCode);
      await shell.openExternal(authUrl);

      console.log('[AuthManager] Browser opened, polling for SSO token...');

      // Poll for 60 seconds (SSO can take longer than Google OAuth)
      for (let i = 0; i < 60; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
          const response = await fetch(
            `${API_BASE_URL}/api/saml/check-auth-code?auth_code=${authCode}`,
            { headers: { 'User-Agent': APP_UA } }
          );

          if (response.ok) {
            const data = await response.json();
            const token = data.token || data.data?.token;

            if (token) {
              AuthManager.storeToken(token);
              console.log('[AuthManager] SSO successful, token received');
              return { success: true, token };
            }
          }
        } catch (error) {
          console.log(`[AuthManager] SSO poll attempt ${i + 1}/60 failed:`, error.message);
        }
      }

      console.error('[AuthManager] SSO timeout after 60 seconds');
      return { success: false, error: 'SSO timeout after 60 seconds' };

    } catch (error) {
      console.error('[AuthManager] SSO error:', error);
      return { success: false, error: error.message };
    }
  }

  static handleLogout() {
    console.log('[AuthManager] Logout');
    store.delete('token');
    store.delete('kolbo_token');
    store.delete('kolbo_access_token');
    return { success: true };
  }

  // Called when the web app (iframe) has a fresher token than electron-store.
  // Keeps the desktop token in sync so getMedia/getProjects calls don't 401.
  static handleUpdateToken(event, token) {
    if (!token || typeof token !== 'string') return { success: false };
    AuthManager.storeToken(token);
    console.log('[AuthManager] Token updated from web app');
    return { success: true };
  }

  static getToken() {
    // Try multiple keys for compatibility (SAME AS PLUGIN)
    const token = store.get('token') ||
                  store.get('kolbo_access_token') ||
                  store.get('kolbo_token');
    return token || null;
  }
}

module.exports = AuthManager;
