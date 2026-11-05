# Gated soundtrack finishing through Core MCP

This developer example finishes existing picture and dialogue with a selected music/effects bed. It uses Desktop's `audio.mix_soundtrack`, Core's walker/MCP/review records, and Desktop's `ffmpeg.replace_audio` for a PCM MOV master. It does not generate music, clips or references, and does not grant approvals.

Copy this directory into the existing user bundle root configured for Core MCP (`DHEE_USER_BUNDLES_DIR`). Preserve other installed bundles. Build Core and Desktop's production extension and use the existing Core MCP registration with that extension loaded. Discover `soundtrack-finishing` with `bundle.list` / `bundle.describe`. This example is checked into Desktop; it is not automatically installed or packaged.

## Inputs and order

Required creation inputs are `story` (Markdown), `picture` (MP4), `dialogue` (PCM16 WAV), `bed` (PCM16 WAV), and `mix_plan` (JSON). Use hashed `localFile` payloads for media, never path strings. Core MCP intake permits at most 64 MiB per local file and 128 MiB total creation imports; these intake limits are stricter than the mixer runner limits. The full-timeline dialogue establishes the mix duration; picture must cover it. The final MOV retains the picture duration and pads audio if the picture is longer. Match durations when requiring exact master/mixer PCM equality. Dialogue and bed must have matching sample rate/channels. See the production-extension README for mix-plan fields, limits and measured-check semantics.

The dependent inputs `scenes_plan`, `character_image`, `setting_image` and `voice_reference` are intentionally not required at creation. **Do not bulk-import these dependent inputs with project.create.** Core's creation import currently does not record their upstream dependency history. Missing lineage makes review gates unavailable; it is not a reason to disable them.

Use this sequence through `dhee_production_control`:

1. `project.create` with the five root inputs in a new directory. Reviews remain enabled.
2. `input.preview` for `scenes_plan`, using the selected JSON/text or hashed file. Inspect the impact and apply the authorized source with `input.write`, its returned `expectedFingerprint` and `humanAcknowledged:true`. This binds the plan to the current story.
3. `review.read` for `storyboard`. Present its previews; record the user's actual decision through `review.decide` with that fingerprint.
4. For each of `character_image`, `setting_image` and `voice_reference`, preview/write the exact chosen source as above. These operations bind each reference to the current story and plan. They do not generate or approve it.
5. `review.read` for `references`, present the selected images/audio, and record the actual user decision. A technical check or a previous project's status alone is not approval. In a repeat technical test, prior approval may be reused only with supporting user authorization and exact matching approved preview bytes.
6. `project.run` with `stopAt:"final_video"`. The walker invokes `audio.mix_soundtrack`, then `ffmpeg.replace_audio`. The result is `mixed.wav` and a lossless `final.mov`, with recorded dependencies and technical metadata. Check the returned pause/result rather than interpreting a successful MCP response as final delivery.
7. Run media checks and read the `rough-cut` review. Present the new mixed cut. It remains unreviewed until the user approves it. A prior dialogue-only approval does not approve this changed soundtrack.

Example write request (use the actual preview fingerprint, paths and SHA-256):

```json
{
  "request": {
    "action": "input.write",
    "projectDir": "/absolute/new-project",
    "inputId": "voice_reference",
    "payload": {
      "kind": "localFile",
      "sourcePath": "/absolute/chosen-voice.wav",
      "expectedSha256": "<current source SHA-256>"
    },
    "expectedFingerprint": "<input.preview fingerprint>",
    "humanAcknowledged": true,
    "reason": "Import the selected voice reference under the current approved story."
  }
}
```

The source stages declare `gpu.queue` to fit the existing imported-source convention, but no GPU run is part of this workflow. Supply the declared sources; do not ask generation to fill missing inputs. Use a fresh project or the supported version/update flow for revisions—never remove outputs to evade no-clobber protection.

## Multiple characters and settings

The minimal example has one image, setting and voice review stage. For more references, add declared file inputs and stage nodes, and connect them as context dependencies of the appropriate review stage. Bind them in topological order with input.preview/write before binding that parent. This makes all additional reference bytes part of the reference review lineage. The local 60-second acceptance exercised four character images, three settings and three voice references this way; the film and assets are not included.

See `docs/research/2026-11-04-gated-soundtrack-verification.md` for the real MCP acceptance evidence and limits.
