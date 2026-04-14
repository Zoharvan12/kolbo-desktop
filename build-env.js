// Build script to write environment configuration
const fs = require('fs');
const path = require('path');

// Get environment from command line argument or environment variable
const env = process.env.KOLBO_ENV || 'development';
const whitelabel = process.env.KOLBO_WHITELABEL || '';
const whitelabelAppUrl = process.env.KOLBO_WHITELABEL_APP_URL || '';
const whitelabelApiUrl = process.env.KOLBO_WHITELABEL_API_URL || '';
const whitelabelSsoSlug = process.env.KOLBO_WHITELABEL_SSO_SLUG || '';
const whitelabelAppLabel = process.env.KOLBO_WHITELABEL_APP_LABEL || '';
const whitelabelCodeLabel = process.env.KOLBO_WHITELABEL_CODE_LABEL || '';

console.log(`[Build] Writing environment: ${env}`);
if (whitelabel) console.log(`[Build] Whitelabel: ${whitelabel} → ${whitelabelAppUrl}`);

// Create environment config file
const envConfig = `// Auto-generated during build - DO NOT EDIT MANUALLY
// This file is created by build-env.js

window.KOLBO_BUILD_ENV = '${env}';
window.KOLBO_WHITELABEL = '${whitelabel}';
window.KOLBO_WHITELABEL_APP_URL = '${whitelabelAppUrl}';
window.KOLBO_WHITELABEL_API_URL = '${whitelabelApiUrl}';
window.KOLBO_WHITELABEL_SSO_SLUG = '${whitelabelSsoSlug}';
window.KOLBO_WHITELABEL_APP_LABEL = '${whitelabelAppLabel}';
window.KOLBO_WHITELABEL_CODE_LABEL = '${whitelabelCodeLabel}';

console.log('[Build Environment] Loaded:', window.KOLBO_BUILD_ENV, window.KOLBO_WHITELABEL || '(Kolbo)');
`;

// Write to src/renderer directory
const outputPath = path.join(__dirname, 'src', 'renderer', 'build-env.js');
fs.writeFileSync(outputPath, envConfig, 'utf8');

console.log(`[Build] Environment config written to: ${outputPath}`);
console.log(`[Build] Environment: ${env}`);
