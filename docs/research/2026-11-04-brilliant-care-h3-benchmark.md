# Brilliant Care H3 benchmark — 2026-11-04

One actual RTX render through Core MCP tested the new Desktop continuity and H3 prompt path. Reused exact previously approved corrected Scene 01 reference and mature narrator recording. Existing approvals were checked against exact preview hashes; no new rough-cut approval has been recorded.

Pipeline: continuity preflight → H3 six-section preparation request → Core GPU selection and render → Desktop normalization (4 seconds, 1280×720, 24fps, generated sound removed) → lossless replacement with approved narration → Core media check → rough-cut gate.

Job: j4bf28cda6326, h3_video_final version ed4e55a5e30f. Only one render, no automatic retries. The same seed as the earlier corrected baseline was used. Raw output is retained in the fresh local project. The original project was not modified.

Technical checks: full decoding, duration, frame size/rate and audio peak passed. Every approved narration PCM sample matches exactly, with only zero samples appended; decoded video frames match before/after audio replacement. Core reports review because the short narration leaves an intentional silent tail. No blanket all-checks-pass claim.

Codex inspected 24 chronological frames at 6 fps and a full-size final frame. Doctor stayed seated; patient advanced through the doorway into the corridor; no role reversal/doctor exit observed. Identity/wardrobe and setting remained recognizable in these samples. This is sampled visual inspection, not automatic semantic verification or full-motion naturalness certification.

Final cut remains unreviewed in Core. Display it for the user's third creative approval. No new application-code changes in this benchmark turn and no redundant full test rerun; the latest verified implementation remains 204 Desktop suites / 1,784 tests. Core unchanged. Nothing pushed; no PR.

Remaining: user's playback review; wider multi-character dialogue/identity benchmark; temporal semantic service and bounded automatic repair. This four-second two-person scene does not establish full-film acceptance.
