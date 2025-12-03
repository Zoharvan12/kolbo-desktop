# Kolbo Studio Release Process

## ⚠️ CRITICAL: Filename Conventions

### The GitHub Spaces-to-Dots Problem

**GitHub automatically converts SPACES to DOTS in uploaded filenames:**

```
electron-builder creates: "Kolbo Studio-Setup-1.0.2.exe"
GitHub uploads it as:     "Kolbo.Studio-Setup-1.0.2.exe"
```

This is GitHub's behavior and CANNOT be changed.

### Why This Matters

The app code (`src/main/main.js`) hardcodes download filenames. When users check for updates, the app constructs a download URL like:

```
https://github.com/Zoharvan12/kolbo-desktop/releases/download/v1.0.2/Kolbo.Studio-Setup-1.0.2.exe
```

If the actual filename doesn't match EXACTLY, the download fails (404 error).

### The Rules

1. **NEVER rename files in the workflow** - Let GitHub handle the space-to-dot conversion
2. **Use DOTS in main.js** - Match GitHub's convention (e.g., `Kolbo.Studio-Setup-${version}.exe`)
3. **Keep productName as "Kolbo Studio"** (with space) in package.json - electron-builder needs this
4. **Test downloads before releasing** - Verify actual filename matches what code expects

## Release Steps

### 1. Update Version

Edit `package.json`:
```json
{
  "version": "1.0.3"  // Increment version
}
```

### 2. Commit Changes

```bash
git add package.json
git commit -m "Bump version to 1.0.3"
git push origin master
```

### 3. Create Release Tag

```bash
git tag -a v1.0.3 -m "Release v1.0.3"
git push origin v1.0.3
```

### 4. Workflow Triggers

The GitHub Actions workflow (`release.yml`) automatically:
- Builds Windows installer (exe)
- Builds Mac installer (dmg + zip)
- Creates `latest.yml` and `latest-mac.yml`
- **Validates filenames** (ensures "Kolbo Studio" with space exists)
- Uploads everything to GitHub release

### 5. Verify Release

After workflow completes:

1. **Check GitHub Release**: https://github.com/Zoharvan12/kolbo-desktop/releases/tag/v1.0.3
2. **Verify Files**:
   - `Kolbo.Studio-Setup-1.0.3.exe` (Windows) ✅
   - `Kolbo.Studio-1.0.3.dmg` (Mac) ✅
   - `Kolbo.Studio-1.0.3.zip` (Mac auto-update) ✅
   - `latest.yml` ✅
   - `latest-mac.yml` ✅

3. **Test latest.yml**:
   ```bash
   curl https://github.com/Zoharvan12/kolbo-desktop/releases/download/v1.0.3/latest.yml
   ```

   Should show:
   ```yaml
   version: 1.0.3
   files:
     - url: Kolbo Studio-Setup-1.0.3.exe  # ⚠️ Has SPACE in yml
   ```

4. **Test actual download**:
   ```bash
   curl -I https://github.com/Zoharvan12/kolbo-desktop/releases/download/v1.0.3/Kolbo.Studio-Setup-1.0.3.exe
   ```

   Should return `200 OK` (not 404)

## Common Pitfalls

### ❌ DO NOT: Rename Files in Workflow

```yaml
# ❌ WRONG - DO NOT DO THIS
- name: Rename files
  run: |
    mv "Kolbo Studio-Setup-1.0.3.exe" "Kolbo-Studio-Setup-1.0.3.exe"
```

**Why:** This breaks downloads for ALL existing users who expect dots.

### ❌ DO NOT: Change productName Format

```json
// ❌ WRONG - DO NOT DO THIS
{
  "build": {
    "productName": "KolboStudio"  // No spaces
  }
}
```

**Why:** Changes the filename format and breaks existing downloads.

### ❌ DO NOT: Use Dashes in main.js

```javascript
// ❌ WRONG - DO NOT DO THIS
fileName = `Kolbo-Studio-Setup-${version}.exe`;
```

**Why:** GitHub creates `Kolbo.Studio-Setup-*.exe` (with dots), not dashes.

## Troubleshooting

### Users Can't Download Updates (290KB file)

**Symptom:** Users download a 290KB file instead of the full installer.

**Cause:** Filename mismatch - app is looking for a file that doesn't exist (404 error page is 290KB).

**Fix:**
1. Check what filename the app expects (see `src/main/main.js`)
2. Check actual filename on GitHub release
3. If mismatch: Either rename the release file OR update the code and release new version

### Workflow Validation Fails

**Error:** `❌ ERROR: Windows installer not found with expected 'Kolbo Studio-Setup' name`

**Cause:** electron-builder output changed (different productName or artifactName).

**Fix:**
1. Check `package.json` build configuration
2. Ensure `productName: "Kolbo Studio"` (with space)
3. Check electron-builder logs for actual filename

## Version Management

### Semantic Versioning

Use semantic versioning: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes (e.g., 2.0.0)
- **MINOR**: New features, backwards compatible (e.g., 1.1.0)
- **PATCH**: Bug fixes (e.g., 1.0.3)

### Version Must Be Higher

GitHub considers the **highest version** as "latest". Ensure your new version is higher than all previous versions:

```
v1.0.0 ← Old
v1.0.1 ← Old
v1.0.2 ← Current
v1.0.3 ← New (must be higher!)
```

### Cleaning Up Old Tags

If you have higher version numbers from testing, delete them:

```bash
# Delete local tag
git tag -d v1.0.5

# Delete remote tag
git push origin :refs/tags/v1.0.5

# Delete release via API
curl -X DELETE -H "Authorization: token YOUR_TOKEN" \
  https://api.github.com/repos/Zoharvan12/kolbo-desktop/releases/RELEASE_ID
```

## Auto-Update Flow

1. **User opens app** → App checks for updates
2. **App fetches** `https://github.com/Zoharvan12/kolbo-desktop/releases/latest`
3. **GitHub returns** v1.0.3 info
4. **App reads** `latest.yml` from v1.0.3
5. **latest.yml contains** `url: Kolbo Studio-Setup-1.0.3.exe`
6. **App constructs URL** `https://github.com/.../Kolbo.Studio-Setup-1.0.3.exe` (replaces space with dot)
7. **App downloads** installer to Downloads folder
8. **User runs** installer to update

## Emergency Rollback

If a release is broken:

1. **Delete the bad release**:
   ```bash
   git tag -d v1.0.3
   git push origin :refs/tags/v1.0.3
   ```

2. **Delete via GitHub UI** or API

3. **Fix the issue** and re-release with same version

## Testing Before Release

Always test in a staging environment first:

1. Build locally: `npm run build:prod:win`
2. Check filename: Should be `Kolbo Studio-Setup-*.exe`
3. Upload manually to test release
4. Test download from production app
5. If successful, proceed with real release

## Questions?

If you encounter filename-related issues, refer to:
- This document
- Comments in `.github/workflows/release.yml`
- Comments in `src/main/main.js`

**Remember:** The filename convention exists because of GitHub's behavior. Don't fight it - work with it!
