# Fix Test-Surface TS Diagnostics

## Problem

The TypeScript diagnostics queue surfaces ~14 errors and ~30 warnings
in the test surface and webpack configs. None of them are blocking the
runtime, but they are signal that the type plumbing around recent
additions is half-wired. Cumulatively they make the editor noisy and
mask real regressions.

## Evidence (verbatim from recent diagnostics)

**Missing test globals:**
- `tests/e2e/fixtures.ts` lines 44, 52 — `Property '__kshanaTest' does
  not exist on type 'Window & typeof globalThis'`.
- `tests/e2e/chat.spec.ts` line 37 — same.
- `tests/e2e/edit-instruction.spec.ts` line 52 — same.
- `tests/e2e/edit-error-retry.spec.ts` line 66 — same.
- `tests/e2e/iterative-edits.spec.ts` line 52 — same.
- `tests/e2e/edit-with-streaming.spec.ts` line 64 — same.
- `tests/e2e/streaming-no-duplicate.spec.ts` line 93 — same.
- `tests/e2e/unhandled-events.spec.ts` lines 41, 67, 79 — same.

These all use `window.__kshanaTest` but the global is never declared
in a `.d.ts`.

**Missing module declarations:**
- `src/main/kshanaCoreManager.test.ts` line 98 — `Cannot find module
  './kshanaCoreManager'`.
- `src/renderer/hooks/useKshanaSession.test.tsx` line 18 — `Cannot find
  module './useKshanaSession'`.
- `src/renderer/components/chat/ChatPanelEmbedded/ChatPanelEmbedded.test.tsx`
  line 39 — `Cannot find module './ChatPanelEmbedded'`.

These are tests that point at sibling files which exist on disk —
typically a `tsconfig` `paths` / `include` / `rootDir` mismatch.

**Webpack config:**
- `.erb/configs/webpack.config.base.ts` line 10 — `Cannot find
  namespace 'webpack'`.
- `.erb/configs/webpack.config.renderer.dev.ts` line 41 — same.

**Deprecation noise:**
- `MutableRefObject` deprecated in `ChatPanelEmbedded.tsx` line 374.
- `platform` deprecated in `WorkspaceLayout.tsx` line 60.

**Unused-symbol noise across desktop main:**
- `main.ts` lines 3278, 3284 — unused `event` parameters.
- `preload.ts` line 430 — convertible to async.

## Done means

- A `tests/e2e/global.d.ts` (or equivalent) declares `Window.__kshanaTest`
  with the right shape. All eight `__kshanaTest` errors clear.
- `tsconfig` for the test surface includes the paths the three
  `Cannot find module './...'` tests need; those errors clear.
- The two webpack-config errors clear (typically `import webpack from
  'webpack'` instead of namespace reference).
- `MutableRefObject` → `RefObject` (or `useRef`'s default), `platform`
  use replaced with a non-deprecated equivalent.
- Unused `event` params either consumed or prefixed `_event`.
- `npm run lint` (the `eslint` step) passes with zero TS errors
  in the editor for the test + webpack surface.

## Out of scope

- Cleaning up unused-vars / unused-imports across the rest of the
  codebase (`ProjectManager.ts` etc. — those are kshana-ink, not
  desktop, and have their own todo).
- Migrating away from electron-react-boilerplate.

## Effort

Small-medium — ~2 days. Pure plumbing.
