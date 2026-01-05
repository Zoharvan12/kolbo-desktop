# macOS Code Signing & Notarization Setup Guide

## Overview

Now that you're an Apple Developer, you need to configure code signing and notarization to eliminate all macOS security warnings. This guide walks you through the complete setup.

## Why This Matters

Without proper code signing and notarization:
- ❌ Users see "Kolbo Studio is damaged and can't be opened"
- ❌ Users see "unidentified developer" warnings
- ❌ Users must right-click and manually allow the app
- ❌ Gatekeeper blocks the app on first launch
- ❌ Auto-updates may fail

With proper setup:
- ✅ App opens without warnings
- ✅ No security dialogs
- ✅ Smooth installation experience
- ✅ Auto-updates work seamlessly
- ✅ Professional, trusted distribution

## Prerequisites

- ✅ Apple Developer Program membership (you have this!)
- ✅ macOS with Xcode Command Line Tools installed
- ✅ Access to Apple Developer portal

## Step 1: Get Your Certificates

### 1.1 Log into Apple Developer Portal

1. Go to: https://developer.apple.com/account
2. Sign in with your Apple ID
3. Navigate to **Certificates, Identifiers & Profiles**

### 1.2 Create Developer ID Application Certificate

**This certificate signs your app:**

1. Click **Certificates** → **+** (plus button)
2. Under **Software**, select **Developer ID Application**
3. Click **Continue**
4. Upload a Certificate Signing Request (CSR):
   ```bash
   # On your Mac, open Keychain Access
   # Menu: Keychain Access → Certificate Assistant → Request a Certificate from a Certificate Authority
   # Enter your email and name
   # Select "Saved to disk"
   # Save the CSR file
   ```
5. Upload the CSR file in the portal
6. Download the certificate (`.cer` file)
7. Double-click to install in Keychain Access

### 1.3 Create Developer ID Installer Certificate

**This certificate signs your DMG/installer:**

1. In Certificates, click **+** again
2. Select **Developer ID Installer**
3. Upload the same CSR (or create a new one)
4. Download and install the certificate

### 1.4 Verify Certificates in Keychain

Open **Keychain Access** and verify you have:
- ✅ **Developer ID Application: Kolbo.AI (TEAM_ID)**
- ✅ **Developer ID Installer: Kolbo.AI (TEAM_ID)**

**Note your Team ID** - you'll need it for configuration (format: `ABC123DEF4`)

## Step 2: Get Your App-Specific Password

For notarization, you need an app-specific password:

1. Go to: https://appleid.apple.com
2. Sign in with your Apple ID
3. Go to **Security** section
4. Under **App-Specific Passwords**, click **Generate Password**
5. Label it: "Kolbo Studio Notarization"
6. **Copy the password immediately** (you won't see it again!)
7. Save it securely (you'll use it as `APPLE_APP_SPECIFIC_PASSWORD`)

## Step 3: Configure Environment Variables

Set these environment variables on your Mac (where you build):

### Option A: Permanent Setup (Recommended)

Add to your `~/.zshrc` or `~/.bash_profile`:

```bash
# macOS Code Signing Configuration
export APPLE_IDENTITY="Developer ID Application: Kolbo.AI (YOUR_TEAM_ID)"
export APPLE_TEAM_ID="YOUR_TEAM_ID"
export APPLE_ID="your-apple-id@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
```

**Replace:**
- `YOUR_TEAM_ID` with your actual Team ID (e.g., `ABC123DEF4`)
- `your-apple-id@email.com` with your Apple ID email
- `abcd-efgh-ijkl-mnop` with your app-specific password

Then reload:
```bash
source ~/.zshrc  # or source ~/.bash_profile
```

### Option B: Temporary Setup (Current Session Only)

```bash
export APPLE_IDENTITY="Developer ID Application: Kolbo.AI (YOUR_TEAM_ID)"
export APPLE_TEAM_ID="YOUR_TEAM_ID"
export APPLE_ID="your-apple-id@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
```

### Option C: Use a `.env` File (For CI/CD)

Create `.env` file (already in `.gitignore`):
```bash
APPLE_IDENTITY=Developer ID Application: Kolbo.AI (YOUR_TEAM_ID)
APPLE_TEAM_ID=YOUR_TEAM_ID
APPLE_ID=your-apple-id@email.com
APPLE_APP_SPECIFIC_PASSWORD=abcd-efgh-ijkl-mnop
```

## Step 4: Verify Your Setup

### 4.1 Check Certificates

```bash
# List Developer ID certificates
security find-identity -v -p codesigning | grep "Developer ID"
```

You should see:
```
1) ABC123DEF4567890 "Developer ID Application: Kolbo.AI (TEAM_ID)"
2) ABC123DEF4567890 "Developer ID Installer: Kolbo.AI (TEAM_ID)"
```

### 4.2 Test Code Signing

```bash
# Test signing a dummy file (optional)
codesign --sign "Developer ID Application: Kolbo.AI (TEAM_ID)" --timestamp --options runtime /path/to/test.app
```

## Step 5: Build and Notarize

### 5.1 Build with Code Signing

```bash
# Make sure environment variables are set
export APPLE_IDENTITY="Developer ID Application: Kolbo.AI (YOUR_TEAM_ID)"
export APPLE_TEAM_ID="YOUR_TEAM_ID"
export APPLE_ID="your-apple-id@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="your-app-specific-password"

# Build production version
npm run build:prod:mac
```

electron-builder will:
1. ✅ Code sign the app with Developer ID Application certificate
2. ✅ Code sign the DMG with Developer ID Installer certificate
3. ✅ Submit to Apple for notarization
4. ✅ Wait for notarization to complete
5. ✅ Staple the notarization ticket to the app

**Note:** Notarization takes 5-15 minutes. The build will wait automatically.

### 5.2 Verify Code Signature

After building, verify the signature:

```bash
# Check app signature
codesign -dv --verbose=4 "dist/mac/Kolbo Studio.app"

# Verify signature
codesign --verify --verbose "dist/mac/Kolbo Studio.app"

# Check notarization status
spctl --assess --verbose "dist/mac/Kolbo Studio.app"
```

Expected output:
```
dist/mac/Kolbo Studio.app: accepted
source=Developer ID
```

### 5.3 Verify Notarization

```bash
# Check notarization ticket
stapler validate "dist/mac/Kolbo Studio.app"
```

Should show:
```
The validate action worked!
```

## Step 6: Test the Installer

1. **On a clean Mac** (or different user account):
   - Download the DMG
   - Double-click to mount
   - Drag app to Applications
   - Open the app

2. **Expected behavior:**
   - ✅ No "damaged" warning
   - ✅ No "unidentified developer" dialog
   - ✅ App opens immediately
   - ✅ No security prompts

## Troubleshooting

### Error: "No identity found"

**Problem:** Certificate not found in Keychain

**Solution:**
```bash
# List all certificates
security find-identity -v -p codesigning

# If missing, re-download from Apple Developer portal
# Double-click the .cer file to install
```

### Error: "Invalid Team ID"

**Problem:** Team ID doesn't match your certificate

**Solution:**
1. Check your Team ID in Apple Developer portal
2. Verify `APPLE_TEAM_ID` environment variable matches
3. Verify certificate name includes correct Team ID

### Error: "Notarization failed"

**Problem:** Apple rejected the notarization

**Solution:**
1. Check notarization logs:
   ```bash
   xcrun notarytool log --apple-id YOUR_APPLE_ID --password APP_SPECIFIC_PASSWORD --team-id TEAM_ID SUBMISSION_ID
   ```
2. Common issues:
   - Entitlements not properly configured
   - Hardened Runtime violations
   - Missing privacy descriptions
3. Fix issues and rebuild

### Error: "App-specific password invalid"

**Problem:** Password expired or incorrect

**Solution:**
1. Generate a new app-specific password
2. Update `APPLE_APP_SPECIFIC_PASSWORD` environment variable
3. Rebuild

### Build succeeds but app still shows warnings

**Possible causes:**
1. Notarization still processing (wait 15 minutes)
2. Notarization ticket not stapled (electron-builder should handle this)
3. Testing on same Mac that built it (test on different Mac)

**Solution:**
```bash
# Manually staple ticket (if needed)
xcrun stapler staple "dist/mac/Kolbo Studio.app"

# Rebuild DMG after stapling
npm run build:prod:mac
```

## CI/CD Setup (GitHub Actions)

For automated builds, add secrets to GitHub:

1. Go to: https://github.com/Zoharvan12/kolbo-desktop/settings/secrets/actions
2. Add secrets:
   - `APPLE_IDENTITY`: `Developer ID Application: Kolbo.AI (TEAM_ID)`
   - `APPLE_TEAM_ID`: Your Team ID
   - `APPLE_ID`: Your Apple ID email
   - `APPLE_APP_SPECIFIC_PASSWORD`: Your app-specific password

3. Update `.github/workflows/release.yml` to use these secrets:
   ```yaml
   env:
     APPLE_IDENTITY: ${{ secrets.APPLE_IDENTITY }}
     APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
     APPLE_ID: ${{ secrets.APPLE_ID }}
     APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
   ```

## Quick Reference

### Environment Variables Needed

```bash
APPLE_IDENTITY="Developer ID Application: Kolbo.AI (TEAM_ID)"
APPLE_TEAM_ID="YOUR_TEAM_ID"
APPLE_ID="your-apple-id@email.com"
APPLE_APP_SPECIFIC_PASSWORD="app-specific-password"
```

### Build Command

```bash
npm run build:prod:mac
```

### Verification Commands

```bash
# Check signature
codesign -dv --verbose=4 "dist/mac/Kolbo Studio.app"

# Verify notarization
spctl --assess --verbose "dist/mac/Kolbo Studio.app"
stapler validate "dist/mac/Kolbo Studio.app"
```

## Costs

- **Apple Developer Program**: $99/year (you already have this!)
- **Code Signing Certificates**: Included with membership
- **Notarization**: Free (included with membership)
- **Total Additional Cost**: $0 (already paid!)

## Next Steps

1. ✅ Get certificates from Apple Developer portal
2. ✅ Set up environment variables
3. ✅ Build and test locally
4. ✅ Verify no warnings appear
5. ✅ Set up CI/CD secrets (optional)
6. ✅ Release signed and notarized version!

---

**Last Updated:** 2025-01-XX  
**Status:** Ready for configuration  
**Required:** Apple Developer account (✅ You have this!)
