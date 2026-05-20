# Audio Production UX

## Problem

The desktop ships whisper-cpp word-level captioning (for audio that
already exists), audio import in `TimelinePanel/AudioImportModal.tsx`,
and a waveform display. None of that produces audio. Final videos are
silent unless the user brings their own track.

This is the single largest perceived-quality gap in user-facing terms.
Every consumer competitor (Pika, Runway, Descript, ElevenLabs Studio)
ships TTS. A silent demo loses the room.

The dhee-ink `MultiShotMotionPrompt` schema already has dialogue fields
that the engine does not consume and the desktop has no UI to drive.

## Evidence

- `src/main/services/wordCaptionService.ts` — whisper-cpp integration,
  already shipped.
- `src/renderer/components/preview/TimelinePanel/AudioImportModal.tsx` —
  imports existing audio files only; no generation.
- `dhee-ink/future-features.md` lists "AI Voice & Audio Pipeline" as
  the #1 missing feature with ElevenLabs / Google TTS / OpenAI TTS
  named as candidates.
- The prompt-overlay ASS export
  (`src/main/services/promptOverlayAss.ts`,
  `src/renderer/utils/promptOverlayExport.ts`) hints that we already
  treat the timeline as overlay-aware; an audio track would slot in
  next to the prompt-overlay layer.

## Done means

- Settings → Providers gains an Audio capability with at least one
  TTS provider option (ElevenLabs is the strongest candidate; Google
  TTS / OpenAI TTS / Kokoro / local Piper are alternatives).
- Per-character voice picker (or per-shot narration voice) in the
  shot-detail view.
- A narration track in `TimelinePanel`, alongside the existing video +
  imported-audio tracks, that fills automatically as scenes generate.
- `final-video` assembly via Remotion includes the narration track.
- The new audio is **regeneratable** through the same redo pattern
  shots use today (`ShotRegenerateModal` analog for narration).

This is dependent on dhee-ink shipping an `AudioProvider` interface
(`generateNarration` / `generateMusic` / `generateSFX`); coordinate
with the core team. Desktop work begins once the engine surface exists.

## Out of scope

- Background music scoring and SFX — defer to v2 of this feature.
- Speech-to-speech voice cloning — defer.
- Audio mixing UI (sliders, ducking) — defer.

## Effort

Medium-large — 2–4 weeks of desktop work assuming the core
`AudioProvider` is ready. Most of the cost is the timeline integration
and the per-character voice mapping UX, not the provider call itself.
