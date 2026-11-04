# Continuity to GPU preparation implementation plan

> Execute inline with superpowers:executing-plans. Continue the user's existing plan; local only, no push/PR.

**Goal:** Produce an exact Core `gpu.prepare` request from fresh checked continuity inputs so Codex can prepare generation without manually rebuilding prompts or reference bindings.
**Architecture:** Optional generation configuration on the existing Desktop continuity runner. A pure compiler maps one checked scene to workflow inputs; the runner supplies freshly hashed project-confined media identities. The artifact contains the existing report and a preparation request. Core remains the sole owner of live catalog validation, selection persistence, active-job recovery, approval gates and submission. The runner never calls Core mutations while the project walk holds its lock.
**Stack:** TypeScript/Zod/Jest, existing Core MCP.

## Design choices

Generation config names sceneId, nodeId, optional itemId, branchId, requestId, expectedSelectionId, workflow/version, promptInput, referenceInputs (workflow slot to asset ID or ordered IDs), scalar parameters and optional durationInput. All visual scene assets must be mapped; on-screen/phone/radio character dialogue requires its canonical audio mapping. Narration and off-screen voice may be preserved later in assembly. Unknown/duplicate/conflicting bindings block compilation. No arbitrary prompt override: use compiled prompt including explicit entity bindings and states. Optional duration input is set from scene duration, never caller-overridden.

Build Core sceneIntent source freshness guards from declared constraints and exact supplied inputs. Evidence explicitly describes declared intent and source hashes, never claims observed visual correctness. For file-list input guards hash the exact ordered Core file identities (project-relative path, SHA256, bytes). Content snapshots are rechecked before output. RequestId must be explicitly supplied for durable retry identity, not randomized on retry.

Artifact generation is preparation only. Codex sends the embedded request through Core MCP after project.run finishes, then preserves the returned selection for gpu.run. A fresh/current preflight is required when materials change. Core checks mapped file hashes again at preparation and submission. No automatic regeneration, no semantic approval, no fourth creative gate.

## Tasks

- [x] Behavioral compiler tests first: exact prompt/reference maps, list hash, omission/wrong bindings, parameter collisions, durations and declared-evidence guard.
- [x] Integrate optional mode into confined runner; tests and build/typecheck.
- [x] Exercise actual Core MCP against existing real materials: compile request and prepare using a real catalog workflow if available, with no GPU submission. Verify stale material refusal.
- [x] Full Desktop suite, integration audit, focused lint, fresh review, documentation/evidence/tracker. Keep Core unchanged.

Verified through real Core MCP with h3_video_final catalog version ed4e55a5e30f; no render submitted. Review fix adds ordered routing/provider labels and assembly-only voice instructions. 1,774 Desktop tests passed.
