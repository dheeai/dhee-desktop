// Cross-OS post-build guardrail. Runs on each platform's release job and
// asserts the things this build pipeline has silently broken before:
//
//   1. asar is ON (app.asar exists) — without it the install is huge/slow.
//   2. Native modules are UNPACKED to app.asar.unpacked/ — a `.node`/`.dll`
//      cannot be dlopen'd from inside an asar archive, so koffi (FFI used by
//      the pi-agent's clipboard) and the clipboard addon MUST be on disk.
//      electron-builder's auto-unpack detector handles this per-platform;
//      this check fails the build loudly if that ever regresses.
//   3. The `**/node_modules/**/*` asarUnpack catch-all stays REMOVED — it
//      forced ~27k loose files (1–2 min Windows installs). We assert the
//      loose-file count is well below that.
//   4. The first-party bundles ship in Resources/bundles and are
//      picker-eligible (declare displayName + summary) — the New Project
//      screen is empty without them.
//
// Pure Node, no shell-isms, so it runs identically on the macOS, Windows,
// and Linux runners. Locates the packaged app by finding app.asar under
// release/build (mac: <X>.app/Contents/Resources; linux/win:
// <platform>-unpacked/resources).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BUILD_DIR = path.join(ROOT, 'release', 'build');

// Catch-all (`**/node_modules/**/*`) unpacked ~27k files; the curated set
// is a few thousand. A loose count above this means the catch-all is back.
const MAX_LOOSE_FILES = 15000;

function fail(msg) {
  console.error(`✗ verify-packaged-app: ${msg}`);
  process.exit(1);
}

function walk(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else if (entry.isFile() || entry.isSymbolicLink()) onFile(full);
  }
}

function findAppAsars(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      // Don't descend into the unpacked tree while hunting for the asar.
      if (entry.isDirectory() && !full.endsWith('.unpacked')) stack.push(full);
      else if (entry.isFile() && entry.name === 'app.asar') found.push(full);
    }
  }
  return found;
}

function isNativeBinary(file) {
  return /\.(node|dll|so|dylib)$/i.test(file);
}

function verifyApp(asarPath) {
  const resourcesDir = path.dirname(asarPath);
  const unpackedDir = `${asarPath}.unpacked`;
  const label = path.relative(BUILD_DIR, resourcesDir);
  console.log(`\n→ Verifying ${label}`);

  // (2) Native modules unpacked to disk.
  if (!fs.existsSync(unpackedDir)) {
    fail(`${label}: app.asar.unpacked/ is missing — no native modules unpacked`);
  }
  const looseFiles = [];
  const natives = [];
  walk(unpackedDir, (f) => {
    looseFiles.push(f);
    if (isNativeBinary(f)) natives.push(path.relative(unpackedDir, f));
  });

  if (natives.length === 0) {
    fail(`${label}: no native (.node/.dll/.so/.dylib) files in app.asar.unpacked`);
  }
  const hasKoffi = natives.some((f) => /koffi.*\.node$/i.test(f));
  const hasClipboard = natives.some((f) => /clipboard.*\.node$/i.test(f));
  if (!hasKoffi) {
    fail(`${label}: koffi native (.node) not unpacked — FFI will fail at runtime. Found: ${natives.join(', ')}`);
  }
  if (!hasClipboard) {
    fail(`${label}: clipboard native (.node) not unpacked. Found: ${natives.join(', ')}`);
  }
  console.log(`  ✓ native modules unpacked (${natives.length}): ${natives.join(', ')}`);

  // (3) Catch-all stays removed: loose-file count must be sane.
  console.log(`  ✓ loose files in app.asar.unpacked: ${looseFiles.length}`);
  if (looseFiles.length > MAX_LOOSE_FILES) {
    fail(`${label}: ${looseFiles.length} loose files (> ${MAX_LOOSE_FILES}). The asarUnpack catch-all "**/node_modules/**/*" is likely back — slow installs.`);
  }

  // (4) First-party bundles ship and are picker-eligible.
  const bundlesDir = path.join(resourcesDir, 'bundles');
  if (!fs.existsSync(bundlesDir)) {
    fail(`${label}: Resources/bundles/ is missing — New Project screen will be empty (extraResources / stage-bundles broke)`);
  }
  const required = ['narrative_prompt_relay', 'narrative_shot_by_shot'];
  for (const id of required) {
    const manifest = path.join(bundlesDir, id, 'bundle.json');
    if (!fs.existsSync(manifest)) {
      fail(`${label}: bundle "${id}" missing (${manifest})`);
    }
    const b = JSON.parse(fs.readFileSync(manifest, 'utf-8'));
    if (!b.displayName || !b.summary) {
      fail(`${label}: bundle "${id}" not picker-eligible (needs displayName + summary)`);
    }
  }
  console.log(`  ✓ bundles shipped + picker-eligible: ${required.join(', ')}`);

  // Informational: asar size.
  const asarMb = (fs.statSync(asarPath).size / (1024 * 1024)).toFixed(1);
  console.log(`  ✓ app.asar present (${asarMb} MB)`);
}

const asars = findAppAsars(BUILD_DIR);
if (asars.length === 0) {
  fail(`no app.asar found under ${BUILD_DIR} — asar disabled or build missing`);
}
for (const asar of asars) verifyApp(asar);
console.log(`\n✓ verify-packaged-app: all checks passed (${asars.length} app(s))`);
