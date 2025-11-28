// Build script to write environment configuration
const fs = require('fs');
const path = require('path');

// Get environment from command line argument or environment variable
const env = process.env.KOLBO_ENV || 'development';

console.log(`[Build] Writing environment: ${env}`);

// Create environment config file
const envConfig = `// Auto-generated during build - DO NOT EDIT MANUALLY
// This file is created by build-env.js

window.KOLBO_BUILD_ENV = '${env}';

console.log('[Build Environment] Loaded:', window.KOLBO_BUILD_ENV);
`;

// Write to src/renderer directory
const outputPath = path.join(__dirname, 'src', 'renderer', 'build-env.js');
fs.writeFileSync(outputPath, envConfig, 'utf8');

console.log(`[Build] Environment config written to: ${outputPath}`);
console.log(`[Build] Environment: ${env}`);
