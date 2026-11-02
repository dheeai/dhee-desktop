# Desktop ownership migration review — 2 November 2026

> Updated user direction: Core may receive necessary fixes and reusable execution support; it need not remain byte-for-byte unchanged. Desktop is the primary product-development repository. Retain existing verified engine gates/exact dispatch rather than reimplementing the engine merely to avoid Core edits. The strict unchanged-Core proposal below is historical and superseded where it conflicts.

## Requested outcome

One feature branch to ship in dhee-desktop. Desktop owns production policy, UX and Codex/MCP controls; unchanged dhee-core remains the execution engine. Continue the existing production plan, three creative approvals and real Brilliant Care acceptance. No push or PR authorized.

## Review result

This is more than moving the last three feature files. Relative to the locally recorded upstream Core commit `75ec0b0c056a385eca41ce6fe7f0cbb239dcc5f6`, the current branch changes 43 tracked files, plus six untracked feature/test files. The production-control export, review-gate enforcement and exact-instance execution are all local additions. Desktop currently resolves `dhee-core` from `file:../dhee-core`; passing tests with that modified sibling does not prove Desktop-only portability. The upstream reference was read locally, not refreshed from GitHub in this review.

No product code has been relocated yet. Existing verified code and accepted media are preserved while selecting the safe execution boundary. The old two-repository push recommendation is superseded by this ownership requirement.

## Ownership map back to the existing plan

| Existing plan | Desktop-owned destination | Core reused | Migration risk / acceptance |
| --- | --- | --- | --- |
| F02 setup / RTX queue | Production services: gateway client, catalog, durable jobs, preparation, recovery | Existing runner discovery and graph execution | Preserve attempt identities, unknown-outcome handling, cancellation and downloads; no direct Comfy bypass |
| F03 creative approvals | Production review service, frozen previews and decisions | Existing artifact/version/event APIs | Enforcement currently lives inside modified walker; must hold across Desktop UI, Codex and regeneration, not merely hide buttons |
| F04 storyboard | Existing storyboard workspace and future intake/planning services | Existing LLM/bundle runners | Materials-to-storyboard and full multiscene acceptance remain planned, not completed by this migration |
| F05 voice | Desktop-owned narration runner and timing controls | Runner SDK / extension mechanism | Preserve PCM comparison, AAC limitation, source hashes, fit checks and no-clobber writes |
| F06 scene checks | Desktop-owned scene-intent and QC services | Existing artifact projections | Keep declared-observation limitations, input-byte binding and stale-result protection |
| F07 assembly | Desktop-owned normalization runner and assembly controller | Existing concat runner | Explicit crop/fit/trim/pad; exact selected dispatch; no implicit prerequisite generation |
| F08 delivery | Desktop-owned delivery policy and report persistence | Existing media outputs | Persistent final-ready gate remains unfinished; do not turn old technical passes into new approvals |
| F09 Codex/MCP | One Desktop-owned production service, called by UI and headless adapter | Core public APIs | Current interface is CLI/API, not an installed MCP server. Add actual MCP transport separately against same service |
| F10 reliability | Desktop operation coordination and status | Existing engine locking/version history where usable | Verify concurrent UI/Codex operations, stale selection, retries and no repeat paid dispatch |
| F11/F12 polish / reuse | Desktop UI, recipes and portability | Existing bundles | Unchanged backlog, no new editor/rewrite scope added |

## What can move without changing the engine

- Scene-intent schema/comparison/hash helpers.
- GPU gateway client, input validation and durable queue records.
- FFmpeg narration replacement and normalization, expressed as external runner extensions using the public runner SDK, not Core internal imports.
- Technical media analysis and product-facing report formatting.
- Production request schemas, CLI/MCP transport and Desktop IPC adapter ownership.

Each move must include its behavioral tests and dependency/build wiring. Copying files without routing both UI and Codex to the new owner is not completion.

## Boundary that requires design work

The current walker additions enforce full-plan approval membership, exact instance dispatch, expected selection/tool pinning under lock, and refusal to generate missing prerequisites. The recorded upstream public API does not provide those same options. Its `runOnly` is a cascade, not exact instance execution; `stopAt` can generate prerequisites. Substituting either silently would regress verified behavior. Some new services also import internal lock/state/materialization modules that are not upstream public exports.

## Approaches

1. **Desktop-owned services and runner extensions using unchanged public Core APIs (recommended target).** Prove a host-side enforcement design first. Preserve the existing executor, versions and graph; fail closed where the upstream API cannot satisfy the contract. This is the intended architecture, but compatibility is not yet proven. If a narrow engine hook is genuinely necessary, report it explicitly before deciding whether it belongs upstream.
2. **Desktop-owned patched copy of Core.** A pinned source snapshot/patch overlay could retain current behavior and allow one repository push, but it is still a maintained engine fork. It does not satisfy the intent of consuming unchanged Core and is not recommended without explicit approval.
3. **Push the current Core changes too.** Smallest migration effort, but contradicts the user's Desktop-only branch decision. Not selected.

Do not present a vendored fork, a cross-repository source import or an unpublished Core commit as an unchanged dependency. Do not weaken review/execution safeguards to make the dependency appear clean.

## Proposed migration sequence

1. Preserve the current Core diff, untracked feature files and test evidence as a recovery snapshot. Do not reset the working Core branch during the move.
2. Create a clean-baseline compatibility harness against the recorded upstream commit. No changed Core source, dist or node_modules symlink may leak into the acceptance run.
3. Move independent helpers/runners and their tests into Desktop-owned production modules. Verify public runner discovery against clean Core.
4. Prove approval and exact-dispatch enforcement with the unchanged engine: unapproved run, changed selection, missing prerequisites, branch/collection scope, direct UI regeneration and concurrent CLI/UI operations. Resolve any unavailable engine hook explicitly before rewiring production.
5. Route Desktop IPC and Codex CLI through the single Desktop-owned service; add MCP transport on that same boundary per F09. Retain protocol schemas and error semantics.
6. Repeat the real Brilliant Care pipeline in a copied project, compare approved narration/final media, test review rejection and restart recovery. Prior results do not certify the relocated architecture.
7. Verify a Desktop-only build/packaging path, update the ownership/verification tracker, then remove superseded Core changes only after the migration is proven. Push remains a separate user instruction.

## Completion gate

A clean checkout of the Desktop branch with the pinned unchanged Core dependency must build and drive the real baseline through Codex without the modified sibling Core checkout. Review gates, exact dispatch, queue durability and source/version checks must remain intact. Full product readiness and full materials-to-video automation remain separate milestones.
