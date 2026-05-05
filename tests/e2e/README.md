# Layer-2 e2e tests (renderer + fake bridge)

Fast Playwright tests that run the renderer in plain Chromium with
in-memory fakes for `window.kshana` and `window.electron`. No Electron,
no preload, no kshana-ink, no ComfyUI. Each test is a scripted IPC
sequence: "given these scripted bridge events, the chat UI should
render this DOM."

## Run

```bash
npm run test:e2e          # headless
npm run test:e2e:headed   # watch the browser
npm run test:e2e:ui       # interactive picker / time-travel debugger
```

Playwright spawns the dev server (`npm run start:test-renderer`) on
port 1212 with `KSHANA_TEST_BRIDGE=1`, which:

- skips the preload + Electron-main spawn in the renderer dev config
- bundles `src/renderer/testing/installFakeBridge.ts` into the page
- mounts `TestApp` instead of `App` in `index.tsx`

`TestApp` wraps `<ChatPanelEmbedded />` in the real `WorkspaceProvider`
and calls `openProject(scenario.project.directory)` once the scenario
is loaded. All `window.electron.project.*` calls are stubbed to succeed.

## How a test works

1. The Playwright fixture (`fixtures.ts`) reads a JSON scenario from
   `tests/e2e/scenarios/`.
2. It seeds the scenario via `page.addInitScript` (so it lands as
   `window.__pendingScenario` BEFORE the renderer bundle runs).
3. The bundle runs `installFakeBridge`, sees `__pendingScenario`, and
   calls `loadScenario(...)` on the test API. That sets the project +
   the rule table.
4. `TestApp` reads the project via `__kshanaTest.getProject()` and
   opens it through the real workspace flow.
5. The test drives the chat UI (fill input, click send). Each call to
   `window.kshana.runTask(...)` is matched against the scenario's
   rules — if a rule matches, its scripted events are scheduled with
   `setTimeout` so the timing mirrors a real streaming response.
6. The chat UI's `handleEvent` is the same code that runs in
   production, so DOM output is identical.

## Add a new scenario + test

```bash
# 1. write a scenario
cat > tests/e2e/scenarios/edit-shot-1.json <<'EOF'
{
  "project": { "name": "noir" },
  "rules": [
    { "on": { "channel": "runTask", "match": "make it darker" },
      "emit": [
        { "after": 50,  "event": "tool_call",      "data": { "toolCallId": "t1", "toolName": "image_edit" } },
        { "after": 250, "event": "tool_result",    "data": { "toolCallId": "t1", "isError": false } },
        { "after": 280, "event": "media_generated","data": { "kind": "image", "path": "/tmp/edited.png", "project": "noir" } }
      ]
    }
  ]
}
EOF

# 2. add the spec
cat > tests/e2e/edit-instruction.spec.ts <<'EOF'
import { test, expect } from './fixtures';

test('edit instruction triggers image_edit + new media', async ({ page, bootWithScenario }) => {
  await bootWithScenario('edit-shot-1.json');
  await page.getByPlaceholder(/Type a task/).fill('make it darker');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('image_edit')).toBeVisible();
  await expect(page.locator('img[alt*="edited.png"]')).toHaveCount(1);
});
EOF

# 3. run it
npm run test:e2e:headed -- edit-instruction.spec.ts
```

## What does NOT belong here

- Real ComfyUI, real LLM, real fs writes — those go in a Layer-3 live
  spec (`*.live.spec.ts`, currently deferred). Layer 2 should be
  deterministic and millisecond-fast.
- Tests that want to assert "ComfyUI workflow X was actually
  submitted" — that's a kshana-ink-side concern.

## Available bridge channels in scenarios

`runTask`, `sendResponse`, `redoNode`, `focusProject` —
match against the inbound payload's main text/id field with
`on.match`.

## Available scripted events

Anything in `KshanaEventName` from `src/shared/kshanaIpc.ts`:
`progress`, `tool_call`, `tool_result`, `todo_updated`,
`agent_response`, `agent_question`, `status`, `stream_chunk`,
`context_usage`, `phase_transition`, `timeline_update`,
`notification`, `project_focused`, `media_generated`.

## Test API surface (inside the page)

```ts
window.__kshanaTest.loadScenario(scenario)
window.__kshanaTest.emit(eventName, data)         // manual one-off event
window.__kshanaTest.getCalls(channel?)            // recorded bridge calls
window.__kshanaTest.getProject()                  // { name, directory }
window.__kshanaTest.reset()
```
