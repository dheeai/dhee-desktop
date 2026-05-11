const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function syncAppPackageJson(mainPackageJson, existingAppPackageJson = {}) {
  const appPackageJson = {
    ...existingAppPackageJson,
    name:
      existingAppPackageJson.name || mainPackageJson.name || 'dhee-desktop',
    version:
      mainPackageJson.version || existingAppPackageJson.version || '1.0.0',
    description:
      existingAppPackageJson.description || mainPackageJson.description || '',
    main: existingAppPackageJson.main || './dist/main/main.js',
    dependencies: {
      ...(existingAppPackageJson.dependencies || {}),
    },
  };

  if (mainPackageJson.dependencies) {
    Object.keys(mainPackageJson.dependencies).forEach((dep) => {
      appPackageJson.dependencies[dep] = mainPackageJson.dependencies[dep];
    });
  }

  return appPackageJson;
}

function runConditionalInstallAppDeps() {
  // Skip in CI environments since the CI workflow handles it
  if (process.env.CI) {
    console.log('Skipping electron-builder install-app-deps in CI');
    return;
  }

  const rootPath = path.resolve(__dirname, '../..');
  const appPath = path.join(rootPath, 'release/app');
  const appPackagePath = path.join(appPath, 'package.json');
  const mainPackagePath = path.join(rootPath, 'package.json');

  if (!fs.existsSync(appPath)) {
    fs.mkdirSync(appPath, { recursive: true });
  }

  if (!fs.existsSync(mainPackagePath)) {
    throw new Error(`Main package.json not found at ${mainPackagePath}`);
  }

  const mainPackageJson = JSON.parse(fs.readFileSync(mainPackagePath, 'utf-8'));
  const existingAppPackageJson = fs.existsSync(appPackagePath)
    ? JSON.parse(fs.readFileSync(appPackagePath, 'utf-8'))
    : {};

  const syncedPackageJson = syncAppPackageJson(
    mainPackageJson,
    existingAppPackageJson,
  );

  fs.writeFileSync(
    appPackagePath,
    `${JSON.stringify(syncedPackageJson, null, 2)}\n`,
  );

  const appLockPath = path.join(appPath, 'package-lock.json');
  try {
    execSync('electron-builder install-app-deps', { stdio: 'inherit' });
  } catch (firstError) {
    // Stale integrity for `file:vendor/*.tgz` after a local repack without
    // `prepare:app-deps`; drop lock and retry once.
    if (fs.existsSync(appLockPath)) {
      fs.rmSync(appLockPath, { force: true });
      execSync('electron-builder install-app-deps', { stdio: 'inherit' });
    } else {
      throw firstError;
    }
  }
  console.log('✓ electron-builder install-app-deps completed successfully');
}

if (require.main === module) {
  try {
    runConditionalInstallAppDeps();
  } catch (error) {
    console.error(
      'electron-builder install-app-deps failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

module.exports = {
  syncAppPackageJson,
  runConditionalInstallAppDeps,
};
