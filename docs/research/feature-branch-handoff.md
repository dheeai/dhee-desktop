# Production workflow branch handoff — 3 November 2026

Use `feat/rtx-5090-queue` in **both** repositories. Desktop owns the production experience and media checker; Core owns MCP and the shared engine. This Desktop checkpoint requires Core commit `1ba88b07e1b6561a681f03e1942f49fabb249352` or a compatible descendant. No PR or merge is implied by this feature-branch checkpoint.

## Checkout and build

Clone as siblings into a new working directory:

```sh
git clone --branch feat/rtx-5090-queue https://github.com/dheeai/dhee-core.git
git clone --branch feat/rtx-5090-queue https://github.com/dheeai/dhee-desktop.git
cd dhee-core
pnpm install
pnpm build
cd ../dhee-desktop
npm install
npm run audit:core-integration
npm run test:core-guides
npm start
```

For existing clean checkouts, run `git fetch origin`, `git switch feat/rtx-5090-queue`, and `git pull --ff-only origin feat/rtx-5090-queue` in **each** repo. Preserve unrelated local work before switching. Build Core before Desktop, including before Desktop typechecking; rebuilding Core clears its dist temporarily.

Follow each repo's Node/package-manager prerequisites. These are source-development instructions; clean-machine, signed packaged-app and cross-platform acceptance remain pending. The audit discovers MCP actions and Core guides without generation; a completed audit is not proof that every listed capability is implemented or that GPU services are online.

## Codex control and runtime setup

Register the built Core stdio entry `dhee-core/dist/mcp/cli.js` with your Codex MCP configuration, using Node and an absolute path. Set `DHEE_NODE_MODULES_DIRS` to a JSON array containing the absolute `dhee-desktop/packages` path so Core discovers Desktop's production runners. Alternatively use the documented Desktop compatibility launcher, which delegates the actual server to Core. See [production extension instructions](../../packages/dhee-runner-production/README.md).

The tool is `dhee_production_control`. Start with `project.status`, `bundle.list` or `bundle.describe`; discover the current action schema instead of assuming embedded-agent tools are MCP tools. Use Desktop's `.agents/skills/dhee-production/SKILL.md`, which resolves guidance from the companion Core checkout. GPU generation requires the existing authorized RTX queue configuration, network access and available workflows; no credentials are committed. Optional English speech checking requires a local faster-whisper model and Python runtime, configured through `DHEE_ASR_MODEL_PATH` and `DHEE_ASR_PYTHON`.

## What this checkpoint enables

- Bundle discovery/material intake through Core MCP; supported stage-input editing and preserved-version restoration, with downstream impact and stale-approval handling.
- Desktop production editing controls and Core creative-guide discovery/audit.
- Persisted, version/hash-bound technical checks that can be reloaded in Desktop.
- Exact selected assembly with corrected hard-cut audio timing and approved-narration preservation.
- Configured automatic assembly checks: duration/decode, sampled picture order, narration alignment and optional English script comparison. Uncertain or unavailable assessments remain unchecked.
- Three human gates: storyboard, references/voice and rough cut. Automated analysis never grants creative or delivery approval.

## Evidence and limits

A real 14-second, three-scene Brilliant Care existing-clips project was created, normalized, narrated, assembled and checked via Core MCP, then opened and played in native Desktop. All eight mechanical checks passed, original source files stayed unchanged, and rough-cut approval remained pending. The earlier unwanted “Narrator” audition was rejected; the corrected long narration matched; uncertain recognition of the opening sentence remained unchecked. The older timing-defective cut failed all three narration-alignment checks. Private client media, machine profiles and runtime credentials are deliberately not in either repository; obtain authorized materials separately to reproduce the exact media benchmark.

Fresh checkpoint checks: 193 Desktop suites / 1,657 tests pass; Core has 1,779 passing tests, three missing-fixture failures and one todo. Nine MCP protocol tests and four guide-resolver tests pass. Both typechecks and production builds pass. The three Core failures all load an absent external `illustrated_story_animated` bundle from a hardcoded developer-local path. That fixture is separate from the verified existing-clips workflow; the full Core suite is not green.

## Next work

1. Semantic scene review against explicit actor/action/continuity requirements, using the intended RTX vision service once its endpoint is verified. Source-image similarity is not scene understanding.
2. Improve uncertain speech review and supported checker reruns; preserve approved audio and avoid silently converting uncertainty to a pass.
3. Improve storyboard, voice and editing screens, then connect current checks and creative approval to final delivery/export readiness.
4. Verify the complete materials-to-film journey, followed by packaged-app acceptance. Existing RTX generation was tested earlier; this checkpoint did not repeat generation or prove a full film.

## Research findings

The tests showed that a render completing is weaker evidence than a usable video. AAC packet padding can shift narration at joins; decoding the timelines and encoding once corrected the reproduced drift. Reference-audio matching caught that defect independently. Speech recognition caught an actual spoken label but was uncertain on a short opening line, so confidence and human review must remain visible. Picture matching verifies assembly order; it does not establish who moved or whether an action fits the storyboard. These findings are why generation, mechanical checks, semantic review and human approval are separate steps.
