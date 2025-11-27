# ⚡ Quick Test Guide - Update System

## Why `npm start` doesn't work?

electron-updater **ONLY works in packaged apps**, not in development mode.

The error you saw:
```
Skip checkForUpdates because application is not packed and dev update config is not forced
```

This is expected - electron-updater refuses to run in `npm start` mode for security reasons.

---

## ✅ **Easiest Way to Test (5 minutes)**

### **Step 1: Build & Install v1.0.0**

```bash
# Make sure package.json shows version 1.0.0
# (Currently it's 1.0.1, let's change it back temporarily)
```

Change in `package.json`:
```json
"version": "1.0.0"
```

Then build:
```bash
cd "G:\Projects\Kolbo.AI\github\kolbo-desktop"
npm run build:prod:win
```

Install the app:
```
dist\Kolbo Desktop-Setup-1.0.0.exe
```

### **Step 2: Create GitHub Release v1.0.1**

1. **Click this link:** https://github.com/Zoharvan12/kolbo-desktop/releases/new?tag=v1.0.1&title=Kolbo+Desktop+v1.0.1

2. **Upload files:**
   - `dist/Kolbo Desktop-Setup-1.0.1.exe` (already built)
   - `dist/latest.yml` (already built)

3. **Publish** (make sure "pre-release" is unchecked!)

### **Step 3: Test!**

1. **Launch the installed app** (v1.0.0)

2. **Wait 3 seconds** - you should see in console:
   ```
   [Updater] Update available: 1.0.1
   ```

3. **Go to Settings tab**
   - You'll see "Update available: 1.0.1"
   - Beautiful update card appears!
   - Click "Download Update"
   - Progress bar shows download
   - Click "Restart & Install"
   - App updates to 1.0.1!

---

## 🎯 **Alternative: Mock Test (No Build Required)**

If you just want to test the **UI** (not the actual update):

1. Run: `npm start`

2. Open DevTools Console (`Ctrl+Shift+I`)

3. Paste this:

```javascript
// Simulate update available
const app = document.querySelector('#app').__vue__ || window.app;
if (app) {
  app.showUpdateAvailable({
    version: '1.0.5',
    releaseNotes: 'Test Release:\n- New feature 1\n- Bug fix 2\n- Performance improvements'
  });
}
```

4. To test download progress:
```javascript
app.updateDownloadProgress({
  percent: 45,
  transferred: 50 * 1024 * 1024,
  total: 100 * 1024 * 1024
});
```

5. To test download complete:
```javascript
app.showUpdateDownloaded({ version: '1.0.5' });
```

---

## 📝 **Summary**

**Can't use `npm start` for testing** - electron-updater blocks it.

**Two options:**
1. ✅ **Full test**: Build → Install → Create GitHub release → See real update
2. ✅ **UI test**: Use console commands to trigger UI states

**I recommend Option 1** - it only takes 5 minutes and tests the real thing!

---

Want me to walk you through it step by step? 🚀
