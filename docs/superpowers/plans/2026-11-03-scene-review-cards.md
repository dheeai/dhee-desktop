# Scene review cards

Continue the user-approved Desktop UX direction: readable per-scene cards, narration/action/duration together, technical information in Details. Existing creative decisions remain authoritative; no synthetic per-scene approval or inferred image/voice links.

- Add a snapshot-only SceneReviewDocument renderer for JSON objects containing a nonempty array of scene objects. Render every scene, preserve order, explicit missing narration/action/duration, valid finite positive durations and total only when complete.
- Unknown schemas/malformed JSON retain the generic readable renderer. Preserve all source bytes and extra fields in Details. References are data, never guessed file paths or external loads.
- Integrate with the existing exact-snapshot preview; move version identifiers into Details while preserving image alt labels and existing gate controls.
- Test more than six scenes, hidden metadata, missing/invalid data and no duplicate reads. Verify with actual Brilliant Care storyboard data in local Electron at wide/narrow widths, full Desktop tests and typecheck. No Core changes or push.

Scene-specific editing/media comparison is a later integration with explicit Core targets, not a decorative button in this slice.

## Local result

Implemented SceneReviewDocument and integrated it with exact-snapshot review previews. All scene objects render in order, including plans longer than six scenes; narration/action/duration remain together. Only complete valid timings produce a total. Missing values are labelled, unknown schemas retain the readable fallback, and full source/extra fields remain in Details. Version identifiers are collapsed. No inferred media associations or decorative editing actions.

Tests: two behavior failures reproduced against the old generic renderer, then fixed. Fourteen focused scene/preview/decision tests pass. Full Desktop: 196 suites / 1,678 tests pass; typecheck and targeted lint pass (only stale Browserslist data warning). Visual verification used the actual three-scene 20-second source storyboard in an isolated Electron component harness; this is distinct from the 14-second existing-clips acceptance cut. Both wide and 420px window captures inspected; no horizontal overflow. Full-app integration acceptance remains separate.

Next: explicit per-scene media/voice associations and supported editing/revision entry points. Approval still belongs to the existing review gate. Local/uncommitted; no push or Core changes for this slice.

## HTML-inspired refinement requested by user

Reference: the user's Brilliant_Care_Storyboard_ORIGINAL_POLISHED.html from 29 October. Adapt its navy/indigo hero, light paper cards, large frames, timing badges and editorial hierarchy inside Desktop. Use container-responsive layouts so narrow inspector panels work independently of window size.

Explicit optional scene field `imagePreviewKey` links only to a unique image in the current gate's saved preview list. No path guessing or loading arbitrary URLs from scene JSON. Show missing/failed frame states. Existing plans without links remain valid. Add regression tests for binding and image failure; use real Scene_01–03 reference snapshots in the visual harness with explicit bindings, without modifying approved project data. Keep approvals separate and raw source available.

## Scope clarification and visual verification

The HTML-inspired presentation applies to storyboard review only. Overall Desktop UX should improve incrementally within the existing layout and design language: navigation, editing, progress/error feedback and review steps. Do not replace the application shell or apply a wholesale redesign. Keep Codex/Core control and existing approval gates intact.

Local result: 196 suites / 1,680 Desktop tests pass, typecheck passes, targeted lint passes apart from the existing Browserslist data notice. Isolated Electron component previews verified wide and 420px layouts without horizontal overflow. Explicit image bindings, ambiguous keys and broken images are covered. The harness uses the corrected seated-doctor Scene 01 frame; it does not modify approved project data. Full-app walkthrough remains separate. Changes remain local and uncommitted.

## Actual-app integration correction

Ruling: retain the existing application shell and readiness grid, but stack gates containing full artifact reviews. The actual Electron screen squeezed the board to 272px within a 654px review panel. A native-browser layout regression failed at the 75% available-width requirement before this fix. Scope typography to the storyboard and prevent outer checkpoint numbering from leaking into its title. Older real project snapshots have no imagePreviewKey bindings; display them honestly as unlinked, without modifying approval snapshots.

Verified the correction in the rebuilt full Electron app using a copied real Brilliant Care project and real preload/Core bridge. Board width increased from 272px to 586px within the same 654px review panel; the failing layout assertion now passes. Three scenes render and approval remains disabled without acknowledgement. 14 focused tests pass; TypeScript, targeted lint and renderer build pass (existing Browserslist warning). No generation or approval recorded.

Remaining integration work: save explicit per-scene reference bindings through supported project operations; older storyboard snapshots currently contain only text, so do not imply the isolated illustrated component preview is already available for every existing project. Review Markdown table formatting and the lengthy review flow next. Overall Desktop UX remains incremental.

## Real image binding verification

Fresh illustrated review created using local Core MCP project.create with hash-checked real image inputs, then input.preview/input.write to record scenes_plan dependencies. Existing initializer omits dependencies between supplied stages; no Core change made. Actual Electron review loads all three frozen images, with hashes matching originals; review unreviewed and acknowledgement required. Original project unchanged. See docs/research/storyboard-image-binding.md for the reusable contract and remaining linking UI/authoring integration. No rendering, push or PR.
