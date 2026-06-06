const { execFileSync } = require('child_process');
const { notarize } = require('@electron/notarize');
const { build } = require('../../package.json');

exports.default = async function notarizeMacos(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  if (process.env.CI !== 'true') {
    console.warn('Skipping notarizing step. Packaging is not running in CI');
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASS;
  const teamId = process.env.APPLE_TEAM_ID;

  // Guard on non-empty values: in CI an unset secret is injected as an
  // empty string, so `'APPLE_ID' in process.env` is true even when it's
  // blank. Skip (build stays signed-but-not-notarized, or unsigned) until
  // all three secrets are actually populated.
  if (!appleId || !appleIdPassword || !teamId) {
    console.warn(
      'Skipping notarizing step. Set non-empty APPLE_ID, APPLE_ID_PASS (app-specific password), and APPLE_TEAM_ID secrets to enable it.',
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  await notarize({
    tool: 'notarytool',
    appBundleId: build.appId,
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });

  // notarytool records the notarization with Apple but does not staple.
  // Staple the ticket into the .app so Gatekeeper validates offline (and
  // so the ticket travels inside the DMG that electron-builder then builds).
  execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' });
  console.log(`✓ Stapled notarization ticket to ${appName}.app`);
};
