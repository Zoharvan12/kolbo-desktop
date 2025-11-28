# Kolbo Desktop - Build & Distribution Guide

## Overview
This guide explains how to build and distribute Kolbo Desktop for all environments (development, staging, production) and platforms (Windows, macOS).

## Quick Reference

### Development (Local Testing)
```bash
npm run dev                    # Run locally with development config
```

### Building Installers

#### Windows
```bash
npm run build:dev:win         # Development build (localhost:5050)
npm run build:staging:win     # Staging build (stagingapi.kolbo.ai)
npm run build:prod:win        # Production build (api.kolbo.ai)
```

#### macOS
```bash
npm run build:dev:mac         # Development build
npm run build:staging:mac     # Staging build
npm run build:prod:mac        # Production build
```

## Environment Configuration

Each environment connects to different API endpoints:

| Environment  | API URL                          | Web App URL                    | Debug Mode |
|-------------|----------------------------------|--------------------------------|------------|
| Development | http://localhost:5050/api       | http://localhost:8080          | ✅ Yes     |
| Staging     | https://stagingapi.kolbo.ai/api | https://staging.kolbo.ai       | ✅ Yes     |
| Production  | https://api.kolbo.ai/api        | https://app.kolbo.ai           | ❌ No      |

The environment is automatically set during build based on which npm script you run.

## Build Output

All builds are saved to the `dist/` directory:

### Windows
- `dist/Kolbo Desktop-Setup-1.0.0.exe` (production)
- `dist/Kolbo Desktop Dev-Setup-1.0.0.exe` (development)
- `dist/Kolbo Desktop Staging-Setup-1.0.0.exe` (staging)

### macOS
- `dist/Kolbo Desktop-1.0.0.dmg` (production)
- `dist/Kolbo Desktop Dev-1.0.0.dmg` (development)
- `dist/Kolbo Desktop Staging-1.0.0.dmg` (staging)

## Distribution Workflow

### 1. For Testing (Development/Staging)
```bash
# Build the installer
npm run build:staging:win   # or build:staging:mac

# Upload to staging server or share directly
# File location: dist/Kolbo Desktop Staging-Setup-1.0.0.exe
```

### 2. For Production Release
```bash
# Update version in package.json first
# Then build production installer
npm run build:prod:win      # or build:prod:mac

# Upload to your website download page
# File location: dist/Kolbo Desktop-Setup-1.0.0.exe
```

### 3. Upload to Website
Upload the production installer to your website's download section:
- **Recommended location**: `https://kolbo.ai/downloads/`
- **File naming**: Keep the version number clear for users

## Version Management & Automated Releases

### Semantic Versioning

Kolbo Studio uses [Semantic Versioning](https://semver.org/):
- **MAJOR** (x.0.0): Breaking changes, major new features
- **MINOR** (0.x.0): New features, backwards-compatible
- **PATCH** (0.0.x): Bug fixes, small improvements

### Creating a New Release (Automatic)

Use these npm scripts to automatically bump version, create git tag, and trigger GitHub Actions:

```bash
# Patch release (1.0.0 → 1.0.1) - Bug fixes
npm run version:patch

# Minor release (1.0.0 → 1.1.0) - New features
npm run version:minor

# Major release (1.0.0 → 2.0.0) - Breaking changes
npm run version:major
```

**What happens automatically:**
1. ✅ Updates version in package.json
2. ✅ Creates git commit with message "Release vX.X.X"
3. ✅ Creates git tag (e.g., v1.0.1)
4. ✅ Pushes commit and tag to GitHub
5. ✅ GitHub Actions builds Windows and macOS installers
6. ✅ Creates GitHub Release with installers attached
7. ✅ electron-updater detects new version automatically
8. ✅ Users get notified in-app about the update

### Manual Version Management (Advanced)

If you need manual control:

1. Update `version` in `package.json`:
   ```json
   "version": "1.0.1"
   ```

2. Create git commit and tag:
   ```bash
   git add package.json package-lock.json
   git commit -m "Release v1.0.1"
   git tag v1.0.1
   git push && git push --tags
   ```

3. GitHub Actions will automatically build and release

## Platform-Specific Notes

### Windows
- **Installer type**: NSIS (user-friendly wizard)
- **Options**: Users can choose installation directory
- **Shortcuts**: Desktop + Start Menu shortcuts created
- **Minimum OS**: Windows 10+

### macOS
- **Installer type**: DMG (drag-to-Applications)
- **Architectures**: Both Intel (x64) and Apple Silicon (arm64)
- **Code signing**: Not configured yet (see "Next Steps" below)
- **Minimum OS**: macOS 10.13+

## Troubleshooting

### "Command not found: electron-builder"
```bash
npm install
```

### Build fails with module errors
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

### Wrong environment detected
Make sure you're using the npm scripts, not running `electron-builder` directly:
```bash
# ✅ Correct
npm run build:prod:win

# ❌ Wrong (won't set KOLBO_ENV)
electron-builder --win
```

## GitHub Actions (Automated Builds)

### How It Works

The repository includes a GitHub Actions workflow (`.github/workflows/release.yml`) that automatically:
- Builds Windows and macOS installers when you push a version tag
- Creates a GitHub Release with installers attached
- Generates update metadata files for electron-updater
- Runs on GitHub's servers (no local build needed)

### Setup Requirements

1. **GitHub Personal Access Token** (automatically provided by GitHub Actions)
   - Already configured via `GITHUB_TOKEN` secret
   - No manual setup needed

2. **Push Access**
   - Ensure you have push access to the repository
   - Version scripts will push tags automatically

### Monitoring Builds

After running `npm run version:patch` (or minor/major):
1. Go to GitHub repository
2. Click "Actions" tab
3. See build progress in real-time
4. Builds take ~5-10 minutes per platform

### Troubleshooting GitHub Actions

**Build fails on Windows:**
- Check Node.js version compatibility
- Verify dependencies install correctly

**Build fails on macOS:**
- Apple Silicon builds require macOS runner
- Check Xcode Command Line Tools version

**Release not created:**
- Ensure tag matches pattern `vX.Y.Z`
- Check GitHub Actions permissions

## Auto-Updates for Users

### How It Works

electron-updater automatically:
1. Checks GitHub Releases for new versions (every 4 hours + on startup)
2. Downloads update in background (if user approves)
3. Installs on next app restart
4. No user intervention needed beyond clicking "Update"

### Configuration

Already configured in `src/main/main.js`:
- ✅ Auto-check on startup (after 3 seconds)
- ✅ Periodic checks (every 4 hours)
- ✅ Manual download (user controls when)
- ✅ Auto-install on quit

### User Experience

When update available:
1. User sees notification in app
2. Clicks "Download Update" button
3. Update downloads in background
4. "Install and Restart" button appears
5. App restarts with new version

## Next Steps (Optional Enhancements)

### 1. Code Signing (Recommended for Production)
**Why**: Prevents "Unknown Publisher" warnings

**Windows:**
- Requires a code signing certificate (~$100-300/year)
- Add to `package.json`:
  ```json
  "win": {
    "certificateFile": "path/to/cert.pfx",
    "certificatePassword": "your-password"
  }
  ```

**macOS:**
- Requires Apple Developer account ($99/year)
- Add signing identity to build config

### 2. App Store Distribution (Optional)
- **Mac App Store**: Submit via Apple Developer
- **Microsoft Store**: Submit via Windows Partner Center

## Security Checklist

Before production release:
- [ ] Update version in `package.json`
- [ ] Test installer on clean machine (Windows 10/11)
- [ ] Test installer on clean machine (macOS Intel + Apple Silicon)
- [ ] Verify correct API endpoint (should be `api.kolbo.ai`)
- [ ] Verify no dev tools open automatically
- [ ] Check app icon displays correctly
- [ ] Test login/logout flow
- [ ] Test drag-and-drop to video editors

## Support

If you encounter build issues:
1. Check the [electron-builder docs](https://www.electron.build/)
2. Verify your Node.js version is 18+
3. Make sure all dependencies are installed

---

**Last Updated**: 2025-11-27
**Build System**: electron-builder v24.9.1
