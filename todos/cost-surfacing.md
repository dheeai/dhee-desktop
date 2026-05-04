# Per-Action Cost Surfacing

## Problem

`kshana-ink`'s `LLMLogger` tracks tokens and cost per call. The desktop's
`AccountTab` shows total cloud balance. Per-shot, per-regenerate, and
per-project cost is not surfaced anywhere visible during the action.
Users learn the cost of regenerating shot 7 by watching their balance
drop, then deciding not to regenerate shot 8.

This is the difference between "thoughtful regeneration" and "anxious
regeneration." Users who can see "this redo will cost ~$0.40" make
better decisions; users who can't, regenerate too little.

## Evidence

- `kshana-ink/src/core/llm/LLMLogger.ts` — already tracks token+cost.
- `src/renderer/components/SettingsPanel/AccountTab.tsx` — surfaces
  total balance only.
- `src/renderer/components/preview/TimelinePanel/ShotRegenerateModal.tsx` —
  the regenerate confirmation dialog. No cost line.
- `src/renderer/components/chat/ToolCallCard` — tool call cards show
  the workflow name and progress bar (per kshana-ink feature list).
  No cost.

## Done means

- Each tool-call card in the chat shows running cost as the tool
  streams: `Generating shot 3 video — $0.12 / ~$0.40 estimated`.
- `ShotRegenerateModal` shows pre-action cost estimate, with breakdown
  (LLM tokens, image gen, video gen) and confirm copy that includes
  the cost.
- Project-level cost summary in the header or sidebar:
  `This project: $4.20` updating live.
- Final assembly produces a cost line in the project metadata JSON for
  later analysis.
- Settings → Account shows last 30 days of project costs as a list
  (works in local mode too — local API costs still happen for Gemini /
  OpenAI / xAI usage).

## Out of scope

- Billing / invoicing UI (cloud mode concern).
- Cost prediction for *full* projects before they start running
  (requires a planner-side estimate; can ship later).

## Effort

Medium — ~2 weeks. The plumbing exists in core; the desktop work is
threading per-call cost through the tool-call event stream and into
the cards / modal / header.

Coordinate with kshana-ink team on the event shape: `LLMLogger` is the
source of truth, but the ConversationManager event bus needs to forward
per-call cost so the renderer can show it without polling.
