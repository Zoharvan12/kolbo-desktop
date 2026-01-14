#!/usr/bin/env node
/**
 * Kolbo Studio - Trimmer Integration Automation Script
 * Applies all necessary changes to integrate the trimmer feature
 */

const fs = require('fs');
const path = require('path');

const baseDir = 'G:\\Projects\\Kolbo.AI\\github\\kolbo-desktop';

function readFile(filePath) {
    return fs.readFileSync(filePath, 'utf-8');
}

function writeFile(filePath, content) {
    fs.writeFileSync(filePath, content, 'utf-8');
}

function updateIndexHtml() {
    console.log('[1/2] Updating index.html...');

    const indexPath = path.join(baseDir, 'src', 'renderer', 'index.html');
    let content = readFile(indexPath);
    let modified = false;

    // Add trimmer CSS
    if (!content.includes('trimmer.css')) {
        console.log('  - Adding trimmer.css link...');
        content = content.replace(
            /(<!-- Format Factory Styles -->\s*<link rel="stylesheet" href="css\/format-factory\.css\?v=1">)/,
            '$1\n  <!-- Trimmer Styles -->\n  <link rel="stylesheet" href="css/trimmer.css?v=1">'
        );
        console.log('  ✓ Added trimmer.css');
        modified = true;
    } else {
        console.log('  ✓ trimmer.css already present');
    }

    // Add trimmer scripts
    if (!content.includes('trimmer/video-trimmer.js')) {
        console.log('  - Adding trimmer scripts...');
        content = content.replace(
            /(<script src="js\/tab-manager\.js\?v=5"><\/script>)/,
            '$1\n  <!-- Trimmer Components (load BEFORE format-factory-manager) -->\n  <script src="js/trimmer/video-trimmer.js?v=1"></script>\n  <script src="js/trimmer/audio-trimmer.js?v=1"></script>\n  <script src="js/trimmer/trimmer-modal.js?v=1"></script>'
        );
        console.log('  ✓ Added trimmer scripts');
        modified = true;
    } else {
        console.log('  ✓ Trimmer scripts already present');
    }

    if (modified) {
        writeFile(indexPath, content);
        console.log('✓ index.html updated successfully!\n');
    } else {
        console.log('✓ index.html already up to date!\n');
    }

    return modified;
}

function updateFfmpegHandler() {
    console.log('[2/2] Updating ffmpeg-handler.js...');

    const ffmpegPath = path.join(baseDir, 'src', 'main', 'ffmpeg-handler.js');
    let content = readFile(ffmpegPath);
    let modified = false;

    // Change 1: Add trimStart and trimEnd to destructuring
    if (!content.includes('trimStart, trimEnd')) {
        console.log('  - Adding trim parameters to job destructuring...');
        content = content.replace(
            /const { id, filePath, outputFormat, outputType, settings, outputFolder } = job;/,
            'const { id, filePath, outputFormat, outputType, settings, outputFolder, trimStart, trimEnd } = job;'
        );
        console.log('  ✓ Added trim parameters');
        modified = true;
    } else {
        console.log('  ✓ Trim parameters already added');
    }

    // Change 2: Add trim to logging
    if (!content.includes('trim:')) {
        console.log('  - Adding trim info to logging...');
        const oldLog = /console\.log\('\[FFmpeg Handler\] Starting conversion:',\s*{[\s\S]*?type: outputType[\s\S]*?}\);/;
        const newLog = `console.log('[FFmpeg Handler] Starting conversion:', {
      id,
      input: filePath,
      format: outputFormat,
      type: outputType,
      trim: trimStart !== undefined ? \`\${trimStart}s - \${trimEnd}s\` : 'none'
    });`;
        content = content.replace(oldLog, newLog);
        console.log('  ✓ Added trim logging');
        modified = true;
    } else {
        console.log('  ✓ Trim logging already added');
    }

    // Change 3: Add trim logic before codec settings
    if (!content.includes('Apply trim settings')) {
        console.log('  - Adding trim processing logic...');
        content = content.replace(
            /(const command = ffmpeg\(filePath\);)\s*(\/\/ Apply conversion settings)/,
            `$1

        // Apply trim settings if specified (MUST be set before codec settings)
        if (trimStart !== undefined && trimEnd !== undefined) {
          console.log(\`[FFmpeg Handler] Applying trim: \${trimStart}s to \${trimEnd}s\`);
          // -ss: start time, -to: end time (both in seconds)
          command.setStartTime(trimStart);
          command.duration(trimEnd - trimStart);
        }

        $2`
        );
        console.log('  ✓ Added trim processing');
        modified = true;
    } else {
        console.log('  ✓ Trim processing already added');
    }

    if (modified) {
        writeFile(ffmpegPath, content);
        console.log('✓ ffmpeg-handler.js updated successfully!\n');
    } else {
        console.log('✓ ffmpeg-handler.js already up to date!\n');
    }

    return modified;
}

function main() {
    console.log('==================================');
    console.log('Kolbo Studio Trimmer Integration');
    console.log('==================================\n');

    if (!fs.existsSync(baseDir)) {
        console.error(`ERROR: Directory not found: ${baseDir}`);
        process.exit(1);
    }

    try {
        const htmlModified = updateIndexHtml();
        const ffmpegModified = updateFfmpegHandler();

        console.log('==================================');
        if (htmlModified || ffmpegModified) {
            console.log('✓ Integration Applied Successfully!');
        } else {
            console.log('✓ Already Integrated!');
        }
        console.log('==================================\n');

        console.log('⚠️  MANUAL STEP REQUIRED:');
        console.log('  Update src/renderer/js/format-factory-manager.js');
        console.log('  Follow: TRIMMER_INTEGRATION_GUIDE.md (Step 3)\n');

        console.log('Next steps:');
        console.log('1. Complete format-factory-manager.js updates');
        console.log('2. Test with: npm start');
        console.log('3. Try trimming a video or audio file!\n');

    } catch (error) {
        console.error(`\nERROR: ${error.message}`);
        process.exit(1);
    }
}

main();
