## 3 November update: saved technical checks

Core MCP now has 26 production actions, including media.read. Desktop and Codex can load the latest saved technical report and detect changed selections, file bytes or expectations. Real Brilliant Care single-scene persistence and native Desktop reads verified locally. Final-delivery readiness and three-scene/full-film acceptance remain pending. All current changes remain local.

## Desktop material editor — local, 3 November 2026

Added an editor to Production View for bundle-declared stage inputs: script/storyboard text, voice/image replacement selection with hash, saved-version inspection and restore. Desktop invokes the existing Core controller through a restricted IPC adapter; Codex continues to use Core MCP for the same engine operations. No separate Desktop MCP or generation implementation was added. The preview lists affected stages; saving requires an explicit click, preserves previous files and leaves creative approvals separate. Editing the draft clears its preview. Replacement and historical previews are separate, and restore confirmation identifies the selected file. Successful local UI edits refresh idle stage/review projections.

Native Electron verification used an isolated profile and copies of actual Brilliant Care materials. Voice history was inspected and restored through the real renderer/preload/main/Core path; hashes proved restored bytes and previous-current preservation. A real script was edited through preview/save; old script preserved, baseline unchanged, and Character Image immediately became 0/1 after dependent invalidation. Native evidence: Brilliant-Care-Scene01-Test/Desktop-Editing-Verification.json and Desktop-Editing-Text-Verification.json; screenshots Desktop-Editing-Preview.png and Desktop-Editing-Text.png. The native file chooser itself has adapter/hash tests; fresh-file selection through the OS dialog was not exercised end to end. No generation or new creative approval.

Validation: 52 focused Desktop tests pass across editor, idle refresh, IPC, preload and production view. Full production build and final renderer build pass. Desktop typecheck retains two existing test-import extension errors (applyEnvFromSettings.comfyEndpoint.test.ts and pathResolver.test.ts); no new editor diagnostics. The legacy bridge test needed its settings dependency mocked to isolate Electron-store initialization. Review found mixed replacement/history preview state; a regression failed first and passed after separating previews. This increment changes Desktop only; all prior Core/skill work remains local and unpushed.

Scope remains declared stage inputs on unbranched projects with valid lineage. Collections, generic shot editing/version switching, live idle refresh after external Codex writes, packaged/cross-platform acceptance, persisted final-quality results, the three-scene benchmark and full-film verification remain pending. Next planned feature: persisted final-quality results tied to exact media versions, followed by the multi-scene workflow test. No commit, push or PR.

## Artifact inspection and version restore — local, 3 November 2026

Added version.list, artifact.read, version.restorePreview and version.restore to Core MCP (25 actions). Codex can inspect completion/preserved-file entries, current hashes and paths, read small text, and get media paths without embedding binary data. Historical IDs with paths reused by any later node/item/branch are unavailable. Missing, unsafe and ambiguous candidates are rejected or clearly marked.

Decision: restore preserved bytes as a NEW current version under current upstream context, using the reviewed input-update contract. The existing generic picker only changes the selected ID and does not invalidate dependents; it is not exposed as production-safe selection. Restore requires an exact fingerprint and acknowledged change, preserves current bytes, invalidates dependents and does not reinstate creative approval or render. Limited to declared stage inputs; branches, relevant collections and incomplete lineage remain unsupported. Generic shot/version switching still needs its own safe contract.

Verification: restored the approved Brilliant Care voice in an isolated project copy through compiled Core MCP, matched its original SHA-256, preserved the prior current voice as another version, and left the baseline untouched. Evidence: Brilliant-Care-Scene01-Test/Version-Restore-Verification.json. 62 focused Core tests, nine MCP tests and four guide-resolver tests pass; Core build and new-adapter lint pass. Full typecheck retains 57 existing diagnostics, none in the new input/version adapters. Review found a cross-node/branch path-reuse issue; regression tests first failed and then passed after comparing against all later artifact events. No video generation or full-film acceptance claim.

Desktop Codex skill, integration audit and controller documentation updated. All changes remain local; no commit, push or PR. Next: Desktop storyboard/reference editing UX using these shared operations, with generic shot editing/selection, persisted quality results and the three-scene benchmark still pending.

## Voice/reference replacement — local, 3 November 2026

Extended Core MCP input.preview/input.write to declared reference stages with complete upstream stage history. Previews expose current upstream versions and hashes; writes retain dependencies so reference reviews can resolve. Existing audio is preserved as a version, affected approvals become stale, and unrelated storyboard approval stays valid. The adapter blocks incomplete upstream history and partial downstream cascades rather than silently retaining stale clips. Relevant collections and branched projects remain unsupported.

Verified through the compiled Core MCP using real Brilliant Care audio and original dependency history in an isolated project copy. The fixture declares the voice under inputs/voice.wav; swapping to an earlier real audition preserved the previous approved bytes and storyboard/images, invalidated scene_clip/narrated_clip/final_video (all declare voice dependencies), and left the original project untouched. No generation or new creative approval occurred. Evidence: Brilliant-Care-Scene01-Test/Reference-Replacement-Verification.json. This supersedes the source-only restriction in earlier checkpoints.

Validation: 56 focused Core tests pass; Core build and adapter lint pass. Nine MCP transport tests passed earlier in this increment. Full typecheck still reports existing errors outside the new adapter; broader shared-writer lint reports existing unnecessary assertions, and test-file lint is excluded by project configuration. No full-film or installed-app acceptance claim. Changes remain local and unpushed. Next feature: artifact/version inspection and selection through Core MCP, then Desktop editing UX, persisted quality-check results and the three-scene benchmark.

## Source-input updates — local, 3 November 2026

Added input.preview/input.write to Core MCP (21 actions). Uses a current-state fingerprint, explicit change acknowledgment and the shared project lock. Reuses Core version preservation/cascade code; fixes main dependency calculation being contaminated by other-branch completions. New API rejects all branched projects and derived-stage inputs because shared legacy editing needs additional branch-state/lineage support. Only declared file inputs mapped to one source stage under inputs/ or plans/ are supported. Tests prove stale preview rejection, lock exclusion, prior-file preservation, dependency invalidation, affected approval staleness and unrelated approval retention.

Final isolated real MCP acceptance used the actual Brilliant Care brief versions in a copy of the imported-input test project. Old brief and dependent image bytes were preserved as versions; originals unchanged; no rendering or new creative approval. Evidence: Brilliant-Care-Scene01-Test/Source-Input-Update-Verification.json. The earlier broader voice-update experiment is superseded by these source-only restrictions and is not acceptance for derived voice edits. 54 focused Core tests and nine MCP tests pass, with Core build and targeted lint. Local and unpushed; next work is safe dependency lineage for derived/reference replacement, then shot/version controls and the three-shot benchmark.

## Binary reference intake — local follow-up

Core project.create now accepts localFile payloads with absolute paths and expected SHA-256 for declared file inputs. Bounded snapshots preserve exact bytes through the shared initializer; file sources and writes are hash-verified. An isolated real MCP test imported the actual Brilliant Care voice_reference.wav and shot_image.png, matched both hashes, registered matching output nodes as completed and kept reviews required. Original media unchanged; no generation or new approval. Existing-project input replacement remains next. The necessary shared Core additions and Desktop skill/audit updates remain local and unpushed.

## Intake follow-up — local

Added shared Core MCP actions `bundle.list`, `bundle.describe`, and `project.create` (19 total). Creation reuses Desktop's initializer, accepts initial text inputs into a new folder only, defaults to a $5 cap and enables reviews without running. Existing-project input replacement, binary reference import, shot editing and version selection remain missing. Real MCP acceptance used the existing Brilliant Care Scene 01 brief and preserved its exact text in a separate new project; no media was generated. This supersedes the earlier 16-action intake finding below. These necessary Core interface additions and the Desktop guidance/audit work are local, uncommitted and unpushed.

# Core reuse and integration audit — 2 November 2026

This checkpoint supplements the existing production plan; it does not replace it. Desktop is the primary workspace. Core remains the shared engine/MCP. The audit found reusable guidance and capabilities that must be connected explicitly before claiming a complete Codex-driven film workflow.

## Implemented locally

- Desktop-owned `.agents/skills/dhee-production` maps workflow stages to existing Core guidance and current production MCP actions. No creative guide content is duplicated or rewritten.
- The guide resolver reads the companion Core, honors `dhee_CORE_PATH` / `dhee_INK_PATH`, inventories file hashes, and also supports an explicitly located installed package. Repository-only authoring skills are unavailable in a published package and are reported by absence rather than invented.
- `npm run audit:core-integration` runs a read-only Core MCP handshake/schema discovery and inventories guidance and built resources. It outputs JSON; redirect it to save a dated checkpoint. A successful exit means the audit ran, not that all capabilities or a full film passed.
- Local Codex registration is a symlink to the Desktop skill. The skill is now present in this session’s supplied skill catalog; a fresh production-task selection benchmark remains pending. Manual invocation of its resolver is verified. This integration is for Codex, not new prompt injection into Desktop's embedded agent.

## Findings and next work

| Priority | Evidence | Implication / next step |
| --- | --- | --- |
| P0 | Live production MCP exposes 16 actions. Core's embedded agent has separate tools for creating projects, listing/describing bundles, writing inputs, critiquing shots, replacing references and selecting versions. | Codex cannot perform those operations through the current production MCP alone. Design explicit shared operations for required intake/editing features, reusing existing Core implementations; do not create another engine or fake tool names. |
| P0 | 31 creative guides, four repository skills and one embedded agent skill exist. The new resolver reads all 36 unchanged. | Codex guidance is now accessible locally. Verify a fresh session selects it for actual production tasks. |
| P0 | The LLM runner reads each node's bundle `promptTemplate`. Core MCP exposes a production tool, not a guide resource/prompt catalog. | Guides being present or read by Codex does not prove they reach each generation prompt. Map and verify the selected three-shot bundle's rendered prompts, including scene action, references and voice ownership. |
| P1 | Built Core contains two curated bundles and an embedded agent skill matching source. The package declares `prompts`; it does not declare `.claude` authoring skills. | Development skills require a Core checkout. Curated bundles are intentional, not proof every catalog example ships. Validate actual selected bundle/runners in the installed app. |
| P1 | Desktop's existing `verify-dhee-core.ts` checks the main built entry and writes revision metadata. | That guard alone does not prove production control/MCP exports, skill files, runners or native dependencies work. New audit checks MCP/guidance; actual packaged-app acceptance is still needed. |
| P1 | Technical media checks and three creative gates have bounded scene evidence; current plan still lists persisted final-delivery readiness as unfinished. | Save version-bound quality results and block final-ready on stale/failed checks or missing approvals. |
| P1 | `scene.check` validates recorded observations; a VLM guide is a Markdown asset. | Neither establishes automatic visual understanding, correct dialogue or voice identity. Test actual evaluators if added and preserve explicit human review. |
| P1 | Only the small Brilliant Care scene has production acceptance. | Run the planned three-shot benchmark including intake, edits, gates, generation, preserved voice and final assembly. Full Brilliant Care/Shipyard films remain unverified. |

## Evidence and limits

Verification: skill format validator; four resolver behavior tests (live reads, installed-package layout, rejected unknown/traversal/root inputs, escaped authoring symlink); all 36 reads through the local Codex skill path matched source hashes; live Core MCP identity and 16-action discovery. Existing Core skill/session tests previously passed 16 cases. No new GPU work, paid generation, credential inspection or project writes were performed by the audit.

No app runtime or Core source changed in this increment. This is not an exhaustive certification of every repository feature. GPU/model availability, provider configuration, installed-app startup, native dependencies, concurrency/recovery under load, fresh-session skill selection and multi-scene artistic quality require their own acceptance checks.

Authoring follows Codex's progressive skill loading: https://learn.chatgpt.com/docs/build-skills. The adapter keeps source guides in Core and loads only stage-relevant material.

All new changes are local. No commit, push or PR for this increment.

Verification limitation: the full Core TypeScript check still reports 57 diagnostics in existing GPU/media/cloud-runner code (including two unchanged expressions in productionControl). No diagnostic names the new intake/input-update modules. Focused tests, build and targeted lint pass; this is not a clean full-typecheck claim.
