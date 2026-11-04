# Continuity preflight — local verification, 2026-11-04

Implemented in Desktop's production extension on `feat/rtx-5090-queue`; Core is unchanged. No new push or PR.

## What changed

`production.continuity_preflight` checks a versioned declaration of cast, canonical reference images, voices, locations, actor movements, timed dialogue and property states before a dependent generation node. It publishes explicit entity-to-reference bindings, per-scene constraints, resolved states, source hashes and a fingerprint. Known states follow present actors and locations across intercuts. Props appear when explicitly mentioned in scene states.

Missing/stale materials, wrong reference types, duplicate or unknown IDs, wrong/shared voice recordings (including aliases), on-screen speech without a visible actor, overlapping/out-of-range speech, stationary/moving conflicts and unexplained state changes block publication. File reads are project-confined and bounded; publication rechecks selections and uses atomic no-clobber output creation.

## Evidence

- Tests were written first: 12 pure-check failures, then 4 runner behavioral failures before implementation.
- Review identified missing reference bindings, dropped state constraints on returning actors and duplicate voice-byte aliases. Three regression tests failed before those fixes.
- Final verification: 202 Desktop suites / 1,759 tests passed; fresh review found no remaining blockers.
- The focused suite covers 25 cases, including cancellation, output confinement, no-clobber, source identity and specification mutation.
- Actual Core MCP discovered and ran the Desktop runner against existing real bottle-film storyboard, reference images and narration. No new GPU jobs were submitted.
- A valid three-scene plan produced `constraints-valid`; removing the bottle-to-planter transition explanation produced `state-discontinuity`, failed the node and published no artifact. The downstream final node was not executed in either preflight-only run.
- Creative review remained required. Earlier explicit user approvals were reused only after every displayed preview was compared byte-for-byte with its approved original. No new cut was approved.
- Production extension build, Desktop TypeScript check, touched-file lint and Core integration audit passed. Lint reports only the existing old Browserslist-data warning.

Acceptance scripts and raw responses are under the task's `work/continuity-acceptance/`; final post-review runs are under its `final/` directory. User-facing evidence is in `outputs/Dhee-Continuity-Preflight/`.

## Boundaries

This checks declarations and selected bytes, not rendered semantics. It cannot infer contradictions inside free text, identify faces or voices, verify natural movement/lip-sync, or prove full-film consistency. Multi-character movement/voice failures are covered by unit fixtures; real MCP acceptance reused the bottle film, not a newly rendered multi-character film. Header identification is only a modality guard, not media decoding.

Existing generation bundles must explicitly depend on this node and consume its constraints/reference bindings. This is not yet wired into every bundle or a new Desktop continuity editor. No automatic clip regeneration or repair loop is implemented. `semanticVerification` stays `unchecked`, `creativeApproval` stays `required` and `deliveryReady` stays false.

Next: connect the constraints to a reusable generation/repair operation, preserving approved assets and unaffected shots; then verify semantic-review and bounded correction against a real multi-character sequence. Live semantic vision service configuration remains unresolved.
