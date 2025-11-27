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

## Version Management

Before each production build:

1. Update `version` in `package.json`:
   ```json
   "version": "1.0.1"
   ```

2. Build with the new version:
   ```bash
   npm run build:prod:win
   ```

3. The installer name will automatically include the new version

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

### 2. Auto-Updates
Add `electron-updater` to automatically update the app:
```bash
npm install electron-updater
```

### 3. CI/CD Automation
Set up GitHub Actions to build automatically on release:
- Build on push to `main`
- Automatic version tagging
- Upload to release assets

### 4. App Store Distribution (Optional)
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
