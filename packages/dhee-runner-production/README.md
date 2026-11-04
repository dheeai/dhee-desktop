# Desktop production extension

Owned by dhee-desktop. Provides normalization and approved-narration runners through Core's existing npm runner protocol, plus a Desktop wrapper for the shared Core controller. No second DAG executor.

Build from the Desktop root: `npm run build:production`. Call `node packages/dhee-runner-production/dist/cli.js --request /absolute/request.json`, or send one JSON request on stdin. The wrapper retains the shared Core request/response contract and three creative review gates. Every operation, including `scene.check`, delegates to `dhee-core/control`.

The Desktop host supplies a compatible built Core with the production-control export, exact selected execution/review safeguards, and JSON-array `DHEE_NODE_MODULES_DIRS` support. The unmodified upstream75ec0b0 does not provide those additions. Necessary Core support is intentionally retained following the user's clarification; this package must not be advertised as working against that unmodified version.

`configureProductionRuntime()` preserves explicit external roots, or normal cwd/ancestor discovery when unspecified, and adds the shipped runner location. Roots use a JSON array so Windows drive letters and commas in paths remain intact. Legacy colon/comma paths are accepted for compatibility.

Media implementations import only public runner SDK types and own their FFmpeg/FFprobe dependencies. Source snapshots, input hashes, no-clobber publication, cancellation and format limitations are preserved. Core no longer registers these two tools as built-ins. `ffmpeg.concat` and the engine remain in Core. Scene-intent validation remains recorded-observation checking, not automatic vision.

Normal postinstall builds the extension; packaging builds and packs it alongside the Core tarball. A successful build and tarball test do not establish full signed-app or Windows/Electron acceptance.

## Core-owned MCP transport

Core owns the MCP server and exports `dhee-core/mcp` and `dhee-core/mcp/stdio`. Codex should launch `dhee-core-mcp` (or Core’s `dist/mcp/cli.js`) with this extension discoverable through `DHEE_NODE_MODULES_DIRS`. Desktop contains no separate protocol server.

For compatibility, build with `npm run build:production` and launch the forwarding shim with `node /absolute/path/to/dhee-desktop/packages/dhee-runner-production/dist/mcpStdio.js` (or the installed `dhee-desktop-mcp` binary). If launching through npm, use `npm run --silent production-mcp` to suppress npm banners on protocol stdout. No HTTP server is opened. This does not register the server in Codex automatically.

The tool is `dhee_production_control`, with arguments `{ "request": { "action": "project.status", "projectDir": "/absolute/project" } }`. Discover the full action-specific input contract through `tools/list`: it is loaded from the host's public `dhee-core/control` schema, including exact selected runs, GPU preparation/jobs/recovery, media checks, scene contracts and human reviews. The host must supply compatible built Core even for MCP initialization. CLI scene checking also uses Core.

Pass the host environment explicitly, including `DHEE_USER_BUNDLES_DIR` and any configured runner/gateway settings; use the existing shared RTX queue configuration. Requests are limited to 1 MiB, transport buffers to 2 MiB. Media is referenced by path, never embedded. Set a suitable client timeout for long operations (the real-media acceptance uses 180 seconds). Cancellation/disconnect aborts active controller signals and drains cleanup, bounded to 21 seconds including stderr flushing. Inspect durable queue records before retrying interrupted generation; do not blindly resubmit paid work.

A successful response may stop at a creative gate. Read its preview and obtain the actual human decision before `review.decide` with `humanAcknowledged: true`. The three approval points remain storyboard, references/voice and rough cut. Scene consistency uses recorded observations, not automatic visual understanding. Technical checks and creative approval are separate.

## Verified companion revision

This feature branch was verified with `dheeai/dhee-core` commit `1ba88b07e1b6561a681f03e1942f49fabb249352` on `feat/rtx-5090-queue`. Use that companion revision, which owns and exports MCP, when reproducing the local acceptance. Earlier Core revisions do not provide these MCP exports. The Desktop packaging scripts pack the companion Core checkout and this extension into vendor tarballs.

The latest bounded acceptance is a real 14-second, three-scene existing-clips test, including approved narration preservation, normalization, assembly and automatic checks. Full materials-to-film automation, persisted final-delivery readiness and signed/cross-platform packaged acceptance remain separate backlog work.

## Automated assembly audit (local)

`media.verify_assembly` is a Desktop-owned analysis runner discovered by Core. It compares a hard-cut assembly with ordered source clips and selected narration, without generating or editing media. Declare the runner dependency and a JSON-output stage with all referenced media as upstream inputs. Configuration:

```json
{
  "videoInput": "assembled_video",
  "outputPath": "assembly-check.json",
  "segments": [
    {"videoInput": "scene_01", "durationSec": 4, "audioInput": "voice_01", "audioOffsetSec": 0},
    {"videoInput": "scene_02", "durationSec": 4, "audioInput": "voice_02", "audioOffsetSec": 0.4}
  ]
}
```

Run the verification bundle through Core MCP `project.run` and read its selected report through `artifact.read`. The checker must be reachable from the bundle goal; adding an unreachable node does not run it. This is an opt-in analysis stage, not automatically attached to every existing project or `assembly.run`. Configured automatic checks are displayed in the native assembly panel (see below). The real acceptance used a separate audit project importing the existing final and sources; it did not change the film project's output or creative decisions.

Checks: complete final decode, summed duration (50 ms tolerance), ordered grayscale source-picture comparison at 8 fps (worst sampled frame mean absolute difference ≤2.5%), and 16 kHz mono waveform comparison at planned offsets (cosine similarity ≥0.995, RMS gain 0.8–1.2). Source pictures must already have the intended crop, speed and transitions; this initial checker covers hard cuts only. Thresholds are conservative defaults, not universal perceptual guarantees. Downsampling does not inspect every original pixel/frame or channel.

Reports include input hashes and explicit criteria. `status: fail` means a measured mismatch; `status: review` means implemented checks passed but further assessments remain. `RunnerResult.ok` means report generation succeeded, **not** that the film passed. Actor/action meaning and creative approval are explicitly unchecked. Speech can be checked against an optional expected script as described below. Extra sound outside the declared narration intervals, music/SFX balance, speaker identity, lip sync, titles/branding and full-frame visual defects are not certified. Reports are immutable snapshots, not an automatically refreshed final-delivery gate; changed sources require a new check and output path. Never promote a historical report to current approval based only on its existence.

Inputs are snapshotted and hash-rechecked; output never overwrites existing files. Limits: 20 segments, total 120 seconds, total input bytes 512 MiB; subprocesses are cancellable, timeout at 120 seconds each and cap output buffers. No network or GPU generation runs. Optional speech recognition runs an explicitly configured offline CPU model. The automatic attachment requires the matching Core support described below.

### Automatic checking after assembly

With the matching local Core update, set `verificationNode: "assembly_check"` in the final assembly runner config. Declare a downstream JSON stage named `assembly_check` using `media.verify_assembly`, with the final assembly and every configured reference as direct stage dependencies. Its `videoInput` must name that assembly stage. Keep the film bundle goal as the final video; Core can now execute the exact downstream check without changing the film goal or generating prerequisites.

`assembly.run` automatically dispatches that check after producing or reusing the selected final, even when the video pauses at rough-cut review. The response includes `verification` and `deliveryReady: false`. Desktop shows the report and creative pause together. This supersedes the earlier standalone-audit-only limitation for configured `assembly.run` calls; unrelated render entry points are not automatically covered.

No configured node means `not-configured`; an assembly pause before output means `not-run`; execution/schema problems mean `unavailable`; changed source bytes, selections or criteria mean `stale`. Valid current findings remain `review` or `fail`, never automatic creative approval. Core checks selected artifacts, report criteria and source hashes before returning a current result. Cached stale reports are not silently overwritten: invalidate/recompute with an appropriate fresh report path. A supported safe rerun UI and global final-delivery/export enforcement remain future work.

### Offline script check

Set `expectedScript` in the checker config to check English narration against the assembled audio. Configure `DHEE_ASR_MODEL_PATH` to an already installed absolute faster-whisper model directory and, optionally, `DHEE_ASR_PYTHON` to its Python executable. That runtime must provide `faster_whisper` and NumPy; no packages/models are downloaded. The expected script is not supplied as a recognition prompt. The recognizer runs on CPU with a 180-second timeout and cancellation support.

The version-2 report records recognized words, timestamped differences and confidence. Punctuation/case normalization is allowed; confident insertions/substitutions fail, while missing words or uncertain recognition require review. No script, model, or usable recognizer means `unchecked`, never a pass. A word match does not identify the speaker or certify pronunciation/performance. Existing version-1 reports are stale and need recomputation with a fresh report path. Adding ASR configuration alone does not rerun a cached report.

Local acceptance used the real 14-second Brilliant Care existing-clips test: source import, normalization, approved audio placement, final assembly, automatic checking and saved technical results through Core MCP. The earlier unwanted “Narrator” audition failed; the corrected long narration matched; the opening sentence remained uncertain. No full-film or semantic vision acceptance is implied.

### Semantic scene-review assist (local increment, not yet live-validated)

Each segment may declare `visualRequirements`, one to ten explicit actor/action/continuity statements of at most 500 characters. The checker samples three chronological frames at 10%, 50% and 90% of that segment in the snapshotted final video. At most 20 segments/120 seconds are supported. Configure `DHEE_REVIEW_VLM_BASE_URL` (an OpenAI-compatible API base URL, ending in e.g. `/v1`) and `DHEE_REVIEW_VLM_MODEL`, with optional `DHEE_REVIEW_VLM_API_KEY`. No default provider, cloud fallback or guessed RTX port is used. Use only the intended authorized vision service; the RTX generation queue URL is not automatically a vision API.

The model must return every requirement exactly once with sampled-frame evidence and confidence. Strong reported contradictions fail the check; supporting/uncertain samples remain unchecked because frames do not prove continuous action or full-video correctness. Reports retain the model, requirements, observations and timestamps. Missing configuration, transport failures, oversized/malformed responses and invalid evidence remain unchecked. Requests have a 60-second timeout, cancellation and a 64-KiB response limit; redirects are rejected.

This increment emits analyzer version 3 and needs the matching local Core change. Older version-2 reports require a fresh check. The deterministic checks and all human approval gates remain separate. The adapter and integration tests use explicit fixture model responses; no live RTX semantic accuracy is claimed until its endpoint/model is identified and tested on real clips.


### Review configuration freshness

Analyzer-v3 reports now include `visualReviewConfigSha256`: SHA-256 of the JSON array `[normalizedBaseUrl, trimmedModel]`. The base URL is trimmed and one trailing slash removed; absent values are empty strings. Credentials are excluded. The runner snapshots its environment for the entire review. Core compares this fingerprint whenever scene requirements are configured and marks missing/mismatched fingerprints stale, including configuration changes during execution. Core and the Desktop extension must receive the same configuration. A stale report requires a fresh report path; this does not automatically overwrite or regenerate media. Changing service implementation behind an unchanged endpoint/model name cannot be detected; use versioned model names when deployment changes require review invalidation.

Long automatic-check findings are collapsed behind Show evidence; status and timestamps remain visible and the complete evidence remains available. Adapter tests cover pending-request cancellation, deadline expiry and duplicated frame references. Live endpoint accuracy and human rough-cut approval remain separate requirements.

## Prepare approved narration

`audio.prepare_narration` splits a PCM16 WAV at measured pauses and adds silence to place each part within its scene. It retains every source sample, channel and sample rate; it never trims or stretches the voice. It produces either the full timed narration or one scene selected by `sceneId`.

Declare upstream audio and JSON-plan nodes, then use this runner config:

```json
{"audioInput":"approved_voice","planInput":"narration_timing","outputPath":"prepared.wav"}
```

Timing plan (replace the hash with the exact reviewed WAV SHA-256):

```json
{
  "sourceSha256":"<64 lowercase hex characters>",
  "scenes":[
    {"id":"opening","durationSec":5,"offsetSec":0.3},
    {"id":"closing","durationSec":5,"offsetSec":0.3}
  ]
}
```

Automatic cuts require exactly one eligible internal pause between each scene. Defaults are `minPauseSec:0.8` and `silenceThresholdDb:-45`, measured with 10ms windows across all channels. Leading/trailing silence is retained, not used as a boundary. When pauses are ambiguous, provide ordered `boundaryHintsSec` inside distinct measured quiet intervals; hints in speech are refused. Scene durations and offsets must fit all source samples; extend the scene or revise timing if they do not. The output is already padded, so use `offsetSec:0` with `ffmpeg.replace_audio`.

Use Core MCP `project.run` with the configured node as `stopAt`. Core discovers the Desktop extension through its existing runner roots; there is no second MCP server or new Core action. In a full production bundle, keep the source recording behind the existing references/voice approval gate. The source hash binds bytes, **not approval**. Pause detection does not verify which sentence belongs in a scene: `semanticAlignment` remains `unchecked`; run transcript checks and review the cut before final approval.

Only PCM16 RIFF WAV (mono/stereo, 8–192 kHz) is accepted. Input/output audio is limited to 128 MiB, the plan to 64 KiB, and the plan to 100 scenes of at most 300 seconds each. Unsupported audio must be explicitly converted and reviewed first. Existing outputs are never overwritten; choose a fresh version path for a redo. Files remain inside the project and source/plan changes invalidate preparation before publication. Core supplies the plan as a parsed JSON snapshot; its serialized-content hash is recorded separately from any file hash. Core remains responsible for that upstream version lineage. Direct runner callers may supply a project-confined plan file, whose bytes are rechecked before publication.

## Check continuity before generation

`production.continuity_preflight` validates explicit cast, voice, movement and property-state declarations against the currently selected storyboard and media bytes. Codex invokes it through Core MCP `project.run`; it is a Desktop extension, not a separate MCP server.

Configure a JSON-output node with `{"specInput":"continuity_spec","outputPath":"continuity-v1.json"}`. Include the parsed specification, storyboard text/JSON and every named media input as upstream dependencies. Make generation depend on this node and explicitly consume its per-scene `prompt` and `assets`; merely installing this runner does not change existing generation bundles. The output is a snapshot: changed selections need a fresh preflight and output path. Existing outputs are never overwritten.

The version-1 spec contains:

- `storyboard: {inputKey, sha256}`: hash UTF-8 text, or `JSON.stringify` of Core's parsed JSON snapshot.
- `assets: [{id, inputKey, kind, sha256}]`: canonical image/audio files and exact byte hashes.
- `characters: [{id, kind, referenceIds, voiceId?}]`: `kind` is `character` or `narrator`; visible characters need image references. Voices are assigned per character.
- `locations: [{id, referenceIds}]` and optional `props: [{id, referenceIds}]`.
- Ordered `scenes`, each with `id`, `durationSec`, `locationId`, `camera`, `framing`, `actors`, optional `dialogue` and `states`.
- Actors declare `characterId`, `movement` (`stationary`, `enter`, `exit`, `move`), `mustRemainStationary` and `action`.
- Dialogue declares `speakerId`, `voiceId`, `mode` (`on-screen`, `off-screen`, `phone`, `radio`, `narration`), `startSec`, `endSec`, `text`. Overlapping speech is refused in v1. Only on-screen dialogue requests lip-sync.
- States declare `entityId`, `property`, `start`, `end`, optional `changeReason` for an in-scene change and `entryReason` for a change since that entity's previous appearance.

For example, assign the doctor `movement:"stationary", mustRemainStationary:true` and the patient `movement:"exit"`. Conflicting movement, wrong voices, invalid speaker placement/timing, stale/missing references and unexplained state changes block the node. State memory persists across intercuts. Known properties are carried into the constraints when an actor or location returns, or a prop is explicitly mentioned in that scene’s states. Unknown properties are not inferred. To show a prop, include at least one state for it; v1 has no separate prop-presence list. Entity-to-image bindings and resolved states are retained in the report and prompt. Identical voice bytes assigned through different asset IDs are also blocked. Free-text contradictions, face/voice identity, physical plausibility and actual rendered movement require semantic review.

A valid report means `constraints-valid`, **not** footage acceptance: `semanticVerification:"unchecked"`, `creativeApproval:"required"`, `deliveryReady:false`. All three creative gates remain in Core. This runner does not submit GPU jobs, automatically repair clips, or bypass review. Shared group-image references are allowed; they do not prove distinct character identities.

Limits: 1 MiB text/JSON snapshots; 100 scenes of at most 300 seconds; 100 assets; 64 MiB per reference and 128 MiB total; 4 MiB output report. Reference headers support PNG/JPEG/WebP and WAV/FLAC/ID3 MP3. Header recognition guards modality only; use media checks for decoding/quality. Inputs and outputs must be project-confined; publication rechecks input hashes and uses atomic no-clobber creation.

### Prepare a checked scene for Core GPU generation

Optional `generation` config on `production.continuity_preflight` adds a `generationRequest` to its JSON report. It is an exact Core `gpu.prepare` request; the runner itself does not save a selection or submit a render. Run the preflight first, then let Codex send the embedded request through Core MCP after `project.run` returns.

```json
{
  "specInput":"continuity_spec",
  "outputPath":"continuity-generation-v1.json",
  "generation":{
    "sceneId":"opening",
    "nodeId":"scene_raw_01",
    "requestId":"opening-attempt-01",
    "expectedSelectionId":null,
    "workflow":"<name from gpu.catalog>",
    "workflowVersion":"<version from gpu.catalog>",
    "promptInput":"prompt",
    "referenceInputs":{"refs":["doctor_reference","clinic_reference"]},
    "referenceLabels":{"refs":["<Picture 1>","<Picture 2>"]},
    "durationInput":"duration",
    "parameters":{"seed":42}
  }
}
```

Slot names, labels and workflow/version must come from the chosen workflow; this example is not a universal provider schema. Optional `endpoint` uses the authorized queue gateway; otherwise Core uses its existing environment setting. Optional `branchId` defaults to `main`; `itemId` selects a collection item, and `primaryOutput` defaults to zero. Get the exact current `expectedSelectionId` from `gpu.targets`. Keep `requestId` unchanged when recovering the same preparation. Use a fresh ID only for an intentional new attempt.

The compiler adds a routing table to the scene prompt: workflow slot, ordered position, reference label, asset ID and entity owners. All image references belonging to the scene must be mapped. On-screen/phone/radio character dialogue also requires its canonical audio reference; narration/off-screen voice may instead stay for assembly and the prompt explicitly says not to synthesize those unmapped tracks. Mapping a voice reference does not guarantee a generated voice is identical: preserve the approved recording in assembly and verify the resulting audio.

Prompt, duration and reference slots cannot collide or be overridden by scalar `parameters`. Unknown/repeated assets, missing required references, stale file hashes and mismatched label lists fail preparation. The report includes exact Core `sceneIntent` freshness guards for prompt, parameters, single files and ordered file lists. Those facts describe **declared request identities**, not observed visual correctness.

Core validates the live catalog and current target when Codex calls `gpu.prepare`, returns a selection ID without submitting a job, and rechecks the bound inputs during `gpu.run`. Preserve that returned selection ID. Core's existing creative gates and unresolved-job safeguards still apply. Preparation is not full generation, automatic repair, or semantic acceptance. This mode does not update existing bundles automatically or provide provider-specific prompt styling; benchmark generated results before claiming quality.

### H3 six-section prompt profile

For the inspected `h3_video_final` contract, set `generation.promptProfile` to `h3-six-section`. Generic formatting remains the default. This profile requires `promptInput:"prompt"`, `durationInput:"duration"`, ordered image `refs` (up to 9), ordered `audio_refs` (up to 3), integer scene duration 1–15 seconds and only optional `seed` parameters. Workflow version still comes from the live catalog; no version is hard-coded.

The six sections are scene/intent, references/identity, action, camera, lighting/finish and audio. Camera, framing and location come from structured continuity data. Actor actions, stationary constraints and property transitions are retained. Lighting/finish follows supplied references. `<Picture N>` and `<Audio N>` labels are derived from actual list positions; optional caller labels must exactly match. Wrong modality, duplicate references, wrong labels or unsupported settings block preparation.

Only on-screen dialogue includes spoken text and lip-sync timing in the prompt. Narration, off-screen, phone and radio text is excluded from synthesis instructions; their approved recordings are preserved for assembly. Voice references do not guarantee identical generated speech. For this H3 profile only on-screen speech requires a generation audio binding; phone/radio/off-screen recordings can remain solely for assembly. Generic mode retains its existing character-audio mapping requirements. Assembly/media review remains necessary.

This profile uses the six-section convention from the earlier real bottle-film test, not a guarantee of H3 output quality. Current verification covers formatting and live Core preparation with real materials, without generating a new clip. Generated multi-character identity, motion and lip-sync accuracy remain unverified for this profile. All creative gates remain unchanged.

### Voice audition checks

`audio.check_voice` reads a selected PCM16 WAV (up to 120 seconds / 128 MiB) and publishes a new JSON report. Configure `audioInput`, `outputPath`, `intent`; optionally `audioItemId` for an exact collection member, `expectedScript` for existing offline ASR, `priorRejection`, and `limits` (`maxPauseSec`, `silenceThresholdDb`, `availableDurationSec`). Output parent must exist; paths stay inside the project and existing files are never overwritten.

Reports bind the source SHA-256 and retain rejection feedback. Checks cover rail hits, active 20 ms RMS levels, quiet intervals, coarse level spread, optional duration fit and broad speaking pace only with a confident transcript. Defaults are disclosed heuristics, not delivery loudness standards or acting scores. Naturalness, emotion, pronunciation quality, character fit and cross-character distinction remain **unchecked**; reports never grant approval or set deliveryReady true. No perceptual audio evaluator is currently configured. The runner does not trim, regenerate, upload or modify source audio.

Core can discover this runner through the existing extension. Run report nodes in a configured narrative bundle before reference approval. Core's current production intake enables creative reviews and refuses standalone non-narrative project execution; this increment does not change or bypass that restriction. A completed report node means checking ran, not that the voice passed.
# Production workflow integration

The Desktop extension registers `audio.check_voice`, `production.continuity_preflight` and `audio.prepare_narration` alongside the existing assembly runners. Core remains the MCP server and engine; these are bundle runner tools, not new top-level MCP actions. Existing bundles must declare the appropriate nodes and dependencies to use them; installing this extension does not rewrite a bundle.

Use the existing workflow in this order:

1. Read Core's creative guides and turn the brief into a script/storyboard. Obtain the first creative approval.
2. Generate character/location references and voice auditions. Run `audio.check_voice` on each audition before presenting references and voices for the second approval. Acoustic checks cannot approve acting or character identity.
3. Declare structured cast, props, location, movement, dialogue ownership and timing. Run `production.continuity_preflight` before GPU preparation. Resolve blocking contradictions and stale assets first. Its optional generation handoff provides exact reference ordering and freshness guards for Core `gpu.prepare`; it does not start generation.
4. Use the current GPU catalog and prepared selection for rendering. Inspect durable jobs before retrying. Preserve approved audio; use `audio.prepare_narration` where a continuous recording needs pause-based placement. Ambiguous boundaries require explicit timing hints.
5. Assemble selected clips, run `media.verify_assembly` and Core `media.check`, and inspect the picture. Present the rough cut for the third creative approval. Changes after approval require renewed review of the changed cut.

See [the 60-second film benchmark and release scope](../../docs/research/2026-11-04-return-to-sender-release.md) for demonstrated results and remaining work. These operations reduce repeated orchestration but do not yet constitute an unattended brief-to-film pipeline.

## Reusable soundtrack mixing

`audio.mix_soundtrack` adds a selected PCM16 bed under a full-timeline PCM16 dialogue stem. It preserves the dialogue's gain and timing, rejects clipping, requires at least 14 dB RMS dialogue-over-bed margin per declared spoken interval, and refuses intervals that omit dialogue samples louder than -45 dBFS. These are technical checks, not perceptual or lip-sync judgments. A combined mix is not sample-identical to its dialogue stem.

Declare a bundle stage using this runner after the selected dialogue and music inputs, before `ffmpeg.replace_audio`. The latter already supports sample-based `offsetSec`, PCM MOV masters and explicitly lossy AAC MP4 delivery. Use `audio.prepare_narration` for pause-based splitting; do not resynthesize approved voices for timing corrections.

Runner config (keys name upstream inputs):

```json
{
  "dialogueInput": "dialogue",
  "bedInput": "music",
  "planInput": "mix_plan",
  "outputPath": "film/mixed-v1.wav"
}
```

The JSON plan contains `dialogueSha256`, `bedSha256`, `bedGain` (0–1), optional `duckGain` (0–1, default 0.1), `fadeSec` (0.01–5, default 0.15), and ordered non-overlapping `speech` intervals with `startSec` / `endSec`. Fades apply at soundtrack ends and around speech. Both inputs must have identical sample rate/channels, be confined to the project, and be at most 128 MiB each. Dialogue may be at most 300 seconds; the bed must cover it. Longer beds are trimmed to that declared dialogue timeline, with the removed frame count recorded. The output parent must exist; outputs are never overwritten.

Core JSON snapshots and confined JSON plan files (64 KiB maximum) are supported. Sources are hashed again before publication. The runner saves source/mix hashes, measured speech margins, peak level and trim count in completion metadata. It never grants creative approval. Call it through Core `project.run` in a bundle with the existing narrative review gates and approved inputs; it is not a standalone MCP action. Existing bundles need an explicit stage declaration. Music/effect generation and creative selection remain upstream operations.
