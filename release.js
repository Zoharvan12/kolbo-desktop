#!/usr/bin/env node
// ============================================================================
// Kolbo Studio Desktop App - Release Script
// ============================================================================
// Usage: node release.js <patch|minor|major|x.y.z>
// Examples:
//   node release.js patch      → bumps 1.2.1 → 1.2.2
//   node release.js minor      → bumps 1.2.1 → 1.3.0
//   node release.js major      → bumps 1.2.1 → 2.0.0
//   node release.js 2.0.0      → sets exact version
// ============================================================================

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DESKTOP_REPO = 'Zoharvan12/kolbo-desktop';
const PLUGIN_REPO  = 'Zoharvan12/kolbo-adobe-plugin';
const SUITE_SCRIPT = path.join(__dirname, '..', 'kolbo-adobe-plugin', 'create-suite.js');

const [,, bumpArg] = process.argv;

if (!bumpArg) {
  console.error('\nUsage: node release.js <patch|minor|major|x.y.z>\n');
  process.exit(1);
}

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: opts.silent ? 'pipe' : 'inherit', encoding: 'utf8', ...opts });
}

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split('.').map(Number);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  if (type === 'patch') return `${major}.${minor}.${patch + 1}`;
  return type; // explicit version
}

// ── Read current version ──────────────────────────────────────────────────────
const pkgPath = path.join(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version;
const newVersion = ['patch', 'minor', 'major'].includes(bumpArg)
  ? bumpVersion(currentVersion, bumpArg)
  : bumpArg;

if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error(`\n[ERROR] Invalid version: "${newVersion}"\n`);
  process.exit(1);
}

const tag = `v${newVersion}`;

console.log(`\n========================================`);
console.log(`  Kolbo Studio Desktop Release`);
console.log(`  ${currentVersion} → ${newVersion}`);
console.log(`========================================\n`);

// ── Step 1: Bump version in package.json ─────────────────────────────────────
console.log('[1/5] Bumping version in package.json...');
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`  ✓ package.json → ${newVersion}`);

// ── Step 2: Commit & tag ──────────────────────────────────────────────────────
console.log('\n[2/5] Committing and tagging...');
run('git add package.json');
run(`git commit -m "Release ${tag}"`);
console.log(`  ✓ Committed`);

// ── Step 3: Push (triggers GitHub Actions) ───────────────────────────────────
console.log('\n[3/5] Pushing to GitHub (triggers build)...');
run('git push origin master');
console.log('  ✓ Pushed — GitHub Actions will build and release automatically');
console.log(`  Monitor: https://github.com/${DESKTOP_REPO}/actions`);

// ── Step 4: Wait for GitHub Actions ──────────────────────────────────────────
console.log('\n[4/5] Waiting for GitHub Actions build to complete...');
console.log('  (This usually takes 5-8 minutes for Windows + Mac)\n');

execSync('ping -n 15 127.0.0.1 > nul 2>&1 || sleep 14', { stdio: 'ignore' });

try {
  const runsJson = run(`gh run list --repo ${DESKTOP_REPO} --limit 3 --json databaseId,status`, { silent: true });
  const runs = JSON.parse(runsJson);
  const activeRun = runs.find(r => r.status === 'in_progress' || r.status === 'queued');
  if (activeRun) {
    run(`gh run watch ${activeRun.databaseId} --repo ${DESKTOP_REPO}`);
  } else {
    console.log('  Could not find active run — check GitHub Actions manually.');
  }
} catch (e) {
  console.log('  Build watcher failed — check GitHub Actions manually.');
}

// ── Step 5: Rebuild suite zip ─────────────────────────────────────────────────
console.log('\n[5/5] Rebuilding complete suite zip...');
if (fs.existsSync(SUITE_SCRIPT)) {
  try {
    run(`node "${SUITE_SCRIPT}"`);
  } catch (e) {
    console.log('  [WARN] Suite zip failed — run manually:');
    console.log('  cd ../kolbo-adobe-plugin && node create-suite.js');
  }
} else {
  console.log('  [WARN] create-suite.js not found at:', SUITE_SCRIPT);
  console.log('  Run manually: cd ../kolbo-adobe-plugin && node create-suite.js');
}

// ── Done ──────────────────────────────────────────────────────────────────────
console.log(`\n========================================`);
console.log(`  ✅ Desktop App ${tag} released!`);
console.log(`========================================`);
console.log(`\n  GitHub:          https://github.com/${DESKTOP_REPO}/releases/tag/${tag}`);
console.log(`  Windows:         https://github.com/${DESKTOP_REPO}/releases/latest/download/Kolbo.Studio-Setup-latest.exe`);
console.log(`  Mac:             https://github.com/${DESKTOP_REPO}/releases/latest/download/Kolbo.Studio-latest.dmg`);
console.log(`  Suite ZIP:       https://github.com/${PLUGIN_REPO}/releases/latest/download/Kolbo_Studio_Suite_latest.zip\n`);
