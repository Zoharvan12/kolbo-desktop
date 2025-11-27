// Convert 9:16 image to BMP format for NSIS installer
const sharp = require('sharp');

async function convertToBmp() {
  try {
    console.log('Converting 9:16 image to BMP for NSIS installer...');

    // NSIS recommended size: 164 width (height auto-calculated from aspect ratio)
    const targetWidth = 164;

    await sharp('assets/images/9x16 image.jpg')
      .resize(targetWidth, null, {
        fit: 'inside',
        withoutEnlargement: false
      })
      .png()
      .toFile('build/installerSidebar.png');

    console.log('✓ Created: build/installerSidebar.png');

    // Get dimensions
    const metadata = await sharp('build/installerSidebar.png').metadata();
    console.log(`  Size: ${metadata.width}x${metadata.height}`);
    console.log(`  Format: ${metadata.format}`);

    // Also create uninstaller sidebar (same image)
    await sharp('assets/images/9x16 image.jpg')
      .resize(targetWidth, null, {
        fit: 'inside',
        withoutEnlargement: false
      })
      .png()
      .toFile('build/uninstallerSidebar.png');

    console.log('✓ Created: build/uninstallerSidebar.png');
    console.log('\nPNG files ready for NSIS installer!');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

convertToBmp();
