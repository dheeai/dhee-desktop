# Enforced creative review gates

Goal: opt-in required reviews checked at the shared Core walker, so Desktop, agent, regen and direct walker callers use the same policy. Keep legacy projects unchanged until the user enables the policy in Desktop.

Policy is a project event, not a UI boolean. Review decisions remain branch-specific. Known narrative contracts require script/storyboard before reference media, character/setting/voice references before scene media, and rough-cut approval before reporting goal completion. Checkpoint membership comes from walker materialization, including all collection members, so approving a partial subset cannot unlock execution. Missing voice-reference configuration blocks the reference checkpoint; no inferred voice approval.

Tasks: remove the dangling caption registry import proven by Git history; add gate-policy and authoritative membership tests; integrate the guard into the shared walker; distinguish approval pauses from collection pauses in runner/status/wake text; expose policy controls over existing Desktop IPC; run focused real walker tests and build the matching local Core. No GPU jobs, remote branch, push or PR.

Review focus: disabled policy preserves behavior; stopAt/runOnly/regen cannot skip an enabled gate; cached outputs do not confer approval; changed upstream artifacts reclose a gate; rough cut remains review-required even when an assembled file exists; missing configuration fails closed; enabling/disabling cannot race an active walk. Local runtime and visual acceptance remain necessary before declaring the overall first feature done.


## Local implementation and verification — 30 October 2026

Implemented the project-wide opt-in review policy, shared walker gates, Desktop policy switch, and approval-specific status/agent messages. Disabled policy preserves existing behavior. The Desktop now reads and saves authoritative scopes resolved from the current bundle and plans; historic removed instances cannot change the checkpoint membership. Targeted runs hydrate full review inputs without executing unrelated siblings. Required reviews reject incomplete dependency history. The canonical scope is resolved again under the project lock when saving.

The missing Core caption module was traced to a dangling registry entry introduced in 4e7bf41; no implementation existed in fetched history. Removed that import/registration instead of inventing a runner. The Core engine and Desktop main/renderer production builds now pass.

Verification: 53 targeted Core tests across walker approvals, saved decisions, locks, collection gates, runner dispatch and status; 65 targeted Desktop tests across IPC, preload, wake messages, production view, readiness, policy and frozen-preview approval controls. Targeted ESLint passes. Core gate module strict typecheck passes. Built Core APIs load through Desktop's installed package export. An isolated Electron startup loads the renderer and matching Core and exposes the review preload methods. For this unpackaged production-build smoke check, the compiled preload was temporarily staged at the existing development preload path; this is not a packaged release test.

## Fresh review and fix ledger

- Fixed: scoped stopAt/regeneration falsely missed approved sibling inputs. A regression failed before full-bundle read-only materialization, then passed.
- Fixed: legacy artifacts without dependency lineage could unlock execution after upstream changes. A regression failed before the lineage guard, then passed.
- Fixed: removed historical collection members made Desktop approvals disagree with the walker. The membership regression fails with caller-provided targets and passes with authoritative current scope; Desktop controls also accept current authoritative readiness even if the historical graph includes invalidated removed members.
- Deferred minor: “Approval out of date” is also used for a stale changes-requested decision.
- Ruling: opt-in policy preserves legacy projects until explicitly enabled. Cost: optional projects are not protected by required gates.
- Ruling: unsupported narrative contracts and missing voice audition configuration fail closed. Cost: existing built-in bundles need a voice-reference stage before required-reference approval can be completed.
- Ruling: dependency history is required for enforcement. Cost: legacy artifacts may need regeneration before required reviews can proceed.
- Ruling: use the same current-bundle materializer for Desktop and walker, including GPU-aware chunk sizing. Cost: review resolution can require the existing read-only GPU capability probe; GPU generation was not exercised.
- Ruling: Desktop currently reviews the main project branch; Core's API keeps explicit branch isolation. Cost: other creative branches are not reviewable through this workspace yet. Git feature branches are unrelated to these project branches.
- Ruling: remove the dangling caption registration. Cost: a bundle requesting that absent runner now receives the normal missing-runner validation instead of every Core import failing.

## Remaining acceptance

Visual layout, actual media playback and a representative production-project walkthrough remain unverified. The earlier browser restriction on opening the generated local preview was not bypassed. No live GPU generation, model downloads, push, remote branch creation, PR, or Slack send. Do not mark the whole first feature fully accepted until the remaining UI/media check is done. The RTX 5090 remains the intended generation backend; this checkpoint feature does not implement voice generation or final-video QC.


## Native Desktop acceptance completed

The built Electron app was opened through the native app controls using an isolated profile and local studio directory. A synthetic two-second fixture supplied script, scene plan, image references, an audio audition, scene clip and final video with recorded dependencies. No live model or GPU generation was used.

Verified visually: policy control and checkpoint layout at the default Desktop window size; frozen script/image previews; native audio and video controls. The audio audition and video scrubbers reached their two-second end. This verifies playback operation, not subjective sound quality or production-video quality. All three decisions were recorded through the UI and remained approved after closing/reopening the project. The shared Core walker returned the final-video goal using those saved UI decisions. After editing the script, refreshing showed all three decisions stale and the walker paused at review:storyboard without returning a goal.

The review-gate feature is now locally verified. RTX 5090 end-to-end generation, built-in voice-reference integration, production-scale UX and final export QC remain later workflow work. Nothing has been pushed and no PR or remote branch has been created. The isolated fixture is test data and does not represent a creative approval of a user production.
