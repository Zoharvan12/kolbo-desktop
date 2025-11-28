// ============================================================================
// KOLBO STUDIO - CENTRALIZED CONFIGURATION
// ============================================================================
//
// Single source of truth for all environment settings
// Change ENVIRONMENT to switch between development/staging/production
//
// ============================================================================

// ============================================
// 🎯 ENVIRONMENT AUTO-DETECTED FROM BUILD
// ============================================
// In main process: reads from process.env.KOLBO_ENV (set during build)
// In renderer process: reads from window.kolboDesktop.environment (passed via preload)
// Fallback: 'development' for local dev
const ENVIRONMENT = (() => {
  // Main process (Node.js environment)
  if (typeof process !== 'undefined' && process.env && process.env.KOLBO_ENV) {
    return process.env.KOLBO_ENV;
  }
  // Renderer process (browser environment with Electron bridge)
  if (typeof window !== 'undefined' && window.kolboDesktop && window.kolboDesktop.environment) {
    return window.kolboDesktop.environment;
  }
  // Fallback for development
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
