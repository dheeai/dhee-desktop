# Approved narration preparation

Continue the agreed next step: replace the task-specific audio splitting used for the 15-second film with a reusable Desktop-owned runner, callable through Core MCP's existing project.run. Keep the existing checkout/branch and all work local.

## Approach

Use `audio.prepare_narration` in the production extension. Read a hash-bound PCM16 WAV plus a JSON timing plan, detect sustained quiet intervals, and split only when there are exactly N-1 eligible internal pauses for N ordered scenes. Optional ordered `boundaryHintsSec` select measured pauses when ambiguous. Defaults: -45 dBFS peak across all channels, minimum pause 0.8s, 10ms windows. Do not mistake this acoustic heuristic for sentence/semantic recognition.

Alternatives: repeating custom scripts prevents reuse; ASR-only forced alignment can cut speech when timestamps are uncertain. Acoustic candidates plus explicit hints provide a bounded first implementation without a new service dependency. This is the implementation choice for the already-authorized narration step.

## Contract

Plan: `sourceSha256`, `scenes:[{id,durationSec,offsetSec?}]`, optional `boundaryHintsSec`, `minPauseSec`, `silenceThresholdDb`. Each scene receives a contiguous part in order. Every source sample, including pauses, appears exactly once. Insert only zero-valued padding to fit the declared scene durations/offsets. Refuse overflow rather than truncate, resample, or speed up speech. Preserve sample rate/channels. Output one complete timeline WAV, or one scene WAV selected by optional runner `sceneId` (same full plan validation). Output metadata includes source and PCM hashes, sample ranges, placement, durations, measured pauses and `semanticAlignment: unchecked` / `deliveryReady: false`.

Runner config: `audioInput`, `planInput`, `outputPath`, optional `sceneId`. Read project-confined immutable input snapshots, bound sizes, validate PCM16 RIFF structure, reject unsupported formats with a useful message. Recheck source bytes before atomic no-clobber publication; cancellation and failure leave no output. Never modify source, approve a review, or submit GPU work. Existing engine lineage/review gates remain authoritative; a hash match alone is not approval.

## Verification and scope

Behavioral tests cover sample identity, stereo, silence ambiguity, hinted cuts, fit refusal, changed hash, invalid WAV/plan, path confinement, existing outputs, cancellation and discovery. Verify real approved bottle narration through Core MCP in a separate local project; compare all retained sample ranges and assemble with the existing real clips. No new generation or changed approval on the original project. UX preview uses the existing audio/review surfaces; a dedicated timing editor and automatic semantic alignment remain later work.
