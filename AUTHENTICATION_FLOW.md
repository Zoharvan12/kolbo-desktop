# Kolbo Desktop - Authentication Flow

## Overview

The Kolbo Desktop app uses a **unified authentication system** that shares the same token between the desktop app and the embedded web app. This ensures users only need to login once and have a seamless experience across both interfaces.

## How It Works

### 1. User Authentication (Desktop App)

When a user logs in via the desktop app:

```
┌─────────────────────────────────────────┐
│  User Login (Email/Google)              │
│  ↓                                       │
│  Main Process (auth-manager.js)         │
│  ↓                                       │
│  Kolbo API (/auth/login or /auth/google)│
│  ↓                                       │
│  Token received and stored              │
│  ├─ electron-store (persistent)         │
│  └─ localStorage (renderer process)     │
└─────────────────────────────────────────┘
```

**Files involved:**
- `src/main/auth-manager.js` - Handles authentication with Kolbo API
- `src/renderer/js/api.js` - Manages token in renderer process
- `src/renderer/js/main.js` - Login UI and flow

### 2. Token Storage

The authentication token is stored in **multiple locations** for different purposes:

| Location | Purpose | Lifetime |
|----------|---------|----------|
| `electron-store` (Main Process) | Persistent storage across app restarts | Until logout |
| `localStorage.token` (Renderer) | Primary token location for API calls | Until logout |
| `localStorage.kolbo_token` (Renderer) | Backwards compatibility | Until logout |
| `localStorage.kolbo_access_token` (Renderer) | Backwards compatibility | Until logout |

**Sync Process:**
```javascript
// On app startup (src/renderer/js/main.js:181)
await kolboAPI.syncTokenFromMainProcess();
```

This ensures tokens persist even after the app is closed and reopened.

### 3. Passing Token to Web App (Iframe)

When the web app tab is opened, the desktop app passes the authentication token to the iframe via URL parameter:

**File:** `src/renderer/js/tab-manager.js` (lines 260-275)

```javascript
// Get token from desktop app
const token = window.kolboAPI?.getToken();

if (token) {
  // Add token to iframe URL
  const separator = tabUrl.includes('?') ? '&' : '?';
  iframe.src = `${tabUrl}${separator}embedded=true&token=${encodeURIComponent(token)}`;
} else {
  // No token available - user will need to login in web app
  iframe.src = tabUrl;
}
```

**Example URL:**
```
https://app.kolbo.ai?embedded=true&token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 4. Web App Token Handling

The web app (kolbo-map) is responsible for:

1. **Detecting Embedded Mode:**
   - Check for `?embedded=true` parameter
   - File: `utils/embeddedMode.ts`

2. **Reading Token from URL:**
   ```javascript
   const urlParams = new URLSearchParams(window.location.search);
   const token = urlParams.get('token');
   ```

3. **Storing Token in Web App:**
   - Store in `localStorage.token` for API calls
   - Remove token from URL (for security)

4. **Auto-Login:**
   - Use the token for all API requests
   - Skip login screen if valid token exists

### 5. Token Refresh (After Re-Login)

If a user logs out and logs back in, the desktop app automatically refreshes the token in all open web app tabs:

**File:** `src/renderer/js/main.js` (lines 498-501, 535-538)

```javascript
// After successful login
if (this.tabManager) {
  this.tabManager.refreshAuthToken();
}
```

This method reloads all iframes with the new token, ensuring they stay authenticated.

## Authentication States

```
┌─────────────────────────────────────────────────────┐
│ App State        │ Desktop App      │ Web App       │
├──────────────────┼──────────────────┼───────────────┤
│ First Launch     │ Show Login       │ N/A           │
│ After Login      │ Show Media       │ Auto-login    │
│ Token in Store   │ Auto-login       │ Auto-login    │
│ After Logout     │ Show Login       │ Show Login    │
│ Token Expired    │ Show Login       │ Show Login    │
└─────────────────────────────────────────────────────┘
```

## API Configuration

Both desktop app and web app use the same API endpoints:

| Environment | API Base URL | Web App URL |
|-------------|--------------|-------------|
| **Production** | `https://api.kolbo.ai/api` | `https://app.kolbo.ai` |
| **Staging** | `https://stagingapi.kolbo.ai/api` | `https://staging.kolbo.ai` |
| **Localhost** | `http://localhost:5050/api` | `http://localhost:8080` |

**Configuration:**
- Set via `localStorage.API_BASE_URL`
- Auto-detected based on environment
- Can be changed in debug console (Ctrl+Shift+D)

## Debugging Authentication

### Enable Debug Mode

Set in localStorage:
```javascript
localStorage.setItem('KOLBO_DEBUG', 'true');
```

### Check Token

```javascript
// Desktop app
const token = window.kolboAPI.getToken();
console.log('Token:', token);

// Web app (in iframe)
const token = localStorage.getItem('token');
console.log('Token:', token);
```

### Common Issues

**Issue:** Web app shows login screen even though desktop app is logged in

**Causes:**
1. Token not being passed to iframe (check console logs)
2. Web app not reading token from URL parameter
3. Token expired or invalid
4. CORS/CSP blocking the iframe

**Solution:**
1. Check browser console for errors
2. Verify token is in URL: `?embedded=true&token=...`
3. Check web app `embeddedMode.ts` is working
4. Try logging out and back in

---

**Issue:** Token not persisting after app restart

**Causes:**
1. `syncTokenFromMainProcess()` not called on startup
2. electron-store not saving token

**Solution:**
1. Verify `main.js:181` calls sync method
2. Check electron-store is working in main process

---

## Security Considerations

1. **Token in URL:**
   - Token is passed via URL parameter (visible in iframe src)
   - Web app should remove token from URL after reading it
   - Use HTTPS in production to encrypt token transmission

2. **Token Storage:**
   - Stored in localStorage (accessible to JavaScript)
   - electron-store is encrypted (secure storage)

3. **Token Expiration:**
   - Tokens expire after a certain period (set by API)
   - Desktop app and web app should handle 401 errors and re-login

4. **Logout:**
   - Clears token from all storage locations
   - Logs out from both desktop app and web app

## Implementation Checklist

### Desktop App (✅ Complete)

- [x] Store token in electron-store (persistent)
- [x] Store token in localStorage (renderer)
- [x] Sync token on app startup
- [x] Pass token to iframe via URL parameter
- [x] Refresh token in iframes after re-login
- [x] Debug logging for token operations

### Web App (kolbo-map)

- [ ] Detect embedded mode (`?embedded=true`)
- [ ] Read token from URL parameter
- [ ] Store token in localStorage
- [ ] Remove token from URL (security)
- [ ] Auto-login with token
- [ ] Handle token expiration
- [ ] Show embedded UI (hide nav/sidebar)

## Related Files

**Desktop App:**
- `src/main/auth-manager.js` - Main process authentication
- `src/renderer/js/api.js` - Renderer process API client
- `src/renderer/js/tab-manager.js` - Iframe token passing
- `src/renderer/js/main.js` - Login UI and token refresh

**Web App (kolbo-map):**
- `src/utils/embeddedMode.ts` - Embedded mode detection
- `src/hooks/useEmbeddedDownload.ts` - Download interception
- `src/components/EmbeddedDownloadInterceptor.tsx` - Auto-intercept

---

**Last Updated:** 2025-01-27
**Version:** 1.0.0
