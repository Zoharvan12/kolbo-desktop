# Kolbo Desktop - macOS Build Instructions

## Prerequisites

Before building on Mac, ensure you have:

- ✅ macOS 10.13 or later
- ✅ Node.js 18+ installed ([download](https://nodejs.org/))
- ✅ Xcode Command Line Tools (run: `xcode-select --install`)
- ✅ Git installed

## Quick Start

### 1. Clone or Pull Latest Code

```bash
# If first time
git clone <repository-url>
cd kolbo-desktop

# If already cloned
cd kolbo-desktop
git pull origin main
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build Installers

#### Option A: Build Single Environment

```bash
# Production (default) - connects to api.kolbo.ai
./build-mac.sh production

# Staging - connects to stagingapi.kolbo.ai
./build-mac.sh staging

# Development - connects to localhost:5050
./build-mac.sh development
```

#### Option B: Build All Environments at Once

```bash
./build-all-mac.sh
```

This builds all 3 versions (dev, staging, production) sequentially. Takes ~5-10 minutes.

## Output

All installers are created in the `dist/` folder:

```
dist/
├── Kolbo Desktop-1.0.0.dmg              (Production)
├── Kolbo Desktop Staging-1.0.0.dmg      (Staging)
└── Kolbo Desktop Dev-1.0.0.dmg          (Development)
```

Each DMG is approximately **50-100 MB**.

## Testing Checklist

After building, test the installer:

### Installation Test
- [ ] Double-click the DMG file
- [ ] Drag "Kolbo Desktop" to Applications folder
- [ ] Eject the DMG
- [ ] Open app from Applications folder
- [ ] Verify no "Damaged/Can't Open" error (see Troubleshooting below)

### Functionality Test
- [ ] App opens and shows login screen
- [ ] Login with Kolbo.AI account works
- [ ] Media library loads correctly
- [ ] Can browse and filter media
- [ ] API endpoint is correct:
  - Production: `api.kolbo.ai`
  - Staging: `stagingapi.kolbo.ai`
  - Development: `localhost:5050`

### System Integration Test
- [ ] App icon appears correctly in Dock
- [ ] App can be added to Dock permanently
- [ ] System tray icon works
- [ ] Minimize to tray works
- [ ] App survives restart

## Distribution

### For Production Release

1. **Build production version:**
   ```bash
   ./build-mac.sh production
   ```

2. **Upload to website:**
   - File: `dist/Kolbo Desktop-1.0.0.dmg`
   - Recommended location: `https://kolbo.ai/downloads/mac/`

3. **Update download page** with link and version info

### For Team Testing (Staging/Dev)

1. Build the appropriate version
2. Share via:
   - Internal file server
   - Cloud storage (Dropbox, Drive, etc.)
   - Direct transfer (AirDrop, USB)

## Troubleshooting

### "Kolbo Desktop" is damaged and can't be opened

This happens because the app isn't code-signed. Users can bypass this:

**Solution for users:**
1. Right-click (or Control+click) on the app in Applications
2. Select "Open" from the menu
3. Click "Open" in the security dialog
4. App will now open and be trusted

**Alternative solution:**
```bash
# Remove quarantine attribute (advanced users)
xcode-select --install  # if not already installed
sudo xattr -r -d com.apple.quarantine "/Applications/Kolbo Desktop.app"
```

**Permanent fix (requires Apple Developer account):**
- Sign the app with a Developer ID certificate ($99/year)
- See section below on code signing

### Build fails with "electron-builder not found"

```bash
npm install
```

### Build fails with "EACCES: permission denied"

```bash
sudo chown -R $(whoami) ~/.npm
npm install
```

### "node-gyp" errors during npm install

```bash
# Install Xcode Command Line Tools
xcode-select --install

# Then retry
npm install
```

### DMG mounts but app doesn't appear

The build may have failed silently. Check:
```bash
ls -lh dist/mac
```

If the folder is empty or missing files, rebuild:
```bash
rm -rf dist
./build-mac.sh production
```

## Code Signing (Optional - for production)

To remove the "damaged app" warning, sign the app with Apple Developer ID.

### Requirements
- Apple Developer account ($99/year)
- Developer ID Application certificate
- Developer ID Installer certificate

### Setup

1. **Get certificates from Apple Developer portal**

2. **Update package.json:**
   ```json
   "mac": {
     "identity": "Developer ID Application: Your Company Name (TEAM_ID)",
     "hardenedRuntime": true,
     "gatekeeperAssess": true,
     "entitlements": "build/entitlements.mac.plist",
     "entitlementsInherit": "build/entitlements.mac.plist"
   }
   ```

3. **Create entitlements file** (if needed for specific features)

4. **Rebuild:**
   ```bash
   ./build-mac.sh production
   ```

5. **Notarize with Apple** (required for macOS 10.15+):
   ```bash
   # electron-builder can do this automatically with proper credentials
   ```

## Building Both Intel and Apple Silicon

The current configuration builds **universal binaries** that work on both:
- Intel Macs (x64)
- Apple Silicon Macs (arm64, M1/M2/M3)

This is configured in `package.json`:
```json
"mac": {
  "target": [
    {
      "target": "dmg",
      "arch": ["x64", "arm64"]
    }
  ]
}
```

## CI/CD (Future Enhancement)

For automated builds on every commit:

1. Use **GitHub Actions** with macOS runner
2. Configure secrets for code signing (if used)
3. Auto-upload to release page

Example workflow: See `.github/workflows/build-mac.yml` (if created)

## Support

If you encounter issues:

1. Check this troubleshooting guide
2. Review build logs in terminal
3. Check electron-builder docs: https://www.electron.build/
4. Contact the development team

## Environment Variables

The build scripts set `KOLBO_ENV` which is read by `src/config.js`:

- `development` → API: `http://localhost:5050/api`
- `staging` → API: `https://stagingapi.kolbo.ai/api`
- `production` → API: `https://api.kolbo.ai/api`

This is automatically configured - no manual changes needed!

## Version Updates

To release a new version:

1. **Update version in package.json:**
   ```json
   "version": "1.0.1"
   ```

2. **Rebuild all installers:**
   ```bash
   ./build-all-mac.sh
   ```

3. **Test thoroughly**

4. **Upload and announce**

---

**Last Updated:** 2025-11-27
**Build System:** electron-builder v24.13.3
**Tested on:** macOS 14.0 (Sonoma), macOS 13.0 (Ventura)
