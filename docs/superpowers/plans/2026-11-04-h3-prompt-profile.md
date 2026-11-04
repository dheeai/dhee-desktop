# H3 prompt profile plan

> Execute inline under the existing user-approved production plan. Local only.

Goal: turn checked continuity into the six-section H3 prompt shape used by the earlier real bottle-film workflow, while retaining Core's preparation and freshness guards.

Design: opt-in `promptProfile: h3-six-section` on generation config; generic remains default. Support the inspected h3_video_final contract only: prompt, duration, refs (ordered images, max9), audio_refs (ordered audio, max3), optional seed. Automatically bind Picture/Audio labels by actual position, reject contradictory caller labels and modality mistakes. Require integer duration 1–15 seconds. Add structured camera/framing/location to compiled scenes, not parsing prose.

Sections: scene/intent, references/identity, action, camera, lighting/finish, audio. Preserve declared movements and states, no invented actions or hard-coded doctor rules. Reference lighting rather than inventing a style. Never put narration labels or narration text into synthesis instructions; explicitly preserve off-screen tracks in assembly. Only on-screen dialogue receives quoted spoken text, voice-reference label and lip-sync timing. Reference-guided speech is not guaranteed identical audio.

Tasks:
- [x] Behavioral tests first for six sections, actor actions, positional labels, speech ownership, no narrator text, provider mismatch and modality/duration errors.
- [x] Implement isolated formatter and generation integration; test and build.
- [x] Use real existing materials through Core MCP to compile and prepare, without new generation; full Desktop tests/typecheck/lint/audit and fresh review.
- [x] Record evidence, limitations and local tracker. No push/PR.

This is prompt construction and preparation acceptance, not newly rendered semantic or full-film acceptance. Temporal vision and bounded repair remain separate.
