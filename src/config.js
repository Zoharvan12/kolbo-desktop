// ============================================================================
// KOLBO STUDIO - CENTRALIZED CONFIGURATION
// ============================================================================
//
// Single source of truth for all environment settings
// Change ENVIRONMENT to switch between development/staging/production
//
// ============================================================================

// ============================================
// 🎯 ENVIRONMENT AUTO-DETECTED FROM APP NAME
// ============================================
// Detects environment from app executable name:
// - "Kolbo Studio Dev" → development
// - "Kolbo Studio Staging" → staging
// - "Kolbo Studio" → production
const ENVIRONMENT = (() => {
  console.log('[Config] Detecting environment...');

  // PRIORITY 1: Build-time environment (from build-env.js, set during build)
  if (typeof window !== 'undefined' && window.KOLBO_BUILD_ENV) {
    console.log('[Config] ✅ Environment from build-env.js:', window.KOLBO_BUILD_ENV);
    return window.KOLBO_BUILD_ENV;
  }

  // PRIORITY 2: Runtime process.env.KOLBO_ENV (works with npm start using cross-env)
  if (typeof process !== 'undefined' && process.env && process.env.KOLBO_ENV) {
    console.log('[Config] Environment from process.env.KOLBO_ENV:', process.env.KOLBO_ENV);
    return process.env.KOLBO_ENV;
  }

  // PRIORITY 3: Renderer process - use environment from kolboDesktop bridge (set by preload.js)
  if (typeof window !== 'undefined' && window.kolboDesktop && window.kolboDesktop.environment) {
    console.log('[Config] Environment from kolboDesktop bridge:', window.kolboDesktop.environment);
    return window.kolboDesktop.environment;
  }

  // PRIORITY 4: Main process - detect from executable name (works in packaged apps as fallback)
  if (typeof process !== 'undefined' && typeof require !== 'undefined') {
    try {
      const path = require('path');
      const exePath = process.execPath || '';
      console.log('[Config] Process executable path:', exePath);

      // Get just the filename without path
      const lastSlash = Math.max(exePath.lastIndexOf('/'), exePath.lastIndexOf('\\'));
      let exeName = lastSlash >= 0 ? exePath.substring(lastSlash + 1) : exePath;

      // Remove .exe extension on Windows
      if (exeName.endsWith('.exe')) {
        exeName = exeName.slice(0, -4);
      }

      console.log('[Config] Executable name:', exeName);

      // Check if this is the packaged app (not electron.exe in node_modules)
      if (exeName.toLowerCase().includes('kolbo')) {
        if (exeName.includes('Dev')) {
          console.log('[Config] Detected DEV from executable name');
          return 'development';
        } else if (exeName.includes('Staging')) {
          console.log('[Config] Detected STAGING from executable name');
          return 'staging';
        } else {
          console.log('[Config] Detected PRODUCTION from executable name');
          return 'production';
        }
      }
    } catch (err) {
      console.error('[Config] Failed to detect environment:', err);
    }
  }

  // Fallback for npm start / development
  console.warn('[Config] Using fallback environment: development');
  return 'development';
})();

// Environment configuration mapping
const ENVIRONMENTS = {
  development: {
    name: 'Development',
    apiUrl: 'http://localhost:5050/api',
    webappUrl: 'http://localhost:8080',
    debug: true
  },
  staging: {
    name: 'Staging',
    apiUrl: 'https://stagingapi.kolbo.ai/api',
    webappUrl: 'https://staging.kolbo.ai',
    debug: true
  },
  production: {
    name: 'Production',
    apiUrl: 'https://api.kolbo.ai/api',
    webappUrl: 'https://app.kolbo.ai',
    debug: false
  }
};

// Get current environment config
const currentConfig = ENVIRONMENTS[ENVIRONMENT];

if (!currentConfig) {
  throw new Error(`Invalid ENVIRONMENT: "${ENVIRONMENT}". Must be one of: ${Object.keys(ENVIRONMENTS).join(', ')}`);
}

// Export configuration
const config = {
  environment: ENVIRONMENT,
  ...currentConfig
};

// Log current environment (helps with debugging)
console.log(`[Config] Environment: ${config.environment.toUpperCase()}`);
console.log(`[Config] API URL: ${config.apiUrl}`);
console.log(`[Config] Webapp URL: ${config.webappUrl}`);
console.log(`[Config] Debug mode: ${config.debug}`);

// Export for both CommonJS (main process) and ES modules (if needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = config;
}

// Also export as global for renderer process
if (typeof window !== 'undefined') {
  window.KOLBO_CONFIG = config;
}
