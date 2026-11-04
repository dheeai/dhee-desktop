# Narration preparation — local verification

Implemented `audio.prepare_narration` in the Desktop production extension. Core remains unchanged; its existing MCP `project.run` loads the runner.

## Evidence

- 32 focused behavioral tests passed; full Desktop suite: 200 suites / 1,734 tests passed.
- TypeScript check, production-extension build and Core integration audit passed.
- Read-only code review found no important defects. The real MCP check exposed JSON-plan inputs arriving as parsed snapshots; added a failing regression and corrected that interface before acceptance.
- Fresh narrative integration project used the actual approved bottle narration and existing normalized video clips. Existing storyboard/reference approvals were reused only after each preview's bytes matched the original approved snapshots. No new creative approval was invented; the new rough cut remains unreviewed.
- Automatic pause detection selected two boundaries. The runner produced three 5-second WAVs and a 15-second full timeline. Independent decoding confirmed all 444,416 source PCM samples preserved in order, only silence added, and each scene WAV matched its full-timeline slice.
- Existing `ffmpeg.replace_audio` composed a 15-second, 1280×720 MOV. Its decoded audio exactly matched the prepared PCM, and decoded picture frames exactly matched the existing assembled picture. Full decode passed.
- Original approved MP4 hash remains `c2fd353654ae93ddc7725375d224af18c5bcc5db6b986cb7562aa135522eceed`. No GPU generation and no changes to the original project.

## Scope

This verifies acoustic splitting/timing and Core MCP execution, not semantic sentence alignment, vocal naturalness, a new dedicated timing editor, or final creative approval of the new cut. Ambiguous pauses require timing hints; overflow fails rather than trimming speech. Core's version lineage owns parsed JSON source freshness, while the runner records and rechecks the received snapshot content and actual audio bytes. A future direct parsed-object mutation regression would extend the existing file-mutation coverage.

Separate technical test setup attempts exposed missing narrative gate declarations and unreachable standalone nodes. Those test-bundle errors were corrected in a fresh narrative project; no gates were disabled and no project-state files were hand-edited.

Next: continuity specification/generation preflight and durable recovery, followed by configured temporal visual/audio evaluation and bounded targeted repairs. Work remains local; no push or PR.
