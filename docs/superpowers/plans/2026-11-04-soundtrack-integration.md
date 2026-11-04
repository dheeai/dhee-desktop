# Soundtrack integration implementation plan

> Execute inline with superpowers:executing-plans; user has explicitly requested integration of the demonstrated workflow without another design round.

**Goal:** Replace film-specific soundtrack mixing with a reusable Desktop runner through existing Core project.run.
**Architecture:** Pure PCM16 mixing plus confined runner input/output. Reuse narration PCM parser/writer. Existing ffmpeg.replace_audio supplies offsets and lossless master composition. No Core API changes.
**Design:** Hash-bound JSON plan selects dialogue and bed WAVs of identical format, bed gain, fade time, duck gain and spoken intervals. Dialogue samples stay unity gain, input files unchanged. Bed may be longer and is cropped explicitly to dialogue duration; shorter beds refused. Speech intervals must cover audible dialogue (samples above -45 dBFS), and each interval must meet minimum 14 dB RMS margin. Reject clipping instead of limiting the voice. Output is a new WAV with provenance/check metadata, no creative approval. Inputs/output bounded to 128 MiB and 300 seconds. No automatic music generation or semantic listening.

## Review focus
- Incompatible rates/channels: reject without resampling approved dialogue.
- Missing speech coverage and inadequate margin: refuse publication.
- Clipping and truncation: fail, leave selected sources intact.
- Stale input/hash and unsafe output paths: refuse; no overwrite.
- Silent dialogue and overlapping intervals: silence supported, overlapping or out-of-order plan refused.

## Tasks
- [ ] Write failing runner tests for registration, sample-exact unity dialogue, ducking/fades, clipping, stale source, incompatible format, no-clobber, confinement and absent speech coverage.
- [ ] Implement soundtrackMix.ts plus mixSoundtrack.ts; export PCM writer and register audio.mix_soundtrack.
- [ ] Verify focused tests, full suite, build/typecheck/lint and Core audit; run on existing real film PCM assets without rendering again.
- [ ] Document invocation and evidence, review, commit/push existing branch. Preserve all media locally.
