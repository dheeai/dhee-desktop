# Bundle Weight and Native-Rebuild Fragility

## Problem

The packaged Mac DMG and Windows NSIS installer are heavy and the
build pipeline has many surfaces that can fail. The `asarUnpack` block
in `package.json` lists ~50 directories that need to ship outside the
asar, each of which is a native module or a heavy dependency. First-
launch native rebuilds (`electron-rebuild`) can fail in ways the user
cannot diagnose — a corrupted `better-sqlite3` or `sharp` build means
the app silently fails to start dhee-core.

Symptoms today:
- Installer size is large enough that download abandonment is a real
  concern for trial users.
- Native rebuild during `electron-builder build` is brittle — see the
  `prepare:app-deps` flow that runs `npm pack` on dhee-core, rewrites
  `release/app/package.json` to depend on the tarball, then runs a
  full `npm install` in `release/app`. Many failure points; little
  observability.
- The cross-architecture story (mac arm64 + x64, windows x64) doubles
  most of these costs.

## Evidence

- `package.json` `build.asarUnpack` — ~50 entries, including the
  entire `dhee-core` tarball, all of Remotion + bundler + webpack,
  better-sqlite3, sharp, fastify, openai, mapbox, three.js,
  `@react-three/*`, `@remotion/*`, plus `.pnpm/*` for transitive deps.
- `package.json` scripts:
  - `verify:dhee-core` — checks sibling repo + writes
    `.dhee-core-version.json`.
  - `prepare:app-deps` — `npm pack` on `../dhee-core`, writes
    tarball to `release/app/vendor`, rewrites `release/app/package.json`,
    runs production `npm install`.
  - `package:mac` / `package:win` / `package:all` — chain of
    `verify`, `prepare:desktop-runtime`, `clean`, `prepare:app-deps`,
    `build`, `electron-builder`.
- `postinstall`: `check-native-dep.js && conditional-install-app-deps.js
  && build:dll`.
- Native deps (`better-sqlite3`, `sharp`, native node-addon ones)
  rebuilt via `@electron/rebuild`.
- README's "Production Packaging" section is long because each of
  these steps has its own caveats.

## Done means

Three reductions, can be tackled independently:

**Reduction 1 — Trim asarUnpack:**
- Audit each entry. Remove entries that are not actually loaded at
  runtime (e.g. webpack / css-loader / style-loader belong in
  devDependencies, not in the runtime asar).
- Move dev-only dependencies out of `release/app`'s production install.
- Target: cut DMG size by 25–40%.

**Reduction 2 — Replace tarball-pack with a direct build:**
- `prepare:app-deps` packs and reinstalls `dhee-core` as a tarball
  to avoid a symlink-in-asar bug. Instead, build dhee-core's
  `dist/` directly and copy it as a sibling under `release/app/dist`,
  with a single `package.json` entry that points at the local path.
- Reduces install time, removes a npm-pack failure surface, makes the
  embedded version explicit.

**Reduction 3 — Native-rebuild observability:**
- On first launch, run a smoke test of better-sqlite3 + sharp +
  whisper-cpp paths and surface a clear "your install is corrupted —
  reinstall" dialog if they fail.
- Today: silent stall.

## Out of scope

- Migrating off electron-builder.
- Migrating to Tauri / Rust shell — major rewrite, defer.
- Code-signing / notarization workflow — already works, leave alone.

## Effort

Reduction 1: 1 week of careful trimming + verification.
Reduction 2: 1 week, depends on dhee-core being directly importable.
Reduction 3: 2–3 days.

Order: start with Reduction 1 (easiest, biggest user-visible impact).
