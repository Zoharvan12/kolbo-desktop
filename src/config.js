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
  // Renderer process: use environment from kolboDesktop bridge (set by preload.js)
  if (typeof window !== 'undefined' && window.kolboDesktop && window.kolboDesktop.environment) {
    return window.kolboDesktop.environment;
  }

  // Main process: detect environment (only if we have access to require)
  if (typeof process !== 'undefined' && typeof require !== 'undefined') {
    try {
      // PRIORITY 1: Check process.env.KOLBO_ENV (works with npm start using cross-env)
      if (process.env.KOLBO_ENV) {
        return process.env.KOLBO_ENV;
      }

      // PRIORITY 2: Detect from executable name (works in packaged apps)
      const path = require('path');
      const exePath = process.execPath || '';

      // Get just the filename without path
      const lastSlash = Math.max(exePath.lastIndexOf('/'), exePath.lastIndexOf('\\'));
      let exeName = lastSlash >= 0 ? exePath.substring(lastSlash + 1) : exePath;

      // Remove .exe extension on Windows
      if (exeName.endsWith('.exe')) {
        exeName = exeName.slice(0, -4);
      }

      // Check if this is the packaged app (not electron.exe in node_modules)
      if (exeName.toLowerCase().includes('kolbo')) {
        if (exeName.includes('Dev')) {
          return 'development';
        } else if (exeName.includes('Staging')) {
          return 'staging';
        } else {
          return 'production';
        }
      }
    } catch (err) {
      console.error('[Config] Failed to detect environment:', err);
    }
  }

  // Fallback for npm start / development
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
