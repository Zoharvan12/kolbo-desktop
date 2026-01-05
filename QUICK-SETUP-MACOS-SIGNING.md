# Quick Setup: macOS Code Signing

## 🚀 Fast Track (5 minutes)

### Step 1: Get Your Team ID
1. Go to: https://developer.apple.com/account
2. Look in the top-right corner for your **Team ID** (format: `ABC123DEF4`)

### Step 2: Create App-Specific Password
1. Go to: https://appleid.apple.com
2. Security → App-Specific Passwords → Generate Password
3. Label: "Kolbo Studio Notarization"
4. **Copy the password** (you won't see it again!)

### Step 3: Get Certificates
1. Go to: https://developer.apple.com/account/resources/certificates/list
2. Click **+** to create:
   - **Developer ID Application** certificate
   - **Developer ID Installer** certificate
3. Download and double-click to install (they'll appear in Keychain Access)

### Step 4: Run Setup Script

On your Mac:

```bash
./setup-macos-signing.sh
```

Follow the prompts - it will configure everything automatically!

### Step 5: Build

```bash
npm run build:prod:mac
```

That's it! The build will be signed and notarized automatically.

---

## Manual Setup (If Script Doesn't Work)

### Set Environment Variables

Add to `~/.zshrc` or `~/.bash_profile`:

```bash
export APPLE_IDENTITY="Developer ID Application: Kolbo.AI (YOUR_TEAM_ID)"
export APPLE_TEAM_ID="YOUR_TEAM_ID"
export APPLE_ID="your-apple-id@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="your-app-specific-password"
```

Then:
```bash
source ~/.zshrc  # or source ~/.bash_profile
npm run build:prod:mac
```

---

## For CI/CD (GitHub Actions)

Add these secrets to GitHub:
- Go to: https://github.com/Zoharvan12/kolbo-desktop/settings/secrets/actions
- Add:
  - `APPLE_IDENTITY`: `Developer ID Application: Kolbo.AI (YOUR_TEAM_ID)`
  - `APPLE_TEAM_ID`: Your Team ID
  - `APPLE_ID`: Your Apple ID email
  - `APPLE_APP_SPECIFIC_PASSWORD`: Your app-specific password

The workflow will automatically use them!

---

## Verify It Works

After building, test on a clean Mac:
1. Download the DMG
2. Open it
3. Drag app to Applications
4. Open the app

**Expected:** No warnings, opens immediately! ✅

**If you see warnings:** Check [MACOS-CODE-SIGNING.md](./MACOS-CODE-SIGNING.md) troubleshooting section.

---

**Full Guide:** See [MACOS-CODE-SIGNING.md](./MACOS-CODE-SIGNING.md) for detailed instructions.
