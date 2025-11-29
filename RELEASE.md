# Release Process for Kolbo Desktop

## Quick Release Checklist

### Mac Release
```bash
# 1. Bump version in package.json
# 2. Build
npm run build:prod:mac

# 3. Fix latest-mac.yml (IMPORTANT - see below)
# 4. Commit and push
git add . && git commit -m "v1.0.X - Description" && git push

# 5. Create tag
git tag -a v1.0.X -m "v1.0.X - Description" && git push origin v1.0.X

# 6. Create release with ALL required files
gh release create v1.0.X \
  "dist/Kolbo Studio-1.0.X-arm64.dmg" \
  "dist/Kolbo Studio-1.0.X-x64.dmg" \
  "dist/Kolbo.Studio-1.0.X.dmg" \
  "dist/latest-mac.yml" \
  --title "v1.0.X - Title" \
  --notes "Release notes here"
```

### Windows Release
```bash
npm run build:prod:win

# Same process - fix latest.yml, then upload
gh release upload v1.0.X \
  "dist/Kolbo Studio-Setup-1.0.X.exe" \
  "dist/latest.yml"
```

---

## CRITICAL: GitHub Filename Conversion

**GitHub converts spaces to dots in filenames!**

| You upload | GitHub stores |
|------------|---------------|
| `Kolbo Studio-1.0.2-arm64.dmg` | `Kolbo.Studio-1.0.2-arm64.dmg` |
| `Kolbo Studio-Setup-1.0.2.exe` | `Kolbo.Studio-Setup-1.0.2.exe` |

### You MUST fix `latest-mac.yml` before uploading:

**Wrong (auto-generated):**
```yaml
files:
  - url: Kolbo-Studio-1.0.2-x64.dmg  # WRONG - has dashes
```

**Correct (manually fixed):**
```yaml
files:
  - url: Kolbo.Studio-1.0.2-x64.dmg  # CORRECT - has dots
```

### Fix command:
```bash
# After building, edit dist/latest-mac.yml
# Replace all "Kolbo-Studio" with "Kolbo.Studio"
# Or use sed:
sed -i '' 's/Kolbo-Studio/Kolbo.Studio/g' dist/latest-mac.yml
```

---

## Required Files for Auto-Update

### Mac Release Must Include:
1. `Kolbo.Studio-X.X.X-arm64.dmg` - Apple Silicon installer
2. `Kolbo.Studio-X.X.X-x64.dmg` - Intel Mac installer
3. `Kolbo.Studio-X.X.X.dmg` - Backward compatible (copy of arm64)
4. `latest-mac.yml` - **With corrected filenames (dots not dashes)**

### Windows Release Must Include:
1. `Kolbo.Studio-Setup-X.X.X.exe` - Windows installer
2. `latest.yml` - **With corrected filename**

---

## Auto-Update Flow

1. App checks `latest-mac.yml` (or `latest.yml`) from latest GitHub release
2. Compares version in yml with installed version
3. If newer, shows update notification to user
4. User clicks download → app downloads DMG/EXE from GitHub release
5. User manually runs installer to update

### Download URL Format:
```
https://github.com/Zoharvan12/kolbo-desktop/releases/download/v{VERSION}/{FILENAME}
```

**Mac downloads based on architecture:**
- Apple Silicon: `Kolbo.Studio-{version}-arm64.dmg`
- Intel Mac: `Kolbo.Studio-{version}-x64.dmg`

---

## Detailed Steps

### 1. Update Version
Edit `package.json`:
```json
"version": "1.0.3",
```

### 2. Build Production
```bash
# Mac (builds both arm64 and x64)
npm run build:prod:mac

# Windows
npm run build:prod:win

# Both
npm run build:prod:mac && npm run build:prod:win
```

### 3. Fix the YML Files
```bash
# Mac - fix the filename format
sed -i '' 's/Kolbo-Studio/Kolbo.Studio/g' dist/latest-mac.yml

# Windows - fix the filename format
sed -i '' 's/Kolbo-Studio/Kolbo.Studio/g' dist/latest.yml
```

### 4. Create Backward Compatible DMG (Mac only)
```bash
# For users on older versions that expect non-arch filename
cp "dist/Kolbo Studio-1.0.X-arm64.dmg" "dist/Kolbo.Studio-1.0.X.dmg"
```

### 5. Commit and Push
```bash
git add .
git commit -m "v1.0.X - Description"
git push origin master
```

### 6. Create Git Tag
```bash
git tag -a v1.0.X -m "v1.0.X - Description"
git push origin v1.0.X
```

### 7. Create GitHub Release
```bash
# Mac release
gh release create v1.0.X \
  "dist/Kolbo Studio-1.0.X-arm64.dmg" \
  "dist/Kolbo Studio-1.0.X-x64.dmg" \
  "dist/Kolbo.Studio-1.0.X.dmg" \
  "dist/latest-mac.yml" \
  --title "v1.0.X - Title" \
  --notes "## Changes
- Change 1
- Change 2

## Downloads
- **Mac (Apple Silicon)**: Kolbo.Studio-1.0.X-arm64.dmg
- **Mac (Intel)**: Kolbo.Studio-1.0.X-x64.dmg"
```

### 8. Add Windows Files (if applicable)
```bash
gh release upload v1.0.X \
  "dist/Kolbo Studio-Setup-1.0.X.exe" \
  "dist/latest.yml"
```

---

## Troubleshooting

### "Cannot find latest-mac.yml" error
The `latest-mac.yml` file is missing from the release. Upload it:
```bash
gh release upload v1.0.X "dist/latest-mac.yml" --clobber
```

### "404 downloading installer" error
Filename mismatch between `latest-mac.yml` and actual files on GitHub.

**Fix:** Edit `latest-mac.yml` to use dots instead of dashes:
- Wrong: `Kolbo-Studio-1.0.2-arm64.dmg`
- Correct: `Kolbo.Studio-1.0.2-arm64.dmg`

### Update yml in existing release:
```bash
# Edit the file first, then:
gh release upload v1.0.X "dist/latest-mac.yml" --clobber
```

### SHA512 mismatch error
The file was modified after yml was generated. Regenerate:
```bash
# Rebuild to regenerate yml with correct hashes
npm run build:prod:mac
# Then fix filenames and upload
```

---

## gh CLI Setup

### Install
```bash
brew install gh
```

### Authenticate
```bash
gh auth login
# Follow prompts - choose GitHub.com, HTTPS, and authenticate via browser
```

### Verify
```bash
gh auth status
```

---

## Links

- **Latest Release:** https://github.com/Zoharvan12/kolbo-desktop/releases/latest
- **All Releases:** https://github.com/Zoharvan12/kolbo-desktop/releases
- **Repository:** https://github.com/Zoharvan12/kolbo-desktop
