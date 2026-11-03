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
