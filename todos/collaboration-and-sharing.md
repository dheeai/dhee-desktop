# Collaboration and Sharing

## Problem

The desktop has no surface for sharing, review, or collaboration. A user
who finishes a draft has no built-in way to send it to someone, get
comments, or co-edit. The 2026 default for any creative tool is
"share a link" — Frame.io, Canva, Descript all assume collaborative
review. Kshana cannot.

This is a gap that hurts for the agency / power-user audience the rest
of the product is positioned for. Indie creators care less, but agencies
will not adopt without a review path.

## Evidence

- `src/renderer/components/landing/LandingScreen` — projects are
  listed by local path. No shared/team project listing.
- `src/main/exporters/capcutGenerator.ts` — only export path is to
  CapCut; nothing for review.
- `src/main/services/chatExportService.ts` — exports the chat as JSON.
  No equivalent for "export the project as a viewable bundle."
- The project on disk is a `<name>.kshana/` directory of JSON +
  manifests + media. Portable in principle, but no zip / share / load
  flow exists.

## Done means

Three layers, can be shipped independently:

**Layer 1 — Shareable project export (no backend needed):**
- "Export project bundle" in the project menu produces a `.kshana.zip`
  containing the project directory + final video + a small static HTML
  viewer.
- Recipient unzips, opens `index.html`, sees the assembled video plus
  the storyboard. No editing on this side, no Kshana install required.

**Layer 2 — Read-only cloud share link** (depends on
`cloud-mode-evaluable-end-to-end.md`):
- Push project bundle to cloud storage, get back a URL.
- URL renders in any browser, with comment threads anchored to shots.

**Layer 3 — Real-time co-editing:**
- Multiple desktop users editing the same cloud-backed project.
- Operational-transform / CRDT story for `project.json`,
  `timeline.json`, manifest. Out of scope until layers 1 and 2 land.

## Out of scope

- Layer 3 — defer indefinitely.
- Mobile review app — defer.
- Per-shot threaded review with @-mentions — slot into Layer 2.

## Effort

Layer 1 alone: ~1 week.
Layer 2: depends on cloud mode (weeks-to-months).
Layer 3: months.

Ship Layer 1 first; it's high-value, no-cloud, and gives the agency
audience the review path they need.
