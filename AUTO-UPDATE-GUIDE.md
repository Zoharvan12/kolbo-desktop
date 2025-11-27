# 🔄 Auto-Update System - Complete Guide

## ✅ What Was Added

Your Kolbo Desktop app now has **automatic update checking**!

### Features

- ✅ **Checks for updates on startup** (after 3 seconds)
- ✅ **Periodic checks** every 4 hours while running
- ✅ **User notifications** when updates are available
- ✅ **Background downloads** (asks permission first)
- ✅ **One-click install** (restarts app automatically)
- ✅ **GitHub Releases** integration (free hosting)

---

## 🚀 How It Works

### For Users

1. **App checks GitHub** for new releases automatically
2. **Notification appears** if update is available
3. **User clicks** "Download & Install"
4. **Update downloads** in background
5. **Notification shows** when ready
6. **User clicks** "Restart Now"
7. **App restarts** with new version installed!

### Update Flow

```
User opens app
   ↓
After 3 seconds → Check GitHub for updates
   ↓
New version found?
   ├─ NO → Continue normally, check again in 4 hours
   └─ YES → Show dialog: "Update available!"
             User clicks "Download & Install"
                 ↓
             Download update in background
                 ↓
             Show dialog: "Update ready! Restart?"
             User clicks "Restart Now"
                 ↓
             App quits, installs update, restarts
                 ↓
             User now on new version! ✅
```

---

## 📦 Releasing New Versions

### When You Want to Release v1.0.1

#### Step 1: Update Version Number

**Edit package.json:**
```json
{
  "version": "1.0.1"  // Change from 1.0.0
}
```

#### Step 2: Commit Changes

```bash
git add .
git commit -m "Bump version to 1.0.1 - Add [features/fixes]"
git push
```

#### Step 3: Build New Installers

```bash
# Build all 3 environments
npm run build:prod:win
npm run build:staging:win
npm run build:dev:win

# Or use the batch file
REBUILD-ALL-INSTALLERS.bat
```

**Output:**
```
dist/Kolbo Desktop-Setup-1.0.1.exe         (Production)
dist/Kolbo Desktop Staging-Setup-1.0.1.exe (Staging)
dist/Kolbo Desktop Dev-Setup-1.0.1.exe     (Development)
```

#### Step 4: Create GitHub Release

**Go to GitHub:**
```
https://github.com/Zoharvan12/kolbo-desktop/releases/new
```

**Fill in:**
- **Tag:** `v1.0.1` (must match package.json version with 'v' prefix)
- **Title:** `Kolbo Desktop v1.0.1`
- **Description:**
  ```markdown
  ## What's New in v1.0.1

  - Added auto-update feature
  - Fixed system tray icon
  - Fixed installer sidebar branding
  - Performance improvements

  ## Installation

  **Windows:** Download `Kolbo Desktop-Setup-1.0.1.exe`
  **macOS:** Download `Kolbo Desktop-1.0.1.dmg`

  ## Full Changelog
  https://github.com/Zoharvan12/kolbo-desktop/compare/v1.0.0...v1.0.1
  ```

**Upload Files:**
1. Click "Attach binaries by dropping them here or selecting them"
2. Upload `Kolbo Desktop-Setup-1.0.1.exe` (production installer)
3. Upload `Kolbo Desktop-1.0.1.dmg` (when you build on Mac)
4. **Important:** Only upload **production** installers (not staging/dev)

**Publish:**
- Check **"Set as the latest release"**
- Click **"Publish release"**

#### Step 5: Users Get Updated Automatically!

Within 4 hours (or next time they open the app):
- Users see "Update available" notification
- They click "Download & Install"
- Update happens automatically
- They're now on v1.0.1! ✅

---

## 🎯 Update Frequency

### When Updates Are Checked

1. **On Startup** - 3 seconds after app opens
2. **Every 4 Hours** - While app is running
3. **No internet?** - Silently fails, tries again later

### Configuring Check Frequency

Edit `src/main/main.js` if you want different timing:

```javascript
// Check on startup (currently 3 seconds)
setTimeout(() => {
  autoUpdater.checkForUpdates();
}, 3000);  // Change this number (milliseconds)

// Check periodically (currently 4 hours)
setInterval(() => {
  autoUpdater.checkForUpdates();
}, 4 * 60 * 60 * 1000);  // Change this number
```

**Recommended:**
- **Startup:** 3-5 seconds (give app time to initialize)
- **Periodic:** 2-6 hours (balance between freshness and server load)

---

## 🔧 Testing Auto-Update

### Before Releasing to Users

1. **Make sure you have v1.0.0 installed**
2. **Create a test release v1.0.1** on GitHub
3. **Open the app** (v1.0.0)
4. **Wait 3 seconds**
5. **Should see:** "Update available" dialog
6. **Click:** "Download & Install"
7. **Wait for download**
8. **Should see:** "Update ready! Restart?"
9. **Click:** "Restart Now"
10. **App restarts** with v1.0.1!

### Testing Checklist

- [ ] Create GitHub release with tag `v1.0.1`
- [ ] Upload production installer as asset
- [ ] Mark as "latest release"
- [ ] Open app (older version)
- [ ] Wait for update notification
- [ ] Download and install update
- [ ] Verify new version after restart

---

## 🎨 Customizing Update Messages

### Change Dialog Text

Edit `src/main/main.js`:

```javascript
// Update available dialog
dialog.showMessageBox(mainWindow, {
  type: 'info',
  title: 'Update Available',
  message: `A new version (${info.version}) is available!`,
  detail: 'Would you like to download and install it?',  // Change this
  buttons: ['Download & Install', 'Later'],  // Change button text
  defaultId: 0,
  cancelId: 1
});
```

### Change Download Message

```javascript
dialog.showMessageBox(mainWindow, {
  type: 'info',
  title: 'Downloading Update',
  message: 'Downloading update in background...',  // Change this
  detail: 'You\'ll be notified when it\'s ready to install.',  // Change this
  buttons: ['OK']
});
```

### Change Ready to Install Message

```javascript
dialog.showMessageBox(mainWindow, {
  type: 'info',
  title: 'Update Ready',
  message: `Version ${info.version} has been downloaded.`,  // Change this
  detail: 'Restart now to install the update?',  // Change this
  buttons: ['Restart Now', 'Later']
});
```

---

## 🔐 Security Considerations

### Code Signing (Recommended for Production)

**Currently:** Installers are NOT code-signed

**Impact on Auto-Update:**
- Updates will work fine
- Users may see security warnings on first install
- Auto-updates inherit trust from initial install

**To Add Code Signing:**

**Windows:**
1. Buy code signing certificate (~$100-400/year)
2. Add to package.json:
   ```json
   "win": {
     "certificateFile": "path/to/cert.pfx",
     "certificatePassword": "your-password"
   }
   ```

**macOS:**
1. Buy Apple Developer ID (~$99/year)
2. Add to package.json:
   ```json
   "mac": {
     "identity": "Developer ID Application: Your Name (TEAM_ID)"
   }
   ```

---

## 📊 Monitoring Updates

### Check Update Logs

In the app console (Ctrl+Shift+I in development):

```
[Updater] Checking for updates...
[Updater] Update available: 1.0.1
[Updater] Download progress: 25%
[Updater] Download progress: 50%
[Updater] Download progress: 75%
[Updater] Download progress: 100%
[Updater] Update downloaded: 1.0.1
```

### GitHub Release Statistics

On GitHub, you can see:
- Number of downloads per release
- Download counts for each asset
- Release views

Go to:
```
https://github.com/Zoharvan12/kolbo-desktop/releases
```

---

## 🐛 Troubleshooting

### Update Check Fails

**Symptoms:** No update notifications appear

**Causes:**
1. No internet connection
2. GitHub API rate limit reached
3. Release not marked as "latest"
4. Version tag doesn't match (must be `v1.0.1` not `1.0.1`)

**Fix:**
- Check internet connection
- Verify GitHub release is marked "latest"
- Verify tag starts with `v` (e.g., `v1.0.1`)
- Check console logs for errors

### Download Fails

**Symptoms:** Download starts but fails

**Causes:**
1. Installer file too large
2. Network interruption
3. GitHub download throttled

**Fix:**
- Check file size (should be < 500 MB)
- Retry download
- Use GitHub CDN for large files

### Update Installs but Fails to Restart

**Symptoms:** Update downloads, user clicks restart, nothing happens

**Causes:**
1. App didn't fully quit
2. Permissions issue

**Fix:**
- Fully quit app manually
- Run new installer manually from Downloads folder

---

## 📈 Version Numbering

### Semantic Versioning

Use semantic versioning: `MAJOR.MINOR.PATCH`

**Examples:**
- `1.0.0` → `1.0.1` - Bug fix (patch)
- `1.0.1` → `1.1.0` - New feature (minor)
- `1.1.0` → `2.0.0` - Breaking change (major)

**When to Bump:**
- **Patch (1.0.0 → 1.0.1):** Bug fixes, small improvements
- **Minor (1.0.0 → 1.1.0):** New features, backwards compatible
- **Major (1.0.0 → 2.0.0):** Breaking changes, major redesign

---

## 🎯 Best Practices

### Release Frequency

**Recommended:**
- **Bug fixes:** Release immediately (patch)
- **New features:** Every 1-2 weeks (minor)
- **Major updates:** Every 2-3 months (major)

### Release Notes

**Always include:**
- What's new (features)
- What's fixed (bugs)
- What changed (improvements)
- Breaking changes (if any)

**Example:**
```markdown
## What's New in v1.1.0

### Features
- Added drag-and-drop to DaVinci Resolve
- Added Premiere Pro integration
- New shortcut keys (Ctrl+D to download)

### Fixes
- Fixed system tray icon not showing
- Fixed installer sidebar image
- Fixed memory leak in media browser

### Improvements
- Faster startup time (2x faster)
- Reduced memory usage (30% less)
- Better error messages
```

### Testing Before Release

**Checklist:**
- [ ] Test on clean Windows 10/11
- [ ] Test on clean macOS (Intel + M1)
- [ ] Test auto-update from previous version
- [ ] Test all new features
- [ ] Test all fixed bugs are resolved
- [ ] Review all commit messages
- [ ] Update changelog
- [ ] Tag version in git
- [ ] Build installers
- [ ] Create GitHub release
- [ ] Upload installers
- [ ] Publish release

---

## 🚨 Disabling Auto-Update (If Needed)

### Temporarily Disable for Development

Auto-update is already disabled in development mode:

```javascript
if (process.env.NODE_ENV !== 'development') {
  setupAutoUpdater();  // Only runs in production
}
```

### Permanently Disable for Specific Build

Edit `src/main/main.js`, comment out:

```javascript
// setupAutoUpdater();  // Disabled
```

Or set environment variable:
```javascript
if (process.env.DISABLE_AUTO_UPDATE !== 'true') {
  setupAutoUpdater();
}
```

---

## 📞 Support

### For Users Having Update Issues

**Provide this checklist:**
1. Check internet connection
2. Manually download latest installer from website
3. Uninstall old version
4. Install new version
5. Open app and check version (Help → About)

### For Developers

- **electron-updater docs:** https://www.electron.build/auto-update
- **GitHub Releases API:** https://docs.github.com/en/rest/releases
- **Code signing:** https://www.electron.build/code-signing

---

## 📦 Summary

**What You Have:**
- ✅ Auto-update checking (startup + every 4 hours)
- ✅ User-friendly update dialogs
- ✅ Background downloads
- ✅ One-click install
- ✅ GitHub Releases integration (free)

**How to Release Updates:**
1. Update version in package.json
2. Build installers
3. Create GitHub release with tag `v1.0.1`
4. Upload installers
5. Publish
6. Users get notified automatically!

**Next Steps:**
1. Rebuild installers with auto-update code
2. Test auto-update locally
3. Create first GitHub release (v1.0.0)
4. Test update from v1.0.0 to v1.0.1

---

**Auto-update is ready!** 🎉

Users will always stay current with the latest version automatically.
