# GitHub Releases Guide

This document explains how to create releases for Dhee Desktop using GitHub Actions.

## Overview

When you push a version tag, GitHub Actions automatically:
1. Checks out the code
2. Installs dependencies (including dhee-core)
3. Builds the Electron app
4. Creates DMG installers for Mac (arm64 + x64)
5. Publishes to GitHub Releases

## Quick Start

### Simple Release (Default Branches)

```bash
# 1. Make sure your code is committed and pushed
git checkout main
git pull origin main

# 2. Create and push a version tag
git tag v1.0.0
git push origin v1.0.0

# 3. Wait 5-10 minutes for the build to complete
# Check progress: https://github.com/dheeai/dhee-desktop/actions
```

## Tag Format

### Standard Version Tag
```
v1.0.0
v1.0.1
v2.0.0
```

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
  "version": "1.0.0"
}
```

Commit the change:
```bash
git add package.json
git commit -m "Bump version to 1.0.0"
git push origin main
```

### Step 3: Create and Push Tag

```bash
git tag v1.0.0
git push origin v1.0.0
```

### Step 4: Monitor Build

1. Go to [Actions](https://github.com/dheeai/dhee-desktop/actions)
2. Find the "Release" workflow run
3. Wait for it to complete (~5-10 minutes)

### Step 5: Download Release

Once complete, the release will be available at:
- https://github.com/dheeai/dhee-desktop/releases

Download the DMG files:
- `Dhee-<version>-arm64.dmg` (Apple Silicon)
- `Dhee-<version>.dmg` (Intel Mac)

## What Gets Built

The workflow builds:

1. **dhee-core** (TypeScript backend)
   - Built with tsup
   - Bundled into the Electron app

2. **Electron App**
   - React renderer
   - Electron main process
   - Output: DMG files in `release/build/`

3. **Release Assets**
   - Automatically uploaded to GitHub Releases
   - DMG files for both Mac architectures

## Troubleshooting

### Workflow Not Running?

- **Check tag format**: Must match `v*.*.*` pattern
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
git tag -d v1.0.0
```

### Delete a Tag (Remote)
```bash
git push origin :refs/tags/v1.0.0
```

### Create Tag from Specific Commit
```bash
git tag v1.0.0 <commit-hash>
git push origin v1.0.0
```

## Release Checklist

Before creating a release:

- [ ] Code is tested and ready
- [ ] Version updated in `package.json` (if needed)
- [ ] Changes committed and pushed
- [ ] Correct branch checked out
- [ ] dhee-core is building successfully
- [ ] Tag name follows versioning scheme

## Workflow Configuration

The workflow file is located at:
`.github/workflows/release.yml`

Key settings:
- **Runner**: `macos-14` (Apple Silicon)
- **Node.js**: Version 20
- **Publish**: Automatic via electron-builder

## Support

For issues or questions:
- Check [Actions logs](https://github.com/dheeai/dhee-desktop/actions)
- Review [GitHub Releases](https://github.com/dheeai/dhee-desktop/releases)
- Open an issue on GitHub

## Examples

### Release v1.0.0
```bash
git tag v1.0.0
git push origin v1.0.0
```

### Release v1.1.0 beta
```bash
git tag v1.1.0-beta
git push origin v1.1.0-beta
```

---

**Last Updated**: December 2024
