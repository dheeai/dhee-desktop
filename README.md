# Kshana Desktop

Electron desktop application for Kshana. The app bundles the `kshana-core` TypeScript backend and runs it **in the Electron main process** — there is no separate server, no localhost port, no spawned CLI. The renderer talks to the embedded `ConversationManager` over a typed IPC bridge (see `src/shared/kshanaIpc.ts`).

Hosted/cloud kshana-core mode has been descoped — the app is local-only at present. ComfyUI cloud (pointing at `https://cloud.comfy.org` or another remote ComfyUI URL) is unrelated and still supported in Settings → Connection.

## Prerequisites

- Node.js 20+
- npm
- sibling `kshana-core` repo at `../kshana-core`
- ComfyUI if you want local image/video generation
- LM Studio, Gemini, or OpenAI-compatible credentials if you want local LLM-backed generation

Notes:

- The product no longer depends on a Python backend.
- Local packaging can still rebuild native Node modules used by `kshana-core`, so build machines may still need a working native toolchain.

## Development

### 1. Build `kshana-core`

```bash
cd ../kshana-core
pnpm install
pnpm build
```

### 2. Install desktop dependencies

```bash
cd ../kshana-desktop
npm install
```

### 3. Start the desktop app

```bash
npm run start
```

In development:

- `kshana-core/manager` is dynamically imported by the Electron main process at app start (see `src/main/kshanaCoreManager.ts`); it owns the `ConversationManager` for the lifetime of the app.
- No subprocess is spawned and no localhost port is opened — everything runs in-process.

You do not need to run `kshana-core` separately for the normal desktop flow. You only need `pnpm build` in the sibling repo so the dist that the manager imports exists.

## Settings

Connection settings cover ComfyUI and the LLM provider for the bundled local backend. Currently supported providers:

- LM Studio
- Gemini
- OpenAI-compatible providers

## Production Packaging

### How bundling works

`kshana-core` is bundled as a package artifact, not as a symlink.

Current flow:

1. `verify:kshana-core`
   - checks that `../kshana-core` exists
   - checks that the built server entry exists
   - writes `release/app/.kshana-core-version.json`
2. `prepare:app-deps`
   - runs `npm pack` in `../kshana-core`
   - writes the tarball into `release/app/vendor`
   - rewrites `release/app/package.json` to depend on that tarball
   - runs a production `npm install` in `release/app`
3. `build`
   - builds Electron main and renderer
4. `electron-builder build`
   - packages `release/app` into the final installers

This avoids the old `file:../kshana-core` symlink problem inside packaged Electron apps.

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

- `KshanaCoreManager` (Electron main) dynamically imports `kshana-core/manager` and constructs a `ConversationManager` once on app start
- the renderer calls into it via the typed `window.kshana.*` bridge (preload) which `ipcRenderer.invoke`s the channels in `src/shared/kshanaIpc.ts`
- streaming events from the conversation manager (`tool_call`, `progress`, `agent_response`, `media_generated`, …) are republished from main → renderer over a single `kshana:event` channel

## Bundled Backend Assets

The packaged `kshana-core` artifact includes:

- `dist/`
- `prompts/`
- `workflows/`

These are required at runtime for:

- server startup
- prompt loading
- ComfyUI workflow loading

## Project Structure

```text
kshana-desktop/
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
├── .kshana/
├── assets/
└── prompts/
```

The outer project folder does not need a `.kshana` extension.

## Known Build Caveats

- `kshana-core` still includes some native modules such as `sharp`
- packaging may trigger Electron/native rebuild steps depending on dependency state
- local build machines should use a current Node/npm toolchain compatible with the Electron version in this repo

## IPC API

There is no network protocol. The renderer talks to the embedded
`ConversationManager` over typed Electron IPC. All channels and
payload shapes live in `src/shared/kshanaIpc.ts`. The renderer-
facing surface is `window.kshana.*` (see `src/main/preload.ts`).

### Renderer → main (request/response)

| Channel | Purpose |
|---------|---------|
| `kshana:createSession` | Create a chat session (returns `sessionId`) |
| `kshana:configureProject` | Bind a session to a project + template/style/duration |
| `kshana:focusProject` | Switch the session to an existing project on disk |
| `kshana:runTask` | Dispatch a user message; streams events on `kshana:event` |
| `kshana:sendResponse` | Reply to an `agent_question` |
| `kshana:cancelTask` | Cancel the in-flight chat turn |
| `kshana:redoNode` | Edit a prompt + invalidate dependents + resume |
| `kshana:invalidateNodes` | Mark executor nodes pending without resuming (Prompts-tab edit flow) |
| `kshana:setAutonomous` | Toggle autonomous mode for the session |
| `kshana:setPiOversight` | Toggle pi-agent oversight |
| `kshana:setVlmJudge` | Toggle VLM judge (gated by oversight) |
| `kshana:runnerCancel` | Cancel the active background task (kshana_run_to et al) |
| `kshana:runnerStatus` | Snapshot of the active background task or `null` |
| `kshana:deleteSession` | Tear down a session |

### Main → renderer (streaming events)

All events publish on the single `kshana:event` channel as
`{ eventName, sessionId, data }`. `eventName` mirrors `kshana-core`'s
`ServerMessageType`:

`progress`, `tool_call`, `tool_result`, `todo_updated`,
`agent_response`, `agent_question`, `status`, `stream_chunk`,
`context_usage`, `phase_transition`, `timeline_update`,
`notification`, `project_focused`, `media_generated`.
