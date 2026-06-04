---
description: Restart the dhee-desktop Electron app — kill any running instance, rebuild the dhee-core dist (so source changes are picked up), then `npm start` in the background.
---

Run these steps in order. **Do NOT skip the dist rebuild** — the desktop loads dhee-core via package.json `exports` pointing to `./dist/...`, so source-only edits are invisible to the running app until tsup runs.

### 1. Kill any existing instance

```bash
pkill -9 -f "electron.*dhee-desktop" 2>/dev/null
pkill -9 -f "electronmon.*dhee-desktop" 2>/dev/null
pkill -9 -f "concurrently.*dhee-desktop" 2>/dev/null
sleep 2
ps aux | grep -E "dhee-desktop|electronmon" | grep -v grep | wc -l
```

If the count is non-zero, retry the pkills once more, then proceed.

### 2. Rebuild the dhee-core dist

```bash
cd /Users/ganaraj/Projects/dhee-core && pnpm tsup
```

Expected: ESM + CJS bundles in ~250ms each, DTS in ~8s. If tsup fails, surface the error and stop — don't start the desktop with a stale dist.

### 3. Drop the stale desktop dev bundle

The desktop's webpack sometimes treats unchanged source as cache-clean even when `dhee-core` changed. Force a fresh main-process bundle:

```bash
rm -f /Users/ganaraj/Projects/dhee-desktop/.erb/dll/main.bundle.dev.js \
      /Users/ganaraj/Projects/dhee-desktop/.erb/dll/preload.bundle.dev.js \
      /Users/ganaraj/Projects/dhee-desktop/.erb/dll/tsconfig.tsbuildinfo
```

### 4. Start the app in the background

```bash
cd /Users/ganaraj/Projects/dhee-desktop && DHEE_DEBUG_PORT=9223 npm start
```

`DHEE_DEBUG_PORT=9223` opens Electron's CDP socket on `127.0.0.1:9223`
so the `desktop-drive` CLI (`pnpm desktop-drive screenshot|click|...`)
and Claude Code's Chrome-DevTools MCP tools can attach and drive the
running window. The switch is read in `src/main/main.ts` before
`app.whenReady()`. It's gated on the env var, so packaged builds never
expose the port. If a downstream script doesn't need driving, dropping
the prefix is safe.

Use the **Bash tool's `run_in_background: true`** option so the command kicks off detached.

### 5. Probe the CDP socket — do NOT ask the user whether it's up

This machine boots Electron in ~10 seconds (per user feedback 2026-05-28). After kicking off the background start, wait 10s then probe directly:

```bash
sleep 10 && DHEE_DEBUG_PORT=9223 npm --prefix /Users/ganaraj/Projects/dhee-desktop run desktop-drive url
```

If the probe returns `ok:true` — proceed with whatever verification step comes next. Do not stop and ask the user. They already know they want to keep iterating.

If the probe returns `ECONNREFUSED` — wait another 5s and probe again, up to ~30s total. Only escalate to the user if probes keep failing past that (e.g. webpack compile error in the task output).

Mention this once in your reply for context:

> Desktop restarting (task `<task-id>`). Probing CDP in ~10s, then continuing with the verification step. CDP on `127.0.0.1:9223`.

### Notes

- If `pnpm tsup` produces TypeScript diagnostic errors that come from `dhee-desktop` (e.g. `dheeCoreManager.ts: Cannot find name '...'`), those are **expected noise** from the broader desktop tree — they don't affect the dist build. Only stop if tsup itself exits non-zero.
- The desktop's `logs/` directory is auto-created on first ComfyUI call thanks to `findKshanaCoreRoot` anchoring of `debugLog`, so no manual `mkdir` is needed.
- If a project is already mid-run when this command fires, the in-flight `BackgroundTaskRunner` task gets killed along with the process. State on disk is unchanged; the next dispatch resumes from where the executor left off (with the stale-stop-file pre-flight in place from `preflightStopFile.ts`, so leftover `.executor.stop` sentinels won't poison the resume).
