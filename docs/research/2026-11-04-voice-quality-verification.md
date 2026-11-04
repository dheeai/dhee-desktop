# Return to Sender — voice quality review

These are the three actual v2 RTX drama3_scene auditions that the user rejected. No new speech was generated and no audio was changed.

- Pip: 4.694 seconds, 153.4 words/minute including pauses; transcript matches. No PCM rail clipping.
- Mags: 8.186 seconds; transcript expands “why’s” to “why is.” No PCM rail clipping. Listening review remains required.
- Zip: 4.186 seconds; active 20 ms window p90–p10 level spread is 22.2 dB, above the 20 dB review heuristic. Internal quiet gap at 0.78–1.76 seconds. Words match but recognition confidence remains flagged. This is measured level variation, not proof of bad acting.

## What the new check can establish

Desktop `audio.check_voice` checks PCM16 input, rail hits, active-window levels, timestamped pauses, optional duration budget, and script comparison through offline ASR. It saves audio hashes, thresholds, intent, prior rejection and a review-required report. Core MCP ran it against the existing voice collection. It does not modify audio or submit GPU jobs.

## Still missing

Naturalness, emotional delivery, character fit and cross-character distinction need perceptual audio evaluation. No such evaluator is configured or exposed by the current RTX workflow catalog. The report explicitly leaves them unchecked. Clean technical results do not override the user’s rejection or grant creative approval. This increment does not solve subjective voice quality or automatically fix it.

## Local verification

206 suites / 1,794 tests passed; build, typecheck, lint and Core integration audit passed. Existing audit limitations remain; lint prints an existing Browserslist warning. Core MCP executed all three report nodes on real audio; no GPU jobs or source changes. Review found no important issues; cancellation and mutation during ASR still lack targeted tests. Core code unchanged. No push or PR.
