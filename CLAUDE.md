# Kolbo Studio Desktop - Project Context for Claude

## Memory Hierarchy (READ FIRST)
At the start of every session, read `C:\Users\Zohar\.claude\memory\MEMORY.md` for the global peer card, user preferences, and cross-project rules that apply to all Kolbo repos.

## Full-Stack Tool Map
Read `C:\Users\Zohar\.claude\KOLBO-STACK.md` when working on any feature — maps every tool's frontend ↔ backend files across all repos (kolbo-map, kolbo-api, kolbo-desktop, kolbo-adobe-plugin).

**MANDATORY**: When you add, remove, or rename a key file in kolbo-desktop, update KOLBO-STACK.md in the same step. Do not wait to be asked.

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

## Internationalization (i18n)

### ALWAYS Use Translation Keys
When adding any user-facing text (buttons, labels, messages, etc.), ALWAYS:
1. Add a translation key to `src/renderer/i18n/locales/en.json`
2. Use `window.t('key')` in JavaScript or `data-i18n="key"` in HTML
3. NEVER hardcode visible strings

### Translation Script
When adding new strings or updating translations, use the Gemini translation script:

```javascript
// translate-locales.js - creates/updates all locale files
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

// To run translations:
node translate-locales.js
```

### Locale Files Location
- `src/renderer/i18n/locales/en.json` - Source (English)
- `src/renderer/i18n/locales/he.json` - Hebrew (RTL)
- `src/renderer/i18n/locales/ar.json` - Arabic (RTL)
- Plus: ru, es, fr, de, zh, pt, ja, ko, hi

### RTL Languages
Hebrew and Arabic automatically flip layout to RTL when selected.

## Video Studio Sub-App

`src/renderer/ltx-studio/` is a vendored copy of [Lightricks/LTX-Desktop](https://github.com/Lightricks/LTX-Desktop) (Apache 2.0), built as a static React+Vite sub-app and loaded by `main.js::_loadVideoStudioIframe()` into a tab driven by `src/renderer/index.html#video-studio-view`.

- Build: `npm run build:ltx-studio` — outputs `src/renderer/ltx-studio/dist/`. Chained into `build:prod:win` and `build:prod:mac`.
- LTX's Electron main process and Python backend were removed. A stub at `src/renderer/ltx-studio/frontend/lib/electron-api-stub.ts` provides safe no-op defaults so the React app boots.
- Generation is NOT yet wired — needs a Kolbo API adapter in `frontend/lib/backend.ts`. See `src/renderer/ltx-studio/KOLBO-VENDORING-NOTES.md` for the full follow-up list.
- electron-builder `files` glob in `package.json` excludes the LTX source folders (`frontend/`, `shared/`, `node_modules/`, etc.) and includes only `dist/`.
- Third-party attribution at root `THIRD-PARTY.md`.

## Last Updated
- **Date**: May 27, 2026
- **Version**: 1.5.1
- **Status**: Video Studio sub-app vendored from LTX-Desktop (scaffold only — API adapter pending)
