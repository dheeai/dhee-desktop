# Desktop production ownership implementation plan

> Updated user direction: Core may receive necessary fixes and reusable execution support; it need not remain byte-for-byte unchanged. Desktop is the primary product-development repository. Retain existing verified engine gates/exact dispatch rather than reimplementing the engine merely to avoid Core edits. The strict unchanged-Core proposal below is historical and superseded where it conflicts.

> Use superpowers:executing-plans inline. Preserve the approved production backlog.

**Goal:** Desktop owns production services and Codex adapters while consuming unchanged Core.
**Architecture:** Move independent services/runners first; prove engine boundary compatibility before changing callers. No patched/vendor Core fork or weaker review enforcement.
**Tech stack:** TypeScript, existing Jest, public runner SDK, Core npm runner discovery, JSON CLI followed by MCP adapter.
**Spec:** ../specs/2026-11-02-desktop-production-ownership-review.md

## Global constraints
- Local only; preserve accepted media and original Core implementation until parity.
- Three creative approvals, shared RTX queue, no implicit prerequisite or sibling generation.
- Do not interpret the existing Scene01 pass as migration acceptance.

## Tasks
- [ ] 1. Desktop-owned independent production package: port scene-intent and normalization/narration behavior tests (observe missing-module failure); port implementations using public SDK types and Desktop FFmpeg dependencies; export runner manifests; build ESM package; pass behavioral tests.
- [ ] 2. Clean upstream compatibility harness: extract exact upstream75ec0b0 into isolated scratch without source patches; expose Desktop package through existing npm discovery; test real runner discovery and media execution. Source and generated artifacts must not come from modified Core.
- [ ] 3. Move queue/control/review services behind Desktop-owned production API; prove full-plan review membership, locks, exact dispatch, stale selections and direct regeneration before redirecting IPC/CLI. If public Core API cannot preserve these, document the precise missing hook rather than substitute cascade execution.
- [ ] 4. Route UI and CLI/MCP to one controller; verify real Scene01 in isolated copy, focused regressions and Desktop packaging against clean Core. Remove old Core implementation only after parity. Update original plan/verification tracker, then report readiness without pushing.

## Review focus
Package discovery from Electron cwd; FFmpeg asar paths; independent SDK types; no stale Core dist leakage; gate bypass through alternate execution path. Each requires explicit verification before claiming complete migration.

## Execution checkpoint / clarified scope

Tasks1–2: Desktop package extracted and source-discovery/real-media verified. Clean upstream full build fails its missing cvCaptions import; no clean-Core claim. User then explicitly allowed necessary Core support.

Tasks3–4 revised: retain existing generic Core queue/review/exact-run service; route five Desktop IPC adapters and headless Desktop CLI through Desktop-owned production entry. Moved both media runners out of Core builtins; add only JSON runner-root parsing in Core for portable extension discovery. Real Desktop CLI chain passed after review fixes. Build/tarball checks passed; full packaged/native acceptance and MCP transport remain in the original backlog.
