#!/usr/bin/env node

/**
 * Automated Release Script for Kolbo Desktop
 *
 * This script automates the entire release process:
 * 1. Builds the production version
 * 2. Creates/updates GitHub release
 * 3. Uploads installer, blockmap, and latest.yml
 *
 * Usage: node scripts/release.js
 * Requires: GH_TOKEN environment variable (GitHub Personal Access Token)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function exec(command) {
  log(`\n> ${command}`, 'cyan');
  return execSync(command, { stdio: 'inherit' });
}

async function main() {
  try {
    log('\n🚀 Starting automated release process...', 'green');

    // Check for GH_TOKEN
    if (!process.env.GH_TOKEN) {
      log('❌ Error: GH_TOKEN environment variable not set', 'red');
      log('Please create a GitHub Personal Access Token with "repo" scope:', 'yellow');
      log('https://github.com/settings/tokens/new?scopes=repo', 'yellow');
      log('\nThen set it: set GH_TOKEN=your_token_here', 'yellow');
      process.exit(1);
    }

    // Get current version from package.json
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const version = packageJson.version;
    const tag = `v${version}`;

    log(`\n📦 Building version ${version}...`, 'green');

    // Build production version for Windows
    exec('npm run build:prod:win');

    log(`\n✅ Build complete!`, 'green');

    // Check if files exist
    const distDir = path.join(__dirname, '..', 'dist');
    const installerName = `Kolbo Studio-Setup-${version}.exe`;
    const blockmapName = `${installerName}.blockmap`;
    const latestYml = 'latest.yml';

    const installerPath = path.join(distDir, installerName);
    const blockmapPath = path.join(distDir, blockmapName);
    const latestYmlPath = path.join(distDir, latestYml);

    if (!fs.existsSync(installerPath)) {
      log(`❌ Error: Installer not found at ${installerPath}`, 'red');
      process.exit(1);
    }

    if (!fs.existsSync(latestYmlPath)) {
      log(`❌ Error: latest.yml not found at ${latestYmlPath}`, 'red');
      process.exit(1);
    }

    log(`\n📝 Creating GitHub release ${tag}...`, 'green');

    // Create release notes
    const releaseNotes = `## What's New in ${tag}

### Split View Features
- ✨ Split view with 3 preset layouts (50/50, 25/75, 70/30)
- 🎯 Visual preset buttons that appear when split view is active
- 🖱️ Click divider to cycle through presets

### State Persistence
- 💾 Comprehensive state persistence - app remembers all tabs and layouts
- ⏰ Auto-saves every 30s + on window close
- 📊 Saves merged/split tabs with exact ratios

### UI Improvements
- 🎨 Custom scrollbar styling (slim 6px, dark theme)
- ✨ Cleaner, more polished interface

---

**Installation**: Download and run the installer below.

**Auto-Update**: If you have an older version installed, the app will notify you of this update.`;

    // Create or update release using GitHub CLI (if available) or API
    try {
      // Try using gh CLI first
      exec(`gh release create ${tag} "${installerPath}" "${blockmapPath}" "${latestYmlPath}" --title "${tag} - Split View Update" --notes "${releaseNotes.replace(/"/g, '\\"')}"`);
      log(`\n✅ Release ${tag} created successfully!`, 'green');
    } catch (error) {
      log('\n⚠️  gh CLI not available, using curl with GitHub API...', 'yellow');

      // Use GitHub API directly
      const owner = 'Zoharvan12';
      const repo = 'kolbo-desktop';
      const token = process.env.GH_TOKEN;

      // Create release
      const createReleaseCmd = `curl -X POST \
        -H "Authorization: token ${token}" \
        -H "Accept: application/vnd.github+json" \
        https://api.github.com/repos/${owner}/${repo}/releases \
        -d '{"tag_name":"${tag}","name":"${tag} - Split View Update","body":${JSON.stringify(releaseNotes)},"draft":false,"prerelease":false}'`;

      const releaseResponse = execSync(createReleaseCmd, { encoding: 'utf8' });
      const release = JSON.parse(releaseResponse);
      const uploadUrl = release.upload_url.replace('{?name,label}', '');

      log(`\n✅ Release created. Upload URL: ${uploadUrl}`, 'green');
      log(`\n⚠️  Please upload files manually to:`, 'yellow');
      log(`https://github.com/${owner}/${repo}/releases/tag/${tag}`, 'cyan');
    }

    log(`\n🎉 Release process complete!`, 'green');
    log(`\nView release: https://github.com/Zoharvan12/kolbo-desktop/releases/tag/${tag}`, 'cyan');

  } catch (error) {
    log(`\n❌ Error during release process:`, 'red');
    console.error(error);
    process.exit(1);
  }
}

main();
