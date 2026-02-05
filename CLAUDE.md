# Kolbo Studio Desktop - Project Context for Claude

## Project Overview

Kolbo Studio is an Electron-based desktop application for video editors. It provides AI-powered creative tools and integrates with video editing software.

## Tech Stack

- **Framework**: Electron 28.x
- **Build System**: electron-builder 24.x
- **Auto-Updates**: electron-updater
- **CI/CD**: GitHub Actions

## Key Files

### Configuration
- `package.json` - App config, dependencies, and electron-builder settings
- `.github/workflows/release.yml` - CI/CD workflow for building and releasing
- `entitlements.mac.plist` - macOS app entitlements
- `entitlements.mac.inherit.plist` - macOS inherited entitlements

### Main Code
- `src/main/main.js` - Main Electron process
- `src/renderer/` - Renderer process (UI)

## macOS Code Signing & Notarization (WORKING)

As of February 2026, macOS builds are **fully signed and notarized**.

### Configuration in package.json
```json
"mac": {
  "hardenedRuntime": true,
  "gatekeeperAssess": true,
  "entitlements": "entitlements.mac.plist",
  "entitlementsInherit": "entitlements.mac.inherit.plist",
  "notarize": {
    "teamId": "DPVW9Z2L9Y"
  }
}
```

### Required GitHub Secrets
- `CSC_LINK` - Base64-encoded .p12 certificate file
- `CSC_KEY_PASSWORD` - Certificate password
- `APPLE_ID` - Apple ID email (malcazohar@gmail.com)
- `APPLE_APP_SPECIFIC_PASSWORD` - App-specific password from appleid.apple.com
- `APPLE_TEAM_ID` - Apple Developer Team ID (DPVW9Z2L9Y)

### Environment Variables for CI
The workflow sets these for the macOS build:
```yaml
CSC_NAME: "Zohar Vanunu Productions, LLC (DPVW9Z2L9Y)"
CSC_LINK: ${{ secrets.CSC_LINK }}
CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
APPLE_ID: ${{ secrets.APPLE_ID }}
APPLE_ID_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
```

### Local Build with Notarization
```bash
export APPLE_ID="malcazohar@gmail.com"
export APPLE_ID_PASSWORD="<app-specific-password>"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific-password>"
export APPLE_TEAM_ID="DPVW9Z2L9Y"
npm run build:prod:mac
```

### Verify Notarization
```bash
spctl --assess --verbose dist/mac-universal/Kolbo\ Studio.app
# Should show: source=Notarized Developer ID
```

## Release Process

### Automated Release
```bash
npm run version:patch   # 1.1.6 -> 1.1.7
# This automatically:
# 1. Bumps version in package.json
# 2. Creates git commit and tag
# 3. Pushes to GitHub
# 4. Triggers GitHub Actions build
# 5. Creates GitHub Release with all installers
```

### Manual Release
1. Update version in `package.json`
2. Commit and push to master
3. GitHub Actions will build and create release

## Common Issues & Solutions

### Notarization "hangs" or fails
1. Check Apple Developer System Status: https://developer.apple.com/system-status/
2. Verify credentials with: `xcrun notarytool history --apple-id EMAIL --team-id TEAM_ID --password PASSWORD`
3. Check for submission errors: `xcrun notarytool log SUBMISSION_ID --apple-id EMAIL --team-id TEAM_ID --password PASSWORD`

### CSC_NAME error: "Please remove prefix 'Developer ID Application:'"
- Use just the company name: `"Zohar Vanunu Productions, LLC (DPVW9Z2L9Y)"`
- NOT: `"Developer ID Application: Zohar Vanunu Productions, LLC (DPVW9Z2L9Y)"`

### Release upload fails with "already_exists"
- Assets already exist on the release
- Delete existing assets: `gh release delete-asset vX.X.X "filename" --yes`
- Re-run the build

## File Naming Convention

GitHub converts spaces to dots in uploaded filenames:
- electron-builder creates: `Kolbo Studio-Setup-1.1.6.exe`
- GitHub uploads as: `Kolbo.Studio-Setup-1.1.6.exe`

This is expected behavior - don't try to "fix" it.

## Developer Identity

- **Company**: Zohar Vanunu Productions, LLC
- **Team ID**: DPVW9Z2L9Y
- **Certificate**: Developer ID Application: Zohar Vanunu Productions, LLC (DPVW9Z2L9Y)

## Useful Commands

```bash
# List code signing identities
security find-identity -v -p codesigning

# Check notarization history
xcrun notarytool history --apple-id EMAIL --team-id TEAM_ID --password PASSWORD

# Verify app signature
codesign -dv --verbose=2 "path/to/App.app"

# Check Gatekeeper status
spctl --assess --verbose "path/to/App.app"

# Test credentials
xcrun notarytool info SUBMISSION_ID --apple-id EMAIL --team-id TEAM_ID --password PASSWORD
```

## Last Updated
- **Date**: February 5, 2026
- **Version**: 1.1.6
- **Status**: Signing and notarization fully working
