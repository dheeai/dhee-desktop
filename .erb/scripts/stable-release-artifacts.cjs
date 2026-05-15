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

  const pkgPath = path.join(__dirname, '..', '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const product = pkg.build?.productName || 'Dhee';

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

  copyStable(armDmg, `${product}-mac-arm64.dmg`);
  copyStable(intelDmg, `${product}-mac-x64.dmg`);

  const setupExe = artifactPaths.find((p) => {
    const b = path.basename(p);
    return (
      b.endsWith('.exe') &&
      !b.endsWith('.exe.blockmap') &&
      /setup/i.test(b)
    );
  });
  copyStable(setupExe, `${product}-windows-x64-setup.exe`);

  const appImage = artifactPaths.find((p) => path.basename(p).endsWith('.AppImage'));
  copyStable(appImage, `${product}-linux-x86_64.AppImage`);

  return extra;
};
