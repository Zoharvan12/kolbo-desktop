# Whitelabel System (Sapir AI Studio) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a parameterized whitelabel build system for Kolbo Desktop that produces a fully branded "Sapir AI Studio" installer (different icon, splash, app name, URLs, GitHub release repo) from the same codebase.

**Architecture:** A `whitelabels/sapir/` folder holds brand config + source assets. `scripts/build-whitelabel.js sapir [--win|--mac]` orchestrates: icon generation from favicon, splash HTML generation with inlined assets, `build-env.js` injection of whitelabel URLs, and electron-builder with a merged override config. A new `.github/workflows/release-sapir.yml` runs on every push to master in parallel with the main Kolbo workflow, building and publishing to `Zoharvan12/kolbo-desktop-sapir`.

**Tech Stack:** Electron 28 / electron-builder 24 / sharp / png2icons / GitHub Actions / `gh` CLI

---

## File Map

| Path | Status | Purpose |
|---|---|---|
| `whitelabels/sapir/config.js` | CREATE | Brand constants: name, appId, URLs, repo, asset paths |
| `whitelabels/sapir/assets/favicon.png` | CREATE | Source icon (copied from kolbo-map) |
| `whitelabels/sapir/assets/logo.svg` | CREATE | Splash logo (copied from kolbo-map) |
| `whitelabels/sapir/assets/splash-vertical.jpeg` | CREATE | Splash background image |
| `whitelabels/sapir/assets/splash-wide.jpeg` | CREATE | Wide splash / installer sidebar source |
| `scripts/build-whitelabel.js` | CREATE | Orchestrates the full whitelabel build |
| `installer-scripts/installer-sapir.nsh` | CREATE | NSIS script that kills Sapir AI Studio.exe |
| `.github/workflows/release-sapir.yml` | CREATE | CI for Sapir builds → kolbo-desktop-sapir |
| `build-env.js` | MODIFY | Accept WHITELABEL + WHITELABEL_APP_URL env vars |
| `src/config.js` | MODIFY | Override webappUrl from KOLBO_WHITELABEL_APP_URL |

---

### Task 1: Copy Sapir source assets into the repo

**Files:**
- Create: `whitelabels/sapir/assets/favicon.png`
- Create: `whitelabels/sapir/assets/logo.svg`
- Create: `whitelabels/sapir/assets/splash-vertical.jpeg`
- Create: `whitelabels/sapir/assets/splash-wide.jpeg`

- [ ] **Step 1: Create the directory structure**

```bash
mkdir -p whitelabels/sapir/assets
```

- [ ] **Step 2: Copy favicon and logo from kolbo-map**

```bash
cp /g/Projects/Kolbo.AI/github/kolbo-map/public/whitelabel/sapir/favicon.png whitelabels/sapir/assets/favicon.png
cp /g/Projects/Kolbo.AI/github/kolbo-map/public/whitelabel/sapir/logo.svg whitelabels/sapir/assets/logo.svg
```

- [ ] **Step 3: Copy splash images from Downloads**

```bash
cp "/c/Users/Zohar/Downloads/kolbo-api-image-edit-generated-Retain-the-centered-canar-69de588b-nano-banana-2-image-1.jpeg" whitelabels/sapir/assets/splash-vertical.jpeg
cp "/c/Users/Zohar/Downloads/kolbo-api-image-edit-generated-Maintain-the-centered,-bo-69de5843-nano-banana-2-image-0.jpeg" whitelabels/sapir/assets/splash-wide.jpeg
```

- [ ] **Step 4: Verify all four files exist**

```bash
ls -lh whitelabels/sapir/assets/
```
Expected: favicon.png, logo.svg, splash-vertical.jpeg, splash-wide.jpeg — all non-zero size.

- [ ] **Step 5: Commit**

```bash
git add whitelabels/sapir/assets/
git commit -m "feat: add Sapir whitelabel source assets"
```

---

### Task 2: Create the Sapir whitelabel config

**Files:**
- Create: `whitelabels/sapir/config.js`

- [ ] **Step 1: Write the config file**

```js
// whitelabels/sapir/config.js
module.exports = {
  id: 'sapir',
  name: 'Sapir AI Studio',
  appId: 'com.kolbo.sapir-studio',
  publishRepo: 'kolbo-desktop-sapir',
  publishOwner: 'Zoharvan12',
  webappUrl: 'https://sapir.kolbo.ai',
  apiUrl: 'https://sapirapi.kolbo.ai',
  copyright: 'Copyright © 2025 Kolbo.AI',
  outputDir: 'dist-sapir',
  assets: {
    iconSource: 'whitelabels/sapir/assets/favicon.png',
    logoSvg: 'whitelabels/sapir/assets/logo.svg',
    splashVertical: 'whitelabels/sapir/assets/splash-vertical.jpeg',
    splashWide: 'whitelabels/sapir/assets/splash-wide.jpeg',
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add whitelabels/sapir/config.js
git commit -m "feat: add Sapir whitelabel config"
```

---

### Task 3: Modify build-env.js to inject whitelabel vars

**Files:**
- Modify: `build-env.js`

- [ ] **Step 1: Update build-env.js**

Replace the entire file content with:

```js
// Build script to write environment configuration
const fs = require('fs');
const path = require('path');

const env = process.env.KOLBO_ENV || 'development';
const whitelabel = process.env.KOLBO_WHITELABEL || '';
const whitelabelAppUrl = process.env.KOLBO_WHITELABEL_APP_URL || '';
const whitelabelApiUrl = process.env.KOLBO_WHITELABEL_API_URL || '';

console.log(`[Build] Writing environment: ${env}`);
if (whitelabel) console.log(`[Build] Whitelabel: ${whitelabel} → ${whitelabelAppUrl}`);

const envConfig = `// Auto-generated during build - DO NOT EDIT MANUALLY
// This file is created by build-env.js

window.KOLBO_BUILD_ENV = '${env}';
window.KOLBO_WHITELABEL = '${whitelabel}';
window.KOLBO_WHITELABEL_APP_URL = '${whitelabelAppUrl}';
window.KOLBO_WHITELABEL_API_URL = '${whitelabelApiUrl}';

console.log('[Build Environment] Loaded:', window.KOLBO_BUILD_ENV, window.KOLBO_WHITELABEL || '(Kolbo)');
`;

const outputPath = path.join(__dirname, 'src', 'renderer', 'build-env.js');
fs.writeFileSync(outputPath, envConfig, 'utf8');

console.log(`[Build] Environment config written to: ${outputPath}`);
```

- [ ] **Step 2: Commit**

```bash
git add build-env.js
git commit -m "feat: inject whitelabel vars into build-env.js"
```

---

### Task 4: Modify src/config.js to respect whitelabel URL override

**Files:**
- Modify: `src/config.js`

Current `src/config.js` assembles a `config` object from `ENVIRONMENTS[ENVIRONMENT]`. After line `const config = { environment: ENVIRONMENT, ...currentConfig };` (line ~109), add the whitelabel override block.

- [ ] **Step 1: Add whitelabel URL override after config assembly**

Find this block in `src/config.js` (around line 109):
```js
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
```

Replace with:
```js
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

// Whitelabel URL override — baked in at build time via build-env.js
// Takes priority over environment-based URLs for whitelabel builds
if (typeof window !== 'undefined' && window.KOLBO_WHITELABEL_APP_URL) {
  config.webappUrl = window.KOLBO_WHITELABEL_APP_URL;
  console.log('[Config] Whitelabel webappUrl override:', config.webappUrl);
}
if (typeof window !== 'undefined' && window.KOLBO_WHITELABEL_API_URL) {
  config.apiUrl = window.KOLBO_WHITELABEL_API_URL;
  console.log('[Config] Whitelabel apiUrl override:', config.apiUrl);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/config.js
git commit -m "feat: respect whitelabel URL override in config"
```

---

### Task 5: Create the Sapir NSIS installer script

**Files:**
- Create: `installer-scripts/installer-sapir.nsh`

The existing `installer.nsh` kills "Kolbo Studio.exe". Sapir needs one that kills "Sapir AI Studio.exe".

- [ ] **Step 1: Create the Sapir NSIS script**

```nsh
; Sapir AI Studio - NSIS Installer Script
; Automatically closes running instances before installation

!macro customInit
  DetailPrint "Checking for running instances of Sapir AI Studio..."
  nsExec::ExecToStack 'taskkill /F /IM "Sapir AI Studio.exe" /T'
  Sleep 1000
  DetailPrint "All running instances closed"
!macroend

!macro customInstall
  DetailPrint "Installing Sapir AI Studio..."
!macroend

!macro customUnInstall
  DetailPrint "Closing Sapir AI Studio..."
  nsExec::ExecToStack 'taskkill /F /IM "Sapir AI Studio.exe" /T'
  Sleep 1000
  DetailPrint "Sapir AI Studio closed"
!macroend
```

- [ ] **Step 2: Commit**

```bash
git add installer-scripts/installer-sapir.nsh
git commit -m "feat: add Sapir NSIS installer script"
```

---

### Task 6: Create the whitelabel build script

**Files:**
- Create: `scripts/build-whitelabel.js`

This is the main orchestrator. It:
1. Reads whitelabel config
2. Generates `.ico` / `.icns` from favicon using sharp + png2icons
3. Generates a branded `splash.html` (inlines image as base64 + inlines logo SVG)
4. Runs `build-env.js` with whitelabel vars
5. Creates a merged electron-builder override config JSON
6. Runs electron-builder
7. Fixes `latest.yml` naming (spaces → dots to match GitHub)

- [ ] **Step 1: Create scripts/build-whitelabel.js**

```js
#!/usr/bin/env node
/**
 * Whitelabel build script
 * Usage: node scripts/build-whitelabel.js sapir [--win] [--mac]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const brand = args.find(a => !a.startsWith('--')) || 'sapir';
const buildWin = args.includes('--win') || !args.includes('--mac');
const buildMac = args.includes('--mac');

const ROOT = path.join(__dirname, '..');
const config = require(`../whitelabels/${brand}/config.js`);

console.log(`\n🎨 Building whitelabel: ${config.name} (${brand})\n`);

// ── Helpers ──────────────────────────────────────────────────────────────────
function run(cmd, env = {}) {
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, env: { ...process.env, ...env } });
}

function toBase64(filePath) {
  return fs.readFileSync(filePath).toString('base64');
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext] || 'image/jpeg';
}

// ── Step 1: Generate icons ───────────────────────────────────────────────────
async function generateIcons() {
  const sharp = require('sharp');
  const png2icons = require('png2icons');

  const iconSrc = path.join(ROOT, config.assets.iconSource);
  const outDir = path.join(ROOT, `whitelabels/${brand}/generated`);
  fs.mkdirSync(outDir, { recursive: true });

  console.log('🔧 Generating icons from:', iconSrc);

  // Read source and ensure RGBA
  const srcBuf = await sharp(iconSrc).ensureAlpha().png().toBuffer();

  // Windows .ico — generate from 256px PNG
  const ico256 = await sharp(srcBuf).resize(256, 256, { fit: 'cover' }).png().toBuffer();
  const icoData = png2icons.createICO(ico256, png2icons.BICUBIC, 0, true, true);
  if (!icoData) throw new Error('png2icons returned null for .ico');
  const icoPath = path.join(outDir, 'icon.ico');
  fs.writeFileSync(icoPath, icoData);
  console.log('  ✓ icon.ico');

  // macOS .icns — requires iconutil (macOS only); generate iconset PNGs on Windows
  const macSizes = [16, 32, 64, 128, 256, 512, 1024];
  const iconsetDir = path.join(outDir, 'icon.iconset');
  fs.mkdirSync(iconsetDir, { recursive: true });

  for (const size of macSizes) {
    const buf = await sharp(srcBuf).resize(size, size, { fit: 'cover' }).png().toBuffer();
    fs.writeFileSync(path.join(iconsetDir, `icon_${size}x${size}.png`), buf);
    if (size <= 512) {
      const buf2x = await sharp(srcBuf).resize(size * 2, size * 2, { fit: 'cover' }).png().toBuffer();
      fs.writeFileSync(path.join(iconsetDir, `icon_${size}x${size}@2x.png`), buf2x);
    }
  }

  if (process.platform === 'darwin') {
    const icnsPath = path.join(outDir, 'icon.icns');
    execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, { stdio: 'inherit' });
    console.log('  ✓ icon.icns');
  } else {
    console.log('  ⚠️  icon.icns skipped (macOS only) — CI will handle it');
  }
}

// ── Step 2: Generate branded splash.html ─────────────────────────────────────
function generateSplash() {
  const splashSrc = path.join(ROOT, config.assets.splashVertical);
  const logoSrc = path.join(ROOT, config.assets.logoSvg);
  const splashOut = path.join(ROOT, 'src', 'renderer', 'splash.html');

  const bgBase64 = toBase64(splashSrc);
  const bgMime = mimeType(splashSrc);
  const logoSvg = fs.readFileSync(logoSrc, 'utf8');

  // Save original so local builds can restore it
  const originalPath = splashOut + '.kolbo-original';
  if (!fs.existsSync(originalPath)) {
    fs.copyFileSync(splashOut, originalPath);
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%; height: 100%;
      background: #000;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      overflow: hidden; user-select: none;
      -webkit-app-region: drag;
    }
    .bg {
      position: absolute; inset: 0;
      background-image: url('data:${bgMime};base64,${bgBase64}');
      background-size: cover; background-position: center;
    }
    .overlay {
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.45);
    }
    .logo {
      position: relative; z-index: 1;
      width: 180px; height: auto;
      opacity: 0;
      animation: fadeIn 0.5s ease 0.1s forwards;
    }
    .dot-row {
      position: relative; z-index: 1;
      display: flex; gap: 8px; margin-top: 40px;
      opacity: 0;
      animation: fadeIn 0.4s ease 0.3s forwards;
    }
    .dot {
      width: 5px; height: 5px; border-radius: 50%;
      background: #555;
      animation: pulse 1.2s ease-in-out infinite;
    }
    .dot:nth-child(1) { animation-delay: 0s; }
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes fadeIn { to { opacity: 1; } }
    @keyframes pulse {
      0%, 100% { background: #555; transform: scale(1); }
      50%       { background: #bbb; transform: scale(1.4); }
    }
  </style>
</head>
<body>
  <div class="bg"></div>
  <div class="overlay"></div>
  ${logoSvg.replace('<svg ', '<svg class="logo" ')}
  <div class="dot-row">
    <div class="dot"></div>
    <div class="dot"></div>
    <div class="dot"></div>
  </div>
</body>
</html>`;

  fs.writeFileSync(splashOut, html, 'utf8');
  console.log('  ✓ splash.html generated');
}

// ── Step 3: Write build-env.js for whitelabel ─────────────────────────────────
function writeBuildEnv() {
  run('node build-env.js', {
    KOLBO_ENV: 'production',
    KOLBO_WHITELABEL: config.id,
    KOLBO_WHITELABEL_APP_URL: config.webappUrl,
    KOLBO_WHITELABEL_API_URL: config.apiUrl,
  });
  console.log('  ✓ build-env.js written');
}

// ── Step 4: Create electron-builder override config ──────────────────────────
function writeOverrideConfig() {
  const generatedDir = `whitelabels/${brand}/generated`;
  const override = {
    productName: config.name,
    appId: config.appId,
    copyright: config.copyright,
    directories: { output: config.outputDir, buildResources: 'assets' },
    publish: {
      provider: 'github',
      owner: config.publishOwner,
      repo: config.publishRepo,
      releaseType: 'release',
    },
    win: {
      icon: `${generatedDir}/icon.ico`,
      artifactName: '${productName}-Setup-${version}.${ext}',
    },
    mac: {
      icon: `${generatedDir}/icon.icns`,
    },
    nsis: {
      include: `installer-scripts/installer-${brand}.nsh`,
    },
  };

  const overridePath = path.join(ROOT, `whitelabel-build-config.json`);
  fs.writeFileSync(overridePath, JSON.stringify(override, null, 2), 'utf8');
  console.log('  ✓ whitelabel-build-config.json created');
  return overridePath;
}

// ── Step 5: Fix latest.yml for GitHub filename convention ────────────────────
function fixLatestYml() {
  const distDir = path.join(ROOT, config.outputDir);
  const latestPath = path.join(distDir, 'latest.yml');
  if (!fs.existsSync(latestPath)) return;

  const version = require('../package.json').version;
  const baseUrl = `https://github.com/${config.publishOwner}/${config.publishRepo}/releases/download/sapir-v${version}`;

  // Product name with spaces → dots (GitHub filename conversion)
  const nameDots = config.name.replace(/ /g, '.');

  let content = fs.readFileSync(latestPath, 'utf8');
  // Replace spaces-in-name with dots
  content = content.replace(new RegExp(config.name.replace(/ /g, '[ -]'), 'g'), nameDots);
  // Make URLs absolute
  content = content.replace(
    new RegExp(`url: (${nameDots.replace(/\./g, '\\.')}-[^\\s]+)`, 'g'),
    `url: ${baseUrl}/$1`
  );
  content = content.replace(
    new RegExp(`path: (${nameDots.replace(/\./g, '\\.')}-[^\\s]+)`, 'g'),
    `path: ${baseUrl}/$1`
  );

  fs.writeFileSync(latestPath, content, 'utf8');
  console.log('\n📋 Fixed latest.yml:');
  console.log(content);
}

// ── Step 6: Restore original splash (local only) ─────────────────────────────
function restoreSplash() {
  const splashOut = path.join(ROOT, 'src', 'renderer', 'splash.html');
  const originalPath = splashOut + '.kolbo-original';
  if (fs.existsSync(originalPath)) {
    fs.copyFileSync(originalPath, splashOut);
    fs.unlinkSync(originalPath);
    console.log('  ✓ splash.html restored to Kolbo original');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  try {
    console.log('1/5 Generating icons...');
    await generateIcons();

    console.log('2/5 Generating splash...');
    generateSplash();

    console.log('3/5 Writing build-env...');
    writeBuildEnv();

    console.log('4/5 Running electron-builder...');
    const overridePath = writeOverrideConfig();
    fs.mkdirSync(path.join(ROOT, config.outputDir), { recursive: true });

    if (buildWin) {
      run(`npx electron-builder --win --publish never --config whitelabel-build-config.json`, {
        KOLBO_ENV: 'production',
      });
    }
    if (buildMac) {
      run(`npx electron-builder --mac --publish never --config whitelabel-build-config.json`, {
        KOLBO_ENV: 'production',
      });
    }

    console.log('5/5 Fixing latest.yml...');
    fixLatestYml();

    // Clean up temp config
    fs.unlinkSync(path.join(ROOT, 'whitelabel-build-config.json'));

    console.log(`\n✅ ${config.name} build complete! Output: ${config.outputDir}/`);
  } finally {
    // Always restore splash for local builds
    if (process.env.CI !== 'true') {
      restoreSplash();
    }
  }
}

main().catch(err => {
  console.error('❌ Build failed:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Make script executable and test the CLI arg parsing**

```bash
node scripts/build-whitelabel.js sapir --win 2>&1 | head -5
```
Expected: prints `🎨 Building whitelabel: Sapir AI Studio (sapir)` then proceeds (or errors on missing node_modules — that's fine at this stage).

- [ ] **Step 3: Commit**

```bash
git add scripts/build-whitelabel.js
git commit -m "feat: add whitelabel build orchestrator script"
```

---

### Task 7: Create the Sapir GitHub repo

- [ ] **Step 1: Create the repo via gh CLI**

```bash
gh repo create Zoharvan12/kolbo-desktop-sapir --public --description "Sapir AI Studio Desktop App releases" --confirm
```

Expected: `✓ Created repository Zoharvan12/kolbo-desktop-sapir`

- [ ] **Step 2: Verify the RELEASES_PAT secret has access**

The existing `RELEASES_PAT` secret in this repo was created for `kolbo-desktop-releases`. If it has `repo` scope on Zoharvan12's account, it will work for the new repo without any changes. No action needed unless Step 1 fails.

---

### Task 8: Create the Sapir GitHub Actions workflow

**Files:**
- Create: `.github/workflows/release-sapir.yml`

This workflow mirrors `release.yml` but:
- Uses `sapir-v${version}` as the tag name
- Runs the whitelabel build script instead of the standard build
- Publishes to `kolbo-desktop-sapir` repo

- [ ] **Step 1: Create .github/workflows/release-sapir.yml**

```yaml
name: Build and Release - Sapir AI Studio

on:
  push:
    branches:
      - master

permissions:
  contents: write

jobs:
  prepare-release:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.get_version.outputs.version }}
      tag_name: ${{ steps.get_version.outputs.tag_name }}
    steps:
      - uses: actions/checkout@v3
      - id: get_version
        run: |
          VERSION=$(node -p "require('./package.json').version")
          echo "version=$VERSION" >> $GITHUB_OUTPUT
          echo "tag_name=sapir-v$VERSION" >> $GITHUB_OUTPUT
          echo "Sapir release version: $VERSION"

  build-windows:
    needs: prepare-release
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npx electron-builder install-app-deps

      - name: Build Sapir Windows installer
        env:
          KOLBO_ENV: production
          CI: 'true'
        run: node scripts/build-whitelabel.js sapir --win

      - name: Upload Windows artifacts
        uses: actions/upload-artifact@v4
        with:
          name: sapir-windows-artifacts
          path: |
            dist-sapir/Sapir AI Studio-Setup-${{ needs.prepare-release.outputs.version }}.exe
            dist-sapir/Sapir AI Studio-Setup-${{ needs.prepare-release.outputs.version }}.exe.blockmap
            dist-sapir/latest.yml

  build-macos:
    needs: prepare-release
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npx electron-builder install-app-deps

      - name: Import Code Signing Certificate
        env:
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
        run: |
          if [ -z "$CSC_LINK" ]; then
            echo "⚠️ CSC_LINK not set, skipping certificate import"
            exit 0
          fi
          KEYCHAIN_NAME="build.keychain"
          KEYCHAIN_PASSWORD="actions"
          echo "$CSC_LINK" | base64 --decode > certificate.p12
          security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_NAME"
          security default-keychain -s "$KEYCHAIN_NAME"
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_NAME"
          security set-keychain-settings -t 3600 -u "$KEYCHAIN_NAME"
          security import certificate.p12 -k "$KEYCHAIN_NAME" -P "$CSC_KEY_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_NAME"
          security list-keychains -d user -s "$KEYCHAIN_NAME" $(security list-keychains -d user | tr -d '"')
          rm certificate.p12

      - name: Build Sapir macOS DMG
        env:
          KOLBO_ENV: production
          CI: 'true'
          CSC_NAME: "Zohar Vanunu Productions, LLC (DPVW9Z2L9Y)"
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_ID_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
        run: node scripts/build-whitelabel.js sapir --mac

      - name: Fix latest-mac.yml filename format
        run: |
          sed -i '' 's/Sapir AI Studio/Sapir.AI.Studio/g' dist-sapir/latest-mac.yml
          sed -i '' 's/-universal-mac\.zip/-universal.zip/g' dist-sapir/latest-mac.yml
          cat dist-sapir/latest-mac.yml

      - name: Upload macOS artifacts
        uses: actions/upload-artifact@v4
        with:
          name: sapir-macos-artifacts
          path: |
            dist-sapir/Sapir AI Studio-${{ needs.prepare-release.outputs.version }}-universal.dmg
            dist-sapir/Sapir AI Studio-${{ needs.prepare-release.outputs.version }}-universal-mac.zip
            dist-sapir/latest-mac.yml

  create-release:
    needs: [prepare-release, build-windows, build-macos]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: sapir-windows-artifacts
          path: ./dist-windows

      - uses: actions/download-artifact@v4
        with:
          name: sapir-macos-artifacts
          path: ./dist-macos

      - name: Rename Mac ZIP (remove -mac suffix)
        run: |
          cd ./dist-macos
          if [ -f "Sapir AI Studio-${{ needs.prepare-release.outputs.version }}-universal-mac.zip" ]; then
            mv "Sapir AI Studio-${{ needs.prepare-release.outputs.version }}-universal-mac.zip" \
               "Sapir AI Studio-${{ needs.prepare-release.outputs.version }}-universal.zip"
          fi

      - name: Consolidate artifacts
        run: |
          mkdir -p ./release-artifacts
          cp -v ./dist-windows/* ./release-artifacts/
          cp -v ./dist-macos/* ./release-artifacts/
          ls -lah ./release-artifacts/

      - name: Create Sapir Release
        uses: softprops/action-gh-release@v1
        with:
          repository: Zoharvan12/kolbo-desktop-sapir
          tag_name: ${{ needs.prepare-release.outputs.tag_name }}
          name: Sapir AI Studio v${{ needs.prepare-release.outputs.version }}
          body: |
            ## Sapir AI Studio v${{ needs.prepare-release.outputs.version }}

            ### Downloads
            - **Windows**: Sapir.AI.Studio-Setup-${{ needs.prepare-release.outputs.version }}.exe
            - **macOS (Universal)**: Sapir.AI.Studio-${{ needs.prepare-release.outputs.version }}-universal.dmg

            ### Auto-Update
            Existing users will be notified automatically within the app.
          draft: false
          prerelease: false
          files: |
            release-artifacts/latest.yml
            release-artifacts/latest-mac.yml
            release-artifacts/Sapir AI Studio-Setup-${{ needs.prepare-release.outputs.version }}.exe
            release-artifacts/Sapir AI Studio-${{ needs.prepare-release.outputs.version }}-universal.dmg
            release-artifacts/Sapir AI Studio-${{ needs.prepare-release.outputs.version }}-universal.zip
        env:
          GITHUB_TOKEN: ${{ secrets.RELEASES_PAT }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release-sapir.yml
git commit -m "feat: add Sapir AI Studio GitHub Actions release workflow"
```

---

### Task 9: Final validation and push

- [ ] **Step 1: Check all expected files exist**

```bash
ls whitelabels/sapir/assets/
ls whitelabels/sapir/config.js scripts/build-whitelabel.js
ls installer-scripts/installer-sapir.nsh
ls .github/workflows/release-sapir.yml
```

- [ ] **Step 2: Verify modified files**

```bash
grep -n "KOLBO_WHITELABEL" build-env.js
grep -n "KOLBO_WHITELABEL_APP_URL" src/config.js
```

Expected: both grep return matches.

- [ ] **Step 3: Verify the sapir GitHub repo exists**

```bash
gh repo view Zoharvan12/kolbo-desktop-sapir
```

- [ ] **Step 4: Push to trigger CI**

```bash
git push origin master
```

- [ ] **Step 5: Watch the Sapir workflow run**

```bash
gh run list --workflow=release-sapir.yml --limit=3
```

Then open the run URL shown to monitor progress.

---

## Notes

- **auto-update**: The packaged Sapir app will auto-update from `Zoharvan12/kolbo-desktop-sapir` because the override config bakes that `publish` target into `app-update.yml` inside the app package.
- **icon generation on Windows CI**: `.ico` is generated by `png2icons` (works on Windows). `.icns` requires `iconutil` (macOS) — the macOS build job generates it at CI time.
- **splash restore**: On local builds, the script saves `splash.html.kolbo-original` and restores it after the build. In CI, this is skipped since each run starts from a fresh checkout.
- **RELEASES_PAT scope**: Must have `repo` scope for `Zoharvan12`. If the Sapir release job fails with 403, the PAT needs to be updated at `Settings → Secrets → RELEASES_PAT`.
