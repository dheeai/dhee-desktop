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

This feature branch was verified with `dheeai/dhee-core` commit `8094ea7df807afd395e59634b9e3f6785b14299a` on `feat/rtx-5090-queue`. Use that companion revision, which owns and exports MCP, when reproducing the local acceptance. Earlier Core revisions do not provide these MCP exports. The Desktop packaging scripts pack the companion Core checkout and this extension into vendor tarballs.

The bounded acceptance is a four-second real scene, including approved narration preservation, normalization, assembly and checks. Full materials-to-film automation, persisted final-delivery readiness and signed/cross-platform packaged acceptance remain separate backlog work.
