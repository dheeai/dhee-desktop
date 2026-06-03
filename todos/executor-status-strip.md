# Executor Status Strip — Live DAG Visualization

## Problem

When the executor runs, the desktop app shows progress only as scrolling text in
the chat panel (`stream_chunk` events) and a binary "is the runner active?"
indicator polled every 1.5s. There is no glanceable surface showing which
specific shot is being worked on right now, which scenes are queued, which are
done, or how far along the run is.

This matters for two reasons:

1. **First impressions.** A new user opening dhee for the first time should
   immediately see the agent doing work — scenes appearing, shots filling in,
   thumbnails landing — without having to read chat text. That visceral
   demonstration is the entire "Cursor for filmmaking" pitch in visual form,
   and it is what differentiates dhee from canvas-first manual tools like
   Flick.art. Today the agent's work is invisible until artifacts hit disk and
   the file watcher picks them up.
2. **Active-user orientation.** Existing users have to scroll chat to learn
   "what is the executor doing right now?" The Prompts tab and Timeline both
   update *after* a node completes (via file watcher), but there is no signal
   that node X is currently mid-flight.

The fix is **a thin status strip above the Timeline** that renders the
executor DAG as scene-rows × shot-tiles, with each tile pulsing while its
node runs and a thumbnail landing when the artifact completes. The strip is
read-only (a status surface, not a third editor); clicking a tile scrolls the
Timeline + opens the matching Prompts card.

## Evidence

- `src/renderer/components/preview/PromptsView/PromptsView.tsx` — per-shot
  inspector, file-watched, editable. Updates after artifacts land but has no
  "node is running now" signal.
- `src/renderer/components/preview/TimelinePanel/TimelinePanel.tsx` — full
  editor with shot segments, audio waveforms, version selector, regenerate
  modal. Same gap: no live per-node status.
- `src/renderer/components/chat/ChatPanelEmbedded/ChatPanelEmbedded.tsx` —
  consumes `stream_chunk` events as `role='progress'` chat messages. Human-
  readable text, not machine-bindable to specific tiles.
- `src/renderer/components/layout/WorkspaceLayout/WorkspaceLayout.tsx:45-71` —
  polls `window.dhee.runnerStatus()` every 1500ms; returns `{ active: boolean }`
  only. No per-node phase information.
- `src/core/planner/ExecutorAgent.ts` (in kshana-core) — emits `stream_chunk`
  lines like `[2/5] Working on shot 2...`; does not emit structured per-node
  state transitions.
- Mockup: `todos/mockups/executor-status-strip.html` — open in any browser,
  press `R` to replay the simulated run. Shows the planning row (story →
  story_essence → scene_plan → characters → settings → world_style →
  character_image → setting_image), the per-scene tile grid, the live agent
  status line in the title bar, and the four tile states (pending / prompt /
  image-running / video-running / done) with thumbnail fade-in.

## Done means

- A new `<ExecutorStatusStrip>` component mounted between the Timeline tabs
  and the Timeline canvas (not a fourth tab — strip is always visible,
  collapses to ~28px when idle).
- The strip shows:
  - **Planning row**: pills for the front-loaded planner nodes (`story`,
    `story_essence`, `scene_plan`, `characters`, `settings`, `world_style`,
    `character_image`, `setting_image`). Pills are gray → yellow-pulsing →
    muted-green as each node moves from pending → running → done. Once all
    planning is complete, the row optionally collapses to a single
    `Planning ✓` pill to save vertical space on regenerations.
  - **Scene rows**: one row per scene. Each row is `[scene label] [tile-strip]
    [duration]`. Tiles are compact (~38×26px), one per shot, showing shot
    number badge, phase badge (`txt` / `img` / `vid` / `✓` / `!`), and a
    thumbnail that fades in once the shot's first frame artifact lands.
  - **Counter + ETA** at top-right (`7 of 18 shots complete · ETA 4m 12s`).
  - **Live agent line** in the title bar mirroring the current node
    (e.g. `shot_video · scene 1 · shot 4`).
- Clicking a tile scrolls Timeline to that shot AND focuses the Prompts tab's
  card for that shot. One click, two surfaces synchronized.
- Failed tiles render with a red border + `!` badge; click → Prompts tab shows
  the error trace and a re-run button.
- The strip stays consistent across:
  - Initial full project runs (planning + all scenes filling in).
  - Targeted re-runs (only the affected scene/shot tiles transition; rest
    stay green).
  - Resumed runs (load existing executor state from `project.json`; render
    each node at its persisted phase).

## Required core-side change

A new structured event channel from `kshana-core`'s `ExecutorAgent` to
`dhee-desktop`'s main process, emitted *alongside* the existing
`stream_chunk` text. Proposed shape:

```ts
type ExecutorNodeEvent = {
  type: 'executor:node-state';
  nodeId: string;              // e.g. "shot_image:scene_1:shot_4"
  nodeKind: string;            // e.g. "shot_image" | "shot_video" | "story_essence"
  scope: { sceneNumber?: number; shotNumber?: number };
  phase: 'pending' | 'running' | 'completed' | 'failed';
  artifactPath?: string;       // populated on completed; renderer uses it to display thumbnail
  error?: { message: string; recoverable: boolean };
  timestamp: number;
};
```

This is emitted at:
- Node entry (phase = running)
- Node exit success (phase = completed, artifactPath if applicable)
- Node exit failure (phase = failed, error attached)

Carried over the same IPC bridge as `stream_chunk`. Renderer subscribes via
`window.dhee.onExecutorEvent(cb)` (new preload binding).

## Done means (acceptance)

- `npm test` passes.
- Playing a full project run shows the strip animating in real time — pills
  light up during planning, tiles pulse through phases, thumbnails appear,
  counter updates.
- Clicking any tile scrolls Timeline + opens its Prompts card.
- Closing and re-opening a project mid-run reloads the strip with the
  correct per-node phases from persisted `executorState`.
- Failed nodes show red; recovering from failure clears the red.
- Strip respects light/dark theme (mockup is dark-only).

## Out of scope

- Not a full DAG node-and-edge graph editor. Edges (dependencies between
  nodes) are not visualized in the strip. The DAG is implied by scene-row
  grouping + tile ordering; users who want the raw graph open the Prompts
  card's "Why this shot?" reasoning panel.
- Not user-editable on the strip itself. All editing happens in the Prompts
  tab as today. Strip is read-only status.
- Not a fourth tab. Adding tabs fragments the UX; the strip lives as chrome
  above the existing Timeline.
- Marketing-mode "watch it build" full-screen overlay for first-run onboarding
  is a follow-up; not part of this todo.

## When to build

Defer until ~4-6 weeks before the public push, then build alongside the
landing-page launch so the strip animation is the headline visual in the
demo video. Building it cold now decorates the desktop app for the existing
user base only; building it bundled with the push gives it the audience it
needs to matter.

Predecessor: the `executor:node-state` IPC event in kshana-core. That core
change can land independently and is also useful for telemetry/logging — so
ship the core event ahead of the renderer work if convenient.

## References

- Mockup: `todos/mockups/executor-status-strip.html` (animated, single-file,
  press `R` to replay the simulated run).
- Conversation thread documenting the design discussion (dhee vs Flick.art
  positioning, why the canvas matters, what's already built in Prompts +
  Timeline) — see chat history dated 2026-05-25.
