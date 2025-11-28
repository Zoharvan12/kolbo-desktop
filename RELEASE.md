# Quick Release Guide

**TL;DR**: Run one command to automatically build, tag, and release.

## Release a New Version (3 Steps)

### 1. Choose Version Type

```bash
# Bug fix (1.0.0 → 1.0.1)
npm run version:patch

# New feature (1.0.0 → 1.1.0)
npm run version:minor

# Breaking change (1.0.0 → 2.0.0)
npm run version:major
```

### 2. Wait for GitHub Actions (~10 minutes)

Go to: https://github.com/Zoharvan12/kolbo-desktop/actions

You'll see:
- ✅ Windows build running
- ✅ macOS build running
- ✅ Release created with installers

### 3. Verify Release

Go to: https://github.com/Zoharvan12/kolbo-desktop/releases

Check:
- ✅ Release shows correct version
- ✅ Windows installer attached
- ✅ macOS DMG attached
- ✅ `latest.yml` and `latest-mac.yml` present

**Done!** Users will be auto-notified of the update within 4 hours.

---

## What Happens Automatically

### On Your Machine
```bash
npm run version:patch
```
1. Updates `package.json` version (1.0.0 → 1.0.1)
2. Updates `package-lock.json`
3. Creates git commit: "Release v1.0.1"
4. Creates git tag: `v1.0.1`
5. Pushes commit and tag to GitHub

### On GitHub (via Actions)
1. Detects new tag `v1.0.1`
2. Spins up Windows and macOS build servers
3. Installs dependencies
4. Builds production installers:
   - `Kolbo Studio-Setup-1.0.1.exe` (Windows)
   - `Kolbo Studio-1.0.1.dmg` (macOS Universal)
5. Creates GitHub Release
6. Uploads installers to release
7. Generates update metadata files

### For Users
1. App checks for updates automatically (every 4 hours)
2. User sees "Update Available" notification
3. User clicks "Download Update"
4. Update downloads in background
5. User clicks "Install and Restart"
6. App updates to new version

---

## Manual Release (Emergency)

If automated workflow fails:

### 1. Update Version Manually
```bash
# Edit package.json manually
"version": "1.0.1"

# Commit and tag
git add package.json package-lock.json
git commit -m "Release v1.0.1"
git tag v1.0.1
git push && git push --tags
```

### 2. GitHub Actions Still Runs
Even with manual tagging, GitHub Actions will:
- Build installers automatically
- Create release automatically
- Upload assets automatically

### 3. If GitHub Actions Fails Completely
Build locally and upload manually:

```bash
# Build Windows (on Windows)
npm run build:prod:win

# Build macOS (on macOS)
npm run build:prod:mac

# Create release manually on GitHub
# Upload files from dist/ folder
```

---

## Development vs Production

### Development Builds (Manual, Local)
```bash
npm run build:dev:win
npm run build:dev:mac
```
- Connects to localhost:5050
- Not published to GitHub
- For testing only

### Staging Builds (Manual, Local)
```bash
npm run build:staging:win
npm run build:staging:mac
```
- Connects to staging.kolbo.ai
- Not published to GitHub
- For internal testing

### Production Builds (Automatic, GitHub)
```bash
npm run version:patch  # or minor/major
```
- Connects to app.kolbo.ai
- Published to GitHub Releases
- Users auto-notified
- Available via electron-updater

---

## Rollback a Release

If you need to rollback:

### Option 1: Release a Patch
```bash
# If v1.0.1 has bugs, release v1.0.2 with fixes
npm run version:patch
```

### Option 2: Delete Release (Immediate)
1. Go to GitHub Releases
2. Click "Delete" on problematic release
3. Users won't get update notification
4. Existing users on bad version: tell them to reinstall

### Option 3: Mark as Pre-release
1. Go to GitHub Releases
2. Edit release
3. Check "This is a pre-release"
4. electron-updater will ignore it

---

## Pre-release Versions

For beta testing:

```bash
# Update to beta version manually
"version": "1.1.0-beta.1"

# Tag and push
git tag v1.1.0-beta.1
git push --tags
```

Then mark release as "Pre-release" on GitHub.

---

## Common Issues

### "npm run version:patch fails"
**Cause**: Uncommitted changes

**Fix**:
```bash
git status
git add .
git commit -m "Your changes"
npm run version:patch
```

### "GitHub Actions build fails"
**Check**:
1. Go to Actions tab
2. Click failed build
3. Read error logs
4. Common causes:
   - Node.js version mismatch
   - Missing dependencies
   - Invalid package.json

### "Users not getting updates"
**Check**:
1. Release has `latest.yml` and `latest-mac.yml` files
2. Release is not marked as "Pre-release"
3. Users are on stable channel (production build)
4. Wait 4 hours for periodic check

---

## Version Numbering Guide

### PATCH (1.0.X)
- Bug fixes
- Performance improvements
- Minor UI tweaks
- Security patches

### MINOR (1.X.0)
- New features
- UI improvements
- New API endpoints
- Backwards-compatible changes

### MAJOR (X.0.0)
- Breaking changes
- Major redesigns
- Removed features
- API breaking changes

---

## Release Checklist

Before releasing:

- [ ] All tests pass locally
- [ ] No uncommitted changes
- [ ] CHANGELOG.md updated (if you maintain one)
- [ ] Breaking changes documented
- [ ] Version number makes sense

After releasing:

- [ ] GitHub Actions build succeeded
- [ ] Both installers present in release
- [ ] Test download and install on clean machine
- [ ] Verify auto-updater works (from previous version)
- [ ] Announce release (if needed)

---

## Links

- **Releases**: https://github.com/Zoharvan12/kolbo-desktop/releases
- **Actions**: https://github.com/Zoharvan12/kolbo-desktop/actions
- **Build Guide**: [BUILD-GUIDE.md](BUILD-GUIDE.md)
- **Semantic Versioning**: https://semver.org/

---

**Last Updated**: 2025-11-28
