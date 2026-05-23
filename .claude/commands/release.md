# Release Kolbo Studio Desktop App

You are releasing a new version of the Kolbo Studio Desktop App (Electron). The user may provide a version bump type or exact version, plus any custom requirements.

## Arguments
$ARGUMENTS

## What to do

Parse the arguments to extract:
- **bump type or version**: `patch`, `minor`, `major`, or an exact version like `2.0.0` — if not provided, ask the user
- **any custom requirements** — handle them as needed (e.g. "also update release notes", "skip suite rebuild", "update the landing page", etc.)

## Standard Release Steps

Execute these steps in order. Adapt based on any custom requirements.

### 1. Bump version in package.json
Read `package.json`, calculate the new version based on the bump type, and update it.

Current version is in `package.json` → `version` field.

Bump rules:
- `patch`: 1.2.3 → 1.2.4
- `minor`: 1.2.3 → 1.3.0
- `major`: 1.2.3 → 2.0.0
- exact: use as-is

### 2. Commit and push
```bash
git add package.json
git commit -m "Release v{version}"
git push origin master
```

GitHub Actions automatically triggers on push to master — it builds both Windows (.exe) and Mac (.dmg) and publishes the GitHub release.

Monitor at: https://github.com/Zoharvan12/kolbo-desktop/actions

### 3. Wait for GitHub Actions to complete
Use: `gh run watch --repo Zoharvan12/kolbo-desktop`

The build takes ~5-8 minutes (Windows + Mac in parallel).

## Permanent download URLs (after release)
- Windows: https://github.com/Zoharvan12/kolbo-desktop/releases/latest/download/Kolbo.Studio-Setup-latest.exe
- Mac: https://github.com/Zoharvan12/kolbo-desktop/releases/latest/download/Kolbo.Studio-latest.dmg

Note: The combined suite zip is deprecated — we ship direct download links to each installer instead. Do NOT run `create-suite.js`.

## Notes
- No MongoDB update needed for the desktop app — only the plugin uses MongoDB for version checks
- No landing page update needed — all download links are permanent GitHub URLs
- If the user has custom requirements (e.g. "update the release notes text", "bump to a specific version", "also release the plugin"), handle them intelligently
- If any step fails, diagnose and fix before continuing
- After completion, verify the new release exists at https://github.com/Zoharvan12/kolbo-desktop/releases
