# GitHub Releases Guide

This document explains how to create releases for Dhee Desktop using GitHub Actions.

## Overview

When you push a `v*` release tag, GitHub Actions automatically:
1. Checks out the code
2. Installs dependencies (including dhee-core)
3. Builds the Electron app
4. Creates a DMG installer for Apple Silicon Macs
5. Publishes to GitHub Releases in `dheeai/dhee-desktop`

## Quick Start

### Simple Release (Default Branches)

```bash
# 1. Make sure your code is committed and pushed
git checkout main
git pull origin main

# 2. Create and push a release tag
git tag v0.1.0
git push origin v0.1.0

# 3. Wait 5-10 minutes for the build to complete
# Check progress: https://github.com/dheeai/dhee-desktop/actions
```

## Tag Format

### Release Tag
```
v0.1.0
v0.1.1
v1.0.0
```

Electron Builder publishes the public GitHub release using the app version
from `package.json`, so `v0.1.0` creates the public release
`dheeai/dhee-desktop/releases/tag/v0.1.0`.

## Complete Release Process

### Step 1: Prepare Your Code

```bash
# Switch to the branch you want to release
git checkout main
git pull origin main

# Make sure all changes are committed
git status
```

### Step 2: Update Version (Optional)

Edit `package.json` and update the version:
```json
{
  "version": "0.1.0"
}
```

Commit the change:
```bash
git add package.json
git commit -m "Bump version to 0.1.0"
git push origin main
```

### Step 3: Create and Push Tag

```bash
git tag v0.1.0
git push origin v0.1.0
```

### Step 4: Monitor Build

1. Go to [Actions](https://github.com/dheeai/dhee-desktop/actions)
2. Find the "Release" workflow run
3. Wait for it to complete (~5-10 minutes)

### Step 5: Download Release

Once complete, the release will be available at:
- https://github.com/dheeai/dhee-desktop/releases

Download the DMG file:
- `Dhee-<version>-arm64.dmg` (Apple Silicon)

### Stable filenames (same URL every release)

After each release, the build also publishes **fixed-name copies** (via `afterAllArtifactBuild` in `package.json`) so you can link to GitHub “Latest” without changing filenames:

| Platform | Stable asset on Latest |
|----------|-------------------------|
| macOS Apple Silicon | `Dhee.Studio-mac-arm64.dmg` |
| Windows x64 | `Dhee.Studio-windows-x64-setup.exe` |
| Linux x86_64 | `Dhee.Studio-linux-x86_64.AppImage` |

Example URLs (after the next successful tagged release):

- `https://github.com/dheeai/dhee-desktop/releases/latest/download/Dhee.Studio-mac-arm64.dmg`
- `https://github.com/dheeai/dhee-desktop/releases/latest/download/Dhee.Studio-windows-x64-setup.exe`

Versioned originals (for support and reproducibility) remain on the same release as today.

The marketing site (`dhee-website`) reads these via environment variables. See the **Dhee Desktop downloads** section in `dhee-website/.env.example` at the monorepo root and copy those values into production hosting (Vercel, Cloud Run, and so on).

### Verify stable assets after a release

Use the `dhee-desktop` latest URLs once the workflow has finished:

```bash
curl -sI "https://github.com/dheeai/dhee-desktop/releases/latest/download/Dhee.Studio-mac-arm64.dmg" | head -n 5
curl -sI "https://github.com/dheeai/dhee-desktop/releases/latest/download/Dhee.Studio-windows-x64-setup.exe" | head -n 5
```

You should see `HTTP/2 302` (or `301`) with a `location:` header pointing at an object URL or the tagged release asset. If you get `404`, the stable files were not attached—check the Actions logs for the `afterAllArtifactBuild` step.

## What Gets Built

The workflow builds:

1. **dhee-core** (TypeScript backend)
   - Built with tsup
   - Bundled into the Electron app

2. **Electron App**
   - React renderer
   - Electron main process
   - Output: DMG file in `release/build/`

3. **Release Assets**
   - Automatically uploaded to GitHub Releases
   - Apple Silicon macOS DMG (versioned name)
   - Stable-named duplicates for website / `releases/latest/download/` links (see above)

## Troubleshooting

### Workflow Not Running?

- **Check tag format**: Must match the `v*` workflow trigger
- **Check Actions tab**: Look for any workflow errors
- **Verify tag was pushed**: `git ls-remote --tags origin`

### Build Failing?

Common issues:
- **Missing dependencies**: Check if `npm ci` fails
- **dhee-core build errors**: Check tsup logs
- **Electron build errors**: Check electron-builder logs

View detailed logs in the Actions tab.

### No DMG Files in Release?

- Check if `electron-builder` completed successfully
- Verify `GH_TOKEN` has permissions to create releases
- Check Actions logs for upload errors

## Tag Management

### List All Tags
```bash
git tag
```

### Delete a Tag (Local)
```bash
git tag -d v0.1.0
```

### Delete a Tag (Remote)
```bash
git push origin :refs/tags/v0.1.0
```

### Create Tag from Specific Commit
```bash
git tag v0.1.0 <commit-hash>
git push origin v0.1.0
```

## Release Checklist

Before creating a release:

- [ ] Code is tested and ready
- [ ] Version updated in `package.json` (if needed)
- [ ] Changes committed and pushed
- [ ] Correct branch checked out
- [ ] dhee-core is building successfully
- [ ] Tag name follows the `v*` release-tag scheme

## Workflow Configuration

The workflow file is located at:
`.github/workflows/release.yml`

Key settings:
- **Runner**: `macos-14` (Apple Silicon)
- **Node.js**: Version 20
- **Publish**: Automatic via electron-builder to `dheeai/dhee-desktop`

## Support

For issues or questions:
- Check [Actions logs](https://github.com/dheeai/dhee-desktop/actions)
- Review [GitHub Releases](https://github.com/dheeai/dhee-desktop/releases)
- Open an issue on GitHub

## Examples

### Release v0.1.0
```bash
git tag v0.1.0
git push origin v0.1.0
```

### Release v0.1.1 beta
```bash
git tag v0.1.1-beta
git push origin v0.1.1-beta
```

---

**Last Updated**: December 2024
