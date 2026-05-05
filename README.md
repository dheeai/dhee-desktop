# Kshana Desktop

Electron desktop application for Kshana. The app bundles the `kshana-core` TypeScript backend and runs it locally:

- The desktop starts the bundled `kshana-core` server on an internal localhost port and the renderer talks to it over HTTP/WebSocket.

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

- the desktop starts `../kshana-core/dist/server/cli.cjs` automatically
- the local backend chooses a free loopback port automatically

You do not need to run `kshana-core` separately for the normal desktop flow. You only need `pnpm build` in the sibling repo.

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

- desktop starts bundled `kshana-core`
- desktop waits for `/api/v1/health`
- renderer connects over WebSocket/HTTP to the localhost backend

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

## WebSocket API

The `kshana-core` backend exposes a WebSocket API at `/api/v1/ws/chat`.

### Client → Server

```ts
{ type: "start_task", data: { task: "Create a video about..." } }
{ type: "user_response", data: { response: "Yes, proceed" } }
{ type: "cancel" }
{ type: "ping" }
```

### Server → Client

```ts
{ type: "status", sessionId, timestamp, data: { status: "connected" | "ready" | "busy" | "completed" | "error", message? } }
{ type: "progress", sessionId, timestamp, data: { iteration, maxIterations, status } }
{ type: "stream_chunk", sessionId, timestamp, data: { content, done } }
{ type: "agent_response", sessionId, timestamp, data: { output, status } }
{ type: "agent_question", sessionId, timestamp, data: { question, toolCallId } }
{ type: "tool_call", sessionId, timestamp, data: { toolName, status, arguments, result?, error? } }
{ type: "todo_update", sessionId, timestamp, data: { todos: [...] } }
{ type: "error", sessionId, timestamp, data: { code, message, details? } }
```
