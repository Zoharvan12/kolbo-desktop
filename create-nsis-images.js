// Create proper NSIS sidebar images in the buildResources (assets) folder
const sharp = require('sharp');

async function createNsisImages() {
  try {
    console.log('Creating NSIS sidebar images...');
    console.log('Source: assets/images/9x16 image.jpg');
    console.log('Output: assets/ folder (buildResources)');
    console.log('');

    // NSIS standard sidebar size
    const width = 164;
    const height = 314;

    // Read source image
    const image = await sharp('assets/images/9x16 image.jpg');
    const metadata = await image.metadata();
    console.log(`Source: ${metadata.width}x${metadata.height}`);

    // Create installer sidebar - resize and save as PNG (24-bit)
    await sharp('assets/images/9x16 image.jpg')
      .resize(width, height, {
        fit: 'cover',
        position: 'center'
      })
      .png({ compressionLevel: 9, palette: false })
      .toFile('assets/installerSidebar.png');

    console.log(`✓ Created: assets/installerSidebar.png (${width}x${height})`);

    // Create uninstaller sidebar (same image)
    await sharp('assets/images/9x16 image.jpg')
      .resize(width, height, {
        fit: 'cover',
        position: 'center'
      })
      .png({ compressionLevel: 9, palette: false })
      .toFile('assets/uninstallerSidebar.png');

    console.log(`✓ Created: assets/uninstallerSidebar.png (${width}x${height})`);

    // Verify files
    const installerMeta = await sharp('assets/installerSidebar.png').metadata();
    console.log('');
    console.log(`Installer sidebar: ${installerMeta.width}x${installerMeta.height} (${installerMeta.format})`);

    const uninstallerMeta = await sharp('assets/uninstallerSidebar.png').metadata();
    console.log(`Uninstaller sidebar: ${uninstallerMeta.width}x${uninstallerMeta.height} (${uninstallerMeta.format})`);

    console.log('');
    console.log('✅ NSIS sidebar images ready!');
    console.log('   Location: assets/ (buildResources folder)');
    console.log('   Format: PNG (24-bit)');
    console.log('   Size: 164x314 (NSIS standard)');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

createNsisImages();
