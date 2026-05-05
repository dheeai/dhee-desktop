# Reviewed-Approval Seam (Pause-and-Review)

## Problem

The dependency-graph executor runs end-to-end. There is no built-in
path to:

1. Pause at a stage (screenplay, character images, scene prompts,
   shot videos, final assembly).
2. Show the user the output with structured review criteria.
3. Optionally run an LLM self-review pass.
4. Either approve, regenerate with feedback, or override and continue.

Power users want this seam (so they can intervene before GPU is burned
on downstream artifacts). Today they have to use kshana-ink CLI scripts
(`pnpm run-to <stage>`, `pnpm regen`, `pnpm override`) — i.e. they have
to drop out of the desktop entirely to get the review path the desktop
should provide natively.

`ShotRegenerateModal` exists and is reactive — you watch a shot
finish, then redo. That's not the same as gating before generation.

## Evidence

- `kshana-ink/todos/approval-gates.md` — the upstream feature spec.
  Defines `ReviewCriterion`, `ReviewConfig`, per-artifact criteria for
  character / setting / screenplay / shot / final-assembly. Unbuilt.
- `kshana-ink/src/core/planner/types.ts:425` — `onApprovalNeeded`
  callback declared but **dead** (zero implementations). Already
  marked `@deprecated DELETE` in the cleanup todo. The new approval-
  gates feature will introduce its own callback shape, not revive
  this one.
- `src/renderer/components/preview/TimelinePanel/ShotRegenerateModal.tsx` —
  the closest existing modal pattern. Reuse the visual language.
- `kshana-ink/src/server/agentRoutes.ts` — REST endpoints for
  `run-to`, `regen`, `override`. The CLI uses these; the desktop
  could too.

## Done means

- Project Settings gains "Review Mode": [Off / Light / Full].
  - Off: today's behavior, runs end-to-end.
  - Light: pauses at major stages (screenplay, references, final
    assembly).
  - Full: pauses at every artifact type with a review modal.
- A new `ReviewModal` component built off `ShotRegenerateModal`'s
  pattern, showing:
  - The artifact (text / image / video).
  - The review criteria as a checklist with `must-pass` / `should-pass`
    / `nice-to-have` priorities.
  - Optional LLM self-review results pre-filled (if enabled).
  - Buttons: Approve, Regenerate (with feedback box), Override
    (pick a file or paste content).
- Wired through to kshana-ink's `run-to` / `regen` / `override`
  endpoints — desktop is a UI on top of the existing CLI surface.
- The criteria themselves come from the template's `reviewConfig`
  (per the upstream spec) — desktop renders, doesn't define.

## Dependency

This is **blocked** on `kshana-ink/todos/approval-gates.md`:
- `ArtifactTypeDefinition.reviewConfig` field added to template types.
- Each template (narrative / documentary / short / infomercial /
  graphic-novel) defines its review criteria.
- ExecutorAgent integration (the new `onApprovalNeeded` flow with
  criteria + self-review).

Coordinate with the kshana-ink team. Desktop work begins once the
engine surface lands.

## Out of scope

- Multi-user review (covered by `collaboration-and-sharing.md`).
- Review threading / comments — defer.
- LLM self-review prompt tuning — that's an evals task on the engine
  side.

## Effort

Medium — ~2 weeks of desktop work after the engine surface ships.
Most of the cost is the criteria-rendering UX and the
regenerate-with-feedback flow.
