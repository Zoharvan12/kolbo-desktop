// Script to convert 9x16 image to BMP format for NSIS installer sidebar
const Jimp = require('jimp').default || require('jimp');
const path = require('path');

async function createInstallerSidebar() {
  try {
    console.log('Reading source image...');
    const image = await Jimp.read('assets/images/9x16 image.jpg');

    console.log(`Original size: ${image.bitmap.width}x${image.bitmap.height}`);

    // Resize to 164 pixels wide (NSIS recommended sidebar width)
    // Height will be calculated automatically to maintain aspect ratio
    console.log('Resizing to 164px wide...');
    image.resize(164, Jimp.AUTO);

    console.log(`New size: ${image.bitmap.width}x${image.bitmap.height}`);

    // Save as BMP (required for NSIS)
    const outputPath = 'build/installerSidebar.bmp';
    console.log(`Saving to ${outputPath}...`);
    await image.writeAsync(outputPath);

    console.log('✓ Installer sidebar created successfully!');
    console.log(`  File: ${outputPath}`);
    console.log(`  Size: ${image.bitmap.width}x${image.bitmap.height}`);

  } catch (error) {
    console.error('Error creating installer sidebar:', error);
    process.exit(1);
  }
}

createInstallerSidebar();
