/**
 * Local `dhee-core` is linked via `file:../dhee-core` and ships no prebuilt `dist/`.
 * Without a build, Electron fails to import the `dhee-core` barrel and Dhee IPC never registers.
 *
 * When `dist/index.js` is missing, run `dhee-core`'s build once (uses pnpm in that repo).
 * (Phase 6.4: the old spawn entry `dist/server/manager.js` is gone — dhee-core is
 * embedded in-process via its main barrel.)
 * Set DHEE_SKIP_CORE_BUILD=1 to skip (e.g. CI with a prebuilt tarball).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function dheeCoreRoot() {
  const root = path.resolve(__dirname, '../..');
  const nm = path.join(root, 'node_modules', 'dhee-core');
  if (!fs.existsSync(nm)) {
    return null;
  }
  try {
    return fs.realpathSync(nm);
  } catch {
    return null;
  }
}

function runBuild(cwd) {
  const prefersPnpm = () => {
    try {
      execSync('pnpm --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };

  if (prefersPnpm()) {
    execSync('pnpm run build', { cwd, stdio: 'inherit' });
    return;
  }

  // Match dhee-core/package.json "packageManager" so npm-only users can still build.
  execSync('npx --yes pnpm@10.24.0 run build', { cwd, stdio: 'inherit' });
}

function main() {
  if (process.env.DHEE_SKIP_CORE_BUILD === '1') {
    console.log('[ensure-dhee-core-dist] DHEE_SKIP_CORE_BUILD=1, skipping');
    return;
  }

  const coreRoot = dheeCoreRoot();
  if (!coreRoot) {
    console.log('[ensure-dhee-core-dist] dhee-core not in node_modules, skipping');
    return;
  }

  const marker = path.join(coreRoot, 'dist', 'index.js');
  if (fs.existsSync(marker)) {
    console.log('[ensure-dhee-core-dist] dist already present');
    return;
  }

  const pkgJson = path.join(coreRoot, 'package.json');
  if (!fs.existsSync(pkgJson)) {
    console.warn('[ensure-dhee-core-dist] no package.json next to dhee-core, skipping');
    return;
  }

  console.log(
    `[ensure-dhee-core-dist] Building dhee-core at ${coreRoot} (first install or clean checkout)…`,
  );
  runBuild(coreRoot);

  if (!fs.existsSync(marker)) {
    throw new Error(
      `[ensure-dhee-core-dist] Build finished but ${marker} is still missing.`,
    );
  }
  console.log('[ensure-dhee-core-dist] ✓ dhee-core dist ready');
}

try {
  main();
} catch (err) {
  console.error(
    '[ensure-dhee-core-dist]',
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
}
