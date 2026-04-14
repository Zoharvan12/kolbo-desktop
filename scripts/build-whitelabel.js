#!/usr/bin/env node
/**
 * Whitelabel build script
 * Usage: node scripts/build-whitelabel.js sapir [--win] [--mac]
 *
 * Orchestrates a fully branded whitelabel build:
 *  1. Generates .ico / .icns from the brand favicon
 *  2. Generates a branded splash.html (inlines images as base64)
 *  3. Writes build-env.js with whitelabel URL vars
 *  4. Runs electron-builder with a merged override config
 *  5. Fixes latest.yml naming for GitHub's spaces→dots convention
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── CLI Args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const brand = args.find(a => !a.startsWith('--')) || 'sapir';
const buildWin = args.includes('--win') || (!args.includes('--mac') && !args.includes('--win'));
const buildMac = args.includes('--mac');

const ROOT = path.join(__dirname, '..');
const config = require(`../whitelabels/${brand}/config.js`);

console.log(`\n🎨 Building whitelabel: ${config.name} (${brand})\n`);

// ── Helpers ───────────────────────────────────────────────────────────────────
function run(cmd, env = {}) {
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, env: { ...process.env, ...env } });
}

function toBase64(filePath) {
  return fs.readFileSync(filePath).toString('base64');
}

function mimeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = { '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  return map[ext] || 'image/jpeg';
}

// ── Step 1: Generate icons ────────────────────────────────────────────────────
async function generateIcons() {
  const sharp = require('sharp');
  const png2icons = require('png2icons');

  const iconSrc = path.join(ROOT, config.assets.iconSource);
  const outDir = path.join(ROOT, `whitelabels/${brand}/generated`);
  fs.mkdirSync(outDir, { recursive: true });

  console.log('🔧 Generating icons from:', path.relative(ROOT, iconSrc));

  // Read source, ensure RGBA PNG
  const srcBuf = await sharp(iconSrc).ensureAlpha().png().toBuffer();

  // ── Windows .ico ──────────────────────────────────────────────────────────
  const ico256 = await sharp(srcBuf).resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const icoData = png2icons.createICO(ico256, png2icons.BICUBIC, 0, true, true);
  if (!icoData) throw new Error('png2icons returned null — cannot generate .ico');
  const icoPath = path.join(outDir, 'icon.ico');
  fs.writeFileSync(icoPath, icoData);
  console.log('  ✓ icon.ico');

  // ── macOS .icns iconset PNGs (iconutil runs on macOS in CI) ───────────────
  const macSizes = [16, 32, 64, 128, 256, 512, 1024];
  const iconsetDir = path.join(outDir, 'icon.iconset');
  fs.mkdirSync(iconsetDir, { recursive: true });

  for (const size of macSizes) {
    const buf = await sharp(srcBuf)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();
    fs.writeFileSync(path.join(iconsetDir, `icon_${size}x${size}.png`), buf);
    if (size <= 512) {
      const buf2x = await sharp(srcBuf)
        .resize(size * 2, size * 2, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png().toBuffer();
      fs.writeFileSync(path.join(iconsetDir, `icon_${size}x${size}@2x.png`), buf2x);
    }
  }

  if (process.platform === 'darwin') {
    const icnsPath = path.join(outDir, 'icon.icns');
    execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, { stdio: 'inherit' });
    console.log('  ✓ icon.icns');
  } else {
    console.log('  ⚠️  icon.icns: skipped on Windows — macOS CI runner will generate it');
  }
}

// ── Step 2: Generate branded splash.html ──────────────────────────────────────
function generateSplash() {
  const splashSrc = path.join(ROOT, config.assets.splashVertical);
  const logoSrc = path.join(ROOT, config.assets.logoSvg);
  const splashOut = path.join(ROOT, 'src', 'renderer', 'splash.html');

  // Inline background image as base64 data URL (works in packaged app, no file I/O)
  const bgBase64 = toBase64(splashSrc);
  const bgMime = mimeForFile(splashSrc);

  // Inline SVG logo — strip XML declaration, add class and remove fixed dimensions
  let logoSvg = fs.readFileSync(logoSrc, 'utf8');
  logoSvg = logoSvg.replace(/<\?xml[^?]*\?>\s*/g, '');           // remove <?xml ...?>
  logoSvg = logoSvg.replace(/\s+width="[^"]*"/, '');             // remove width attr
  logoSvg = logoSvg.replace(/\s+height="[^"]*"/, '');            // remove height attr
  logoSvg = logoSvg.replace('<svg ', '<svg class="logo" ');       // add CSS class

  // Save original splash so local builds can restore it
  const originalPath = splashOut + '.kolbo-original';
  if (!fs.existsSync(originalPath)) {
    fs.copyFileSync(splashOut, originalPath);
    console.log('  📦 Saved original splash.html for restore after build');
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
      background-size: cover;
      background-position: center;
    }
    .overlay {
      position: absolute; inset: 0;
      background: rgba(0, 0, 0, 0.4);
    }
    .logo {
      position: relative; z-index: 1;
      width: 160px; height: auto;
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
      50%       { background: #ccc; transform: scale(1.4); }
    }
  </style>
</head>
<body>
  <div class="bg"></div>
  <div class="overlay"></div>
  ${logoSvg}
  <div class="dot-row">
    <div class="dot"></div>
    <div class="dot"></div>
    <div class="dot"></div>
  </div>
</body>
</html>`;

  fs.writeFileSync(splashOut, html, 'utf8');
  console.log('  ✓ splash.html generated (inlined background + logo)');
}

// ── Step 3: Write build-env.js with whitelabel vars ───────────────────────────
function writeBuildEnv() {
  run('node build-env.js', {
    KOLBO_ENV: 'production',
    KOLBO_WHITELABEL: config.id,
    KOLBO_WHITELABEL_APP_URL: config.webappUrl,
    KOLBO_WHITELABEL_API_URL: config.apiUrl,
    KOLBO_WHITELABEL_SSO_SLUG: config.ssoSlug || '',
    KOLBO_WHITELABEL_APP_LABEL: config.appLabel || config.name,
    KOLBO_WHITELABEL_CODE_LABEL: config.codeLabel || 'Code',
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

  console.log('  ✓ build-env.js written with whitelabel vars + auth assets');
}

// ── Step 3b: Generate installer sidebar BMP (164×314) ────────────────────────
async function generateInstallerSidebar() {
  const { Jimp } = require('jimp');
  const squareSrc = path.join(ROOT, config.assets.splashSquare);
  const outDir = path.join(ROOT, `whitelabels/${brand}/generated`);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'installerSidebar.bmp');

  const img = await Jimp.read(squareSrc);
  img.cover({ w: 164, h: 314 });
  await img.write(outPath);
  console.log('  ✓ installerSidebar.bmp (164×314)');
  return outPath;
}

// ── Step 4: Create electron-builder override config ───────────────────────────
function createOverrideConfig() {
  const generatedDir = `whitelabels/${brand}/generated`;
  const packageJson = require('../package.json');

  // electron-builder's --config does a top-level merge, NOT deep-merge.
  // So mac:{icon} alone would wipe out hardenedRuntime, notarize, entitlements, etc.
  // We spread the original mac config and only override the icon.
  const baseMac = packageJson.build.mac || {};
  const baseWin = packageJson.build.win || {};
  const baseNsis = packageJson.build.nsis || {};

  const override = {
    productName: config.name,
    appId: config.appId,
    copyright: config.copyright,
    directories: {
      output: config.outputDir,
      buildResources: 'assets',
    },
    publish: {
      provider: 'github',
      owner: config.publishOwner,
      repo: config.publishRepo,
      releaseType: 'release',
    },
    win: {
      ...baseWin,
      icon: `${generatedDir}/icon.ico`,
      artifactName: '${productName}-Setup-${version}.${ext}',
    },
    mac: {
      ...baseMac,
      icon: `${generatedDir}/icon.icns`,
    },
    nsis: {
      ...baseNsis,
      include: `installer-scripts/installer-${brand}.nsh`,
      installerSidebar: `${generatedDir}/installerSidebar.bmp`,
      uninstallerSidebar: `${generatedDir}/installerSidebar.bmp`,
    },
  };

  const overridePath = path.join(ROOT, 'whitelabel-build-config.json');
  fs.writeFileSync(overridePath, JSON.stringify(override, null, 2), 'utf8');
  console.log('  ✓ whitelabel-build-config.json created');
  return overridePath;
}

// ── Step 5: Fix latest.yml for GitHub spaces→dots naming ─────────────────────
function fixLatestYml() {
  const distDir = path.join(ROOT, config.outputDir);
  const latestPath = path.join(distDir, 'latest.yml');
  if (!fs.existsSync(latestPath)) {
    console.log('  ⚠️  latest.yml not found, skipping fix');
    return;
  }

  const version = require('../package.json').version;
  const baseUrl = `https://github.com/${config.publishOwner}/${config.publishRepo}/releases/download/sapir-v${version}`;

  // Product name with spaces → dots (GitHub converts spaces in uploaded filenames)
  const nameDots = config.name.replace(/ /g, '.');
  const nameEscaped = config.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameDotsEscaped = nameDots.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let content = fs.readFileSync(latestPath, 'utf8');
  // Replace spaces in name with dots
  content = content.replace(new RegExp(nameEscaped, 'g'), nameDots);
  // Make file URLs absolute
  content = content.replace(
    new RegExp(`url: (${nameDotsEscaped}-[^\\s]+)`, 'g'),
    `url: ${baseUrl}/$1`
  );
  content = content.replace(
    new RegExp(`path: (${nameDotsEscaped}-[^\\s]+)`, 'g'),
    `path: ${baseUrl}/$1`
  );

  fs.writeFileSync(latestPath, content, 'utf8');
  console.log('\n📋 Fixed latest.yml:');
  console.log(content);
}

// ── Step 6: Restore original splash (local builds only) ───────────────────────
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
  const isCI = process.env.CI === 'true';
  let overridePath = null;

  try {
    console.log('1/5 Generating icons...');
    await generateIcons();

    console.log('\n1b/5 Generating installer sidebar...');
    await generateInstallerSidebar();

    console.log('\n2/5 Generating branded splash...');
    generateSplash();

    console.log('\n3/5 Writing build-env...');
    writeBuildEnv();

    console.log('\n4/5 Running electron-builder...');
    overridePath = createOverrideConfig();
    fs.mkdirSync(path.join(ROOT, config.outputDir), { recursive: true });

    const platform = buildWin ? '--win' : '--mac';
    run(`npx electron-builder ${platform} --publish never --config whitelabel-build-config.json`, {
      KOLBO_ENV: 'production',
    });

    console.log('\n5/5 Fixing latest.yml...');
    fixLatestYml();

    console.log(`\n✅ ${config.name} build complete! Output: ${config.outputDir}/\n`);
  } finally {
    // Clean up temp override config
    if (overridePath && fs.existsSync(overridePath)) {
      fs.unlinkSync(overridePath);
    }
    // Restore splash for local builds (CI has fresh checkout, no need)
    if (!isCI) {
      restoreSplash();
    }
  }
}

main().catch(err => {
  console.error('\n❌ Whitelabel build failed:', err.message);
  process.exit(1);
});
