# Gated soundtrack: real Core MCP acceptance

This resolves the missing narrative-gate setup identified in the earlier soundtrack integration report. Core implementation is unchanged. The reusable bundle and instructions belong to Desktop; film assets and the acceptance project remain local.

## Included

`examples/bundles/soundtrack-finishing/bundle.json` wires imported inputs through `audio.mix_soundtrack` to `ffmpeg.replace_audio`, with the narrative `story`, `scenes_plan`, reference and `final_video` stage IDs expected by Core. Its README documents the complete MCP sequence and multi-character extension. It is an explicit developer bundle, not a silently installed replacement for existing workflows.

The repository template was also validated directly with Core MCP bundle.describe. Read-only review found no blocking bundle/API/approval issues; intake-size and duration semantics were clarified in the instructions.

## Real test

- Used the existing Return to Sender 60-second picture, dialogue and music/effects bed; no GPU generation.
- Initial direct dependent-input import failed review validation because creation did not record upstream lineage. The corrected setup imports only roots at creation, then uses Core input.preview/write for dependent inputs in topological order. No state files or approval records were edited by hand, and no gates were disabled.
- The local test extends the minimal bundle with all four character images, three settings and three voice references. Before reusing the user's existing storyboard/reference approvals, every current preview was SHA-256-compared against an original approved preview. No new creative approval was inferred.
- Core project.run stopped at reference review before those approvals; it still stopped after storyboard approval alone. After reference approval, it ran the new mixer and lossless master composition through the actual MCP server.
- Resuming the completed project through MCP kept the selected mixer/master version IDs and output bytes unchanged and stopped at rough-cut review again.
- The run ended at `review:rough-cut`. `review.read` reported the new mixed master as unreviewed. Reviews remained enabled.
- Independent media verification checks full decoding, the 60-second duration, an unchanged picture bitstream and exact equality between decoded master PCM and the mixer's WAV. The runner's real-film check recorded no clipping and minimum spoken-interval dialogue-over-bed margin of 27.08 dB.

These are finishing-stage acceptance results, not a new brief-to-film generation test, automatic visual/lip-sync evaluation or packaged-app acceptance. The new master is a technical derivative, not an approved replacement of the user's film. Project, logs, test harness and media remain local.
