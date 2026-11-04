# Voice audition quality check

User requests that Codex inspect the rejected Return to Sender voices and add checks instead of asking the user to diagnose them. Implement in Desktop, reuse Core runner discovery, local only.

Approaches: transcript alone misses delivery; signal metrics alone cannot certify acting; a combined objective report with explicit unchecked perceptual dimensions is the implementable first increment. No audio evaluator is exposed in the configured GPU catalog. The user delegated checking/implementation rather than another design questionnaire.

Add audio.check_voice: strict PCM16 WAV analysis (reuse parser), read-only hashed report, existing offline ASR, levels/clipping, timestamped silence, coarse active-window level spread, optional duration budget and conservative speaking-rate flag when transcript matches. Thresholds are disclosed configurable heuristics, not a subjective score. Naturalness, emotional fit, character fit and cross-character distinction stay unchecked. No automatic approval, trim, regeneration or new cloud upload. Report is always review-required unless objective checks fail; deliveryReady false. Prior user-rejected auditions remain rejected regardless of report.
