# Dhee Desktop: complete video production

Research and design proposal · 30 October 2026 · Draft for review

## Outcome and scope

Produce a complete Brilliant Care-style character film and a shipyard/MD1-style industrial film using only Dhee Desktop for creative decisions, generation, correction, editing, review, and export. Core remains the execution engine. Work is limited to `dhee-core` and `dhee-desktop`; existing external providers/packages may be consumed, but this project does not require editing other repositories.

The user confirmed three creative approval points: (1) script/storyboard, (2) character and voice references, (3) rough cut. Technical failures may stop work at any stage. Final export must use the approved cut and a passing delivery check. Changes, branches, and verification stay local; pushing or opening a PR requires the user's later instruction.

This is a researched design and milestone plan, not a claim that the application has been built or tested. Exact implementation tasks follow design approval and a local baseline run.

## Evidence and present state

Inspected GitHub master snapshots: core `75ec0b0c056a385eca41ce6fe7f0cbb239dcc5f6`; desktop `2cf8b7a648274295a0c222cc379db766fa5e85cd`. Source inspection establishes code presence, not production reliability. Previous local production reports are historical evidence, not proof that their defects still reproduce today.

| Capability | Evidence | Implication |
|---|---|---|
| DAG execution, cache, invalidation, event projections, versions | Core `src/dag/walker.ts`, event-log modules, README | Reuse the engine; no new orchestrator |
| Nonblocking run dispatch, stop, status, regenerate, reference replacement, version selection, budgets | Core `src/agent/pi/tools/index.ts`, `dheeStartRun.ts` | Share these operations between Desktop and MCP |
| Stage and collection stops, budget stops, bounded review walks | Actual walker source | Review foundations exist; older approval TODOs understate current capability |
| Image critique and refinement | `src/dag/runners/vlmJudge.ts` | Reuse for image checks; does not establish full-film, lip-sync, or voice-quality assurance |
| Production canvas, shot sheets, inspector, versions, chat, timeline/audio import | Desktop `ProductionView.tsx`, inspector and preview components, `src/shared/dheeIpc.ts` | Extend existing workspace; avoid rebuilding it |
| First-run flow and diagnostics | `App.tsx`, FirstRunSetup, providerDiagnostics modules | Audit behavior rather than schedule a new onboarding system blindly |
| FFmpeg final assembly and watermark behavior | Core `src/dag/runners/ffmpegConcat.ts` | Clean/review export must be explicit and covered by tests |
| MCP | `todos/mcp-server.md`; no MCP server path in inspected tree | Treat as an additive adapter; TODO tool names are older than current registry |
| Voice production, mixing, structured approvals | TODOs plus historical Desktop review | Verify installed package capabilities first; fill specific gaps |

The December 2025 `PROJECT_STATUS.md` and May 2026 readiness audit are not authoritative descriptions of the current app. Their claims about missing UI, onboarding, credentials, and run behavior must be reconciled with current code and tests.

Historical evidence used:

- September Desktop review: WAV bytes were interpreted as a path; binary errors enlarged logs; runner discovery differed by install path; provider credit failures triggered unhelpful retries. A later template-based Desktop render succeeded. Its reusable template and runner integration remained local, not upstream features.
- Brilliant Care repair checklist: clipped consonants, unnatural phrasing, wrong/unstable voices, closed-mouth speaking, weak body acting, eye artifacts, prop discontinuity, unreadable monitors, color jumps, and feedback timestamps drifting across cuts.
- MD1 review: technically clean export still had a review watermark, unclear opposite-corner camera coverage, cropped repair action, incomplete leak-response-resolution storytelling, and insufficient evidence for pipeline footprint claims.

## Approaches

1. Expand chat and inspector only. Smallest initial UI change, but users still have to remember production stages and quality checks.
2. Guide production through the existing workspace, backed by the existing graph. Recommended: visible stages, review decisions, focused controls, chat for intent, inspector for advanced work. Incremental delivery is possible.
3. Fully autonomous brief-to-final. A later operating mode after benchmarks; currently likely to automate repeated mistakes and expensive retries.

The user selected three review points. The guided-workspace architecture is the author's recommendation, pending review; it has not been represented as an approved implementation design.

## What the user supplies

Start from an idea, script, existing storyboard, or existing assets. Ask only for missing production decisions and retain answers as structured project inputs.

| Input | Required before | Contents |
|---|---|---|
| Brief | Storyboard approval | Audience, purpose, message, platform, language, target duration/range, aspect ratio, tone, required beats, exclusions, call to action |
| Factual/brand pack | Storyboard approval | Approved claims, service/product facts, logos, colors, fonts, spelling, reference material and its provenance |
| Cast/world bible | Reference approval | Character IDs, canonical faces/wardrobe, location IDs, prop states, visual style, lighting and framing examples |
| Voice direction | Reference approval | Speaker-to-voice mapping, sample performance, pronunciation dictionary, accent/language, emotional direction, narrator versus dialogue |
| Production settings | Paid/compute work | Available providers, capability requirements, quality preset, spend ceiling, retry allowance, output format |
| Source assets | When used | Reference images, footage, narration, music/SFX; asset role, origin, allowed use, selected version |
| Acceptance criteria | Storyboard approval | Must-show details, forbidden changes, technical export profile, benchmark-specific checks |

Unknown facts stay unresolved instead of being invented. A project can enter drafting without every optional field. No required asset or capability may silently fall back to an incompatible substitute.

## Complete workflow

1. **Intake and preflight.** Import the brief/assets, detect missing decisions, resolve runner dependencies and credentials, check disk/provider reachability, explain estimates and unknown costs. A successful settings ping is not proof that a full model call will work.
2. **Research and treatment.** Organize supplied facts, record supporting sources, propose narrative structure, distinguish confirmed claims from creative suggestions.
3. **Script and production breakdown.** Assign stable scene/shot/line IDs. Define who speaks, the visible action, emotional intent, shot purpose, duration estimate, transitions and required facts.
4. **Storyboard and coverage.** Show scene cards with narration/dialogue, framing, action, continuity and rough timing. Include a low-cost animatic when images exist. **Approval 1: script/storyboard.** Revisions remain possible.
5. **Cast, setting and voice development.** Generate/import canonical references; preview voice samples using actual project lines; maintain pronunciation and performance notes. **Approval 2: character/voice reference pack.** Image drafts can proceed earlier, but expensive motion production waits for approved references.
6. **Per-shot production.** Choose native audiovisual dialogue, voice-driven lip-sync, narration over footage, or graphics/template animation according to capability. Generate keyframes and candidates; check brief adherence before motion; store prompts, models, input versions and provenance.
7. **Voice and timing.** Generate complete utterances with conversational context, align words, preserve breaths and word boundaries, and fit the visual edit to speech where appropriate. Do not force natural dialogue into arbitrary five-second windows. Native audiovisual generation keeps its own audio paired with its video; replacement speech requires a deliberate sync strategy.
8. **Motion and scene checks.** Generate clips; inspect start/mid/end frames plus moving playback; evaluate identity, hands, props, eye direction, action and lip-sync. Regenerate only failed components and affected dependents.
9. **Assembly and sound.** Select takes, trim and reorder shots, handle dialogue/narration/music/ambience/SFX separately, duck music under speech, add controlled typography/screens/captions, match color and review transitions.
10. **Rough-cut review.** Present the entire film with timecoded issues, unresolved warnings and A/B candidates. **Approval 3: rough cut.** Required fixes return to relevant stages without discarding accepted material.
11. **Master and delivery QC.** Render the exact approved revision; decode the whole output; verify stream properties, timing, captions, audio, watermarks and final slate. A changed cut invalidates approval; an encoding-only retry retains it if the edit/assets are identical and export checks rerun.
12. **Delivery and reuse.** Export clean master, optional review copy, captions and provenance/QA report; retain editable project and selected media. Archive accepted references and reusable production recipes.

Do not confuse successful generation, machine QA pass, human approval and delivery readiness: they are distinct states.

## Desktop experience

Evolve the current ProductionView rather than replace it. Stage navigation can be a compact rail or progress header over the existing canvas: Brief, Storyboard, Cast & Voice, Scenes, Edit & Sound, Review, Export. Exact layout is a design decision to validate with a prototype after approval.

- A persistent project header shows current stage, current work, unresolved decisions, budget and a clear next action.
- Scene cards show the approved text, selected image/video, speaker, duration, versions and review findings together.
- A scene detail view supports playback, contextual regeneration, reference replacement, voice audition and A/B comparison. Show what downstream work changes before committing an edit.
- The review inbox opens the exact shot/line/version, not just an old timestamp. Show before/after in surrounding context and mark “not checked” honestly.
- Chat expresses intent; ordinary actions also have direct buttons. Graph/node jargon belongs in an advanced inspector.
- Run status distinguishes queued, executing, awaiting review, stopping, stopped, failed and complete. Display actionable provider errors and explain when remote cancellation is unconfirmed.
- Preserve selection, scroll, playback position and unsaved edits across navigation. Keyboard navigation, visible focus, readable contrast, responsive panes, undo/version restore and useful empty states are acceptance requirements.
- Audio controls begin with voice audition, pronunciation, line regeneration, gain, fades and ducking; no need to build a general-purpose professional audio workstation.
- Editing scope for v1: select takes; trim/reorder; adjust timing; place voice/music/SFX; captions and controlled overlays; preview and export. Advanced compositing remains behind approved templates/recipes.

## State and contracts

Reuse the event log, selected versions and dependency graph as the source of truth. Add review and production metadata through the existing core schema/event conventions only where absent. Desktop must not maintain an independent approval database that disagrees with core or MCP.

Proposed logical records (not frozen TypeScript signatures):

- `ProductionBrief`: version, goals, constraints, facts, format, budget policy, required checks.
- `ShotSpec`: stable ID, scene ID, script line IDs, references, before/after prop states, action, camera, timing and chosen production strategy.
- `VoiceProfile`: speaker ID, provider/voice reference, pronunciation and approved sample version.
- `ReviewDecision`: gate, artifact/version IDs, dependency fingerprint, reviewer, decision, notes and timestamp.
- `QualityFinding`: check ID, severity, confidence, shot/line ID, artifact version, local time range, evidence, repair scope, status and waiver reason.
- `ExportManifest`: selected cut revision, source versions, core/desktop/provider versions, settings, checksum, QC results and delivery state.

Approval freshness is based on content/dependency identity. A regenerated face invalidates affected scene checks; a changed voice invalidates affected lines and sync; a script change reopens relevant storyboard approval. Unchanged independent work stays selected. Revision conflicts must be detected across UI/agent/MCP actions, with one writer/run policy per project.

## Dhee MCP for rendering

Implement within `dhee-core`, not a third repository. Desktop keeps typed IPC and in-process operation; MCP is an alternate entry point into the same services. Do not route local UI actions through MCP just to reuse business logic.

The current tool registry is the starting point: create project, describe/list bundles, start/stop run, status, regenerate node, read artifact, list/select versions, write input and budget cap. Add narrowly scoped render/export and QA operations only after identifying the existing services they wrap. Do not port obsolete names from the MCP TODO uncritically.

Use explicit project IDs/paths and explicit revisions; no hidden global “active project.” Mutating calls use idempotency keys and preconditions so retries cannot create duplicate paid work. Return structured task/run IDs and structured errors; artifact resources expose scoped files, not arbitrary filesystem access. Logs stay bounded and redact credentials/binary payloads.

Start with local stdio and start/status/cancel/result tools. The server and Desktop must respect the same project lock; an MCP invocation must not start a competing worker on an already-running project. Choose process ownership during the first local spike: one engine host or clearly enforced exclusion, verified by a concurrent-client test.

MCP progress notifications are optional; the Tasks extension provides durable task handles but requires client support. Negotiate actual SDK/client capabilities and preserve explicit status polling as a compatible tool-based path. Do not claim restart durability merely because a process returned a task ID. Reconcile persisted tasks with engine state after a crash. Remote HTTP/authentication is deferred until a concrete remote-client need exists. [MCP progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress), [Tasks extension](https://tasks.extensions.modelcontextprotocol.io/).

## Quality and repair system

| Layer | Checks | What can decide |
|---|---|---|
| Deterministic | Schema, missing media, dependency validity, duration/frame counts, decode, channels/sample rate, clipping/loudness, unexpected black/freeze/silence, export settings | Block objectively broken outputs; intentional holds/fades/silence need context exemptions |
| Semantic assist | Required objects/actions, identity, prop state, text legibility, script coverage, speaker/ASR mismatch, possible sync issues | Suggest timestamped findings with confidence; uncertain results require review |
| Human creative | Acting, believable emotion, voice naturalness, pacing, continuity, factual meaning and overall impact | Required at three gates; watch and listen before accepting a film |

FFmpeg provides useful measurement/filter primitives such as black detection, silence detection and loudness normalization. They do not establish emotional quality or lip-sync correctness. Loudness targets belong to an explicit delivery preset, not a claimed universal YouTube standard. [FFmpeg filter documentation](https://ffmpeg.org/ffmpeg-filters.html).

Voice checks: correct speaker and text, no missing/repeated words, complete consonants, no unintended speech/overlap, intelligibility, stable identity, connected phrasing, meaningful pauses, natural breaths, pronunciation, consistent levels and clean ambience. ASR may miss proper names or accent differences; it cannot certify performance. Lip-sync needs moving-picture review with sound, including the listener not speaking the other person's line.

Scene checks: canonical identity/costume, whole-body acting, gaze/blinks, hand/anatomy coherence, prop acquisition/state, lighting/color, eyelines and geography, action coverage, readable screens, no unwanted generated text/watermarks. Review cuts with surrounding motion rather than hiding discontinuities with blanket dissolves.

Repair loop: detect → attach evidence to version → classify → propose smallest repair → estimate impact/cost → create candidate → rerun affected checks → compare in context → select/approve. Proposed default: at most two automatic creative repair candidates per failing item, within the project budget; then escalate to user choice. Transport retries and creative retries are separate. Terminal credit/auth/capability failures stop immediately. Unknown costs are displayed and require a configured attempt limit; existing spent-to-date caps cannot guarantee zero overshoot on an in-flight provider request.

Final-ready requires no unresolved blockers, all required human checks recorded, fresh approvals, and passing export QC. A waiver requires a recorded reason; it cannot silently turn a failed technical decode into a final-ready file.

## Benchmarks and delivery sequence

1. **Production workflow and UX specification first.** Reuse existing test evidence and source inspection. Map missing user-facing actions and provider integration seams; do not make a new broad baseline test cycle a prerequisite for planning. At implementation time, run checks relevant to the changed paths and a local end-to-end check of that feature. Preserve historical projects and reference existing external runners without modifying their repositories.
2. **First complete slice.** A proposed 20–30-second, three-shot film: two-speaker exchange, narrated action shot, branded ending. Import or generate refs/voices inside Desktop, exercise all three gates, repair one line, replace one take, export clean master. No terminal/file surgery in the production path.
3. **Brilliant Care workflow.** Expand to the approved full narrative, without inheriting the obsolete 120-second limit. Validate recurring characters, phone/dialogue scenes, glasses/cuff/monitor continuity, voice identity and natural performance. Historical review copy is a failure-reference set, not an accepted quality target.
4. **Shipyard workflow.** Demonstrate required camera placement and coverage, pipeline geometry, full technician/work area framing, readable alerts and leak → response → repair → verification. Obtain exact approved reference cut/brief before using factual proportions as acceptance requirements; the located MD1 work is the provisional reference.
5. **Reliability and polish.** Packaged app, restart recovery, provider failures, storage handling, keyboard/accessibility, project portability and longer-film responsiveness. Then consider higher-autonomy mode.

Proposed release criteria: both full benchmarks completed through Desktop without external editing; all three gates survive reopening; changing one item preserves unrelated accepted assets; stop/retry behavior is truthful; no hidden paid retries; clean exports match approved versions; full technical scan and complete human playback/listening recorded. Track time to first storyboard, manual interventions, accepted-shot rate, retries, actual/estimated cost and recovery success. Establish baseline numbers before promising percentage gains.

## Branch and verification policy

Local documentation branches in Desktop: `docs/production-workflow-plan` and `docs/production-feature-backlog`. Keep the full design in the former and prioritized feature inventory in the latter. Record source commits and cross-links; reconcile decisions so the branches do not become contradictory sources of truth. Once approved, integrate documentation locally into a common base before feature branches.

Use short-lived `feat/<scope>` or `fix/<scope>` branches. Feature work is paired across repos only when a core API change is needed; record the core commit used by Desktop. Suggested scopes: production-review, voice-workbench, scene-qc, edit-sound, delivery-qc, mcp-adapter. Do not accumulate unrelated changes on one giant “polish” branch. No push, PR or release without explicit later user instruction.

Verification is layered: focused behavior tests for each change; existing core build/typecheck/Vitest and Desktop Jest/lint/Playwright; deterministic fixture integration without billed generation; small approved real-provider smoke tests; then packaged local app and benchmark playback. Record pre-existing failures separately. A source audit is not a local runtime test. No GPU job or billed generation is started by this planning task.

## Decisions still to validate

- Guided production workspace layout: extend current production canvas as recommended, with visual prototype before implementation.
- Exact current Brilliant Care and shipyard approved inputs and delivery specs: import them into benchmark packs rather than infer from old timestamps or filenames.
- First supported provider combination: choose after a capability audit and short voice/dialogue samples, not from provider popularity. Local execution remains supported; network providers are configured alternatives. “Only Desktop” describes the interface, not a promise that all inference runs on the Mac.
- Review threshold calibration and delivery audio preset: benchmark against labeled examples before automated blocking on subjective scores.

## Source map

- [Core architecture and pipeline](https://github.com/dheeai/dhee-core/blob/75ec0b0c056a385eca41ce6fe7f0cbb239dcc5f6/README.md)
- [Core walker](https://github.com/dheeai/dhee-core/blob/75ec0b0c056a385eca41ce6fe7f0cbb239dcc5f6/src/dag/walker.ts)
- [Current agent tools](https://github.com/dheeai/dhee-core/blob/75ec0b0c056a385eca41ce6fe7f0cbb239dcc5f6/src/agent/pi/tools/index.ts)
- [Image judge](https://github.com/dheeai/dhee-core/blob/75ec0b0c056a385eca41ce6fe7f0cbb239dcc5f6/src/dag/runners/vlmJudge.ts)
- [MCP proposal](https://github.com/dheeai/dhee-core/blob/75ec0b0c056a385eca41ce6fe7f0cbb239dcc5f6/todos/mcp-server.md)
- [Desktop IPC](https://github.com/dheeai/dhee-desktop/blob/2cf8b7a648274295a0c222cc379db766fa5e85cd/src/shared/dheeIpc.ts)
- [Production canvas](https://github.com/dheeai/dhee-desktop/blob/2cf8b7a648274295a0c222cc379db766fa5e85cd/src/renderer/inspector/production/ProductionView.tsx)
- Local historical evidence: September 28 `Dhee-Desktop-Review.md` and `Dhee-Local-Workflow-Changes.md`; October 23 Brilliant Care `MASTER_REPAIR_CHECKLIST.md`; MD1 `final-qa-report.json` and the “Regenerate barge video” chat. These were read for planning; the films were not freshly reviewed in this task.

## Planning refinement: RTX 5090 and the actual production experience

User clarification on 30 October: focus on the automation and Desktop UX plan, not another broad environment/test setup exercise. Core is presumed largely complete; tests establish specific changes, not a reason to postpone the design. No production source changes were made during planning. A local dependency setup attempt encountered a native-module install failure; that is recorded as setup evidence, not a product defect or the next product priority.

### Two interfaces, one production state

`Codex → Dhee MCP → Core project operations` and `Desktop → typed IPC → Core project operations` are alternate control paths. Core runners invoke the RTX 5090 workflow queue for generation and local assembly services for editing/export. GPU MCP tools available to Codex do not automatically become available inside Desktop: an explicit client/runner integration is required unless an existing installed runner already provides it.

Keep generation calls behind the queue. Do not bypass it with direct ComfyUI submissions: the GPU is shared with other work and owner LLM use. Map queue states into Desktop, preserve job IDs across restarts, and download completed assets into the project promptly; the service describes output retention as 14 days. Tailnet access is required for upload/download. Project metadata should record workflow/version, ordered references, requested settings, seed, returned job ID and local asset checksum.

The catalog was read successfully on 30 October. All listed workflows report `available: true` but `status: unchecked`; no generation was run to validate quality. An empty own-jobs list does not establish that the GPU is globally idle.

| Production need | Catalog candidates | Product requirement |
|---|---|---|
| Reference/storyboard images | `krea2_image`, `flux3_klein_image`, `qwen_image`, `zimage_image`, `moss_image` | Let the user choose a quality preset; retain exact recipe behind it |
| Image correction | `krea2_edit`, `flux3_klein_edit`, `qwen_image_edit` | Target one image; preserve original and compare candidate |
| Dialogue/action video | `h3_video_draft`, `h3_video_final`, `h3_video_final_x2`, `h3_prism` | Ordered visual/audio refs; capability-valid clip lengths; draft before final |
| Narration/voice performance | `drama3_speech`, `drama3_scene` | Audition actual lines and scenes, stable speaker mapping, pronunciation notes |
| Music | `music_instrumental` | Keep cue and generated ABC score for thematic variations; measure actual duration |
| Optional repair/finishing | SAM masks/tracking, depth, neural look pass, RTX upscale | Explicit opt-in per need; preserve source audio and verify changed format |

Audio references in an H3 request are not proof of exact speech timing or lip synchronization. The initial dialogue strategy is to evaluate H3 native audiovisual candidates with approved speaker references, preserving generated audio/video pairs. Drama3 is a candidate for narration and voice auditions; replacing visible on-camera speech requires a separately validated synchronization path. The exposed catalog does not establish a standalone lip-sync repair workflow, so the UI must not promise one.

Finishing is not mandatory: do not silently turn an SDR 24fps approved film into HDR 48fps merely because that is an upscale recipe's default. The export brief controls resolution, frame rate and dynamic range.

### First feature: storyboard and approval workspace

Branch recommendation: Desktop `feat/storyboard-review-workspace`, created when implementation begins. Extend the existing ProductionView and shot sheet components. Core work is restricted to a missing read/write/review contract demonstrated during implementation.

The user enters a project and sees:

1. A concise brief with attached script, references, required facts and desired output.
2. Scene cards containing story purpose, dialogue/narration, visual action, duration, reference assignments and generation readiness.
3. An editable script/storyboard with a visible approval record. “Approve storyboard” is distinct from “Generate.”
4. Cast and voice previews attached to named characters, with approval status and a clear reason if generation is blocked.
5. “Generate approved scenes” showing draft/final quality, queued work, estimated effort/cost where known and the items that will change.
6. A review queue where “voice sounds unnatural,” “wrong prop,” or “scene doesn't match” opens the exact candidate and offers the smallest supported repair.

Acceptance: the ordinary workflow needs no node names, hand-edited JSON, copied file paths or external chat instructions. Advanced controls remain accessible. The first feature can be reviewed with fixture media before scheduling real GPU work.

### Concrete pilot for discussing the workflow

Use a small excerpt of Brilliant Care rather than inventing an unrelated demo. Proposed three-shot structure, still subject to storyboard approval:

- Clinic exchange: Bennett asks “Any questions?” and Thomas gives the approved response. Judge connected delivery, listening, stable identity and complete words.
- At-home follow-up beat: an approved patient/care-team action, with a short narration line from the approved script. Judge phone/prop continuity, voice fit and readable visual information.
- Resolution/end card: an approved outcome beat and controlled brand typography. Judge pacing, music balance, legibility and clean export.

Target roughly 20–30 seconds only if the complete dialogue and action fit naturally; do not truncate speech to satisfy the demo length. Exact scene text and references must come from the chosen script revision. This is a workflow acceptance fixture, not authorization to replace the full film's creative plan.

### Implementation order after this design

1. Storyboard/review workspace and three approval states, using current artifacts.
2. RTX 5090 runner/client integration only where missing, including queue status and durable local output retrieval.
3. Voice auditions, speaker assignments, scene generation and focused repair controls.
4. Rough-cut editing, audio mix, review findings and clean export.
5. Dhee MCP adapter over those same operations; bring its minimum dispatch/status surface forward if needed for Codex-assisted integration testing.
6. Full Brilliant Care and shipyard workflows, then deeper polish based on actual use.

For each feature: write its detailed implementation tasks, make the smallest local change, verify that feature locally, record evidence and iterate. Broader regression checks happen when the affected integration warrants them and before delivery; setup work must not displace the product objective. All commits remain local until the user explicitly requests a push or PR.
