# Dhee Desktop

Electron desktop application for **Dhee Studios**. The app bundles the `dhee-core` TypeScript backend and runs it **in the Electron main process** — there is no separate server, no localhost port, no spawned CLI. The renderer talks to the embedded `ConversationManager` over a typed IPC bridge (see `src/shared/dheeIpc.ts`).

Hosted/cloud dhee-core mode has been descoped — the app is local-only at present. ComfyUI cloud (pointing at `https://cloud.comfy.org` or another remote ComfyUI URL) is unrelated and still supported in Settings → Connection.

## Prerequisites

- Node.js 20+
- npm
- sibling `dhee-core` repo at `../dhee-core`
- ComfyUI if you want local image/video generation
- LM Studio, Gemini, or OpenAI-compatible credentials if you want local LLM-backed generation

Notes:

- The product no longer depends on a Python backend.
- Local packaging can still rebuild native Node modules used by `dhee-core`, so build machines may still need a working native toolchain.

## Development

### 1. Build `dhee-core`

```bash
cd ../dhee-core
pnpm install
pnpm build
```

### 2. Install desktop dependencies

```bash
cd ../dhee-desktop
npm install
```

### 3. Start the desktop app

```bash
npm run start
```

In development:

- `dhee-core/manager` is dynamically imported by the Electron main process at app start (see `src/main/dheeCoreManager.ts`); it owns the `ConversationManager` for the lifetime of the app.
- No subprocess is spawned and no localhost port is opened — everything runs in-process.

You do not need to run `dhee-core` separately for the normal desktop flow. You only need `pnpm build` in the sibling repo so the dist that the manager imports exists.

## Settings

Connection settings cover ComfyUI and the LLM provider for the bundled local backend. Currently supported providers:

- LM Studio
- Gemini
- OpenAI-compatible providers

## Production Packaging

### How bundling works

`dhee-core` is bundled as a package artifact, not as a symlink.

Current flow:

1. `verify:dhee-core`
   - checks that `../dhee-core` exists
   - checks that the built server entry exists
   - writes `release/app/.dhee-core-version.json`
2. `prepare:app-deps`
   - runs `npm pack` in `../dhee-core`
   - writes the tarball into `release/app/vendor`
   - rewrites `release/app/package.json` to depend on that tarball
   - runs a production `npm install` in `release/app`
3. `build`
   - builds Electron main and renderer
4. `electron-builder build`
   - packages `release/app` into the final installers

This avoids the old `file:../dhee-core` symlink problem inside packaged Electron apps.

### Local packaging

```bash
npm run package
```

Build macOS artifacts only:

```bash
npm run package:mac
```

Build Windows artifacts only:

```bash
npm run package:win
```

Build every configured local target:

```bash
npm run package:all
```

`npm run package:all` needs substantially more disk space than `npm run package`.

### Release packaging

```bash
npm run release
```

## Runtime Model

- `dheeCoreManager` (Electron main; logs as `DheeCoreManager`) dynamically imports `dhee-core/manager` and constructs a `ConversationManager` once on app start
- the renderer calls into it via the typed `window.dhee.*` bridge (preload) which `ipcRenderer.invoke`s the channels in `src/shared/dheeIpc.ts`
- streaming events from the conversation manager (`tool_call`, `progress`, `agent_response`, `media_generated`, …) are republished from main → renderer over a single `dhee:event` channel

## Bundled Backend Assets

The packaged `dhee-core` artifact includes:

- `dist/`
- `prompts/`
- `workflows/`

These are required at runtime for:

- server startup
- prompt loading
- ComfyUI workflow loading

## Project Structure

```text
dhee-desktop/
├── src/
│   ├── main/
│   ├── renderer/
│   └── shared/
├── .erb/
│   └── scripts/
├── release/
│   └── app/
└── assets/
```

## Project Creation

Desktop projects use a normal folder root:

```text
my-project/
├── .dhee/
├── assets/
└── prompts/
```

The outer project folder does not need a `.dhee` extension.

## Known Build Caveats

- `dhee-core` still includes some native modules such as `sharp`
- packaging may trigger Electron/native rebuild steps depending on dependency state
- local build machines should use a current Node/npm toolchain compatible with the Electron version in this repo

## IPC API

There is no network protocol. The renderer talks to the embedded
`ConversationManager` over typed Electron IPC. All channels and
payload shapes live in `src/shared/dheeIpc.ts`. The renderer-
facing surface is `window.dhee.*` (see `src/main/preload.ts`).

### Renderer → main (request/response)

| Channel | Purpose |
|---------|---------|
| `dhee:createSession` | Create a chat session (returns `sessionId`) |
| `dhee:configureProject` | Bind a session to a project + template/style/duration |
| `dhee:focusProject` | Switch the session to an existing project on disk |
| `dhee:runTask` | Dispatch a user message; streams events on `dhee:event` |
| `dhee:sendResponse` | Reply to an `agent_question` |
| `dhee:cancelTask` | Cancel the in-flight chat turn |
| `dhee:redoNode` | Edit a prompt + invalidate dependents + resume |
| `dhee:invalidateNodes` | Mark executor nodes pending without resuming (Prompts-tab edit flow) |
| `dhee:setAutonomous` | Toggle autonomous mode for the session |
| `dhee:setPiOversight` | Toggle pi-agent oversight |
| `dhee:setVlmJudge` | Toggle VLM judge (gated by oversight) |
| `dhee:runnerCancel` | Cancel the active background task (dhee_run_to et al) |
| `dhee:runnerStatus` | Snapshot of the active background task or `null` |
| `dhee:deleteSession` | Tear down a session |

### Main → renderer (streaming events)

All events publish on the single `dhee:event` channel as
`{ eventName, sessionId, data }`. `eventName` mirrors `dhee-core`'s
`ServerMessageType`:

`progress`, `tool_call`, `tool_result`, `todo_updated`,
`agent_response`, `agent_question`, `status`, `stream_chunk`,
`context_usage`, `phase_transition`, `timeline_update`,
`notification`, `project_focused`, `media_generated`.
