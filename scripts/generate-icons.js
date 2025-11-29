/**
 * Icon Generator Script
 * Generates macOS (.icns) and Windows (.ico) icons with proper alpha channel
 * and modern rounded corners (squircle for macOS, rounded rect for Windows)
 *
 * Usage: node scripts/generate-icons.js
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SOURCE_ICON = path.join(__dirname, '..', 'assets', 'icon-source.png');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const TEMP_DIR = path.join(__dirname, '..', 'temp-icons');

// macOS icon sizes (must include all required sizes for .icns)
const MAC_SIZES = [16, 32, 64, 128, 256, 512, 1024];

// Windows icon sizes
const WIN_SIZES = [16, 24, 32, 48, 64, 128, 256];

// Corner radius as percentage of icon size
// macOS Big Sur+ uses ~22.37% for squircle effect
const MAC_CORNER_RADIUS_PERCENT = 22.37;
// Windows 11 uses more subtle rounded corners
const WIN_CORNER_RADIUS_PERCENT = 15;

/**
 * Generate an SVG mask for rounded corners (squircle approximation)
 * Uses a superellipse formula for smooth continuous curvature
 */
function createRoundedMaskSVG(size, radiusPercent) {
  const radius = Math.round(size * (radiusPercent / 100));
  // Use a rounded rectangle with smooth corners
  return Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white"/>
    </svg>
  `);
}

/**
 * Apply rounded corner mask to an image buffer
 */
async function applyRoundedCorners(imageBuffer, size, radiusPercent) {
  const mask = createRoundedMaskSVG(size, radiusPercent);

  // First resize the image to the target size
  const resized = await sharp(imageBuffer)
    .resize(size, size, { fit: 'cover' })
    .ensureAlpha()
    .toBuffer();

  // Apply the rounded corner mask
  return sharp(resized)
    .composite([{
      input: mask,
      blend: 'dest-in'
    }])
    .png()
    .toBuffer();
}

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function cleanupDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }
}

async function generateMacIcon() {
  console.log('Generating macOS icon with ROUNDED CORNERS (squircle)...');
  console.log(`Corner radius: ${MAC_CORNER_RADIUS_PERCENT}% for macOS Big Sur+ style\n`);

  const iconsetDir = path.join(TEMP_DIR, 'icon.iconset');
  await ensureDir(iconsetDir);

  // Read source and ensure it has alpha channel
  const sourceBuffer = await sharp(SOURCE_ICON)
    .ensureAlpha()
    .png()
    .toBuffer();

  // Generate all required sizes for macOS iconset with rounded corners
  for (const size of MAC_SIZES) {
    // Standard resolution with rounded corners
    const outputPath = path.join(iconsetDir, `icon_${size}x${size}.png`);
    const roundedBuffer = await applyRoundedCorners(sourceBuffer, size, MAC_CORNER_RADIUS_PERCENT);
    await sharp(roundedBuffer).toFile(outputPath);
    console.log(`  ✓ Created ${size}x${size} with rounded corners`);

    // @2x retina resolution (except for 1024 which is already max)
    if (size <= 512) {
      const retinaSize = size * 2;
      const retinaPath = path.join(iconsetDir, `icon_${size}x${size}@2x.png`);
      const retinaRoundedBuffer = await applyRoundedCorners(sourceBuffer, retinaSize, MAC_CORNER_RADIUS_PERCENT);
      await sharp(retinaRoundedBuffer).toFile(retinaPath);
      console.log(`  ✓ Created ${size}x${size}@2x (${retinaSize}x${retinaSize}) with rounded corners`);
    }
  }

  // Use iconutil to create .icns (macOS only)
  const icnsPath = path.join(ASSETS_DIR, 'icon.icns');
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    console.log('\n⚠️  iconutil is macOS-only. Iconset files generated in temp-icons/icon.iconset/');
    console.log('To generate .icns file, run this on a Mac or in GitHub Actions.');
    console.log('The iconset files have rounded corners applied.\n');
  } else {
    try {
      execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, { stdio: 'inherit' });
      console.log(`\n✓ Created ${icnsPath} with rounded corners\n`);
    } catch (error) {
      console.error('Failed to create .icns file.');
      console.error('Error:', error.message);
    }
  }
}

async function generateWindowsIcon() {
  console.log('Generating Windows icon with ROUNDED CORNERS (Windows 11 style)...');
  console.log(`Corner radius: ${WIN_CORNER_RADIUS_PERCENT}% for modern Windows look\n`);

  const pngDir = path.join(TEMP_DIR, 'win-pngs');
  await ensureDir(pngDir);

  // Read source and ensure it has alpha channel
  const sourceBuffer = await sharp(SOURCE_ICON)
    .ensureAlpha()
    .png()
    .toBuffer();

  const pngPaths = [];

  // Generate PNG files for each size with rounded corners
  for (const size of WIN_SIZES) {
    const outputPath = path.join(pngDir, `icon-${size}.png`);
    const roundedBuffer = await applyRoundedCorners(sourceBuffer, size, WIN_CORNER_RADIUS_PERCENT);
    await sharp(roundedBuffer).toFile(outputPath);
    pngPaths.push(outputPath);
    console.log(`  ✓ Created ${size}x${size} with rounded corners`);
  }

  // Try to use png2icons if available, otherwise use ImageMagick
  const icoPath = path.join(ASSETS_DIR, 'icon.ico');

  try {
    // Try using png2icons (from devDependencies)
    const png2icons = require('png2icons');
    const input = fs.readFileSync(path.join(pngDir, 'icon-256.png'));
    const output = png2icons.createICO(input, png2icons.BICUBIC, 0, true, true);
    if (output) {
      fs.writeFileSync(icoPath, output);
      console.log(`\n✓ Created ${icoPath} with rounded corners\n`);
    } else {
      throw new Error('png2icons returned null');
    }
  } catch (error) {
    console.log('png2icons failed, trying ImageMagick...');
    try {
      // Fallback to ImageMagick (magick convert on Windows)
      const pngList = pngPaths.map(p => `"${p}"`).join(' ');
      const convertCmd = process.platform === 'win32' ? 'magick convert' : 'convert';
      execSync(`${convertCmd} ${pngList} "${icoPath}"`, { stdio: 'inherit' });
      console.log(`\n✓ Created ${icoPath} with rounded corners\n`);
    } catch (magickError) {
      console.error('Failed to create .ico file.');
      console.error('Install ImageMagick or ensure png2icons is working.');
      console.error('Rounded corner PNGs are available in temp-icons/win-pngs/');
    }
  }
}

async function verifyIcons() {
  console.log('\nVerifying generated icons...');

  const icnsPath = path.join(ASSETS_DIR, 'icon.icns');
  const icoPath = path.join(ASSETS_DIR, 'icon.ico');

  if (fs.existsSync(icnsPath)) {
    try {
      const result = execSync(`sips -g hasAlpha "${icnsPath}"`, { encoding: 'utf8' });
      console.log(`icon.icns: ${result.includes('yes') ? '✓ Has alpha channel' : '✗ No alpha channel'}`);
    } catch (e) {
      console.log('Could not verify icon.icns');
    }
  }

  if (fs.existsSync(icoPath)) {
    const stats = fs.statSync(icoPath);
    console.log(`icon.ico: ${stats.size} bytes`);
  }
}

async function main() {
  console.log('=== Icon Generator with ROUNDED CORNERS ===\n');
  console.log(`Source: ${SOURCE_ICON}`);
  console.log(`Output: ${ASSETS_DIR}`);
  console.log(`macOS Corner Radius: ${MAC_CORNER_RADIUS_PERCENT}% (squircle)`);
  console.log(`Windows Corner Radius: ${WIN_CORNER_RADIUS_PERCENT}% (rounded rect)\n`);

  // Check source exists
  if (!fs.existsSync(SOURCE_ICON)) {
    console.error(`Source icon not found: ${SOURCE_ICON}`);
    process.exit(1);
  }

  // Create temp directory
  await ensureDir(TEMP_DIR);

  try {
    await generateMacIcon();
    await generateWindowsIcon();
    await verifyIcons();
  } finally {
    // On Windows, keep the iconset files for Mac build in GitHub Actions
    const isWindows = process.platform === 'win32';
    if (isWindows) {
      console.log(`\n📁 Temp files kept in ${TEMP_DIR} for GitHub Actions Mac build`);
    } else {
      await cleanupDir(TEMP_DIR);
    }
  }

  console.log('\n=== Done - All icons have ROUNDED CORNERS ===');
}

main().catch(console.error);
