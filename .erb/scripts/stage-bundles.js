// Stage dhee-core's curated first-party bundles into a desktop-internal
// directory that electron-builder's `extraResources` can reliably copy
// into the packaged app at `<app>/Resources/bundles`.
//
// Why this exists:
//   electron-builder resolves `extraResources.from` relative to the
//   desktop PROJECT ROOT. Locally the two repos are siblings, so
//   `../dhee-core/dist/bundles` resolves. In CI, dhee-core is checked
//   out NESTED at `<workspace>/dhee-core`, so `../dhee-core/...`
//   overshoots one level, the source is missing, and electron-builder
//   silently warns-and-skips — shipping a build with ZERO bundles
//   (no "Narrative Prompt Relay" / "Narrative Shot by Shot" cards on
//   the New Project screen).
//
// The robust fix: resolve dhee-core the same way `verify-dhee-core.ts`
// does (dhee_CORE_PATH ?? dhee_INK_PATH ?? sibling), copy its
// `dist/bundles` into `<desktop-root>/dhee-core-bundles`, and point
// `extraResources.from` at that stable in-repo path. Works identically
// for local `npm run release` and CI.
//
// We FAIL HARD if the bundles are absent: a release that ships without
// its built-in bundles is broken, and a loud error here beats a silent
// skip that only surfaces after users download the app.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const STAGING_DIR = path.join(ROOT, 'dhee-core-bundles');

function resolveDheeCorePath() {
  const configured = process.env.dhee_CORE_PATH || process.env.dhee_INK_PATH;
  if (configured && configured.trim()) {
    return path.resolve(configured.trim());
  }
  // Local dev fallback: dhee-core is a sibling of the desktop repo.
  return path.resolve(ROOT, '..', 'dhee-core');
}

function stageBundles() {
  const corePath = resolveDheeCorePath();
  const srcBundles = path.join(corePath, 'dist', 'bundles');

  if (!fs.existsSync(srcBundles)) {
    throw new Error(
      `dhee-core bundles not found at ${srcBundles}.\n` +
        `Build dhee-core first (\`pnpm build\` in the dhee-core repo runs ` +
        `tsup, which writes dist/bundles). Resolved dhee-core via ` +
        `dhee_CORE_PATH/dhee_INK_PATH/sibling = ${corePath}.`,
    );
  }

  const ids = fs
    .readdirSync(srcBundles, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (ids.length === 0) {
    throw new Error(
      `dhee-core dist/bundles at ${srcBundles} is empty — nothing to ship. ` +
        `Check FIRST_PARTY_BUNDLES in dhee-core/tsup.config.ts.`,
    );
  }

  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGING_DIR, { recursive: true });
  for (const id of ids) {
    fs.cpSync(path.join(srcBundles, id), path.join(STAGING_DIR, id), {
      recursive: true,
    });
  }

  console.log(`✓ Staged ${ids.length} bundle(s) from ${srcBundles}`);
  console.log(`  → ${STAGING_DIR}`);
  for (const id of ids) console.log(`    • ${id}`);
}

try {
  stageBundles();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Failed to stage bundles',
  );
  process.exit(1);
}
