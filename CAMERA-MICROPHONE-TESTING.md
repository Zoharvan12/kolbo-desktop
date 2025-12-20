# Camera & Microphone Permission Testing Guide

This document explains how to test camera and microphone permissions in Kolbo Studio after implementing the permission handlers.

## What Was Implemented

### 1. **macOS Entitlements** (NEW)
- `entitlements.mac.plist` - Declares camera/microphone permissions for macOS
- `entitlements.mac.inherit.plist` - Inherits permissions to child processes (renderer)

### 2. **package.json Updates**
- Added entitlements file references to Mac build configuration
- Ensures permissions are requested during macOS installation

### 3. **Permission Handlers** (EXISTING - Already Working!)
- `src/main/main.js` lines 1175-1233 - `setupPermissionHandlers()`
- Grants `camera` and `microphone` permissions to web content
- Includes `media` permission which bundles camera/microphone

### 4. **iframe Permissions** (EXISTING - Already Working!)
- `src/renderer/js/tab-manager.js` line 881
- iframe `allow` attribute includes: `camera; microphone`

---

## How to Test

### **Option 1: Test in Development (npm start)**

1. **Start the app:**
   ```bash
   npm start
   ```

2. **Navigate to a test page:**
   - In the web app, go to a page that uses camera/microphone
   - OR use this test URL in the browser: https://webcamtests.com/

3. **Check console for permission logs:**
   ```
   [Permissions] Permission requested: media
   [Permissions] ✅ Granted: media
   ```

4. **Expected behavior:**
   - **macOS**: System dialog appears asking for camera/microphone access
   - **Windows**: No system dialog (Windows grants automatically)
   - Web app can access camera/microphone via `navigator.mediaDevices.getUserMedia()`

---

### **Option 2: Test in Packaged App (macOS)**

1. **Build for macOS:**
   ```bash
   npm run build:prod:mac
   ```

2. **Install the app:**
   - Open `dist/Kolbo Studio-1.0.5.dmg`
   - Drag to Applications folder
   - Open from Applications

3. **First camera/microphone access:**
   - macOS will show system permission dialog
   - Click **"OK"** to grant permission

4. **Check System Preferences:**
   - Open System Preferences → Security & Privacy → Privacy
   - Check "Camera" and "Microphone" tabs
   - Kolbo Studio should be listed with permission granted

---

### **Option 3: Test in Packaged App (Windows)**

1. **Build for Windows:**
   ```bash
   npm run build:prod:win
   ```

2. **Install the app:**
   - Run `dist/Kolbo Studio-Setup-1.0.5.exe`
   - Install to default location

3. **Test camera/microphone:**
   - Open the app
   - Navigate to a page that uses camera/microphone
   - Should work without system prompts (Windows grants automatically)

---

## Test Scenarios

### ✅ **Scenario 1: Camera Access**
- Open a web page that requests camera (`navigator.mediaDevices.getUserMedia({ video: true })`)
- Verify camera feed appears
- Check console for permission logs

### ✅ **Scenario 2: Microphone Access**
- Open a web page that requests microphone (`navigator.mediaDevices.getUserMedia({ audio: true })`)
- Verify audio levels show activity
- Check console for permission logs

### ✅ **Scenario 3: Both Camera & Microphone**
- Open a web page that requests both (`navigator.mediaDevices.getUserMedia({ video: true, audio: true })`)
- Verify both work simultaneously

### ✅ **Scenario 4: Device Selection**
- If you have multiple cameras or microphones:
  - Check if the web app can enumerate devices (`navigator.mediaDevices.enumerateDevices()`)
  - Verify you can switch between devices

---

## Debugging

### macOS Permission Issues

If permissions don't work on macOS:

1. **Check entitlements are applied:**
   ```bash
   codesign -d --entitlements :- "/Applications/Kolbo Studio.app"
   ```
   Should show camera/microphone entitlements

2. **Reset macOS permissions:**
   ```bash
   tccutil reset Camera com.kolbo.studio
   tccutil reset Microphone com.kolbo.studio
   ```
   Then restart the app

3. **Check System Preferences:**
   - Security & Privacy → Privacy → Camera/Microphone
   - Ensure Kolbo Studio is listed and enabled

### Windows Permission Issues

If permissions don't work on Windows:

1. **Check Windows Settings:**
   - Settings → Privacy → Camera/Microphone
   - Ensure "Allow desktop apps to access your camera/microphone" is ON

2. **Check app permissions in registry** (advanced):
   - Windows stores app permissions in registry
   - Reinstalling usually fixes permission issues

### General Debugging

1. **Open DevTools in the app:**
   - Press F12 or Ctrl+Shift+I
   - Check console for errors

2. **Check Electron logs:**
   - Look for permission-related console logs in terminal (if running via `npm start`)

3. **Test in browser first:**
   - Open https://webcamtests.com/ in Chrome
   - If it works there but not in the app, it's an Electron issue

---

## Expected Console Output

### Successful Permission Grant:
```
[Permissions] Permission requested: media
[Permissions] ✅ Granted: media
```

### macOS System Permission Request:
```
[Permissions] Permission requested: media
[Permissions] ✅ Granted: media
[Permissions] 📷 macOS Camera permission status: not-determined
[Permissions] 🎤 macOS Microphone permission status: not-determined
[Permissions] 📷 Requesting macOS camera permission...
[Permissions] 🎤 Requesting macOS microphone permission...
```

---

## What Happens Under the Hood

### On macOS:
1. **Electron Permission Check** (`setPermissionRequestHandler`) → GRANTED
2. **macOS System Permission Dialog** → User clicks "OK"
3. **Entitlements** → Allow app to request system permissions
4. **Web App** → `navigator.mediaDevices.getUserMedia()` works ✅

### On Windows:
1. **Electron Permission Check** (`setPermissionRequestHandler`) → GRANTED
2. **Windows automatically grants** (no dialog)
3. **Web App** → `navigator.mediaDevices.getUserMedia()` works ✅

---

## Files Modified

1. ✅ `entitlements.mac.plist` - macOS camera/mic entitlements
2. ✅ `entitlements.mac.inherit.plist` - Child process entitlements
3. ✅ `package.json` - Build config updated to use entitlements
4. ✅ `src/main/main.js` - Permission handlers (ALREADY WORKING)
5. ✅ `src/renderer/js/tab-manager.js` - iframe allow attribute (ALREADY WORKING)

---

## Troubleshooting

### "Permission denied" errors:
- Ensure entitlements are applied (see "Check entitlements are applied" above)
- Check macOS System Preferences → Security & Privacy
- Try resetting permissions with `tccutil reset`

### Camera/microphone not detected:
- Check if devices are connected
- Test in browser first (https://webcamtests.com/)
- Check Windows/macOS system settings

### Multiple cameras/microphones not showing:
- Use `navigator.mediaDevices.enumerateDevices()` in console
- If empty, it's a system/driver issue, not Electron

---

## Next Steps After Testing

Once testing is complete and working:

1. **Commit changes:**
   ```bash
   git add entitlements.mac.plist entitlements.mac.inherit.plist package.json
   git commit -m "Add camera and microphone permissions for macOS and Windows"
   ```

2. **Build and distribute:**
   - Build for both platforms: `npm run build:all:mac && npm run build:all:win`
   - Test installers on both platforms
   - Distribute to users

3. **Update documentation:**
   - Add note to README about camera/microphone support
   - Inform users about macOS permission dialogs
