# Reuse map

Guide IDs below are relative to Core's `prompts/skills/` (without `.md`). Read them with the bundled resolver. These are stage inputs, not evidence of generation quality. The generation runner currently loads each bundle's configured prompt template; reading a guide here does not automatically inject it into that template.

| Work | Existing Core guides |
| --- | --- |
| Brief, research and script | `research-synthesis`, `content-writing`, `defaults/plot_guide`, `defaults/screenplay_guide`, `narration-scripting` |
| Visual style and identities | `defaults/world_style_guide`, `defaults/character_image_guide`, `defaults/setting_image_guide` |
| Storyboard and scene staging | `defaults/scene_guide`, `defaults/scene_breakdown_plan_guide`, `defaults/scene_breakdown_shot_guide`, `defaults/scene_breakdown_guide` |
| Shot composition and references | `image-prompting`, `defaults/shot_composition_guide`, `defaults/shot_image_prompt_guide`, `defaults/shot_image_refs_extraction_guide`, `defaults/scene_image_guide`, `defaults/shot_mode_decision_guide` |
| Motion and video | `video-direction`, `defaults/motion_directive_guide`, `defaults/scene_video_guide` |
| Review and revision | `defaults/vlm_image_judge`, `edit-and-regen-shot`, `regen-ref-image-from-edited-prompt`, `resize-shot-duration` |
| Model/workflow specifics | `comfyui-workflow-integration`; use `content-type/*` only when the actual selected model matches |
| Bundle or runner implementation | `authoring/bundle-authoring`, `authoring/runner-authoring`, `authoring/test-loop`; read Desktop's own test-loop for UI work |
| Older interfaces / architecture reference | `authoring/dhee` (CLI), `agent/dhee` (embedded agent) |

## Adapt older instructions

- The CLI skill's `--only shot_image` selects a node, not one shot. Never use that example as evidence of exact item selection. Inspect actual target/item IDs; use the selected GPU/assembly operations where applicable.
- The embedded agent's `dhee_*` names, identity, limited tool access and chat-question UI belong to that host. Codex keeps its own identity and tool interface. Use current MCP schemas; no assumed one-to-one translation.
- Follow current bundle discovery settings, not hard-coded home folders in older examples. Respect the user's selected project directory and current `DHEE_USER_BUNDLES_DIR`.
- Preserve the approved narrative action even when a composition guide recommends another framing or pose. Propose material creative changes for approval.
- Model-specific guides describe particular models; verify the workflow catalog before using them with the RTX queue. Their presence does not prove the GPU has the models or workflows installed.
- `vlm_image_judge` is guidance, not an active visual evaluator. Only claim automatic visual checks when a real evaluator ran and produced evidence.
