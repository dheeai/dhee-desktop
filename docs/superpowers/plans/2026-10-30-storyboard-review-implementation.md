# Storyboard review workspace: first local implementation slice

Goal: make production readiness and the three review checkpoints visible in the existing Desktop workspace, without treating generated artifacts as human-approved.

Architecture: a pure review-readiness model derived from bundle declarations and the existing run projection feeds a small accessible React panel in ProductionView. Navigation reuses existing section anchors. No second persistence store, new runner, or core change. Missing approval persistence remains explicit; this slice does not enforce approval gates or launch generation.

Scope ruling: implement readiness/navigation first because current IPC exposes execution state but not version-bound human review decisions. A decorative Approve button would misrepresent the agreed design. Durable approvals and engine enforcement are a separate following change.

## Tasks

- [x] Add behavior tests for missing/unmaterialized requirements, failed/stale assets, partial collections, voice absence, unknown bundle types and ready-for-review states.
- [x] Implement `buildProductionReview(model, bundleNodes, doc)` in `src/renderer/lib/runCockpit/productionReview.ts`; readiness is computed, never persisted as approval.
- [x] Add and integrate `ProductionReviewPanel` with per-checkpoint criteria, status and links to actual material; no generation side effects.
- [x] Test navigation and status in the actual ProductionView; label assembled output as generated rather than approved/final-ready. Keep existing advanced controls.
- [ ] Run focused tests, affected type/lint checks and a local visual preview with fixture media. Record unavailable wider checks honestly; no broad baseline cycle or GPU run.
- [x] Review the resulting diff and preserve it on `feat/storyboard-review-workspace`, local only.

## Review focus

Unknown or audio-only bundles must not acquire a misleading film approval panel. A lone completed item in a larger collection must not imply readiness. Missing voice assets must remain visible. Changes to run state must update readiness immediately. A generated film must never imply human approval or export QC.

Spec: Dhee-Production-Design.md, including the 30 October planning refinement. Testing follows the user's instruction to focus verification on actual changes.

## Local execution record

- Readiness tests observed failing with the empty implementation (7 failures, 1 pass), then passing with the model.
- 23 focused tests pass across readiness, panel, ProductionView integration and existing production model. Jest uses repository transforms and diagnostics with the packaged Electron build prerequisite omitted in a temporary config; no full app build was claimed.
- New TypeScript source/tests pass ESLint. ProductionView retains pre-existing lint violations; new integration lines are formatted without reformatting the whole file.
- SCSS compiles and the React panel renders to static HTML. Visual verification remains pending: Playwright browser executable absent; in-app browser rejects file URLs. No workaround attempted after that policy denial.
- Fresh reviewer found no Critical/Important issues.
- Final: minor (deferred): add a ProductionView rerender test changing mockModel to cover the full model-to-panel update path; current panel rerender and initial view integration have tests.
- Ruling: readiness/navigation precedes saved approval decisions and enforcement; otherwise UI would imply a gate that the runner does not enforce. Cost: users must still manage approvals manually.
- Ruling: pre-existing generic film classification and entity-card status behavior remain out of scope; the new panel is restricted to known narrative contracts. Cost: generic views retain existing limitations.
- Ruling: visual acceptance and full runtime/GPU/export verification remain pending; this slice does not alter execution. Cost: layout and packaged-runtime behavior still require verification before release.
- No Core changes, GPU jobs, remote pushes or PRs.

## 3 November continuation: review-preview correctness

Following the approved Desktop UX plan, fixed missing/blank text previews counting as loaded, stale text while a new version loads, and old errors surviving a successful new-version load. Three tests reproduced the bugs before fixes. Nine focused preview/decision tests pass; full Desktop suite 195 suites / 1,673 tests passes. Typecheck passes. Local only; native visual acceptance remains separate.
