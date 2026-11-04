# Scene-image linking in the existing editor

Continue the approved Desktop UX plan without replacing the app shell. Add explicit scene-image choices inside Edit storyboard and references for JSON scene plans. Reuse Core input.preview/input.write and existing saved review lineage; do not add another MCP or edit completion/approval files.

1. Add a SceneImageLinkEditor component. Parse only a nonempty object-array scenes document. Discover direct upstream image stages from the selected bundle node; read current artifacts through productionEditing. Offer only successfully read image references, with thumbnails and unavailable-state feedback. Never infer links, expose arbitrary paths from JSON, or discard unknown fields. Show a clear no-image-input explanation for unsupported bundles. Cancel stale asynchronous reads when project/node changes.
2. Embed in ProductionEditingPanel beside the text editor. Scene selections update only imagePreviewKey and clear pending change previews. All writes still require Preview change then Save this change; source text remains editable.
3. Tests first: field preservation, unlink, missing/unavailable links, no inferred default, upstream-only choices, stale async response, integration preview invalidation and exact save payload. Run focused tests/types/lint, then full Desktop tests and renderer build. Verify unlink/relink in the real isolated Brilliant Care project, no creative approval/generation. Update tracker. Keep local.

Scope: direct upstream stage images only, matching supported stage-input editing. Bundle authoring/import and collection/branched editing remain separate. Image choice alone does not approve its contents. Core captures current reference lineage during the change preview/save; final creative review uses frozen snapshots.

## Local result

Implemented and verified all three steps. The new integration test failed for the missing image selector before implementation, then passed. Nine focused editor tests cover preservation, unlink, unavailable refs, no implicit choices, stale async response, malformed JSON and preview/save invalidation. Full Desktop: 197 suites / 1,686 tests pass. TypeScript and renderer build pass; new component/tests lint clean, existing parent lint debt reduced 18→16 with no added rule counts.

Actual Electron verification using the fresh real Brilliant Care project: unlink Scene 01, preview leaves file unchanged, save changes only imagePreviewKey, relink/save restores scene JSON, review refreshes all three images. Source image hashes unchanged; no review approval or generation. Screenshot and verification JSON saved in outputs. No Core change for this increment. Local/uncommitted, no push.

## Follow-up: reach image-file editing from the scene

Add an explicit Replace image for scene N action and an image-files disclosure for declared editable upstream images (including missing images). Route to the existing material editor, retaining a Back to storyboard action. Disable navigation while storyboard text/links are unsaved so it cannot discard the draft. Reuse the existing picker/preview/save; no automatic writes or approval changes. Verify navigation uses the input ID, not a guessed node ID; test dirty-draft guard and return path, then actual Electron navigation with real images.

Follow-up verified locally: scene shortcut resolves the actual editable input ID, supports returning to storyboard and blocks navigation while the draft is changed. The new regression failed when the route was absent, then passed. 197 suites / 1,687 Desktop tests pass; typecheck, new component lint and renderer build pass. Actual Electron navigation check passed on the real illustrated project; source plan hash unchanged, no replacement chosen or write/approval executed. Existing file import/save is reused; this verification covers the new navigation, not a new import engine.

## Follow-up: readable scene text editing

Add narration and action textareas to each scene alongside its image. Update only the edited field while preserving image links, timing, IDs, extra fields and other scenes. For legacy picture-only scenes edit picture in place; do not silently create a competing action field. Non-string structured values stay in the source editor. Keep all edits draft-only, invalidate previous change previews, and use the same Core save operation. Verify field preservation, legacy fallback, structured values and explicit preview/save. No timing or voice generation changes.

Scene-text follow-up verified: 3 new regressions failed before implementation, then passed. Narration/action fields preserve all untouched content, legacy picture updates in place, structured data remains source-only. 13 focused tests and full 197 suites / 1,690 tests pass; typecheck, new component lint and renderer build pass. Actual Electron whitespace-only edit/preview/save/restore verified no write on preview, invalidation of a prior preview after another edit, preservation of all references/timing/other scenes, original text restored and unreviewed gate retained. Local only, no Core change.
