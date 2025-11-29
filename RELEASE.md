# Release Process for Kolbo Desktop

## Automated Release (Recommended)

### Setup (One-time)

1. **Create GitHub Personal Access Token**:
   - Go to: https://github.com/settings/tokens/new?scopes=repo
   - Select scope: `repo` (Full control of private repositories)
   - Generate token and copy it

2. **Set Environment Variable**:
   ```bash
   # Windows (permanent)
   setx GH_TOKEN "your_token_here"

   # Or set for current session only
   set GH_TOKEN=your_token_here
   ```

### Release Steps

1. **Make your changes** and commit them

2. **Bump version and push**:
   ```bash
   npm run version:patch   # 1.0.5 -> 1.0.6 (bug fixes)
   npm run version:minor   # 1.0.5 -> 1.1.0 (new features)
   npm run version:major   # 1.0.5 -> 2.0.0 (breaking changes)
   ```

3. **Build and publish automatically**:
   ```bash
   # With GH_TOKEN set, this will:
   # - Build production version
   # - Create GitHub release
   # - Upload all files (installer, blockmap, latest.yml)
   npm run release:win
   ```

That's it! The auto-updater will now detect the new version.

---

## For This Release (v1.0.5)

**Immediate Fix Needed:**

1. Go to: https://github.com/Zoharvan12/kolbo-desktop/releases/tag/v1.0.5
2. Click "Edit"
3. Delete the current `latest.yml`
4. Upload the updated `latest.yml` from `dist/` folder
5. Click "Update release"

The updated `latest.yml` has the correct filename: `Kolbo.Studio-Setup-1.0.5.exe` (with dot, not space)

---

## Troubleshooting

### "Cannot find latest.yml" error
Upload `latest.yml` to the release.

### "404 downloading installer" error
Filename mismatch. Check that `latest.yml` matches the exact filename on GitHub.

---

Latest release: https://github.com/Zoharvan12/kolbo-desktop/releases/latest
