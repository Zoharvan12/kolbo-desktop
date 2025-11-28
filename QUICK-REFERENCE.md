# Quick Reference - Build & Release Commands

**⚡ Fast lookup for everyday development tasks**

---

## 🚀 Release New Version (Production)

### One Command Release
```bash
# Bug fix (1.0.0 → 1.0.1)
npm run version:patch

# New feature (1.0.0 → 1.1.0)
npm run version:minor

# Breaking change (1.0.0 → 2.0.0)
npm run version:major
```

**This automatically:**
- Updates version in package.json
- Commits, tags, and pushes to GitHub
- Triggers GitHub Actions to build installers
- Creates GitHub Release
- Notifies users via auto-updater

**Monitor builds:** https://github.com/Zoharvan12/kolbo-desktop/actions

---

## 🔨 Build Commands

### Development (Local Testing)
```bash
# Run app locally
npm start
# or
npm run dev
```

### Build Development Installers
```bash
# Windows (connects to localhost:5050)
npm run build:dev:win

# macOS (connects to localhost:5050)
npm run build:dev:mac
```

**Output:** `dist/Kolbo Studio Dev-Setup-1.0.0.exe` or `.dmg`

### Build Staging Installers
```bash
# Windows (connects to staging.kolbo.ai)
npm run build:staging:win

# macOS (connects to staging.kolbo.ai)
npm run build:staging:mac
```

**Output:** `dist/Kolbo Studio Staging-Setup-1.0.0.exe` or `.dmg`

### Build Production Installers (Manual)
```bash
# Windows (connects to app.kolbo.ai)
npm run build:prod:win

# macOS (connects to app.kolbo.ai)
npm run build:prod:mac
```

**Output:** `dist/Kolbo Studio-Setup-1.0.0.exe` or `.dmg`

---

## 📋 Common Workflows

### Testing New Features Locally
```bash
npm start
```
App opens with development config (localhost:5050)

### Build for Team Testing
```bash
npm run build:staging:win
# Share dist/Kolbo Studio Staging-Setup-1.0.0.exe with team
```

### Release to Production Users
```bash
npm run version:patch
# Wait 10 mins for GitHub Actions to build
# Users auto-notified within 4 hours
```

### Emergency Manual Build
```bash
# If GitHub Actions fails
npm run build:prod:win
npm run build:prod:mac
# Upload manually to GitHub Releases
```

---

## 🔄 Version Management

### Current Version
```bash
# Check current version
grep '"version"' package.json
```

### Semantic Versioning Guide
- **PATCH** (1.0.X): Bug fixes, small improvements
- **MINOR** (1.X.0): New features, backwards-compatible
- **MAJOR** (X.0.0): Breaking changes, major updates

### Manual Version Update
```bash
# Edit package.json manually
"version": "1.0.1"

# Then commit and tag
git add package.json package-lock.json
git commit -m "Release v1.0.1"
git tag v1.0.1
git push && git push --tags
```

---

## 🛠️ Build Environment Variables

| Build Command | Environment | API URL | Web App URL |
|--------------|-------------|---------|-------------|
| `npm start` | Development | localhost:5050 | localhost:8080 |
| `build:dev:*` | Development | localhost:5050 | localhost:8080 |
| `build:staging:*` | Staging | stagingapi.kolbo.ai | staging.kolbo.ai |
| `build:prod:*` | Production | api.kolbo.ai | app.kolbo.ai |

---

## 📦 Build Output Locations

All builds go to `dist/` folder:

```
dist/
├── Kolbo Studio-Setup-1.0.0.exe          (Production Windows)
├── Kolbo Studio Staging-Setup-1.0.0.exe  (Staging Windows)
├── Kolbo Studio Dev-Setup-1.0.0.exe      (Dev Windows)
├── Kolbo Studio-1.0.0.dmg                (Production Mac)
├── Kolbo Studio Staging-1.0.0.dmg        (Staging Mac)
└── Kolbo Studio Dev-1.0.0.dmg            (Dev Mac)
```

---

## 🚨 Troubleshooting Quick Fixes

### "npm run version:patch" fails
```bash
# Commit any changes first
git add .
git commit -m "Your changes"
npm run version:patch
```

### Build fails with "electron-builder not found"
```bash
npm install
```

### Wrong API endpoint in build
```bash
# Always use npm scripts, not electron-builder directly
✅ npm run build:prod:win
❌ electron-builder --win
```

### Clean build (fresh start)
```bash
rm -rf dist node_modules package-lock.json
npm install
npm run build:prod:win
```

---

## 📊 Release Checklist

Before releasing:
- [ ] All changes committed
- [ ] Tested locally with `npm start`
- [ ] Choose correct version type (patch/minor/major)

After running release command:
- [ ] Check GitHub Actions: https://github.com/Zoharvan12/kolbo-desktop/actions
- [ ] Verify release created: https://github.com/Zoharvan12/kolbo-desktop/releases
- [ ] Test installer download and installation
- [ ] Verify auto-updater works from previous version

---

## 🔗 Quick Links

- **Releases**: https://github.com/Zoharvan12/kolbo-desktop/releases
- **Actions**: https://github.com/Zoharvan12/kolbo-desktop/actions
- **Full Build Guide**: [BUILD-GUIDE.md](BUILD-GUIDE.md)
- **Release Guide**: [RELEASE.md](RELEASE.md)

---

## ⏱️ Typical Build Times

- **Local dev build**: 2-3 minutes
- **Local production build**: 3-5 minutes
- **GitHub Actions (both platforms)**: 8-12 minutes

---

**Last Updated**: 2025-11-28
**Current Version**: 1.0.0
