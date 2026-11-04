# Readable review previews implementation plan

Continue the approved Desktop storyboard/voice/editing UX plan. Use inline execution; preserve existing local branch and uncommitted work. No Core changes, media changes or remote writes.

- [x] Extract the existing ReadableArtifact display portion into a pure exported ReadableArtifactContent receiving already-loaded content and path metadata. Keep the existing file-reading wrapper intact.
- [x] Use that renderer inside ProductionReviewPreview for its exact saved text/JSON snapshot. Keep raw text available in a disclosure; retain existing JSON inspection. Do not perform another read or alter approval fingerprints.
- [x] Test readable Markdown and JSON fields, exact snapshot path/single read, plus current loading/error/approval regressions. Run the full Desktop suite, typecheck and relevant lint. Render a local preview if available; distinguish component verification from native app acceptance.

Scope: readable review, not stage editing, generated changes, or automatic approval. Existing renderer truncation indicators and full-source disclosure remain; larger storyboard navigation is later work.

## Verification

Two new behavior tests failed before implementation and pass afterward. Desktop full suite: 195 suites / 1,675 tests pass. Typecheck passes. Review component/test lint passes; the reused ReadableArtifact file has pre-existing lint debt (baseline 35 findings, current 34; no new rule-count increase). The full app was not relaunched. A local Electron component harness rendered the real existing-clips test plan with actual Markdown and CSS; visual inspection caught overlapping long hashes and decorative drop-cap typography. Scoped review styles fixed both, and the second capture was inspected. Screenshot: outputs/Dhee-Readable-Review-Preview.png in the parent task workspace.

Generic object arrays now use labelled subcards rather than flattening short objects into chips. Existing item/depth limits and raw JSON disclosure remain; full storyboard pagination, editing and voice comparison remain later UX work. No Core changes in this slice, no commit/push.

## Follow-up: Markdown tables and checklists

Continued the authorized readable-preview scope: enable the already installed remark-gfm parser and scoped table/checklist styles. Wide tables scroll inside the prose area. Checklist inputs are disabled document content, not creative approval controls. No Core, file-editing or approval changes.

Real parser/browser regression in the task workspace (`work/markdown-review/build.cjs`, `verify.cjs`): before the fix, zero tables and checkbox inputs; after, correct three-column table, exact narration/action cells and two disabled checkbox states. At 420px no document overflow. Captured and inspected isolated Electron component preview; this is not a full native project workflow verification. Jest mocks Markdown and is not evidence for actual parser rendering. No new dependencies, commit or push.

Follow-up checks: 198 suites / 1,693 tests pass; TypeScript, renderer build and diff whitespace checks pass. Existing stale Browserslist notice only in build output.

## Follow-up: consistent saved project identity

The approved overall Desktop UX scope includes keeping project identity clear. Inspection found both WorkspaceContext and ProductionView ignoring project.json's name in favor of a folder-derived title. Read the root name on open, support the existing legacy metadata location when no root file exists, and fall back to the folder for absent/invalid/unreadable names. ProductionView uses the same workspace name. Directory identity and engine operations remain unchanged; no metadata is written. Existing branch reused, no commit/push.

Two UI regressions failed before the change (saved name in workspace and production hero) and passed after. Additional coverage exercises malformed metadata, blank/nonstring names, read failure and legacy location. Live renaming while already open remains outside this increment; reopening reads the current saved name.

Saved-name verification: 198 suites / 1,701 tests pass; TypeScript and renderer build pass. Actual Electron reopened the illustrated Brilliant Care project and showed its saved name in shell/chat. Project metadata, event log and storyboard hashes unchanged. Hero text is covered by component regression. Screenshot inspected. No push.
