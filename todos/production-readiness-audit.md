# Production-Readiness Audit

**Date:** 2026-05-15
**Scope:** kshana-desktop (renderer + main) + kshana-core (embedded engine)
**Method:** Parallel deep-dive across onboarding, error handling, observability, deployment plumbing, settings, cost visibility, multi-project concurrency, crash recovery, and project lifecycle.

This document captures every gap found, ranked by severity. The intent is to surface blind spots before launch — not to bikeshed polish. Items are grouped by when they will hurt: **day-one (data/money loss)** → **first-week (user bounce)** → **second-month (slow burn)**.

---

## Day-one blockers — correctness or money-loss bugs

These will cause irrecoverable user experience within the first ~50 installs. Each item is a single-fix scope.

### 1. Cross-project concurrency race (DATA CORRUPTION)

- **Where:** `kshana-core/src/tasks/video/workflow/activeProject.ts:26` (`activeProjectDir` is a process-global). `kshana-core/src/server/runners/executorRunner.ts:7-10` explicitly documents that JobManager serializes per-project only — cross-project is the caller's responsibility.
- **Symptom:** User runs Project A, switches the active project to B (without waiting), hits generate. Both runs share `activeProjectDir` globally; per-shot writers race on each other's `project.json`. Silent data corruption.
- **Fix options:** (a) IPC-layer guard — reject `runTask` while any session has `status === 'running'`; (b) thread `projectDir` explicitly through the executor pipeline and delete the global. (a) is fast, (b) is correct.
- **Severity:** BLOCKER

### 2. Silent ComfyUI / LLM error surface

- **Where:** `kshana-core/src/services/comfyui/ComfyUIClient.ts:45-63` (`enrichFetchError()` logs to `debug.log` only); `ComfyUIClient.ts:399` (HTTP errors caught upstream and dropped). LLM streaming JSON parse failures default to `{}` silently in `LLMClient.ts:791-789`. 200s timeout at `LLMClient.ts:490-492` is console-only.
- **Symptom:** Generation submits → `debug.log` records a 404 / 401 / timeout → user sees no toast, no chat error, no notification. For ComfyUI Cloud users the credit clock keeps ticking. We hit the *symptom* of this twice this conversation (the "no UI feedback on regen click" thread).
- **Fix:** Every IPC error path must surface via `events.onNotification({ level: 'error', message })` or a dedicated `tool_error` event the chat panel can render as a red error card. Bind to all `ComfyUIClient` + `LLMClient` rejection sites.
- **Severity:** BLOCKER

### 3. Cancellation does not interrupt in-flight cloud renders

- **Where:** `kshana-core/src/server/runners/BackgroundTaskRunner.ts:238-242` (cancel aborts the local controller). `kshana-core/src/services/comfyui/ComfyUIClient.ts:300-305` (`interrupt()` exists but is never called when cancel fires).
- **Symptom:** User clicks "Cancel" → local pipeline stops → ComfyUI GPU keeps processing to completion. On Cloud, this burns paid credits the user thinks they reclaimed.
- **Fix:** Chain `ComfyUIClient.interrupt(promptId)` into the cancel path. Track active-job prompt-ids on the runner so cancel can address them. Idempotent and safe to call against a finished job.
- **Severity:** BLOCKER (money loss for Cloud users)

### 4. API keys stored in plaintext

- **Where:** `kshana-desktop/src/main/settingsManager.ts:62-66` writes settings (including OpenRouter / OpenAI / Gemini / ComfyUI Cloud keys) to `~/Library/Application Support/kshana/kshana-settings.json` via electron-store. No encryption layer.
- **Symptom:** Any other process on the box can read the user's paid-API keys. Standard security regression for any app shipping to non-developers.
- **Fix:** Use `keytar` or `electron.safeStorage` for credential fields (`openaiApiKey`, `googleApiKey`, `openRouterApiKey`, `comfyCloudApiKey`). Keep non-sensitive settings (URLs, model names) in electron-store. ~half-day swap.
- **Severity:** BLOCKER

### 5. Non-atomic file writes — crash recovery is partial

- **Where:** `kshana-core/src/core/planner/ExecutorAgent.ts` (~8 direct `writeFileSync` calls with no temp-file-and-rename). Stale `.executor.stop` sentinel is handled (`kshana-core/src/server/runners/backgroundTaskRunnerSingleton.ts:55-61`) but partial PNGs / half-written JSON / truncated MP4s are not.
- **Symptom:** Power loss / force-quit mid-write → corrupted `project.json` or shot-prompt JSON. Next launch silently consumes garbage. `ProjectManager.ts` reports `'partial'` status but never acts on it.
- **Fix:** Add `atomicWriteFileSync(path, data)` helper (`writeFileSync(tmp); renameSync(tmp, path)`), replace bare calls in `ExecutorAgent.ts` and any other producer. Add a partial-file detector at boot that quarantines suspicious files.
- **Severity:** BLOCKER (data integrity)

---

## First-week bounce list — users churn within 5 minutes

These determine whether anyone *stays* past install. None are correctness bugs; all are UX gaps that make the product feel hostile to a new user.

### 6. Zero first-run guidance / setup wizard

- **Where:** `kshana-desktop/src/renderer/components/landing/LandingScreen/LandingScreen.tsx:230, 628-641` — app opens to "No projects yet — Create your first project." Click → `NewProjectDialog.tsx:741` asks for a workspace folder with no explanation of what to pick or why.
- **Symptom:** Non-technical user has no idea what folder to pick, has no idea they need an LLM key + ComfyUI URL configured first. Creates a project against a bad setup, the agent silently fails on the first generation, user bounces.
- **Fix:** Add a first-run modal that (a) explains workspace folder choice, (b) walks through the three configuration lanes (LLM provider, ComfyUI mode, optional VLM), (c) refuses to advance until at least one LLM lane is configured. Keep it skippable for power users but make the default flow safe.
- **Severity:** HIGH

### 7. No "test this key" validation in Settings

- **Where:** `kshana-desktop/src/renderer/components/SettingsPanel/` — accepts any string for API keys with no validation, no test endpoint, no preflight.
- **Symptom:** User pastes a typo'd OpenAI key, hits Save, opens a project, types in chat. Generation fails with a cryptic error deep in the agent loop. User can't tell whether the key, the model, the URL, or their prompt is wrong.
- **Fix:** Add a "Test key" button per provider that hits a tiny known endpoint (e.g., `GET /models` for OpenAI-compatible). Show green check / red X with the real error message. Same affordance for ComfyUI URL ("Ping server").
- **Severity:** HIGH

### 8. No cost visibility for paid APIs

- **Where:** Codebase has no `cost`, `token`, `pricing`, or `quota` tracking outside `accountManager.ts:40-77` (which fetches Kshana Cloud credit balance but doesn't display it in-flow).
- **Symptom:** App calls OpenAI / Gemini / OpenRouter (per-token billing) and ComfyUI Cloud (per-render billing). User sees zero spend feedback. First-time user runs a multi-shot project and racks up $50–$500 with no warning. This kills word-of-mouth fast.
- **Fix:** (a) Show a running spend counter in the chat panel header (token sums from LLM responses, render counts from ComfyUI). (b) Surface AccountInfo.credits prominently. (c) Pre-run cost estimate before kicking off `kshana_run_to`. (d) Optional spend cap setting.
- **Severity:** HIGH

### 9. No initial chat guidance / discoverability

- **Where:** `kshana-desktop/src/renderer/components/chat/ChatPanelEmbedded/ChatPanelEmbedded.tsx:600-650` — after project setup, the chat opens with an empty input and no example prompts, no `/help`, no quick-actions.
- **Symptom:** User has no idea what to type. The pi-orchestrator has rich tools (`kshana_run_to`, `kshana_status`, scene generation, override flows) that are completely undiscoverable. Compare to ChatGPT's example prompt cards on a fresh chat.
- **Fix:** Inject a starter message ("Hi! Tell me about the video you want to make — a story, a script, or a single scene") with 3-4 clickable example prompts ("Generate a 30-second sci-fi trailer", "Break down this script into shots", "Resume my last project"). Document `/help` as a hidden command.
- **Severity:** MEDIUM (high for non-power users)

### 10. Generic "Generating…" with no per-shot / per-step progress

- **Where:** `kshana-core/src/services/comfyui/ComfyUIClient.ts:686-706` — WebSocket message handler relays `currentNode` to progress callback, but `kshana-core/src/services/providers/comfyui/ComfyUIProvider.ts:686-694` discards it. Desktop IPC has `tool_call` / `tool_result` / `notification` but no `step_progress` event.
- **Symptom:** A 5-minute render shows one spinner. User can't tell if it's stuck or progressing. After 90 seconds, half quit.
- **Fix:** Plumb `currentNode` + percentage through a new `step_progress` event. Render a per-shot progress strip in the chat / timeline ("Shot 3 of 7 — Klein step 12/20 — 60%").
- **Severity:** MEDIUM

---

## Slower-burn — second-month problems

These are real but recoverable. Fix in order over the first month while users are forgiving.

### 11. Schema migration on app open is not wired

- **Where:** `kshana-core/src/core/project/projectSchema.ts:117-118` defines `schemaVersion: 3`. `backfillProjectSchema.ts` exists as a CLI helper (`pnpm backfill-schema`). Desktop boot never calls it.
- **Symptom:** v0.9-era projects opened by v1.0 fall through `classifyProjectState.ts:42` and are silently classified as 'fresh' — erasing visibility into the user's existing work.
- **Fix:** On `WorkspaceContext.openProject`, read `schemaVersion`. If `< current`, run `backfillProjectSchema` in-process. If the read fails, show a recovery modal instead of pretending the project is empty.
- **Severity:** HIGH (data invisibility, not loss)

### 12. No crash reporting / telemetry

- **Where:** `kshana-desktop/src/main/main.ts:3535-3542` handles `unhandledRejection` and `uncaughtException` via `electron-log` only. No Sentry. No upload. No user-facing "error occurred" toast.
- **Symptom:** User hits a bug → emails "the app crashed" → support has nothing to investigate. `debug.log` lives at `~/Library/Application Support/kshana/logs/debug.log` and the user doesn't know it exists.
- **Fix:** Wire Sentry (or equivalent) for crash + unhandled-rejection capture. Surface a one-click "Report this bug" affordance from the chat error UI that bundles the last N log lines and the project name (with PII redaction). `exportLogsZip` in `main.ts:1690` already exists — surface it from the error path instead of buried in Settings → Diagnostics.
- **Severity:** HIGH (support load)

### 13. No portable project export

- **Where:** `kshana-desktop/src/main/exporters/capcutGenerator.ts` exports a CapCut-shaped XML. No "zip up the whole project" affordance. No "import zipped project" path.
- **Symptom:** Users can't share projects with teammates, can't back up to Drive without manual folder copy, can't move between machines cleanly. Orphaned media paths if they copy partially.
- **Fix:** Add an "Export project" menu that zips `project.json`, `assets/`, `prompts/`, `chapters/` into a `*.kshana-archive` file. Symmetric import.
- **Severity:** MEDIUM

### 14. Disk grows unbounded, no cleanup

- **Where:** No GC, no per-project size display, no free-disk check. Per-shot PNGs + MP4s + intermediate Klein outputs accumulate forever. Temp-download cleanup callbacks exist (`tools.ts:1637, 1720`) for reference downloads only.
- **Symptom:** Power user crosses 100GB in a few months. Mac dies. They blame the app.
- **Fix:** (a) Per-project size badge in RecentProjects. (b) "Project storage" pane showing size by asset class. (c) "Free unused renders" button that deletes superseded `*_klein_*.png` and old `final_video<N>.mp4`. (d) Free-disk-space check before kicking off a generation.
- **Severity:** MEDIUM

### 15. Auto-updater plumbed but unvalidated

- **Where:** `electron-updater@6.3.9` in `package.json:153`. `main.ts:3308-3393` wires the full lifecycle (check / download / install). Disabled in dev (`main.ts:3290`). Publisher is GitHub releases (`package.json:394-399`).
- **Symptom:** No verification that a real packaged DMG/EXE auto-checks on launch and applies updates. First "we shipped 1.1, push update" event will reveal whatever's broken.
- **Fix:** Build a DMG, install it, ship a no-op 1.0.1 release, verify the user gets it. Document the rollback path.
- **Severity:** MEDIUM

### 16. Moved/deleted projects silently disappear

- **Where:** `LandingScreen.tsx:267-284` loads recent-project metadata via `checkFileExists` + `readFile`. If the user moved a folder in Finder, the entry quietly drops. No "this project moved — locate it?" prompt.
- **Symptom:** User reorganizes their drive, comes back, "my project is gone." Confusing.
- **Fix:** When a recent-projects entry resolves to a missing path, show it as muted with a "Locate…" affordance that opens a folder picker.
- **Severity:** LOW

### 17. No rename validation / safety

- **Where:** `RenameProjectDialog.tsx` accepts any string. Special characters (slashes, colons) cause silent rename failures via path normalization in `NewProjectDialog.tsx:78`.
- **Fix:** Validate the rename input against a safe-filename regex and surface "Contains characters that aren't valid in a folder name" inline.
- **Severity:** LOW

---

## What's actually solid

So this doesn't sound like everything is on fire:

- **Surgical regen pipeline** — end-to-end, in-process, well-tested. Recent cleanup removed all subprocess-spawning paths.
- **FFmpeg/FFprobe path resolution** via `KSHANA_FFMPEG_PATH` / `KSHANA_FFPROBE_PATH` env vars — the correct packaged-app contract; already implemented (`kshana-core/src/core/timeline/ffmpegBinaries.ts`).
- **Schema versioning** exists at the data layer (`projectSchema.ts:117`) and a backfill function (`backfillProjectSchema.ts`) is already implemented — just needs to be called on app open (#11).
- **Logging infrastructure** + ZIP export exist (`main.ts:1690`) — needs to be surfaced from the error path, not buried.
- **Test coverage** — 2348+ passing tests in kshana-core, comprehensive component tests for TimelinePanel and AssetRegenerateButton in the desktop.
- **IPC bridge contract** — well-typed, well-organized, isolates main from renderer cleanly.

---

## Recommended ordering

If you have **one weekend**:
- **#2** (error surfacing) + **#6** (first-run wizard) + **#8** (cost visibility)
- Converts the app from "looks polished, fails silently" to "feels like a product."

If you have **two weeks** before launch:
- All five day-one blockers (#1–#5)
- All first-week-bounce items (#6–#10)
- Plus #11 (schema migration) and #12 (Sentry)

If you have **a month**:
- Above plus #13 (export), #14 (disk), #15 (updater validation).
- Leave #16, #17 for polish-round in week 6.

---

## Open questions for the team

1. **Single-user or multi-user?** If multi-user (shared workspaces), #1 (concurrency) needs the deeper fix, not the IPC guard.
2. **Cloud-first or local-first?** If most users will use ComfyUI Cloud and a hosted LLM, #3 (cancel) and #8 (cost) escalate to top-of-the-stack. If most are local, they're lower priority.
3. **Who hosts errors?** Sentry, self-hosted, or none? #12 depends on this answer.
4. **Schema bump cadence?** If you're shipping breaking schema changes weekly, #11 is critical; if it's once a quarter, the CLI is acceptable for now.
