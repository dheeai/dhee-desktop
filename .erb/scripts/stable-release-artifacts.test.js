const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, expect, it } = require('@jest/globals');
const stableReleaseArtifacts = require('./stable-release-artifacts.cjs').default;
const removedMacStableAlias = ['Dhee.Studio', 'mac', 'x64'].join('-') + '.dmg';

function writeArtifact(dir, fileName) {
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, 'artifact');
  return filePath;
}

describe('stable-release-artifacts', () => {
  it('publishes stable assets without creating macOS DMG aliases', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stable-release-artifacts-'));

    try {
      const armDmg = writeArtifact(tempRoot, 'Dhee-1.2.0-arm64.dmg');
      const x64Dmg = writeArtifact(tempRoot, 'Dhee-1.2.0-x64.dmg');
      const setupExe = writeArtifact(tempRoot, 'Dhee Setup 1.2.0.exe');
      const appImage = writeArtifact(tempRoot, 'Dhee-1.2.0.AppImage');

      const extra = await stableReleaseArtifacts({
        artifactPaths: [armDmg, x64Dmg, setupExe, appImage],
      });

      expect(extra.map((filePath) => path.basename(filePath)).sort()).toEqual([
        'Dhee.Studio-linux-x86_64.AppImage',
        'Dhee.Studio-windows-x64-setup.exe',
      ]);
      expect(fs.existsSync(path.join(tempRoot, 'Dhee.Studio-mac-arm64.dmg'))).toBe(false);
      expect(fs.existsSync(path.join(tempRoot, removedMacStableAlias))).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not publish a stable Mac DMG from x64-only artifacts', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stable-release-artifacts-'));

    try {
      const x64Dmg = writeArtifact(tempRoot, 'Dhee-1.2.0-x64.dmg');

      const extra = await stableReleaseArtifacts({
        artifactPaths: [x64Dmg],
      });

      expect(extra).toEqual([]);
      expect(fs.existsSync(path.join(tempRoot, removedMacStableAlias))).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
