---
name: test-loop
version: 1.0.0
description: |
  Add tests for the kshana-desktop chat panel UI. Use when the user wants
  to "test X" or "pin Y" in the chat surface — tool-call rendering,
  streaming text, media display, edit/regen flows, error states. Walks
  through the Layer-2 e2e harness we built: Playwright + an in-memory
  fake `window.kshana` / `window.electron` bridge driven by JSON
  scenarios. No Electron, no preload, no kshana-ink, no ComfyUI.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
---

# kshana-desktop test loop

This skill exists so future Claude doesn't reinvent the chat-panel
test pattern we already established. Read these notes BEFORE writing
test code.

## When to use this skill

The user said something like:

- "Test that the tool card renders when X."
- "Pin the streaming-text behavior."
- "Make sure the chat panel handles a failed edit."
- "Add coverage for video media."
- "Verify the duplicate-bubble bug stays fixed."

If the request is about kshana-ink agent behavior — runners, pi-agent
tools, in-process ports — that's a different loop (see
`../kshana-ink/.claude/skills/test-loop/`). This skill is for the UI
surface that consumes the bridge events.

## What this harness IS, and what it ISN'T

**IS:** a UI rendering contract test. Given a scripted sequence of
`KshanaEvent` payloads (the real wire shape from
`src/shared/kshanaIpc.ts`), does `ChatPanelEmbedded` produce the
right DOM? Tool cards, streaming bubbles, media, notifications,
button states.

**ISN'T:** an agent behavior test. The fake bridge does NOT make
the LLM choose tools, doesn't run ComfyUI, doesn't write to disk.
If you need to verify "given user input X, does the agent actually
call the right tool?" — that's a kshana-ink test, not a
kshana-desktop test.

The fake bridge isn't a lie about the agent's behavior; it's a
**fixture** of what the agent emits. The UI's job is to render
those events correctly — and that's what these tests pin.

## The loop, once

1. **Decide what you're testing.** Look at
   `ChatPanelEmbedded.handleEvent` (`src/renderer/components/chat/
   ChatPanelEmbedded/ChatPanelEmbedded.tsx`) — every event type the
   panel handles is in that switch. The test will assert on DOM
   produced by one of those handlers.

2. **Write the scenario.** Drop a JSON file at
   `tests/e2e/scenarios/<descriptive-name>.json`. Shape:

   ```json
   {
     "project": { "name": "noir", "directory": "/tmp/noir.kshana" },
     "rules": [
       {
         "on": { "channel": "runTask", "match": "show me s1 shot 1" },
         "emit": [
           { "after": 50,  "event": "tool_call",       "data": { "toolCallId": "t1", "toolName": "image_text_to_image", "arguments": { ... } } },
           { "after": 250, "event": "tool_result",     "data": { "toolCallId": "t1", "isError": false } },
           { "after": 280, "event": "media_generated", "data": { "kind": "image", "path": "/tmp/.../v1.png", "project": "noir" } },
           { "after": 320, "event": "agent_response",  "data": { "output": "Here is **s1 shot 1**.", "status": "completed" } }
         ]
       }
     ]
   }
   ```

   Rules match the user's typed text by substring against `on.match`.
   Events fire on a relative `after` ms timer so the chat sees
   real streaming. The bundled `runTask` resolves only after the
   last scripted event fires (so `isRunning` lifecycle is correct).

   If you need a new scenario with a project the picker should
   recognize, add it to `src/renderer/testing/scenarioCatalog.ts`
   so the manual-test picker can load it via `?scenario=NAME`.

3. **Write the spec.** Drop a `<topic>.spec.ts` at
   `tests/e2e/<topic>.spec.ts`. Shape:

   ```ts
   import { test, expect, type Page } from './fixtures';

   async function send(page: Page, text: string) {
     await page.getByPlaceholder(/Type a task and press send/i).fill(text);
     await page.getByRole('button', { name: 'Send' }).click();
   }

   test('descriptive name', async ({ page, bootWithScenario }) => {
     await bootWithScenario('your-scenario.json');
     await send(page, 'show me s1 shot 1');
     await expect(page.getByText('image_text_to_image')).toBeVisible();
     // ... more assertions
   });
   ```

   `bootWithScenario` is the Playwright fixture from
   `tests/e2e/fixtures.ts` — it seeds the scenario via
   `addInitScript`, navigates, and waits for the chat input to
   render. Don't roll your own boot.

4. **Run it red→green.** While iterating:
   ```bash
   npm run test:e2e:headed -- <topic>.spec.ts   # watch the browser
   npm run test:e2e:ui                          # time-travel debugger
   ```
   Once green, the file IS the regression test forever after — no
   "promotion" step needed.

5. **Verify the full suite still passes.**
   ```bash
   npm run test:e2e
   ```

## What lives where

| File | Purpose |
|---|---|
| `playwright.config.ts` | Playwright project config; spawns the dev server with `KSHANA_TEST_BRIDGE=1` |
| `src/renderer/testing/installFakeBridge.ts` | Runtime fakes for `window.kshana` + `window.electron`; exposes `window.__kshanaTest` API |
| `src/renderer/testing/TestApp.tsx` | Mounts `<ChatPanelEmbedded />` inside the real `WorkspaceProvider`; opens the scenario's project |
| `src/renderer/testing/ScenarioPicker.tsx` | Manual-testing UI when no `?scenario=` param is set |
| `src/renderer/testing/scenarioCatalog.ts` | Bundled list of scenarios — add yours here for picker visibility |
| `src/renderer/index.tsx` | Branches to `<TestApp />` when `KSHANA_TEST_BRIDGE=1` |
| `tests/e2e/fixtures.ts` | `bootWithScenario` Playwright fixture |
| `tests/e2e/scenarios/*.json` | Scripted IPC sequences |
| `tests/e2e/*.spec.ts` | Test files themselves |
| `tests/e2e/README.md` | Manual-testing + add-a-scenario walkthrough |
| `.erb/configs/webpack.config.renderer.dev.ts` | Dev-server config; `KSHANA_TEST_BRIDGE=1` skips the preload+Electron spawn |

## The window.__kshanaTest API (inside the page)

Useful inside `page.evaluate(...)` blocks for advanced tests:

```ts
window.__kshanaTest.loadScenario({...})        // replace the rule table at runtime
window.__kshanaTest.loadScenarioByName('foo')  // pick from scenarioCatalog
window.__kshanaTest.listScenarios()
window.__kshanaTest.emit('notification', {...}) // fire an event manually
window.__kshanaTest.getCalls('runTask')        // every recorded bridge call
window.__kshanaTest.getProject()               // active scenario's project info
window.__kshanaTest.reset()                    // clear scenario + listeners + timers
```

`getCalls(channel?)` is gold for asserting "the chat panel actually
sent runTask with the right text" without depending on DOM.

## Anti-patterns — DO NOT do these

- **Test by grep'ing source files.** Per the project's CLAUDE.md:
  "Never write tests that grep/search for text strings in source
  code files." Tests must exercise behavior — render the component,
  check the DOM, verify the handler ran.
- **Use `toBeVisible()` on file:// images.** The Chromium running
  the test can't load file:// from an http origin, so the chat
  panel's `onError` handler hides them. Use `toHaveCount(1)` +
  `toHaveAttribute('src', ...)` instead. Real-image-actually-renders
  is a Layer-3 concern (real Electron + real fs), out of scope.
- **Test agent decision-making.** "Given user types X, does the
  panel call runTask with Y?" — yes, that's UI. "Given user types
  X, does the agent decide to call tool Y with arg Z?" — that's
  agent behavior, kshana-ink-side, NOT this harness.
- **Mount more than `<ChatPanelEmbedded />`.** The harness mounts
  exactly the chat panel inside a `WorkspaceProvider`. Don't pull
  in `<App />`, the timeline panel, the explorer — those have
  their own concerns (and would need their own scenarios for the
  events they consume). Keep the test scope tight.
- **Ship a flaky test.** If a test passes sometimes, find the
  timing assumption (usually a delay too tight on the scenario,
  or asserting on text before all `stream_chunk` events have
  fired). Playwright's `expect(...).toBe<...>()` is auto-retrying
  — lean on that instead of `await page.waitForTimeout(N)`.

## Counter-test pattern

If your assertion uses a tricky locator / regex / count, write a
**counter-test** in the same file that proves the assertion would
fail under the wrong condition. Example:
`streaming-no-duplicate.spec.ts` has a test pinning "exactly 1
`<p>` for the canonical text" plus a sibling that fires a second
`agent_response` manually and asserts "now there are 2." If the
first test were trivially passing (e.g. wrong selector), the
second couldn't pass too.

## Selectors that exist today

The chat panel doesn't use `data-testid` extensively — most
selectors lean on natural ARIA / text:

- Input: `getByPlaceholder(/Type a task and press send/i)`
- Send: `getByRole('button', { name: 'Send' })`
- Cancel: `getByRole('button', { name: 'Cancel' })` (only present
  while `isRunning`)
- Tool name in card: `getByText('image_text_to_image')` etc.
- Status glyph: `getByText('✓')` / `'✗'` / `'⋯'`
- Notification row: `getByText(/^\[error\] /)` (level prefix)
- User bubble: `getByText('exact user text', { exact: true })`
- Assistant text (markdown): `page.locator('p', { hasText: '...' })`
- Image media: `page.locator('img[alt*="<filename>"]')`
- Video media (text-only branch today):
  `page.getByText('📹 <path>')`

If you need to assert on something that has no stable selector,
add a `data-testid` to the rendered element — but try the natural
selectors first.

## Always run before reporting "done"

1. `npm run test:e2e` — full suite green (16 tests today, ~22s).
2. `npm run test:e2e:headed` for any new test you added — eyeball
   the playback once to confirm it's testing what you intend.
3. If the test relied on a new scenario, add it to
   `scenarioCatalog.ts` for manual-test picker visibility.

## Pointers

- `tests/e2e/README.md` — manual testing + extending the loop, full
  user-facing walkthrough.
- `src/shared/kshanaIpc.ts` (over in kshana-ink) — the canonical
  list of `KshanaEventName` values + payload shapes.
- The companion skill in kshana-ink's `.claude/skills/test-loop/`
  for the agent-side bridge tests.

## When NOT to use this skill

- Tests for kshana-ink runners or pi-agent tools — wrong repo, use
  kshana-ink's `test-loop` skill instead.
- Tests that need a real Electron process (file:// asset rendering,
  IPC behavior, packaged-app paths) — those are Layer 3, currently
  not built.
- Component-unit tests for individual widgets — those use the
  existing Jest setup (`*.test.tsx` next to the component); the
  e2e harness is for whole-panel rendering contracts.
