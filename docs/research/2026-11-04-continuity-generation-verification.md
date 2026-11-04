# Continuity to GPU preparation — local verification

Desktop only, `feat/rtx-5090-queue`, 2026-11-04. No commit, push or PR for this increment.

## Added

Optional generation mode on `production.continuity_preflight` compiles a selected scene into a Core `gpu.prepare` request with checked prompt, explicit reference routing, selected workflow/version/target, duration, scalar parameters and exact source-identity guards. Canonical image/audio bindings are mapped by stable asset IDs, including ordered file lists. Provider labels such as `<Picture 1>` remain attached to their actual reference order. Repeated preparation uses an explicit stable request ID.

This extends the existing Desktop runner; it neither creates another MCP server nor bypasses Core's queue, selection, review or recovery logic. Core is unchanged.

## Verification

Behavioral tests observed failing before implementation: compiler success cases, then runner integration, then the review regression for ordered reference labels. Tests cover invalid scene/status, missing or incorrect references, aliased input-slot overrides, changed hashes, ordered file guards and narration preserved for later assembly.

Actual Core MCP was exercised against the reachable RTX catalog with existing real bottle-film materials in a fresh local project. The selected `h3_video_final` workflow was available with version `ed4e55a5e30f` at test time. Preflight produced a request; Core accepted it. Repeating that exact request returned the same selection ID. Changing a selected image byte caused Core to reject a new preparation as stale; the original byte content was restored immediately. The target remains pending. No GPU job, media generation, or new final approval occurred.

Earlier user approvals were reused only for exact byte-matching storyboard/reference previews. Three creative gates remain required. The test proves request compilation and live Core preparation, not rendered quality or full-film production.

Raw responses and verification scripts are in the task's `work/generation-acceptance/` directory; user-facing evidence is under `outputs/Dhee-Continuity-Generation/`.

Final checks: 203 Desktop suites / 1,774 tests passed. Production extension build, Desktop typecheck, integration audit and touched-file lint passed (existing old Browserslist-data warning only). Fresh review verified the routing fix and found no remaining blockers.

## Remaining

Provider-specific prompt shaping and rendered multi-character acceptance, automatic semantic motion/identity review, bounded targeted repair and retry orchestration, and a Desktop continuity editor remain unfinished. Generation slots/labels require explicit workflow configuration. This path does not automatically retrofit existing production bundles. Missing vision service configuration remains a separate gap. Approved voice references guide generation but do not guarantee identical generated speech; preserve approved recordings and check audio during assembly.
