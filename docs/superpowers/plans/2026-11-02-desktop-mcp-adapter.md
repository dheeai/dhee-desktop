> Superseded ownership decision: user approved Core-owned MCP. Desktop retains UI/runners and a compatibility launcher only. See companion Core `docs/core-mcp-ownership.md`. Correction verified locally and approved for branch push; no PR requested.

# Desktop production MCP adapter implementation plan

> Execute inline with superpowers:executing-plans. This is F09 from the existing approved production plan, not a new video engine.

**Goal:** Codex MCP clients can invoke the same Desktop production controls through a local stdio server.
**Architecture:** A single typed production-control tool wraps the Desktop controller; Core remains its execution engine. No HTTP listener or second state store.
**Spec:** Existing Dhee production design/F09 and 2026-11-02 Desktop ownership review (including user clarification allowing necessary Core support).

## Constraints
- Local only; no app MCP configuration changes, push or PR without a separate instruction.
- Preserve creative approvals, exact-instance isolation, durable GPU queue and cancellation. Never manufacture humanAcknowledged.
- stdout is protocol-only; logs go to stderr. Bound transport messages and tool request size.
- A successful tool response can still be a review/budget pause. Nested engine failure is a tool error, not success.

## Tasks
- [x] Write real SDK client/server tests: listing and schema; unchanged request/cancellation forwarding; outer/nested failures versus creative pause; oversized input rejection; request cancellation and disconnect abort. Observe failure before implementation.
- [x] Implement packages/dhee-runner-production/src/mcp.ts with createProductionMcpServer(execute,log), bounded schema/handler and active-request drain; mcpStdio.ts owns transport and shutdown. Add npm bin/root script/build wiring.
- [x] Verify compiled stdio handshake/tool call, protocol-only stdout, process shutdown and installed tarball entry. Run a fresh copied real Brilliant Care media chain through MCP; compare approved final hash and gate.
- [x] Focused tests/build/lint and fresh review; fix Important findings with regressions; update existing plan/tracker. Installation into the current Codex app and native Desktop acceptance are separate, not claimed.

## Review focus
Client disconnect during generation; log output corrupting protocol; nested failures mislabeled success; unsolicited approvals; packaging imports. No endpoint or API key should be silently inferred by the adapter.

## Follow-through checkpoint
User continued after the MCP verification and next-step proposal. Local Codex registration completed; saved configuration passed SDK startup/discovery/project.status. Current chat tool hot-reload remains unverified. Built Electron native IPC passed target discovery, completed assembly reuse with rough-cut gate, and actual media checks in isolated profile/studio. See outputs tracker. No source changes, push or PR.

## Follow-on: actionable media-check results (F08/F10 UX)
Close the recorded deferred silence-timestamp gap in Desktop. Reuse media.check's existing media properties and silenceIntervals; no new engine operation or persisted approval. Show measured duration/video/audio properties and explicit start/end seconds for each interval, including open-ended intervals. Keep uncertainty and first-track scope visible. Older reports without media details remain supported. Clear details when expectations/selection/project change using existing invalidation. Tests first: real report-shaped details, open-ended interval, missing details, invalidation. Focused renderer tests, build/lint, and real-report rendering evidence; no GPU generation.
