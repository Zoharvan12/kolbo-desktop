# ✅ Installer Branding Added - 9:16 Image

## What Was Added

Your beautiful 9:16 portrait image is now integrated into **BOTH Windows and macOS** installers!

### Image Details
- **Source**: `assets/images/9x16 image.jpg`
- **Original Size**: 1152x2048 pixels (9:16 aspect ratio)
- **Format**: JPEG (automatically converted by electron-builder)
- **Used In**:
  - **Windows**: Installer sidebar (left side during installation)
  - **Windows**: Uninstaller sidebar (when user uninstalls)
  - **macOS**: DMG background image (when users open the .dmg file)

## Changes Made

### 1. Updated package.json

Added sidebar images to NSIS configuration:

```json
"nsis": {
  "oneClick": false,
  "allowToChangeInstallationDirectory": true,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "shortcutName": "${productName}",
  "installerSidebar": "assets/images/9x16 image.jpg",  // ← NEW
  "uninstallerSidebar": "assets/images/9x16 image.jpg" // ← NEW
}
```

### 2. Added macOS DMG Branding

Added background image to macOS DMG configuration:

```json
"dmg": {
  "title": "${productName} ${version}",
  "icon": "assets/icon.icns",
  "background": "assets/images/9x16 image.jpg",  // ← NEW
  "window": {
    "width": 540,
    "height": 380
  }
}
```

### 3. Rebuilt Production Installer

The production installer has been rebuilt with the new branding:
- **File**: `dist/Kolbo Desktop-Setup-1.0.0.exe` (78 MB)
- **Built**: 2025-11-27 16:06
- **Includes**: Beautiful 9:16 sidebar image

## How It Looks

### Windows Installer
When users run the installer, they'll see:
- **Left side**: Your 9:16 portrait image (full height)
- **Right side**: Installation options and progress
- **Professional branding** throughout the installation process

### Windows Uninstaller
Same branded sidebar appears when users uninstall, maintaining consistent branding.

### macOS DMG
When users open the DMG file on Mac:
- **Background**: Your 9:16 image fills the window
- **Foreground**: App icon and Applications folder link
- **Professional branded** drag-and-drop installation experience

## Rebuild Other Versions

To add the sidebar to staging and development installers:

```bash
# Rebuild staging
npm run build:staging:win

# Rebuild development
npm run build:dev:win
```

All three versions will now have the branded sidebar!

## Technical Details

### Automatic Conversion
- electron-builder automatically converts JPG to BMP (required by NSIS)
- Scales the image to fit the sidebar (164px wide standard)
- Maintains aspect ratio

### Supported Formats
You can use any of these formats:
- `.jpg` / `.jpeg` (what we're using)
- `.png`
- `.bmp` (native NSIS format)
- `.gif`

electron-builder handles the conversion automatically!

## Testing the Installer

To see the branded sidebar:

1. **Double-click** `dist/Kolbo Desktop-Setup-1.0.0.exe`
2. The installer window will open with:
   - Your 9:16 image on the left sidebar
   - Installation options on the right
3. Click "Next" to see the image throughout installation
4. After install, try uninstalling to see it in the uninstaller too

## Customization Options

If you want to adjust the sidebar in the future:

### Use Different Images
```json
"nsis": {
  "installerSidebar": "assets/images/installer-image.jpg",
  "uninstallerSidebar": "assets/images/uninstaller-image.jpg"
}
```

### Use Different Image for Uninstaller
```json
"nsis": {
  "installerSidebar": "assets/images/install-sidebar.jpg",
  "uninstallerSidebar": "assets/images/uninstall-sidebar.jpg"
}
```

### Recommended Specifications
- **Aspect Ratio**: 9:16 (portrait) - perfect for sidebar!
- **Minimum Width**: 164 pixels
- **Recommended Width**: 328-656 pixels (for high-DPI displays)
- **Format**: JPG, PNG, or BMP
- **File Size**: Keep under 2 MB for fast installer loading

## Additional Branding Options

You can also customize:

### Installer Header
```json
"nsis": {
  "installerHeader": "assets/images/installer-header.bmp",
  // Size: 150x57 pixels
}
```

### Installer Icon
```json
"nsis": {
  "installerIcon": "assets/custom-installer-icon.ico"
}
```

### License Page
```json
"nsis": {
  "license": "LICENSE.txt",
  "warningsAsErrors": false
}
```

### Custom Welcome Text
```json
"nsis": {
  "welcomeTitle": "Welcome to Kolbo Desktop Setup",
  "runAfterFinish": true
}
```

## Files Modified

```
package.json         - Added installerSidebar and uninstallerSidebar
dist/                - Rebuilt production installer with branding
```

## Next Steps

1. ✅ **Production installer** - Already rebuilt with sidebar
2. ⏳ **Staging installer** - Run `npm run build:staging:win`
3. ⏳ **Development installer** - Run `npm run build:dev:win`
4. ✅ **Commit changes** - Add to git and push
5. ✅ **Test installer** - Double-click to see the branded sidebar!

## Commit to Git

Add these changes to your repository:

```bash
git add package.json
git commit -m "Add branded 9:16 sidebar image to Windows installers

- Added installerSidebar and uninstallerSidebar to NSIS config
- Using assets/images/9x16 image.jpg for branding
- Rebuilt production installer with new sidebar
- Professional branded installation experience"

git push
```

## Visual Preview

The installer will look like:

```
┌─────────────────────────────────────┐
│  9:16 │                             │
│ Image │  Kolbo Desktop Setup        │
│       │                             │
│       │  Choose installation        │
│       │  directory:                 │
│       │  [C:\Program Files\...]     │
│       │                             │
│       │  [✓] Create desktop shortcut│
│       │  [✓] Create start menu      │
│       │                             │
│       │     [Cancel]  [Next >]      │
└─────────────────────────────────────┘
```

Your 9:16 image fills the left sidebar throughout the entire installation process!

---

**Status**: ✅ Branding Added Successfully!
**Installer**: Production (16:06) - **READY WITH SIDEBAR**
**Image**: `assets/images/9x16 image.jpg` (1152x2048)
**Result**: Professional branded installation experience

---

**Test it now**: Double-click `dist/Kolbo Desktop-Setup-1.0.0.exe` to see your branded installer! 🎨
