#!/usr/bin/env node
/**
 * Whitelabel preview script
 * Usage: node scripts/preview-whitelabel.js sapir
 *
 * Writes build-env.js with whitelabel vars (auth bg, logo, SSO slug, labels)
 * then launches npm start so you can preview the branded UI locally.
 *
 * Does NOT run electron-builder or touch splash.html.
 * Run `node scripts/restore-build-env.js` (or npm start without this) to revert.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const brand = args.find(a => !a.startsWith('--')) || 'sapir';
const launchApp = !args.includes('--no-start');

const ROOT = path.join(__dirname, '..');
const config = require(`../whitelabels/${brand}/config.js`);

console.log(`\n🎨 Whitelabel preview: ${config.name} (${brand})\n`);

function mimeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = { '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  return map[ext] || 'image/jpeg';
}

// ── Write build-env.js with whitelabel vars ────────────────────────────────────
function writeBuildEnv() {
  execSync('node build-env.js', {
    stdio: 'inherit',
    cwd: ROOT,
    env: {
      ...process.env,
      KOLBO_ENV: 'development',
      KOLBO_WHITELABEL: config.id,
      KOLBO_WHITELABEL_APP_URL: config.webappUrl,
      KOLBO_WHITELABEL_API_URL: config.apiUrl,
      KOLBO_WHITELABEL_SSO_SLUG: config.ssoSlug || '',
      KOLBO_WHITELABEL_APP_LABEL: config.appLabel || config.name,
      KOLBO_WHITELABEL_CODE_LABEL: config.codeLabel || 'Code',
    }
  });

  // Append visual assets (auth background + logo SVG) as inlined data URLs
  const authBgPath = path.join(ROOT, config.assets.splashSquare);
  const logoSvgPath = path.join(ROOT, config.assets.logoSvg);

  const authBgBase64 = fs.readFileSync(authBgPath).toString('base64');
  const authBgMime = mimeForFile(authBgPath);

  let logoSvg = fs.readFileSync(logoSvgPath, 'utf8');
  logoSvg = logoSvg.replace(/<\?xml[^?]*\?>\s*/g, '').trim();

  const outputPath = path.join(ROOT, 'src', 'renderer', 'build-env.js');
  const extraVars = `\nwindow.KOLBO_WHITELABEL_AUTH_BG = 'data:${authBgMime};base64,${authBgBase64}';\nwindow.KOLBO_WHITELABEL_LOGO_SVG = ${JSON.stringify(logoSvg)};\n`;
  fs.appendFileSync(outputPath, extraVars, 'utf8');

  console.log(`✅ build-env.js written for ${config.name}`);
  console.log(`   App URL: ${config.webappUrl}`);
  console.log(`   API URL: ${config.apiUrl}`);
  console.log(`   SSO slug: ${config.ssoSlug}`);
}

writeBuildEnv();

if (launchApp) {
  // Launch electron directly — NOT via npm start, because npm start re-runs
  // node build-env.js which would overwrite the whitelabel vars we just set.
  const electronBin = path.join(ROOT, 'node_modules', '.bin', 'electron');
  console.log('\n🚀 Launching app with whitelabel branding...\n');

  const proc = spawn(electronBin, ['.'], {
    stdio: 'inherit',
    cwd: ROOT,
    shell: true,
    env: {
      ...process.env,
      KOLBO_ENV: 'development',
      NODE_ENV: 'development',
      // Pass whitelabel URLs so main process (auth-manager, etc.) uses them
      KOLBO_WHITELABEL_API_URL: config.apiUrl,
      KOLBO_WHITELABEL_APP_URL: config.webappUrl,
    }
  });

  proc.on('exit', () => {
    // Restore a plain build-env.js when the app closes
    console.log('\n♻️  Restoring default build-env.js...');
    execSync('node build-env.js', {
      stdio: 'inherit',
      cwd: ROOT,
      env: { ...process.env, KOLBO_ENV: 'development' }
    });
    console.log('✅ build-env.js restored to Kolbo defaults');
  });
} else {
  console.log('\nDo NOT use npm start (it overwrites build-env.js).');
  console.log('Run electron directly:');
  console.log('  .\\node_modules\\.bin\\electron .\n');
  console.log('When done, run: node build-env.js  (to restore default env)\n');
}
