# Remaining production work — local execution

User requested completing remaining work. Preserve the current Desktop design, RTX-only generation scope, Core MCP engine, exact targets, approved media and three creative gates. Initially local-only; user authorized verification and push on 2026-11-05. Continue the existing feature branch.

## Execution order
1. Finishing UX: correctly name soundtrack/narration tools, explain audio effects, separate loading/empty/error states, invalidate assembly results on material changes, summarize technical findings without claiming creative approval.
2. Checks UX: explicit loading/empty/error states, clear saved-result freshness, accessible consistent controls. Preserve Core report semantics and exact selection.
3. Verify native workflows with the existing isolated film copy, including narrow windows. No new creative approvals or generation needed to test these UI paths.
4. Verify fresh distribution of production runners, Core integration and packaged startup. Fix discovered local packaging faults; record any environment/tooling blockers without claiming acceptance.
5. Reconcile remaining automatic visual/lip-sync review and targeted recovery with available RTX capabilities. Do not invent a vision service or substitute segmentation for semantic review.

## Evidence and rulings
- Live RTX catalog inspected: 22 workflows, including speech, scene generation, music, images, segmentation and tracking; no semantic scene reviewer or lip-sync evaluator. Generation availability does not validate those checks.
- Existing reusable code already includes narration preparation, soundtrack mixing, normalization, voice checks and continuity preflight. Do not recreate these or repeat isolated generation proofs.
- Ruling: complete discoverability and stale-result handling before adding new orchestration. Incorrectly labelled tools and stale results make existing capabilities hard to use reliably.
- Existing 60-second film remains the production example; fresh materials-to-film acceptance remains separate from unit tests or reused-asset checks.

## Completed locally
- Finishing/checks UX now separates loading, lookup errors and empty results. Matching material-change events clear assembly evidence and reject late responses; exact target pinning and creative gates are unchanged.
- Technical results summarize pass/fail/unchecked counts without implying delivery approval. Finishing copy explains dependency-driven soundtrack mixing and directs users to Checks. Shared controls now use app typography, colors and focus styles.
- Fixed packaging checkout resolution: install-app-deps previously ignored dhee_CORE_PATH. Verification, packing and bundle staging now share one resolver, including blank-value fallback and legacy support.
- Behavioral regressions failed before changes. Final full suite: 210 suites / 1,835 tests passed. Read-only review found no blockers. TypeScript and renderer build passed.
- Native isolated Electron test discovered the real finishing target and existing media. A real voice-file check executed through renderer/preload/Core; duration/format/decode/peak checks passed, silence was correctly flagged for review. No media source or creative approval changed. Screenshots under outputs/Dhee-Finishing-{900,1280}.png and Dhee-Media-Checks.png.
- Fresh source snapshots of both branches include local changes. Core dependencies installed and full build passed. Desktop offline install lacked packages; initial online install timed out at npm registry, bounded cached retry in progress.

## Remaining boundary
- The developer finishing template has intentional dependent-input lineage requirements; do not silently promote it into a ready-made intake wizard or package it as a one-click full-production workflow.
- Semantic review adapter already supports an OpenAI-compatible image endpoint configured by DHEE_REVIEW_VLM_BASE_URL and DHEE_REVIEW_VLM_MODEL. The current RTX generation catalog provides no matching evaluator. Video lip-sync evaluation needs temporal audio/video evidence; sampled still-frame checks cannot prove it.
- Automatic targeted creative repair needs a validated evaluator plus bounded retry rules and reapproval for altered creative material. Technical checks alone must not trigger speculative rerenders or pass creative work.
- Fresh full-film acceptance still requires a new brief and the user's three actual approvals; reusing an accepted cut tests mechanics, not new creative acceptance.


## Fresh checkout and native execution findings
- Clean Desktop dependency install succeeded on bounded retry; Core full build, Desktop production build, runtime packaging and fresh Core integration discovery passed.
- Built an unsigned macOS arm64 app with publishing/notarization disabled. It launched with a clean profile using its actual executable (no launcher shim); Core imported from packaged exports, manager and IPC started, renderer loaded and ping/pong succeeded. An unsigned directory build lacks app-update.yml, so updater logs an expected non-blocking missing-metadata error; signed updater/distribution acceptance is not established.
- Native exact assembly correctly refused the isolated project because soundtrack was incomplete. Contrary to initial UI wording, exact assembly never creates prerequisites. Corrected guidance: finish soundtrack dependencies through Codex first. Existing Core project.run is the dependency-aware path; no approval was bypassed and no completed mix was claimed.
- Ruling: keep the developer example explicit rather than silently install it as a standard bundle. Built-in narrative bundles are staged by packaging. This preserves intake/lineage constraints documented in its README.

- Packaged onboarding and home screen verified visually; read-only project bridge discovered both built-in narrative bundles. No keys were copied into the clean profile. Screenshots: outputs/Dhee-Fresh-Packaged-Startup.png and Dhee-Fresh-Packaged-Home.png.

## Pre-push verification — 2026-11-05
- Re-ran the full Jest suite: 210 suites / 1,835 tests passed. TypeScript no-emit, full main/renderer production build, and Core integration audit completed successfully. Audit capability gaps remain limitations, not passes.
- Final independent diff review found no blockers. Git identity matched the connected GitHub account.
- Push scope: Desktop production UX, soundtrack controls, RTX queue review/recovery, stale-result handling, and consistent Core-path resolution. Core has no source changes. Film assets and project-specific orchestration remain outside both repositories. No PR requested.
