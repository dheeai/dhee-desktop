# Return to Sender: production evidence and release scope

Branch: `feat/rtx-5090-queue`. This increment belongs to Desktop. Companion Core remains at `2a34a12`; it supplies the engine, MCP control, GPU queue operations and approval records. Desktop supplies the production extension and editing/review interface. There is no separate Desktop MCP implementation.

## Reusable additions

- Voice audition checks: PCM clipping, active level, silence, duration fit and confidence-aware transcript/pace evidence; naturalness remains a creative judgment.
- Narration preparation: pause-based splitting and placement, ambiguity/overflow refusal, source hashes and exact source PCM preservation.
- Continuity preflight: cast/voice bindings, asset hashes, structured movement, dialogue overlap and scene-state transitions.
- Generation handoff: exact ordered references and scene intent, stale-input protection and an optional six-section H3 prompt compiler. The H3-specific compiler currently supports `h3_video_final`; other workflows require their own catalog-compatible preparation.
- Runner registration, behavioral tests, usage contracts and implementation/verification notes. Existing bundles need explicit runner nodes; this release does not silently retrofit them.

## Film evidence

Codex drove a 60-second, 14-shot, multi-character film from a brief through script/storyboard, reference/voice review, generation, assembly and corrections. RTX services supplied voices and motion; built-in image generation also supplied composition/correction images. The user approved the three creative stages and accepted the corrected dialogue cut in conversation. The later music version has not yet received a separate final approval; saved reports retain pending status. Do not report it as formally approved in Core.

The corrected dialogue cut passed 14 picture-order checks, nine dialogue checks, transcript matching, full decode and exact master PCM comparison. Five intentional silent sections were verified separately as zero samples, rather than claiming correlation on silence.

The subsequent music mix retained the picture bitstream and dialogue stem, decoded successfully, had zero clipped samples and at least 27.08 dB dialogue-over-bed margin in measured spoken intervals. Its speech-recognition result was **unchecked** because confidence was uncertain, not passed. Music came from the RTX instrumental service; quiet effects were synthesized locally.

Evidence identifiers (media and reports stay outside Git):

- Corrected master SHA-256: `4adb893373df26ad5e45c625c65e3cf307ea1946daaa866ae630b0875c0fc1dd`.
- Music master SHA-256: `f9a10584fcebffccb68042286387683a2dfcf43acab9e494e316962a369b0f61`.
- Music MP4 SHA-256: `66a1f2f408ba1d253e1d195f44e0d70cb73d85d19502389a881d39cb01747997`.

## Efficiency and limits

Preflight catches structured contradictions before spending GPU time. Exact selections and durable-job inspection avoid accidental duplicate renders. Approved audio is reused instead of synthesized again. Targeted fixes retain unaffected shots. This is Codex-driven automation with human creative gates; task-specific scripts still performed film orchestration, crop corrections, dialogue offsets and soundtrack mixing. Visual judgment used sampled-frame inspection by Codex. No automatic semantic vision evaluator ran.

## Remaining work

1. Turn targeted crop/timing repairs and soundtrack ducking into portable, versioned Desktop operations.
2. Connect temporal semantic evaluation for identity, acting, movement and speaker/lip-sync checks; bound retries and preserve the three creative gates.
3. Improve prompt/reference preparation for left/right staging and prop geometry. Structured checks cannot prove free-text instructions are consistent or guarantee model compliance.
4. Add reusable silence-aware assembly verification and explicit PCM master-export policy. Avoid context images entering concat inputs; the film bundle explicitly selected videos.
5. Improve multi-output recovery when a completed job's first output is text; the music artifact was recovered without another GPU job.
6. Verify a fresh checkout and packaged app on supported platforms. The external bundle fixture gap in Core is separate from this Desktop increment.

## Local release verification

Desktop: 206 Jest suites / 1,794 tests passed. Production-extension build and Desktop TypeScript check passed. The live Core integration audit completed and discovered Core MCP plus 36 guidance entries; its capability gaps remain explicitly reported. These checks do not establish general full-film correctness or packaged-app acceptance.

Film assets, project state and task-specific scripts remain local. Credentials and GPU endpoint configuration are not included in this release. No PR is part of this increment.
