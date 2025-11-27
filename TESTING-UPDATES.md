# Testing the Update Notification System

## Current State
- ✅ Update system fully implemented
- ✅ Temporarily enabled in development mode
- ✅ Built v1.0.1 installer ready to test
- 📦 Installer location: `dist/Kolbo Desktop-Setup-1.0.1.exe`

---

## 🧪 **Method 1: Test with GitHub Release (Recommended)**

This tests the **real update flow** as users will experience it.

### **Step 1: Create GitHub Release**

1. **Go to GitHub releases:**
   ```
   https://github.com/Zoharvan12/kolbo-desktop/releases/new
   ```

2. **Fill in the release form:**
   - **Tag:** `v1.0.1`
   - **Release title:** `Kolbo Desktop v1.0.1 - Test Release`
   - **Description:**
     ```
     ## What's New
     - ✨ New update notification system
     - 🎨 Improved Settings page
     - 🐛 Bug fixes and improvements

     This is a test release to verify the update system works correctly.
     ```

3. **Upload the installer:**
   - Click "Attach binaries"
   - Upload: `G:\Projects\Kolbo.AI\github\kolbo-desktop\dist\Kolbo Desktop-Setup-1.0.1.exe`
   - Upload: `G:\Projects\Kolbo.AI\github\kolbo-desktop\dist\latest.yml`

4. **Publish:**
   - ⚠️ **IMPORTANT:** Make sure "This is a pre-release" is **UNCHECKED**
   - Click "Publish release"

### **Step 2: Downgrade Your App**

To test the update, you need to run an **older version**:

1. **Change package.json back to 1.0.0:**
   ```json
   "version": "1.0.0"
   ```

2. **Rebuild:**
   ```bash
   npm run build:prod:win
   ```

3. **Install the 1.0.0 version:**
   - Run: `dist\Kolbo Desktop-Setup-1.0.0.exe`
   - Complete installation

### **Step 3: Test the Update!**

1. **Launch the installed app** (v1.0.0)

2. **Wait 3 seconds** - auto-updater will check GitHub

3. **Check the console output:**
   - Press `Ctrl+Shift+I` to open DevTools
   - Look for: `[Updater] Update available: 1.0.1`

4. **Go to Settings tab:**
   - You should see: "Update available: 1.0.1"
   - A beautiful update card should appear

5. **Click "Download Update":**
   - Progress bar should show download progress
   - When done, "Restart & Install" button appears

6. **Click "Restart & Install":**
   - App closes
   - Installer runs automatically
   - App reopens with v1.0.1

---

## 🚀 **Method 2: Quick Test (Manual Check)**

Test the UI without waiting for auto-check:

1. **Run the app in development:**
   ```bash
   npm start
   ```

2. **Login and go to Settings**

3. **Click "Check for Updates"**

4. **Observe:**
   - Status changes to "Checking for updates..."
   - If GitHub release exists, update card appears
   - If no release, shows "Your app is up to date"

---

## 🐛 **Method 3: Mock Test (No Internet Needed)**

Test the UI components without real updates:

Open DevTools Console (`Ctrl+Shift+I`) and paste:

```javascript
// Simulate update available
app.showUpdateAvailable({
  version: '1.0.5',
  releaseNotes: 'Test changelog:\n- New feature 1\n- Bug fix 2\n- Improvement 3'
});

// Simulate download progress (run multiple times)
app.updateDownloadProgress({
  percent: 45,
  transferred: 50 * 1024 * 1024,
  total: 100 * 1024 * 1024
});

// Simulate download complete
app.showUpdateDownloaded({
  version: '1.0.5'
});
```

---

## ✅ **What to Verify**

### **Auto-Check (on app start):**
- [ ] App checks for updates 3 seconds after launch
- [ ] Console logs: `[Updater] Checking for updates...`
- [ ] If update exists, logs: `[Updater] Update available: X.X.X`

### **Manual Check:**
- [ ] "Check Now" button works
- [ ] Status shows "Checking for updates..."
- [ ] Button shows spinner while checking
- [ ] Status updates correctly (up-to-date or available)

### **Update Available:**
- [ ] Update card appears with animation
- [ ] Version number displayed correctly
- [ ] Changelog displayed (if provided)
- [ ] "Download Update" button visible

### **Download:**
- [ ] Progress bar appears
- [ ] Progress percentage updates in real-time
- [ ] MB transferred/total displayed
- [ ] Button disabled during download

### **Install:**
- [ ] "Restart & Install" button appears when download complete
- [ ] Confirmation dialog shows when clicked
- [ ] App quits and installer runs
- [ ] New version launches after install

---

## 🔄 **After Testing**

### **Disable development mode updater:**

In `src/main/main.js` line 472, change:
```javascript
const ENABLE_UPDATER_IN_DEV = false; // Set to false after testing
```

### **Revert to 1.0.0 if needed:**

If you want to keep the old version:
```json
"version": "1.0.0"
```

---

## 📝 **Expected Console Output**

When update is found:
```
[Updater] Checking for updates...
[Updater] Update available: 1.0.1
[Update] Update available: {version: '1.0.1', releaseDate: '...', ...}
```

When downloading:
```
[Updater] Download progress: 25%
[Updater] Download progress: 50%
[Updater] Download progress: 75%
[Updater] Download progress: 100%
[Updater] Update downloaded: 1.0.1
```

When no update:
```
[Updater] Checking for updates...
[Updater] App is up to date
```

---

## 🎯 **Quick Start (Copy-Paste)**

```bash
# 1. Create GitHub release with v1.0.1
# 2. Upload dist/Kolbo Desktop-Setup-1.0.1.exe
# 3. Publish release

# 4. Change package.json to "version": "1.0.0"
# 5. Rebuild
npm run build:prod:win

# 6. Install old version
.\dist\Kolbo-Desktop-Setup-1.0.0.exe

# 7. Launch app and go to Settings
# 8. See update notification!
```

---

## 🚨 **Troubleshooting**

### **"No update available" even though release exists:**
- Make sure GitHub release is **published** (not draft)
- Make sure it's **NOT a pre-release**
- Check the version is **higher** than current (1.0.1 > 1.0.0)
- Wait a few minutes for GitHub CDN to update

### **Update check fails:**
- Check internet connection
- Check console for errors
- Verify GitHub repository settings
- Make sure `latest.yml` was uploaded to release

### **Download fails:**
- Check GitHub release has the `.exe` file
- Verify file is not corrupted
- Check antivirus isn't blocking

---

**Happy Testing! 🎉**
