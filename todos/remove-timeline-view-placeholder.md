# Remove `TimelineView` Placeholder

## Problem

`src/renderer/components/preview/TimelineView/TimelineView.tsx` literally
renders "Timeline coming soon — This feature is under development." A user who
clicks the wrong tab sees a disabled feature on first run, which signals
"this product is unfinished" — even though the *real* timeline editor
(`TimelinePanel`) is fully functional.

## Evidence

- `src/renderer/components/preview/TimelineView/TimelineView.tsx` — current
  body is a `<Clock>` icon + "Timeline coming soon" + "This feature is
  under development".
- `src/renderer/components/preview/TimelinePanel/TimelinePanel.tsx` — the
  real timeline editor: zoom, play/pause, audio import, scene action
  popover, shot regenerate modal, drag-resize, version selector. ~1000+
  lines of working UI.
- The placeholder is wired into the preview tab system somewhere
  (verify before deleting — find the import sites).

## Done means

- `TimelineView/` directory deleted, OR redirected to render
  `<TimelinePanel />` directly.
- All import sites of `TimelineView` either removed or updated.
- No tab in `PreviewPanel` renders the "coming soon" placeholder.
- E2E test that opens each preview tab passes without seeing
  "coming soon" text.

## Out of scope

- Adding new features to the real `TimelinePanel`. This is a deletion task.

## Effort

Small — half a day at most. Mostly find-and-delete.
