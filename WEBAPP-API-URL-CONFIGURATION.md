# Webapp API URL Configuration Guide

## Problem
The webapp (kolbo-map) is not reading the API URL from the desktop app, so it defaults to `https://api.kolbo.ai/api` instead of using `http://localhost:5050/api` in development.

## What the Desktop App is Doing

The desktop app now passes the API URL in **two ways**:

### 1. URL Parameter
When creating an iframe, the desktop app adds `apiUrl` to the URL:
```
http://localhost:8080?embedded=true&source=desktop&token=...&apiUrl=http://localhost:5050/api
```

### 2. PostMessage
When the iframe loads, the desktop app sends a postMessage:
```javascript
{
  type: 'KOLBO_DESKTOP_CONFIG',
  apiUrl: 'http://localhost:5050/api',
  environment: 'development'
}
```

## What Needs to Be Done in kolbo-map

### Step 1: Check `src/utils/embeddedMode.ts`

This file should handle embedded mode detection. It needs to be updated to:

1. **Read `apiUrl` from URL parameter:**
```typescript
const urlParams = new URLSearchParams(window.location.search);
const apiUrl = urlParams.get('apiUrl');
if (apiUrl) {
  localStorage.setItem('API_BASE_URL', apiUrl);
  // Also remove from URL for security
  urlParams.delete('apiUrl');
  window.history.replaceState({}, '', `${window.location.pathname}?${urlParams.toString()}`);
}
```

2. **Listen for postMessage from desktop app:**
```typescript
window.addEventListener('message', (event) => {
  // Verify origin for security (optional but recommended)
  // if (event.origin !== 'http://localhost:8080') return;
  
  if (event.data?.type === 'KOLBO_DESKTOP_CONFIG') {
    if (event.data.apiUrl) {
      localStorage.setItem('API_BASE_URL', event.data.apiUrl);
      // Reconfigure API client if needed
      // This depends on how your API client is set up
    }
  }
});
```

### Step 2: Check API Client Configuration

Find where the API base URL is configured (likely in an API client file or config file). Common locations:
- `src/api/client.ts` or `src/api/index.ts`
- `src/config/api.ts`
- `src/utils/api.ts`
- `src/services/api.ts`

The API client should read from `localStorage.API_BASE_URL`:

```typescript
// Example implementation
const API_BASE_URL = localStorage.getItem('API_BASE_URL') || 'https://api.kolbo.ai/api';

// Or if using an API client library:
const apiClient = axios.create({
  baseURL: localStorage.getItem('API_BASE_URL') || 'https://api.kolbo.ai/api',
});
```

### Step 3: Ensure Early Initialization

The API URL should be read **before** any API calls are made. This should happen:
1. On app initialization
2. Before React renders (if using React)
3. In the embedded mode handler

### Step 4: Test

1. Open the desktop app in development mode
2. Open the webapp view
3. Check browser console in the iframe
4. Verify:
   - URL contains `apiUrl` parameter: `?apiUrl=http://localhost:5050/api`
   - `localStorage.API_BASE_URL` is set to `http://localhost:5050/api`
   - API calls go to `http://localhost:5050/api` instead of `https://api.kolbo.ai/api`

## Files to Check in kolbo-map

1. **`src/utils/embeddedMode.ts`** - Embedded mode detection and configuration
2. **API client configuration file** - Where API base URL is set
3. **App initialization file** - Where the app starts (e.g., `src/main.tsx` or `src/index.tsx`)
4. **Any environment config files** - That might override API URL

## Debugging

### In the Webapp Console (iframe context):

```javascript
// Check if apiUrl is in URL
new URLSearchParams(window.location.search).get('apiUrl')

// Check localStorage
localStorage.getItem('API_BASE_URL')

// Check if postMessage listener is set up
// (You'll need to check the code for this)
```

### Expected Behavior

When the desktop app loads the webapp:
1. URL should contain: `?embedded=true&source=desktop&token=...&apiUrl=http://localhost:5050/api`
2. `localStorage.API_BASE_URL` should be set to `http://localhost:5050/api`
3. All API calls should go to `http://localhost:5050/api`

## Quick Fix (Temporary)

If you need a quick workaround while implementing the proper solution, you can manually set it in the webapp console:

```javascript
localStorage.setItem('API_BASE_URL', 'http://localhost:5050/api');
location.reload();
```

But this should be automated via the URL parameter or postMessage.
