# Quick Release Guide

## ✅ v1.0.5 Fixed!

The latest.yml has been updated and auto-updater should work now.

## 🚀 Future Releases (One Command!)

### Setup (Do Once):

```bash
setx GH_TOKEN "your_github_token_here"
```

Get your token from: https://github.com/settings/tokens

Close and reopen terminal for it to take effect.

### Release New Version:

```bash
# 1. Make your changes and commit

# 2. Bump version
npm run version:patch

# 3. Build and publish everything automatically!
npm run release:win
```

That's it! The command will:
- ✅ Build production version
- ✅ Create GitHub release
- ✅ Upload installer, blockmap, and latest.yml
- ✅ Auto-updater works immediately

---

## What Just Happened (v1.0.5 fix):

Using the GitHub API, I:
1. ✅ Deleted the old incorrect latest.yml
2. ✅ Uploaded the fixed latest.yml with correct filename
3. ✅ Auto-updater should now work!

The issue was: GitHub renamed the file from "Kolbo Studio" to "Kolbo.Studio" (space → dot)

---

**Note**: Keep your GitHub token secure and never commit it to the repository!
