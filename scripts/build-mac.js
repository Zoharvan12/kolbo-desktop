const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Building Mac universal installers (Intel + Apple Silicon)...\n');

// Run electron-builder
try {
  execSync('npx electron-builder --mac --publish never', {
    stdio: 'inherit',
    env: { ...process.env, KOLBO_ENV: 'production' }
  });
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}

console.log('\n✅ Build completed. Fixing filenames...\n');

const distDir = path.join(__dirname, '..', 'dist');
const packageJson = require('../package.json');
const version = packageJson.version;

console.log(`Version: ${version}`);
console.log('\nFiles before fix:');
fs.readdirSync(distDir).forEach(f => console.log(`  - ${f}`));

// Fix DMG: remove -universal suffix
const universalDmg = `Kolbo Studio-${version}-universal.dmg`;
const finalDmg = `Kolbo Studio-${version}.dmg`;
if (fs.existsSync(path.join(distDir, universalDmg))) {
  console.log(`\n📝 Renaming: ${universalDmg} -> ${finalDmg}`);
  fs.renameSync(path.join(distDir, universalDmg), path.join(distDir, finalDmg));
}

// Fix ZIP: remove -universal-mac suffix
const universalZip = `Kolbo Studio-${version}-universal-mac.zip`;
const finalZip = `Kolbo Studio-${version}.zip`;
if (fs.existsSync(path.join(distDir, universalZip))) {
  console.log(`📝 Renaming: ${universalZip} -> ${finalZip}`);
  fs.renameSync(path.join(distDir, universalZip), path.join(distDir, finalZip));
}

// Fix latest-mac.yml
const latestMacPath = path.join(distDir, 'latest-mac.yml');
if (fs.existsSync(latestMacPath)) {
  console.log('\n📝 Fixing latest-mac.yml...');
  let content = fs.readFileSync(latestMacPath, 'utf8');

  // Replace Kolbo-Studio with Kolbo Studio (spaces)
  content = content.replace(/Kolbo-Studio/g, 'Kolbo Studio');

  // Remove -universal-mac suffix from ZIP
  content = content.replace(/-universal-mac\.zip/g, '.zip');

  // Remove -universal suffix from DMG
  content = content.replace(/-universal\.dmg/g, '.dmg');

  fs.writeFileSync(latestMacPath, content, 'utf8');

  console.log('\nFixed latest-mac.yml:');
  console.log(content);
}

// List final files
console.log('\n✅ Final release files:');
const releaseFiles = fs.readdirSync(distDir)
  .filter(f => (f.includes(version) || f === 'latest-mac.yml') && !f.includes('.blockmap'));

releaseFiles.forEach(f => {
  const stats = fs.statSync(path.join(distDir, f));
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`  ✓ ${f} (${sizeMB} MB)`);
});

console.log('\n🎉 Done! Upload these files to GitHub release:');
releaseFiles.forEach(f => console.log(`   - ${f}`));
console.log('\n💡 Note: GitHub will convert spaces to dots in filenames automatically.');
