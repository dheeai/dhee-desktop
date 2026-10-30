# Version-bound review decisions implementation plan

Goal: record and restore human decisions against exact reviewed content in the existing Core event log, then connect Desktop review controls without confusing recorded decisions with runner enforcement.

Architecture: Core owns an artifact-snapshot review service; snapshots include selected versions, content hashes and transitive recorded dependencies. Desktop submits the snapshot fingerprint it showed the reviewer. Core recomputes under the project walk lock and rejects stale or incomplete saves. Reopening recomputes freshness. No localStorage or second approval database.

Spec: Dhee-Production-Design.md, review decision and freshness requirements. Work remains local in the two existing repositories.

## Tasks
- [x] Core behavioral tests: reopen, changed content/selection/dependency, failed/missing output, stale saves, concurrent walk, revocation, unrelated artifacts and branch isolation.
- [x] Add review event payload and snapshot/decision service, exported through Core DAG API.
- [x] Add typed IPC and Desktop review controls with pending/error states and stale-response protection.
- [ ] Focused tests and fresh review; document enforcement limitations before declaring the first feature complete.

## Scope and sequencing
A recorded decision describes an explicitly enumerated artifact set; it does not establish that a whole workflow is complete. The current readiness panel controls which sets it offers for review. A later authoritative checkpoint policy must define complete expected membership and protected execution stages before engine enforcement can be claimed. Existing arbitrary run/regen calls and collection pauses are not approval enforcement. No Approve-and-generate shortcut is added here.

## Review focus
Never accept an empty snapshot or missing/failed dependency. Track selected historical versions, not only latest completions. Reject stale UI saves. No approval reuse across unrelated project/branch/gate scopes. Reopening and external artifact edits must make status truthful. Main-process errors must be visible; switching projects must not display the previous project's decisions.

## Local execution record — 30 October 2026

- Core review service: 12 behavior tests, plus 23 existing event-log/projection regressions pass. Eight original behavior tests were observed failing against the stub first.
- Desktop: 47 focused tests cover readiness, snapshot review controls, IPC delegation, preload whitelist, production integration and existing grouping.
- Targeted strict TypeScript check of the Core service passes. New Desktop files pass ESLint; review SCSS compiles. Existing broad source lint debt is not represented as clean.
- A per-project lock alias bug was reproduced by the new tests: /var and /private/var aliases could bypass the same-process lock. Canonicalizing existing project paths fixes this; explicit alias/release tests pass.
- Final review found one Important issue: refreshing a fingerprint could leave old workspace previews visible. Fixed with content-addressed frozen previews, loaded-preview checks and a fresh user acknowledgement after every refresh. Core same-path edit/frozen-content test and Desktop refresh/new-preview/acknowledgement test were observed failing before the fix and passing afterward.
- Final: minor (deferred): stale changes-requested decisions currently use the generic “Approval out of date” label. This wording should become “Review decision out of date.”

## Rulings and practical limits

- Ruling: artifact decisions are distinct from authoritative checkpoint membership and engine enforcement. No run/regen restriction is claimed or silently activated. Cost: existing run commands can still proceed without these decisions, so the first feature remains incomplete.
- Ruling: use a project-local content-addressed preview cache under .dhee/review-previews. It stores exact bytes, including dependency artifacts, so approval previews cannot silently change when canonical files are rewritten. Cost: additional disk space; cleanup policy remains future work. The event log is still the only decision store.
- Ruling: inherited branch artifacts are readable, but human decisions do not inherit across branches. Cost: a fork requires review again.
- Ruling: dependency freshness follows recorded event lineage. Legacy artifacts without dependency metadata only bind to available targets and recorded dependencies. Cost: a future authoritative gate policy must require complete lineage/membership before accepting such a review for execution.
- Ruling: no automatic agent/MCP approval tool is exposed; the shared Core API is ready for later controlled integration. The actor is the local user, not an authenticated multi-user identity.

## Integration status (updated after gate enforcement)

The dangling caption registry import has been removed after history inspection; Core now builds. Authoritative current-membership, dependency-lineage validation and shared walker gate enforcement are implemented. Desktop production builds and isolated Electron startup with the matching Core pass; review preload methods are available. See Dhee-Gates-Implementation-Plan.md for targeted verification and fresh-review fixes.

Visual/media acceptance and representative end-to-end project verification remain pending. Existing built-in bundles still need voice-reference configuration. Frozen-artifact approval is not final export QC, and the entire first feature is not yet declared fully accepted.

No GPU generation, push, GitHub branch creation or PR was performed. Local work stays on feat/storyboard-review-workspace in both repositories. Notify the user before publishing once the full first feature is locally verified.


## Native Desktop acceptance completed

The built Electron app was opened through the native app controls using an isolated profile and local studio directory. A synthetic two-second fixture supplied script, scene plan, image references, an audio audition, scene clip and final video with recorded dependencies. No live model or GPU generation was used.

Verified visually: policy control and checkpoint layout at the default Desktop window size; frozen script/image previews; native audio and video controls. The audio audition and video scrubbers reached their two-second end. This verifies playback operation, not subjective sound quality or production-video quality. All three decisions were recorded through the UI and remained approved after closing/reopening the project. The shared Core walker returned the final-video goal using those saved UI decisions. After editing the script, refreshing showed all three decisions stale and the walker paused at review:storyboard without returning a goal.

The review-gate feature is now locally verified. RTX 5090 end-to-end generation, built-in voice-reference integration, production-scale UX and final export QC remain later workflow work. Nothing has been pushed and no PR or remote branch has been created. The isolated fixture is test data and does not represent a creative approval of a user production.
