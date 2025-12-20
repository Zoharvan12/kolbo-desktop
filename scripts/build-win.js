const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Building Windows installer...\n');

// Run electron-builder
try {
  execSync('npx electron-builder --win --publish never', {
    stdio: 'inherit',
    env: { ...process.env, KOLBO_ENV: 'production' }
  });
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}

console.log('\n✅ Build completed!\n');

const distDir = path.join(__dirname, '..', 'dist');
const packageJson = require('../package.json');
const version = packageJson.version;
const repoOwner = 'Zoharvan12';
const repoName = 'kolbo-desktop';

console.log(`Version: ${version}`);

// List final files
console.log('\n✅ Release files:');
const releaseFiles = fs.readdirSync(distDir)
  .filter(f => (f.includes(version) || f === 'latest.yml') && !f.includes('.blockmap') && (f.endsWith('.exe') || f.endsWith('.yml')));

releaseFiles.forEach(f => {
  const stats = fs.statSync(path.join(distDir, f));
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`  ✓ ${f} (${sizeMB} MB)`);
});

// Fix latest.yml:
// 1. GitHub converts spaces to dots in filenames
// 2. Use full absolute URLs to ensure electron-updater downloads correctly
const latestPath = path.join(distDir, 'latest.yml');
if (fs.existsSync(latestPath)) {
  let content = fs.readFileSync(latestPath, 'utf8');

  // Fix filename format: electron-builder uses hyphens, GitHub converts spaces to dots
  content = content.replace(/Kolbo-Studio/g, 'Kolbo.Studio');

  // Convert relative URLs to full GitHub release URLs
  // This is CRITICAL for electron-updater to properly download files
  const baseUrl = `https://github.com/${repoOwner}/${repoName}/releases/download/v${version}`;

  // Replace relative file URLs with absolute URLs
  content = content.replace(
    /url: (Kolbo\.Studio-[^\s]+)/g,
    `url: ${baseUrl}/$1`
  );

  // Also fix the path field
  content = content.replace(
    /path: (Kolbo\.Studio-[^\s]+)/g,
    `path: ${baseUrl}/$1`
  );

  fs.writeFileSync(latestPath, content, 'utf8');

  console.log('\n📋 latest.yml content (fixed for GitHub):');
  console.log(content);
}

console.log('\n🎉 Done! Upload these files to GitHub release.');
console.log('💡 Note: GitHub will convert spaces to dots in filenames automatically.');
