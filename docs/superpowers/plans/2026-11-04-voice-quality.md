# Voice Quality Implementation Plan

Goal: reusable Codex-drivable audition checks and evidence on the real three rejected takes.
Architecture: pure PCM analysis + bounded read-only runner using existing ASR; register Desktop runner through Core discovery.
Tech: TypeScript, Zod, Jest, existing PCM parser/ffmpeg ASR conversion.
Spec: ../specs/2026-11-04-voice-quality-design.md

- [x] Add failing tests for silence, clipping on either channel, pauses with timestamps, low levels, duration budget, unknown perceptual quality, malformed input and runner path/no-clobber safety.
- [x] Implement voiceQuality.ts, voiceQualityRunner.ts; export shared PCM reader and register audio.check_voice.
- [x] Run focused tests, production build, full suite/typecheck and integration audit.
- [x] Run check on real Pip/Mags/Zip auditions; retain hashes and rejected status; verify Core discovery and execution.
- [x] Document measured evidence and unavailable perceptual evaluation. No push/PR.
