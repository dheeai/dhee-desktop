# Narration Preparation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace custom voice splitting with sample-preserving, scene-timed audio preparation through Core MCP.
**Architecture:** Desktop production runner with a pure PCM/timing module; existing Core runner discovery and project.run. No Core edits.
**Tech Stack:** TypeScript, Node Buffer/fs, existing Zod and Jest; existing FFmpeg for independent verification.
**Spec:** `docs/superpowers/specs/2026-11-04-narration-preparation-design.md`

## Global constraints

Keep all source PCM samples, sample rate and channels; add silence only. Exactly N-1 unambiguous pauses or validated hints; refuse overflow. No approval inference or semantic pass. Local work only on existing feature checkout.

## Review focus

- Stereo quiet detection must check every channel.
- Comma pauses and extra silence must not silently cause guessed cuts.
- Fractional durations must use sample-rounded cumulative boundaries without drift.
- Unsupported or malformed WAV and huge plans must fail before allocation/publication.
- Same source/output, symlinks, existing outputs and cancellation must never damage source.

## Task 1: PCM and timing algorithm

Files: `packages/dhee-runner-production/src/narrationTiming.ts`, `src/production/narrationTiming.test.ts`.
Interface: `prepareNarration(wav:Buffer, rawPlan:unknown, sceneId?:string)` returns WAV bytes plus metadata. Parse canonical PCM16 WAV (including ancillary chunks); validate source hash and timing plan, derive acoustic cuts and copy contiguous sample ranges with silence padding.
- [x] Write behavioral tests: source PCM reconstruction, stereo preservation, automatic/hinted cuts, fractional boundaries, invalid hashes/format, ambiguity/overflow.
- [x] Observe RED, implement, verify GREEN.

## Task 2: Runner and discovery

Files: `packages/dhee-runner-production/src/prepareNarration.ts`, package `index.ts`, `src/production/prepareNarration.test.ts`, README.
Interface: `prepareNarrationRunner: Runner`, registered as `audio.prepare_narration`.
- [x] Write tests calling runner.run on temp projects and checking actual outputs and error cases.
- [x] Observe RED, implement confined reads, fresh hashes and atomic no-clobber output; verify GREEN.
- [x] Document plan/config examples and semantic/approval boundaries.

## Task 3: Local acceptance

- [x] Build extension; run full Desktop tests, typecheck, Core integration audit.
- [x] Use real approved bottle source and existing clips in a separate Core MCP project; prepare scene narration and assemble through existing runners. Independently compare retained source samples and probe/decode output.
- [x] Fresh read-only review; fix important issues and rerun affected checks.
- [x] Record evidence and next gaps. No push or PR.

## Execution notes

User repeatedly requested continuing the existing plan and local verification, so this is inline execution of the agreed narration step rather than a new design approval cycle. Existing feature checkout is clean at fca830c; 1,702 tests passed in the just-completed pre-push run. Keep that checkout and reuse its dependencies. No repeat baseline render required.

Completed locally: see `docs/research/2026-11-04-narration-preparation-verification.md`. Integration ruling: Core JSON upstreams are parsed snapshots, so accept and hash snapshots as well as confined file paths. Added a regression before fixing. New user requirements for multi-character continuity and self-repair are captured in `docs/research/2026-11-04-continuity-and-repair-requirements.md`. No commits or push for this increment.
