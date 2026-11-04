# Codex-driven 15-second workflow verification

Branch: `feat/rtx-5090-queue` in Dhee Desktop and Dhee Core.

A real three-scene film, **The Second Life of a Bottle**, was generated from a brief using RTX 5090 workflows and assembled into a 15.000-second, 1280×720, 24-fps video. The user approved the script/storyboard, references/revised voice, and final cut. Core MCP recorded the approvals and drove production operations; Desktop provided review, editing, redo, and playback.

## Verified

- Generated visual references, narration, and three five-second clips.
- Corrected inconsistent images and recovered a completed GPU job after a local timeout without duplicating generation.
- Split the approved narration at pauses with sample-exact preservation, then placed the sentences across the scenes.
- Automatic duration, decoding, shot-order, voice-preservation, and transcript checks passed.
- Actual Desktop playback was verified, and final approval was recorded against the selected cut.

Final video SHA-256: `c2fd353654ae93ddc7725375d224af18c5bcc5db6b986cb7562aa135522eceed`.

## Scope and remaining work

This was Codex-driven execution with three human creative approvals. Task-specific orchestration and audio-splitting scripts were still needed. Codex supplied visual judgment and corrections; the semantic vision endpoint remains unconfigured. The new optional visual-review integration reports absent or uncertain evidence as unchecked, never as a semantic pass.

Next: make recovery and voice segmentation reusable Desktop operations, configure semantic vision review, and extend acceptance beyond this short film. This test does not establish unattended full-film production or packaged cross-platform acceptance.

Core's full test suite has three known failures requiring an external `illustrated_story_animated` bundle. That fixture is not supplied by these branches; do not substitute synthetic data and call those acceptance tests verified.
