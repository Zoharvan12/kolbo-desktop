# Kolbo Desktop - Icon Assets

## Current Icons

### Windows
- **icon.ico** - Windows application icon (16x16, 32x32)
  - Used in: Task bar, window title, installer
  - Source: Copied from kolbo-adobe-plugin project

### macOS
- **icon.icns** - macOS application icon (NEEDED)
  - Status: ❌ **NOT YET CREATED**
  - Required sizes: 16x16, 32x32, 128x128, 256x256, 512x512, 1024x1024
  - Source PNG available: `icon-source.png` (698x698px)

### Source Files
- **icon-source.png** - High-res source (698x698px)
  - Use this to regenerate icons if needed

## How to Create macOS .icns File

### Option 1: Use Online Tool (Quick)
1. Go to https://cloudconvert.com/png-to-icns
2. Upload `icon-source.png`
3. Convert to `.icns`
4. Download and save as `assets/icon.icns`

### Option 2: Use Mac Terminal (Professional)
```bash
# On macOS, create iconset folder
mkdir kolbo.iconset

# Resize source image to all required sizes
sips -z 16 16     icon-source.png --out kolbo.iconset/icon_16x16.png
sips -z 32 32     icon-source.png --out kolbo.iconset/icon_16x16@2x.png
sips -z 32 32     icon-source.png --out kolbo.iconset/icon_32x32.png
sips -z 64 64     icon-source.png --out kolbo.iconset/icon_32x32@2x.png
sips -z 128 128   icon-source.png --out kolbo.iconset/icon_128x128.png
sips -z 256 256   icon-source.png --out kolbo.iconset/icon_128x128@2x.png
sips -z 256 256   icon-source.png --out kolbo.iconset/icon_256x256.png
sips -z 512 512   icon-source.png --out kolbo.iconset/icon_256x256@2x.png
sips -z 512 512   icon-source.png --out kolbo.iconset/icon_512x512.png
sips -z 1024 1024 icon-source.png --out kolbo.iconset/icon_512x512@2x.png

# Convert iconset to icns
iconutil -c icns kolbo.iconset

# Move to assets folder
mv kolbo.icns assets/icon.icns

# Clean up
rm -rf kolbo.iconset
```

### Option 3: Use npm Package
```bash
npm install -g png2icons

# Generate .icns from PNG
png2icons assets/icon-source.png assets/icon.icns
```

## Asset Organization

```
assets/
├── icon.ico              # Windows icon (READY ✅)
├── icon.icns             # macOS icon (NEEDED ❌)
├── icon-source.png       # Source for regeneration
├── images/               # Additional assets
└── README-ICONS.md       # This file
```

## Notes

- Windows .ico includes: 16x16, 32x32 (32-bit color)
- macOS .icns should include all retina sizes
- Both icons use the Kolbo.AI gradient logo
- Source from: kolbo-adobe-plugin project

## TODO Before Building macOS App

- [ ] Create icon.icns file (see instructions above)
- [ ] Test on macOS to verify icon appears correctly
- [ ] Update if rebranding occurs
