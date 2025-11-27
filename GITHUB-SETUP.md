# Kolbo Desktop - GitHub Setup Instructions

## ✅ Git Repository Initialized

Your local git repository has been created with the initial commit:

```
Commit: 2c86438
Message: Initial commit: Kolbo Desktop - Media Library for Video Editors
Files: 44 files committed
```

---

## 🚀 Push to GitHub

### Step 1: Create Repository on GitHub

1. Go to **https://github.com/new** (or your GitHub organization)
2. Fill in repository details:
   - **Repository name**: `kolbo-desktop`
   - **Description**: `Kolbo.AI Desktop App - Media Library for Video Editors with DaVinci Resolve & Premiere Pro Integration`
   - **Visibility**:
     - ✅ **Private** (recommended for internal development)
     - ⬜ Public (if you want open source)
   - **Initialize repository**: ❌ **DO NOT** check any boxes (no README, no .gitignore, no license)
3. Click **"Create repository"**

### Step 2: Connect Local Repository to GitHub

After creating the repository, GitHub will show you commands. Use these:

```bash
# Navigate to your project (if not already there)
cd "G:\Projects\Kolbo.AI\github\kolbo-desktop"

# Add GitHub as remote
git remote add origin https://github.com/YOUR_USERNAME/kolbo-desktop.git

# Or if using your organization:
git remote add origin https://github.com/Kolbo-AI/kolbo-desktop.git

# Push to GitHub
git push -u origin master
```

**Replace `YOUR_USERNAME` or `Kolbo-AI` with your actual GitHub username or organization name.**

### Step 3: Verify Push

After pushing, visit your GitHub repository:
```
https://github.com/YOUR_USERNAME/kolbo-desktop
```

You should see:
- ✅ 44 files
- ✅ Initial commit message
- ✅ All documentation (README.md, BUILD-GUIDE.md, etc.)
- ✅ Source code in `src/`
- ✅ Assets (icons, images)
- ❌ No `dist/` folder (correctly ignored - contains 78MB installers)
- ❌ No `node_modules/` (correctly ignored)

---

## 🔐 Authentication Options

### Option A: HTTPS with Personal Access Token (Recommended)

1. **Generate token:**
   - Go to: https://github.com/settings/tokens
   - Click "Generate new token" → "Generate new token (classic)"
   - Name: `Kolbo Desktop Development`
   - Expiration: 90 days (or longer)
   - Scopes: ✅ `repo` (full control of private repositories)
   - Click "Generate token"
   - **COPY THE TOKEN** (you won't see it again!)

2. **Use token when pushing:**
   ```bash
   # When prompted for password, use the token instead
   git push -u origin master
   ```

3. **Save credentials (optional):**
   ```bash
   # Store credentials so you don't have to enter them every time
   git config credential.helper store
   ```

### Option B: SSH Key (More Secure)

1. **Generate SSH key** (if you don't have one):
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   ```

2. **Add to GitHub:**
   - Copy public key: `cat ~/.ssh/id_ed25519.pub`
   - Go to: https://github.com/settings/keys
   - Click "New SSH key"
   - Paste key and save

3. **Use SSH URL:**
   ```bash
   git remote set-url origin git@github.com:YOUR_USERNAME/kolbo-desktop.git
   git push -u origin master
   ```

---

## 📂 What's in the Repository

### Source Code
```
src/
├── main/              - Electron main process
│   ├── main.js       - App entry point
│   ├── auth-manager.js
│   ├── file-manager.js
│   └── drag-handler.js
├── renderer/          - UI and frontend
│   ├── index.html    - Main interface
│   ├── css/          - Stylesheets
│   └── js/           - Frontend logic
└── config.js         - Environment configuration
```

### Build System
```
package.json           - npm scripts & electron-builder config
build-mac.sh          - macOS build script (single environment)
build-all-mac.sh      - macOS build script (all environments)
```

### Assets
```
assets/
├── icon.ico          - Windows icon (256x256+)
├── icon.icns         - macOS icon (universal)
├── icon-source.png   - Source PNG
└── images/           - Additional assets
```

### Documentation
```
README.md                     - Project overview
BUILD-GUIDE.md                - Build instructions
MAC-BUILD-INSTRUCTIONS.md     - Mac-specific guide
READY-TO-COMMIT.md            - Deployment checklist
ASSETS-AND-BUILD-STATUS.md    - Assets comparison
GITHUB-SETUP.md               - This file
```

### Ignored Files (NOT in repository)
```
dist/                 - Build outputs (78MB installers)
node_modules/         - Dependencies (~150MB)
*.log                 - Log files
package-lock.json     - Lock file (can regenerate)
```

---

## 🔄 Daily Workflow

### Making Changes

```bash
# 1. Make your code changes

# 2. Check what changed
git status

# 3. Stage changes
git add .

# 4. Commit with descriptive message
git commit -m "Add DaVinci Resolve drag-and-drop integration"

# 5. Push to GitHub
git push
```

### Pulling Changes (on another machine or team member)

```bash
# Get latest code
git pull

# Install any new dependencies
npm install

# Run the app
npm run dev
```

---

## 👥 Team Collaboration

### Cloning on Another Machine

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/kolbo-desktop.git
cd kolbo-desktop

# Install dependencies
npm install

# Run development version
npm run dev
```

### Working on Mac

```bash
# Clone and setup
git clone https://github.com/YOUR_USERNAME/kolbo-desktop.git
cd kolbo-desktop
npm install

# Build all Mac installers
./build-all-mac.sh

# Or build specific environment
./build-mac.sh production
```

---

## 🏷️ Releases & Tags

### Creating a Release

When you're ready to release a new version:

```bash
# 1. Update version in package.json
# Change "version": "1.0.0" to "1.0.1"

# 2. Commit version bump
git add package.json
git commit -m "Bump version to 1.0.1"

# 3. Create tag
git tag -a v1.0.1 -m "Release v1.0.1 - Add DaVinci integration"

# 4. Push code and tags
git push
git push --tags

# 5. Create GitHub Release
# - Go to: https://github.com/YOUR_USERNAME/kolbo-desktop/releases/new
# - Select tag: v1.0.1
# - Title: "Kolbo Desktop v1.0.1"
# - Description: Release notes
# - Upload installers:
#   - Kolbo Desktop-Setup-1.0.1.exe (Windows)
#   - Kolbo Desktop-1.0.1.dmg (Mac)
```

---

## 🔧 Git Configuration

### Set Your Identity (First Time)

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@kolbo.ai"
```

### Useful Aliases

```bash
# Add shortcuts
git config --global alias.st status
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.cm commit
git config --global alias.last "log -1 HEAD"

# Now you can use:
git st      # instead of git status
git last    # see last commit
```

---

## 📊 Repository Statistics

**Current Status:**
- ✅ Repository initialized
- ✅ Initial commit created (44 files)
- ✅ .gitignore configured (ignores dist/, node_modules/)
- ⏳ Waiting to push to GitHub remote

**Repository Size:**
- Source code: ~2-3 MB
- Assets: ~3-4 MB
- **Total**: ~5-7 MB (very manageable)
- **Excluded**: dist/ (78MB x 3 = 234MB of installers not in repo)

---

## 🚨 Important Notes

### Don't Commit Build Outputs
The `.gitignore` file prevents committing:
- `dist/` folder (contains installers)
- `node_modules/` (can be regenerated with `npm install`)
- `package-lock.json` (can regenerate, but you can include it if you prefer)

### Why Not Commit Installers?
- 78MB per installer × 3 environments = 234MB
- GitHub has 100MB file size limit (would fail)
- Git repos should stay small and fast
- Use GitHub Releases to distribute installers instead

### Security
- ✅ No secrets or API keys in code (good!)
- ✅ Environment URLs are configurable
- ✅ No `.env` files to worry about
- ⚠️ Keep repository private if it contains proprietary code

---

## ✅ Checklist

Before pushing to GitHub:

- [x] Git repository initialized
- [x] Initial commit created
- [x] .gitignore configured
- [ ] GitHub repository created
- [ ] Remote origin added
- [ ] Pushed to GitHub
- [ ] Verified files on GitHub
- [ ] Team members can clone

**Next step:** Create repository on GitHub and push!

---

## 🆘 Troubleshooting

### "Repository not found" error

Make sure the repository name and username are correct:
```bash
# Check current remote
git remote -v

# Fix if wrong
git remote set-url origin https://github.com/CORRECT_USERNAME/kolbo-desktop.git
```

### "Authentication failed"

If using HTTPS, you need a Personal Access Token (not your password):
- Generate at: https://github.com/settings/tokens
- Use token as password when prompted

### "Large files detected"

If you accidentally try to commit large files:
```bash
# Check file sizes
git ls-files | xargs ls -lh | sort -k5 -h -r | head -20

# If you committed dist/ by mistake
git rm -r --cached dist/
git commit -m "Remove dist/ from tracking"
```

### "Permission denied" on Mac build scripts

```bash
chmod +x build-mac.sh build-all-mac.sh
git add build-mac.sh build-all-mac.sh
git commit -m "Make build scripts executable"
```

---

## 📞 Support

- **GitHub Docs**: https://docs.github.com/
- **Git Docs**: https://git-scm.com/doc
- **Team**: Ask in Slack/Discord/Teams channel

---

**Ready to push!** Create your GitHub repository and run the commands above.
