# Continuity preflight implementation plan

> Use superpowers:executing-plans inline; local changes only.

**Goal:** Validate a versioned multi-character continuity specification and freeze usable per-scene generation constraints before a dependent render.
**Spec:** `docs/research/2026-11-04-continuity-and-repair-requirements.md` (user requested and approved continuing this sequence).
**Architecture:** Desktop extension runner `production.continuity_preflight`, driven through existing Core MCP `project.run`. Pure validation/compiler plus confined-file runner. No new Core API or separate MCP.
**Stack:** TypeScript, Zod, Node fs/hash, existing Jest and Core runner discovery.

## Bounded design / implementation decisions

Schema version 1 binds a storyboard input and canonical image/audio assets to SHA-256. Stable character IDs select canonical identity images and an optional approved voice asset. Locations and props have stable IDs and references. Ordered scenes declare actors, movement, stationary constraints, camera/framing instructions, timed speaker turns, and explicit start/end property states. State memory persists across intercuts; an intentional discontinuity must carry an entry explanation. Property changes within a scene require an action explanation. No NLP inference or face/voice recognition is claimed.

The pure `checkContinuity` returns issues and per-scene structured constraints plus readable prompt sections. Missing/stale material, duplicate/unknown IDs, wrong asset modality, incompatible stationary/movement declarations, off-scene on-screen speech, dialogue overlaps, invalid timing and unexplained state changes block preparation. Distinct characters may share an approved group image; this remains an identity-verification question, not a fabricated face match. Narration is explicitly off-screen.

Runner `production.continuity_preflight` accepts `specInput` and fresh JSON `outputPath`; Core provides the spec as parsed JSON. It reads and hashes declared assets inside the project (bounded file size/count), checks unchanged inputs before atomic no-clobber publication and returns failure for blocked constraints. Downstream generation must depend on this node. The artifact records fingerprint, asset hashes, requirements and `semanticVerification: unchecked`, `creativeApproval: required`, `deliveryReady: false`. It does not approve or automatically submit GPU jobs.

## Review focus

Unknown/doubled IDs, inherited JS property names, multi-channel/actor assignment confusion, omitted continuity states at intercuts, empty actors/offscreen dialogue, source mutation, and unsafe output paths. A successful preflight validates declarations and material identity, not the honesty of arbitrary descriptions or full-film readiness.

## Tasks

- [x] Write behavioral pure-check tests for multi-character input, doctor stationary/patient exits, voice identity, overlapping turns, intercut prop history and stale sources; observe RED, implement and GREEN.
- [x] Write runner tests for real file hashes, parsed Core input, blocked downstream result, confinement/cancellation/no-clobber and registered discovery; observe RED, implement and GREEN.
- [x] Build and exercise through actual Core MCP with real existing media; validate both good and contradictory plans without new generation or approvals.
- [x] Full Desktop suite, typecheck, touched lint and integration audit; fresh review; record limitations and update tracker. No push/PR.

## Not in this increment

Temporal identity recognition, automatic semantic clip acceptance, automatic regeneration, new continuity-editor UI and provider setup remain later tasks. Required creative gates stay unchanged. Work continues in the existing feature checkout alongside the verified local narration increment.

Review fixes: explicit entity/reference bindings, inherited state constraints for present entities and hash-based duplicate voice detection. Prop presence remains explicitly declared; no semantic inference.
