/**
 * electron-builder `afterPack` hook — strip foreign-platform native binaries
 * that ship bundled inside a single npm package (so electron-builder's normal
 * per-platform native handling doesn't catch them).
 *
 * Background: `koffi` (pulled in transitively via @mariozechner/pi-tui →
 * pi-coding-agent) bundles a prebuilt binary for ~18 OS/arch combos under
 * `build/koffi/<platform>/koffi.node` and selects one at runtime via its own
 * loader. electron-builder treats those as ordinary files and copies *all* of
 * them into *every* platform build — so the mac arm64 .app ships win32/linux/
 * freebsd/openbsd binaries (~36MB of dead weight), and vice-versa on the
 * Windows/Linux runners.
 *
 * This hook runs on each runner (mac/win/linux) AFTER the app is assembled but
 * BEFORE code-signing, and deletes every koffi platform dir except the one(s)
 * matching the build target. Add more `PACKAGES` entries for other deps that
 * follow the same bundle-all-platforms pattern.
 */
const fs = require('fs');
const path = require('path');

// electron-builder `Arch` enum (out/core.Arch) → arch token used in dir names.
const ARCH_TOKEN = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

// koffi names its arches slightly differently from electron-builder.
const KOFFI_ARCH = { ia32: 'ia32', x64: 'x64', arm64: 'arm64', armv7l: 'armhf' };

/**
 * Which koffi `build/koffi/<dir>` names to KEEP for this target.
 * Returns null when the platform/arch is unknown (→ prune nothing, fail-safe).
 */
function koffiKeepSet(electronPlatformName, archToken) {
  const os = { darwin: 'darwin', win32: 'win32', linux: 'linux' }[
    electronPlatformName
  ];
  if (!os) return null;

  // Universal mac builds need both slices.
  if (os === 'darwin' && archToken === 'universal') {
    return new Set(['darwin_x64', 'darwin_arm64']);
  }

  const arch = KOFFI_ARCH[archToken];
  if (!arch) return null;

  const keep = new Set([`${os}_${arch}`]);
  // A Linux AppImage may run on either glibc or musl hosts; koffi picks the
  // right libc variant at runtime, so keep both for this arch.
  if (os === 'linux') keep.add(`musl_${arch}`);
  return keep;
}

const PACKAGES = [
  {
    name: 'koffi',
    // build/koffi/<platform>/ holds the per-platform binaries
    platformsSubdir: path.join('build', 'koffi'),
    keepSet: koffiKeepSet,
  },
];

function unpackedNodeModulesDir(context) {
  const { appOutDir, electronPlatformName } = context;
  const productFilename = context.packager?.appInfo?.productFilename;
  const resources =
    electronPlatformName === 'darwin'
      ? path.join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
      : path.join(appOutDir, 'resources');
  return path.join(resources, 'app.asar.unpacked', 'node_modules');
}

/** Recursively locate every `<...>/<pkgName>` dir under `root` (handles hoisted + nested installs). */
function findPackageDirs(root, pkgName) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (e.name === pkgName) {
        out.push(full);
        continue; // don't descend into the matched package
      }
      stack.push(full);
    }
  }
  return out;
}

function dirSize(p) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(p, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const fp = path.join(p, e.name);
    if (e.isDirectory()) total += dirSize(fp);
    else
      try {
        total += fs.statSync(fp).size;
      } catch {
        /* ignore */
      }
  }
  return total;
}

exports.default = async function pruneNative(context) {
  const { electronPlatformName, arch } = context;
  const archToken = ARCH_TOKEN[arch] ?? String(arch);

  const nmDir = unpackedNodeModulesDir(context);
  if (!fs.existsSync(nmDir)) {
    console.log(`[prune-native] no unpacked node_modules at ${nmDir}; skipping`);
    return;
  }

  let totalRemoved = 0;
  let totalBytes = 0;

  for (const pkg of PACKAGES) {
    const keep = pkg.keepSet(electronPlatformName, archToken);
    if (!keep) {
      console.log(
        `[prune-native] ${pkg.name}: unknown target ${electronPlatformName}/${archToken}; skipping (kept everything)`,
      );
      continue;
    }

    for (const pkgDir of findPackageDirs(nmDir, pkg.name)) {
      const platformsDir = path.join(pkgDir, pkg.platformsSubdir);
      let platformDirs;
      try {
        platformDirs = fs
          .readdirSync(platformsDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        continue; // layout not as expected; leave it untouched
      }

      // Fail-safe: never prune unless the binary we need is actually present.
      const haveKeep = [...keep].some((k) => platformDirs.includes(k));
      if (!haveKeep) {
        console.warn(
          `[prune-native] ${pkg.name}: target dir(s) [${[...keep].join(
            ', ',
          )}] not found in ${platformsDir}; leaving all ${platformDirs.length} platform dirs intact`,
        );
        continue;
      }

      for (const name of platformDirs) {
        if (keep.has(name)) continue;
        const target = path.join(platformsDir, name);
        totalBytes += dirSize(target);
        fs.rmSync(target, { recursive: true, force: true });
        totalRemoved += 1;
      }
    }

    console.log(
      `[prune-native] ${pkg.name}: kept [${[...keep].join(
        ', ',
      )}] for ${electronPlatformName}/${archToken}`,
    );
  }

  console.log(
    `[prune-native] removed ${totalRemoved} foreign platform dir(s), ~${(
      totalBytes /
      1e6
    ).toFixed(1)}MB`,
  );
};
