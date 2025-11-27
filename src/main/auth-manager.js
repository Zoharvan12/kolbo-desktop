// Kolbo Desktop - Authentication Manager
// Handles email/password login and Google OAuth (same flow as plugin)

const { ipcMain, shell, app } = require('electron');
const Store = require('electron-store');
const crypto = require('crypto');
const config = require('../config');

const store = new Store();

class AuthManager {
  static setupHandlers() {
    ipcMain.handle('auth:login', this.handleEmailLogin);
    ipcMain.handle('auth:google-login', this.handleGoogleLogin);
    ipcMain.handle('auth:logout', this.handleLogout);
    ipcMain.handle('auth:get-token', this.getToken);
    ipcMain.handle('app:get-version', () => app.getVersion());
    ipcMain.handle('app:open-external', (event, url) => shell.openExternal(url));

    console.log('[AuthManager] IPC handlers registered');
  }

  static async handleEmailLogin(event, { email, password }) {
    try {
      console.log('[AuthManager] Email login attempt for:', email);

      const API_BASE_URL = config.apiUrl;

      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        // Store token in multiple keys for compatibility with plugin
        store.set('token', token);
        store.set('kolbo_token', token);
        store.set('kolbo_access_token', token);

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

      // Generate random 16-char hex auth code (SAME AS PLUGIN)
      const authCode = crypto.randomBytes(8).toString('hex');

      const API_BASE_URL = config.apiUrl;
      const authUrl = `${API_BASE_URL}/auth/google?plugin_auth_code=${authCode}`;

      console.log('[AuthManager] Opening browser with auth code:', authCode);

      // Open system browser (Electron equivalent of CEP openURLInDefaultBrowser)
      await shell.openExternal(authUrl);

      console.log('[AuthManager] Browser opened, starting polling...');

      // Poll for token (EXACT SAME AS PLUGIN: 30 attempts, 1 second interval)
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
          const response = await fetch(
            `${API_BASE_URL}/auth/google/check-auth-code?auth_code=${authCode}`
          );

          if (response.ok) {
            const data = await response.json();
            const token = data.token || data.data?.token;

            if (token) {
              // Store token
              store.set('token', token);
              store.set('kolbo_token', token);
              store.set('kolbo_access_token', token);

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

  static handleLogout() {
    console.log('[AuthManager] Logout');
    store.delete('token');
    store.delete('kolbo_token');
    store.delete('kolbo_access_token');
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
