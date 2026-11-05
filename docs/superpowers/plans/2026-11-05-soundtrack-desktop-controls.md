# Desktop soundtrack controls

Implement the next planned UX increment inline, using the existing guarded material editor and Core operations. User authorized proceeding; no push.

- Add a structured editor for recognized soundtrack plans: music level, speech ducking, fade, ordered speech intervals. Keep source hashes unchanged. Local field edits must invalidate pending saves and block preview until applied or discarded; invalid/overlapping intervals cannot be applied.
- Preserve the existing preview/downstream-impact/save flow and creative gates. Show audio roles and technical checks separately from approval. Raw JSON remains available.
- Add behavioral tests for preserved hashes, invalid input, draft/save invalidation and resetting across materials. Verify actual UI layout and the Core integration audit. Do not claim a new mixer run from a draft edit.
- This increment does not automatically install bundles, invent speech intervals, grant approval or introduce a second execution engine. Follow with native workflow discovery/execution and version-bound readiness once this editor is verified.

## Progress and decisions

- Structured editor and guarded save integration implemented locally. Eight component tests cover source preservation, invalid/overlapping fields, reset/discard, unrelated documents, silence, and readable timing display without changing sample-accurate values. Seven parent tests cover the existing editing behavior plus soundtrack preview invalidation.
- Native Electron verification used a copied Return to Sender finishing project. Renderer → preload → Core preview/write saved only bedGain (1 → 0.8), preserved every speech timing and both audio hashes, and left the original film project unchanged. No generation or creative approval was performed.
- Review fixes: disable raw text and restore preview while structured fields are unapplied; invalidate earlier save previews on edits.
- Ruling: show milliseconds but preserve original timing numbers for untouched fields. Readability must not alter dialogue timing.
- Ruling: retain the existing app theme and Core-backed editing path. Rename the editing panel to cover all production materials; add a simple choose/edit/review sequence, stronger save-preview hierarchy, keyboard focus styling and narrow-layout safeguards. This is incremental polish, not a replacement UI.
- The isolated native test required installing the existing finishing example in the app's resolved user-bundle folder. This does not prove automatic bundle installation or packaged discovery.
- No push or commit in this increment. Core source remains unchanged.

## Remaining overall Desktop UX work

1. Make project setup and bundle discovery understandable from the Desktop entry point, including missing services and materials.
2. Improve the production overview: clear current stage, next action, relevant checks and three approval stages, with stale results visibly separate from current results.
3. Continue consistent scene/character/voice editing, previews and revision navigation across production panels.
4. Bring finishing execution and recovery into a discoverable native flow while keeping Core as the sole engine/MCP.
5. Verify complete journeys on narrow windows, keyboard navigation, errors/recovery and a fresh packaged checkout. Semantic vision/lip-sync service configuration remains separate from UI polish.

## Local verification — 5 November 2026

- Full Jest suite: 208 suites, 1,816 tests passed.
- TypeScript and production renderer build passed; Core integration discovery audit completed with its existing explicit verification gaps.
- New soundtrack component and tests pass ESLint. Parent editor retains existing lint debt; no blanket lint-clean claim.
- Native preview/save path verified against an isolated real film project copy. Screenshots verified at 900px and 1280px; soundtrack panel has no horizontal overflow, and keyboard focus is visible.
- Overall screen review follow-ups: unify creative-approval panel controls with existing design tokens; replace internal tool names in sidebar instructions with user-facing actions. These are not implemented in this increment.
- Evidence files stay local under outputs: Dhee-Soundtrack-Controls-Verification.json and Dhee-Soundtrack-Controls-{900,1280}.png.

## Approval and sidebar polish follow-up — local

- Implemented the recorded approval styling and sidebar-copy follow-ups: three numbered creative checkpoints, consistent typography/buttons/focus, plain-language continuation helper, and generated-video availability wording that does not imply delivery acceptance.
- Kept policy mutation, task dispatch, selected project paths and engine behavior unchanged. Updated two existing title assertions to match the corrected wording.
- Verified 70 focused policy/decision/sidebar/chat tests, TypeScript, production renderer build, and native read-only inspection at 900px/1280px. No policy or creative approval changed; no generation performed.
- Screenshots: outputs/Dhee-Production-Polish-900.png and -1280.png (local only).
- Remaining: broader workflow navigation, accurate service readiness, setup/discovery and remaining automation work listed above. Nothing pushed.


## User scope correction

User requested focusing on the RTX 5090 workflow and leaving other areas as they are. Reverted the unfinished general connection-status increment. Existing completed local soundtrack and production polish is preserved. Next work must target RTX generation, job recovery and artifact handoff; no general provider/UI expansion.

## RTX queue feedback — local

- Implemented explicit loading, remote status-check, cancellation-request and output-download feedback in the existing RTX queue panel.
- Empty queue appears only after a successful lookup; lookup failures retain any previous list with a stale-data explanation.
- Download completion still comes from the existing Core/gateway result. No new submission, polling protocol, retry engine or approval change.
- New behavioral tests failed before implementation and passed after: pending/failed lookup is not empty; output retrieval shows progress and does not claim saved files early or submit another job.
- Verified 13 queue/preparation tests and TypeScript. This increment did not submit a live GPU job or verify a new film.

## RTX output handoff UX

Expose existing Core download records as file names, sizes and expandable provenance, with the existing Desktop reveal-in-folder action. Only accept project-relative paths without traversal for this action. Report reveal failures inline. Do not imply recorded checksums are fresh integrity checks or that downloaded files are approved. Preserve queue IDs and all existing generation/recovery operations. Test successful reveal, refused paths and failed reveal before implementation; verify through existing real downloaded output records without new rendering.

RTX output handoff verification:
- 15 queue/preparation tests passed, including new reveal/no-resubmission and unsafe-path/error coverage. Final queue rerun after lint cleanup: 9 passed.
- TypeScript, production renderer build and new component lint passed. Core discovery audit completed with its known capability gaps unchanged.
- Native Electron loaded an unchanged copy of a real Return to Sender drama3_scene queue record and its two audio files. Checked copied bytes against recorded hashes before opening; reveal succeeded; original source hash remained unchanged. Screenshots checked at 900px and 1280px.
- Fresh read-only review found no blockers in path handling, project-response isolation or approval/checksum wording.
- No live generation/download, new approval, Core code change, commit or push. General connection controls remain reverted per scope correction.

## Overall production navigation UX

Replace the five stacked tool panels with an accessible tabbed Production tools workspace: Edit materials, Generate, RTX jobs, Assemble, Checks. Keep panels mounted while switching so drafts, selections and in-flight operations survive. Open the selected panel's existing disclosure automatically. Keep artifact-stage navigation and creative review outside this tool switcher, unchanged. Use the current theme; no new engine actions, provider work or automation capability claims. Verify keyboard navigation, draft preservation, production-view integration and native layout.

Production navigation verification:
- Tests started red (missing component), then passed: draft retention, selected disclosure, accessible tab relationships and keyboard navigation. ProductionView integration tests passed.
- Full suite: 209 suites / 1,822 tests passed. TypeScript, production renderer build, new component/test lint and diff whitespace checks passed.
- Native Electron: selected soundtrack input, edited music level without applying, switched to RTX jobs and saw real copied outputs, switched back and recovered the unsaved value, then discarded it. On-disk mix plan remained byte-identical. Layout screenshots checked at 900px and 1280px.
- Fresh read-only review found no blockers in draft retention, project-keyed reset or tab accessibility.
- Source remains local. Core unchanged. No generation, creative approval or push.

## RTX batch status check

Add a user-triggered check of saved remote jobs using existing sequential Core refresh operations. Skip downloaded outputs and records without gateway IDs. Show per-job progress and partial failures; continue checking other jobs after one failure. Stop dispatching when the project changes. Never submit, download or approve during status checks. Keep local list reload separate and explicitly labelled in helper text. Surface the count of completed remote jobs ready to save.

RTX batch check verification:
- New tests failed before implementation; 21 queue/preparation/IPC tests passed after implementation. Final queue rerun: 11 passed, including partial failure and project-switch cancellation.
- Native Desktop refreshed one copied existing remote job via Core, returned “Checked 1 of 1 remote jobs. No renders were submitted,” and left the original job record byte-identical. A successful status refresh does not imply the historical render succeeded; that job correctly remained failed.
- Existing downloaded outputs were skipped. No new render, download or creative approval occurred. Screenshot: outputs/Dhee-RTX-Batch-Check.png.
- Review found an overlapping-recovery race: a recovery-triggered list reload could invalidate the batch request without releasing its busy flag. Added a failing regression, reset batch ownership when another operation supersedes it, and verified the full suite: 209 suites / 1,825 tests passed.
- Existing lint debt in this queue component remains three nested-ternary findings; the new sequential iteration introduces no iterator lint failure. No blanket lint-clean claim.
- Final TypeScript and renderer build passed after the race fix. Core repository remains clean. Everything in this increment remains local; no push.

## RTX queue organization UX

Add counted views for all jobs, in progress, needs attention, ready to save and saved locally. Classify from existing saved state only; no new probing or generation. Keep job cards mounted while filtering so recovery drafts survive. Reset the view on project changes. Put raw job errors in expandable details with a short visible explanation. Downloaded jobs never offer cancellation even if their remote state is absent.

RTX queue organization verification:
- New tests started red; 16 queue/navigation tests passed after implementation. Visibility tests open the outer queue disclosure just as the real workspace does.
- TypeScript and production renderer build passed. Read-only review found no blockers in classification, draft preservation or cancellation visibility.
- Native Electron checks passed with two existing copied real job records: attention/saved/all filters, collapsed and expanded error text, output access and fitting layouts at 900px/1280px. All queue JSON records remained byte-identical.
- Evidence: outputs/Dhee-RTX-Queue-Views-900.png and -1280.png. No remote requests, generation, downloads, approvals, Core changes or push in this increment.

## Production stage navigation

Add an always-available stage picker using the existing bundle-derived stage list and existing section targets. Keep pills on wider production panels; use the picker alone on narrow panels so every stage remains reachable. Show existing generated counts without implying approval. Navigation focuses the destination section and respects reduced motion. Do not change stage ordering, outputs, generation or review behavior.

Stage navigation verification:
- Added an explicit Go action after review identified native-select keyboard focus risk. Selection retains focus until Go; project changes reset the selection.
- Regression tests failed before implementation and passed afterward. Full suite: 209 suites / 1,829 tests passed; TypeScript, renderer build and git diff whitespace checks passed.
- Native isolated Electron verification passed at 720px, 900px and 1280px using the existing real film project copy. Confirmed selection focus, destination focus and visually inspected screenshots; existing narrow sidebar remains cramped at 720px, outside this stage-navigation increment.
- Screenshots: outputs/Dhee-Stage-Navigation-720.png, -900.png and -1280.png.
- No generation, new approvals or remote operations. All UX changes remain local; nothing pushed.
