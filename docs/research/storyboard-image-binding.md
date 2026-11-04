# Illustrated storyboard review through Core MCP

Desktop scene cards resolve `imagePreviewKey` only against image snapshots returned by the current Core review. Arbitrary image paths in JSON are not loaded, and images are never matched by scene position or filename.

## Data contract

A scene can include `"imagePreviewKey": "frame_01"`. This must equal a unique review preview key: the exact Core node ID, or `nodeId:itemId` for a collection item. The current renderer supports one image per scene. Missing, ambiguous and broken images have explicit empty/error states.

To author a supplied-reference workflow, declare each frame as an image-output stage with an `inputs/` path. Its bundle input declaration uses `kind: "file"`, not `kind: "image"`. Import through `project.create` with a `localFile` payload containing the absolute source path and expected SHA-256. Declare these frame stages as inputs to `scenes_plan`.

Core follows recorded completion dependencies to create frozen review images and include their bytes/versions in the review fingerprint. A JSON key alone does not create provenance. The current initializer does not record dependencies among supplied stages: inspect `review.read`, then use the existing `input.preview` / acknowledged `input.write` workflow to record the plan under its exact imported frame versions. Never write completion events manually or silently alter an approved project. Changing an existing plan or reference requires reviewing downstream impact and affected approvals.

## Local verification on 3 November 2026

Created a fresh Brilliant Care illustrated review through local Core MCP using the corrected seated-doctor Scene 01 image and the original Scene 02/03 frames. Imported all three with SHA-256 verification; saved the unchanged scene text with explicit image keys and recorded dependencies through supported input operations. No generation or review decision ran.

Verified in the actual Electron Desktop with real preload/Core review calls: three images decoded, every displayed frozen image hash matched the intended source, originals stayed unchanged, review status remained unreviewed and approval stayed disabled without acknowledgement. The screenshot is an actual application view, not the earlier component harness.

This proves supplied-image storyboard review for that fresh project. It does not migrate existing approved projects, automatically choose images, generate images, or establish full-film acceptance. The original project still lacks the bindings. Desktop now provides a scene-image picker for direct upstream image stages in Edit storyboard and references. Automatic bundle authoring/import remains follow-up work; Codex can use the supported MCP path today.

## Desktop image picker

Open Edit storyboard and references, select the scene-plan material, then choose a reference under Image for scene N. The picker only offers successfully read direct upstream image stages; no filename/order matching. It shows thumbnails and unavailable-image feedback, preserves unknown scene fields, and leaves malformed JSON to the raw text editor. No image is selected automatically.

Choose Preview change, inspect affected stages, then Save this change. Changing a scene selection invalidates an earlier preview. Core retains old material versions and invalidates affected creative approvals. For an unconfigured bundle the editor explains that image inputs must first be added to its workflow; this UI does not modify the bundle or support collection/branched editing.

Local actual-app verification covered unlink → preview without writing → save → relink → preview/save → refreshed three-frame review. All narration/action data and original image hashes remained unchanged. The project stayed unreviewed. Full Desktop suite: 197 suites / 1,686 tests pass; TypeScript and renderer build pass. New component lint is clean; the existing parent editor has 16 pre-existing lint findings (18 at HEAD), no added rule counts.

## Image-file editing shortcuts

Each linked scene can open its exact declared image input through Replace image for scene N. Add or replace image files also lists editable upstream image inputs, including ones whose current artifact is missing. These controls navigate to the existing material editor; Choose replacement file, Preview change and Save this change retain their existing behavior. Back to storyboard returns to the originating scene plan. An unsaved storyboard draft blocks these shortcuts. If a replacement file was picked but not saved, the return action explicitly says it discards that replacement. No new file-import or rendering API was added.

## Scene text fields

Storyboard scenes now exposes Narration and Action textareas next to the image controls. Changes remain drafts until Preview change and Save this change. IDs, image links, timing, extra metadata and other scenes are preserved. A legacy picture field is edited in place; structured narration/action values stay in the source editor. The raw source editor remains available. No narration audio is generated or approved by editing text. Verified in the actual Electron project with original text restored after a whitespace-only test; current full suite is 1,690 passing Desktop tests.
