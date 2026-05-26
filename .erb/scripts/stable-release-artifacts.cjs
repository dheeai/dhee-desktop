/**
 * electron-builder afterAllArtifactBuild: publish stable filenames alongside
 * versioned artifacts so https://github.com/.../releases/latest/download/... works.
 * Does not replace primary artifacts (electron-updater latest.yml / blockmaps unchanged).
 */
const fs = require('fs');
const path = require('path');

exports.default = async function stableReleaseArtifacts(context) {
  const { artifactPaths } = context;
  if (!artifactPaths?.length) {
    return [];
  }

  const stablePrefix = 'Dhee.Studio';

  const extra = [];
  const dmgs = artifactPaths.filter(
    (p) => p.endsWith('.dmg') && !p.endsWith('.dmg.blockmap'),
  );

  const armDmg = dmgs.find((p) => /arm64/i.test(path.basename(p)));
  const intelDmg = dmgs.find(
    (p) => !/arm64/i.test(path.basename(p)),
  );

  function copyStable(src, stableName) {
    if (!src || !fs.existsSync(src)) return;
    const dest = path.join(path.dirname(src), stableName);
    fs.copyFileSync(src, dest);
    extra.push(dest);
    console.log(`[stable-release-artifacts] ${path.basename(src)} -> ${stableName}`);
  }

  copyStable(armDmg, `${stablePrefix}-mac-arm64.dmg`);
  copyStable(intelDmg, `${stablePrefix}-mac-x64.dmg`);

  const setupExe = artifactPaths.find((p) => {
    const b = path.basename(p);
    return (
      b.endsWith('.exe') &&
      !b.endsWith('.exe.blockmap') &&
      /setup/i.test(b)
    );
  });
  copyStable(setupExe, `${stablePrefix}-windows-x64-setup.exe`);

  const appImage = artifactPaths.find((p) => path.basename(p).endsWith('.AppImage'));
  copyStable(appImage, `${stablePrefix}-linux-x86_64.AppImage`);

  return extra;
};
