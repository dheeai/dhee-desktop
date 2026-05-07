/**
 * Tests for `ChatPanelEmbedded` — the new chat panel that drives
 * kshana-ink in-process via window.kshana (instead of the legacy
 * WebSocket-backed `ChatPanel.tsx`).
 *
 * Goal: verify the panel
 *   1. renders the chat input + send button
 *   2. submitting a task calls window.kshana.runTask via useKshanaSession
 *   3. tool_call events from the IPC stream appear in the message list
 *   4. agent_response events show as assistant messages
 *   5. media_generated events render inline thumbnails
 *   6. cancel button calls window.kshana.cancelTask
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { KshanaEvent, KshanaEventName } from '../../../../shared/kshanaIpc';

// Mock the workspace context — the chat panel reads `projectName`
// from it so it can auto-bind the kshana session to the current
// project. Default: no project selected; individual tests override.
let mockWorkspaceProjectName: string | null = null;
jest.mock('../../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    projectDirectory: mockWorkspaceProjectName ? `/tmp/${mockWorkspaceProjectName}.kshana` : null,
    projectName: mockWorkspaceProjectName,
  }),
}));

// AppSettingsContext: the chat panel reads piOversight + vlmJudge
// for its header toggle buttons. Default both ON for tests; the
// saveConnectionSettings stub records writes so the toggle-click
// tests can assert on them.
let mockSavedConnectionSettings: Array<Record<string, unknown>> = [];
jest.mock('../../../contexts/AppSettingsContext', () => ({
  useAppSettings: () => ({
    settings: {
      piOversight: true,
      vlmJudge: true,
    },
    saveConnectionSettings: jest.fn(async (patch: Record<string, unknown>) => {
      mockSavedConnectionSettings.push(patch);
      return true;
    }),
    isLoaded: true,
    error: null,
    isSettingsOpen: false,
    themeId: 'studio-neutral',
    isSavingConnection: false,
    openSettings: () => {},
    closeSettings: () => {},
    updateTheme: jest.fn(async () => undefined),
    clearError: () => {},
  }),
}));

// Inline mocks deferred to the global moduleNameMapper in
// package.json (see .erb/mocks/reactMarkdownMock.tsx). The previous
// inline jest.mock factory returned a function but the rendered
// output didn't reach the DOM in this test environment; the global
// mock is the one path of truth and it's exercised by every test
// that touches ReactMarkdown.

// eslint-disable-next-line @typescript-eslint/no-require-imports, import/first
import ChatPanelEmbedded from './ChatPanelEmbedded';

type EventListener = (e: KshanaEvent) => void;
interface KshanaListenerSlot {
  eventName: KshanaEventName | '*';
  cb: EventListener;
  active: boolean;
}

interface KshanaMockState {
  runTaskCalls: Array<{ sessionId: string; task: string }>;
  cancelCalls: Array<{ sessionId: string }>;
  listeners: KshanaListenerSlot[];
  nextSessionId: string;
}

let mockState: KshanaMockState;

function publishEvent(eventName: KshanaEventName, data: unknown): void {
  const event: KshanaEvent = { eventName, sessionId: mockState.nextSessionId, data };
  for (const slot of mockState.listeners) {
    if (!slot.active) continue;
    if (slot.eventName === '*' || slot.eventName === eventName) {
      slot.cb(event);
    }
  }
}

beforeEach(() => {
  mockWorkspaceProjectName = null;
  mockSavedConnectionSettings = [];
  mockState = {
    runTaskCalls: [],
    cancelCalls: [],
    listeners: [],
    nextSessionId: 's-1',
  };
  (window as unknown as { kshana: unknown }).kshana = {
    createSession: jest.fn(async () => ({ sessionId: mockState.nextSessionId })),
    configureProject: jest.fn(async () => ({ ok: true })),
    runTask: jest.fn(async (req: { sessionId: string; task: string }) => {
      mockState.runTaskCalls.push(req);
      return { ok: true };
    }),
    cancelTask: jest.fn(async (req: { sessionId: string }) => {
      mockState.cancelCalls.push(req);
      return { cancelled: true };
    }),
    redoNode: jest.fn(async () => ({ ok: true })),
    sendResponse: jest.fn(async () => ({ ok: true })),
    focusProject: jest.fn(async () => ({ ok: true })),
    setAutonomous: jest.fn(async () => ({ ok: true })),
    deleteSession: jest.fn(async () => ({ ok: true })),
    // runnerStatus is the SINGLE SOURCE OF TRUTH for whether a long
    // pipeline is in flight. The header Stop button is driven by it
    // (polled), not by tool-call events. Default: idle.
    runnerStatus: jest.fn(async () => ({ active: false })),
    runnerCancel: jest.fn(async () => ({ cancelled: true })),
    on: jest.fn((eventName: KshanaEventName | '*', cb: EventListener) => {
      const slot = { eventName, cb, active: true };
      mockState.listeners.push(slot);
      return () => {
        slot.active = false;
      };
    }),
  };
});

describe('ChatPanelEmbedded', () => {
  it('renders the chat input + send button', async () => {
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  // ── Header redesign (project name + dropdown) ───────────────────

  it('header shows the active project name (not the embedded-session debug string)', async () => {
    mockWorkspaceProjectName = 'BurgerEating';
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    // The project name is the primary affordance now.
    expect(screen.getByText('BurgerEating')).toBeInTheDocument();
    // The old debug string should NOT be visible to users.
    expect(screen.queryByText(/kshana embedded/i)).toBeNull();
    expect(screen.queryByText(/session [0-9a-f]{8}/i)).toBeNull();
  });

  it('header shows "No project open" when no workspace project is selected', async () => {
    mockWorkspaceProjectName = null;
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    expect(screen.getByText(/No project open/i)).toBeInTheDocument();
  });

  it('clicking the project name opens a menu containing Export chat', async () => {
    mockWorkspaceProjectName = 'BurgerEating';
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));

    // The menu is closed by default — Export chat must NOT be in the DOM yet.
    expect(screen.queryByRole('menuitem', { name: /export chat/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /project menu/i }));

    expect(
      screen.getByRole('menuitem', { name: /export chat/i }),
    ).toBeInTheDocument();
  });

  it('clicking Export chat in the project menu calls exportChatJson', async () => {
    mockWorkspaceProjectName = 'BurgerEating';
    // window.electron isn't polyfilled by jest setup — wire just
    // enough of the bridge for the export handler to fire.
    const exportSpy = jest.fn(async () => undefined);
    const readFileSpy = jest.fn(async () => null);
    (window as unknown as { electron: unknown }).electron = {
      project: {
        exportChatJson: exportSpy,
        readFile: readFileSpy,
      },
      logger: { logUserInput: jest.fn() },
    };

    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    // Generate at least one assistant message so Export isn't disabled.
    act(() => {
      publishEvent('agent_response', {
        output: 'something to export',
        status: 'completed',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: /project menu/i }));
    await act(async () => {
      fireEvent.click(
        screen.getByRole('menuitem', { name: /export chat/i }),
      );
    });

    expect(exportSpy).toHaveBeenCalledTimes(1);
  });

  it('does not render an autonomous-mode toggle in the footer', async () => {
    // Per the 2026-05-03 UI cleanup the AUTO button was removed —
    // every run is interactive. A regression that re-introduces the
    // toggle would be visible in user testing immediately, but a
    // pinned negative test is cheap insurance.
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    expect(screen.queryByRole('button', { name: /^auto$/i })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /toggle autonomous/i }),
    ).toBeNull();
  });

  it('does not render a separate Export Chat footer button (moved into the project menu)', async () => {
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    // The footer should NOT have a chip button labelled "Export Chat".
    // The menuitem inside the dropdown is the only export entry now.
    const buttons = screen.queryAllByRole('button', { name: /export chat/i });
    expect(buttons.length).toBe(0);
  });

  // ── Contextual CTA on project open ─────────────────────────────

  it('renders an in_progress CTA when an opened project is configured but unfinished', async () => {
    mockWorkspaceProjectName = 'BurgerEating';
    // Wire window.electron.project.readFile to return a configured
    // project.json with no final-video assets. The classifier will
    // resolve this as 'in_progress'.
    (window as unknown as { electron: unknown }).electron = {
      project: {
        readFile: jest.fn(async (path: string) => {
          if (path.endsWith('project.json')) {
            return JSON.stringify({
              style: 'cinematic_realism',
              templateId: 'narrative',
              targetDuration: 60,
            });
          }
          if (path.endsWith('assets/manifest.json')) {
            return JSON.stringify({
              assets: [{ kind: 'shot_image', path: 'a.png' }],
            });
          }
          return null;
        }),
        exportChatJson: jest.fn(async () => undefined),
      },
      logger: { logUserInput: jest.fn() },
    };

    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));

    await waitFor(
      () => {
        expect(
          screen.queryByText(/Continue where you left off/i),
        ).not.toBeNull();
      },
      { timeout: 1500 },
    );
    expect(
      screen.queryByRole('button', { name: /Continue the pipeline/i }),
    ).not.toBeNull();
  });

  it('renders a completed CTA when project.json marks goal.status="achieved"', async () => {
    // project.json is the only source of truth for lifecycle state —
    // see memory/feedback_project_state_truth.md and the classifier
    // tests that pin "manifest is ignored". The completion marker is
    // goal.status === 'achieved'.
    mockWorkspaceProjectName = 'BurgerEating';
    (window as unknown as { electron: unknown }).electron = {
      project: {
        readFile: jest.fn(async (path: string) => {
          if (path.endsWith('project.json')) {
            return JSON.stringify({
              style: 'cinematic_realism',
              templateId: 'narrative',
              targetDuration: 60,
              goal: {
                status: 'achieved',
                achievedAt: 1700000000000,
              },
            });
          }
          return null;
        }),
        exportChatJson: jest.fn(async () => undefined),
      },
      logger: { logUserInput: jest.fn() },
    };

    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(
      () => {
        expect(screen.queryByText(/Your project is ready/i)).not.toBeNull();
      },
      { timeout: 1500 },
    );
    expect(
      screen.queryByRole('button', { name: /Show me the final video/i }),
    ).not.toBeNull();
  });

  it('clicking a CTA action dispatches the pre-baked task via runTask', async () => {
    mockWorkspaceProjectName = 'BurgerEating';
    (window as unknown as { electron: unknown }).electron = {
      project: {
        readFile: jest.fn(async (path: string) => {
          if (path.endsWith('project.json')) {
            return JSON.stringify({
              style: 'cinematic_realism',
              templateId: 'narrative',
              targetDuration: 60,
            });
          }
          return null;
        }),
        exportChatJson: jest.fn(async () => undefined),
      },
      logger: { logUserInput: jest.fn() },
    };

    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(
      () => {
        expect(
          screen.queryByRole('button', { name: /Continue the pipeline/i }),
        ).not.toBeNull();
      },
      { timeout: 1500 },
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Continue the pipeline/i }),
      );
    });

    expect(mockState.runTaskCalls.length).toBeGreaterThanOrEqual(1);
    const last = mockState.runTaskCalls[mockState.runTaskCalls.length - 1];
    expect(last?.task).toMatch(/kshana_run_to/);
    expect(last?.task).toContain('BurgerEating');
  });

  it('submitting a task calls window.kshana.runTask', async () => {
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    const input = screen.getByRole('textbox') as HTMLInputElement | HTMLTextAreaElement;
    const button = screen.getByRole('button', { name: /send/i });

    fireEvent.change(input, { target: { value: 'create a 30s noir story' } });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockState.runTaskCalls).toHaveLength(1);
    expect(mockState.runTaskCalls[0]).toMatchObject({
      sessionId: 's-1',
      task: 'create a 30s noir story',
    });
  });

  it('tool_call events appear in the message list', async () => {
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    // Wait for the subscription effect to fire after sessionId is set.
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    act(() => {
      publishEvent('tool_call', {
        toolCallId: 'tc-1',
        toolName: 'kshana_run_to',
        arguments: { project: 'noir' },
        status: 'in_progress',
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/kshana_run_to/i)).toBeInTheDocument();
    });
  });

  it('agent_response events show as assistant messages', async () => {
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    // Wait for the subscription effect to fire after sessionId is set.
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    act(() => {
      publishEvent('agent_response', {
        output: 'I created the story.',
        status: 'completed',
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/I created the story/i)).toBeInTheDocument();
    });
  });

  it('media_generated events render inline media thumbnails', async () => {
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    // Wait for the subscription effect to fire after sessionId is set.
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    act(() => {
      publishEvent('media_generated', {
        kind: 'image',
        project: 'noir',
        path: 'assets/images/s1shot1_first_frame.png',
        source: 'kshana_run_to',
      });
    });

    await waitFor(() => {
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('alt', expect.stringMatching(/noir|s1shot1/i));
    });
  });

  /**
   * GIVEN a workspace project is open at an absolute path
   *       (e.g. /tmp/noir.kshana) AND the executor emits a
   *       media_generated event with a PROJECT-RELATIVE path
   *       (assets/images/foo.png — that's what ExecutorAgent
   *       writes to tool_result.file_path).
   *
   *  WHEN the chat panel renders the resulting media bubble.
   *
   *  THEN the <img>'s src must be a usable absolute file:// URL
   *       (file:///tmp/noir.kshana/assets/images/foo.png), not the
   *       broken `file://assets/images/foo.png` form that produces
   *       a silent 404 + onError-hidden element — the bug the user
   *       reported as "shows the path but never the actual image".
   */
  it('media_generated with a relative path resolves to an absolute file:// URL under the workspace project dir', async () => {
    mockWorkspaceProjectName = 'noir';
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    act(() => {
      publishEvent('media_generated', {
        kind: 'image',
        project: 'noir',
        path: 'assets/images/s1shot1_first_frame.png',
        source: 'kshana_run_to',
      });
    });

    await waitFor(() => {
      const img = document.querySelector(
        'img[src^="file://"]',
      ) as HTMLImageElement | null;
      expect(img).not.toBeNull();
      expect(img!.src).toBe(
        'file:///tmp/noir.kshana/assets/images/s1shot1_first_frame.png',
      );
    });
  });

  /**
   * GIVEN the executor emits a media_generated event for a video
   *       (mp4) under the workspace project dir.
   *
   *  WHEN the chat panel renders it.
   *
   *  THEN the bubble must contain a <video> element (so the user
   *       can actually play the clip inline), with src resolved to
   *       an absolute file:// URL under the project dir — not just
   *       a 📹 emoji + path text, which is what the current code
   *       falls back to.
   */
  it('media_generated with a video path renders a <video> element with absolute file:// src', async () => {
    mockWorkspaceProjectName = 'noir';
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    act(() => {
      publishEvent('media_generated', {
        kind: 'video',
        project: 'noir',
        path: 'assets/videos/s1shot1.mp4',
        source: 'kshana_run_to',
      });
    });

    await waitFor(() => {
      // <video> has no implicit ARIA role, so query by tag.
      const video = document.querySelector('video') as HTMLVideoElement | null;
      expect(video).not.toBeNull();
      expect(video!.src).toBe(
        'file:///tmp/noir.kshana/assets/videos/s1shot1.mp4',
      );
    });
  });

  /**
   * GIVEN a kshana_run_to tool_call followed by several stream_chunks
   *       (the per-line progress the executor pumps out — one for the
   *       "[info] [N/M] Working on: …" headline, one for each
   *       sub-step like "[generate_image]" or "→ assets/…").
   *
   *  WHEN the chat renders the run.
   *
   *  THEN the progress rows must collapse into a SINGLE group element
   *       (queryable via aria-label="Run progress group"), defaulting
   *       to collapsed state with at most one summary line visible —
   *       not N separate bubbles. The user reported the chat is "quite
   *       heavy" with one bubble per event; this is the structural
   *       grouping that fixes it.
   */
  it('progress events under one kshana_run_to call collapse into a single group element by default', async () => {
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    act(() => {
      publishEvent('tool_call', {
        toolCallId: 'task:run-1',
        toolName: 'kshana_run_to',
        arguments: { project: 'noir' },
      });
      // The executor's per-step heartbeat — each line arrives as its
      // own stream_chunk in production.
      publishEvent('stream_chunk', {
        toolCallId: 'task:run-1',
        content: '  [info] [40/67] Working on: Shot Composition: S2 Shot 6\n',
      });
      publishEvent('stream_chunk', {
        toolCallId: 'task:run-1',
        content: '  [generate_shot_image_prompt]\n',
      });
      publishEvent('stream_chunk', {
        toolCallId: 'task:run-1',
        content: '    → completed\n',
      });
      publishEvent('stream_chunk', {
        toolCallId: 'task:run-1',
        content: '  [info] [41/67] Working on: Shot Composition: S2 Shot 7\n',
      });
    });

    await waitFor(() => {
      const groups = document.querySelectorAll('[aria-label="Run progress group"]');
      expect(groups.length).toBe(1);
    });

    // Default: collapsed — most rows hidden. We allow at most one
    // visible "current step" line as the summary.
    const visibleProgressRows = document.querySelectorAll(
      '[aria-label="Run progress"]',
    );
    expect(visibleProgressRows.length).toBeLessThanOrEqual(1);
  });

  /**
   * GIVEN a collapsed progress group with several stream_chunks already
   *       inside it.
   *
   *  WHEN the user clicks the group's expand toggle (a button
   *       inside the group with aria-label="Expand run progress").
   *
   *  THEN every stream_chunk row that was hidden becomes visible.
   */
  it('clicking the run progress group expander reveals every stream_chunk row', async () => {
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    act(() => {
      publishEvent('tool_call', {
        toolCallId: 'task:run-2',
        toolName: 'kshana_run_to',
        arguments: { project: 'noir' },
      });
      publishEvent('stream_chunk', {
        toolCallId: 'task:run-2',
        content: '  [info] [10/67] Working on: Character A\n',
      });
      publishEvent('stream_chunk', {
        toolCallId: 'task:run-2',
        content: '  [generate_image]\n',
      });
      publishEvent('stream_chunk', {
        toolCallId: 'task:run-2',
        content: '    → completed\n',
      });
    });

    const expander = await screen.findByRole('button', {
      name: /expand run progress/i,
    });
    fireEvent.click(expander);

    await waitFor(() => {
      const rows = document.querySelectorAll('[aria-label="Run progress"]');
      // 3 chunks → 3 rows visible after expanding.
      expect(rows.length).toBe(3);
    });
  });

  /**
   * GIVEN media_generated arrives, WHEN the chat renders, THEN the
   *       resulting <img> must display as a compact thumbnail with
   *       a max-width <= 240px — not full-bleed (the previous styling
   *       used `maxWidth: '100%'` which dominated the chat panel and
   *       made the run feel "heavy").
   */
  it('generated images render as compact thumbnails (max-width <= 240px), not full-bleed', async () => {
    mockWorkspaceProjectName = 'noir';
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    act(() => {
      publishEvent('media_generated', {
        kind: 'image',
        project: 'noir',
        path: 'assets/images/foo.png',
        source: 'kshana_run_to',
      });
    });

    await waitFor(() => {
      const img = document.querySelector(
        'img[src^="file://"]',
      ) as HTMLImageElement | null;
      expect(img).not.toBeNull();
      // Inline style, not computed style — we control how it's set in
      // the component, and JSDOM doesn't run a layout engine to honour
      // computed CSS.
      const maxWidth = img!.style.maxWidth;
      // Either an explicit pixel value <= 240, or a width/maxWidth
      // pattern that doesn't say "100%".
      const px = /(\d+)px/.exec(maxWidth);
      expect(px).not.toBeNull();
      expect(parseInt(px![1]!, 10)).toBeLessThanOrEqual(240);
    });
  });

  /**
   * GIVEN the user dispatched a task that's still in flight (the main
   *       session's status is 'running' — pi-agent is mid-turn,
   *       running tools, awaiting LLM, etc.).
   *
   *  WHEN the user types a follow-up clarification and clicks Send.
   *
   *  THEN the previous turn must be cancelled (via cancelTask on the
   *       same session) AND the new task dispatched — instead of the
   *       previous "please wait a moment and try again" no-op that
   *       made the chat feel non-interactive. Pi-agent regularly
   *       does multi-minute tool sequences (regen + bash + regen);
   *       blocking the user from interjecting until that drains is
   *       the whole bug from the field.
   */
  it('clicking Send while the main session is running cancels the in-flight turn and dispatches the new task', async () => {
    // Hold the first runTask in a deferred promise so the session
    // stays in status='running' for the duration of the test.
    let resolveFirst: () => void = () => {};
    const firstFinished = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    let runTaskCount = 0;
    (window as unknown as { kshana: Record<string, unknown> }).kshana.runTask =
      jest.fn(async (req: { sessionId: string; task: string }) => {
        runTaskCount += 1;
        mockState.runTaskCalls.push(req);
        if (runTaskCount === 1) {
          // Hang the first call — emulates pi-agent mid-turn.
          await firstFinished;
        }
        return { ok: true };
      }) as never;

    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    // First task — fire and forget; session goes to 'running'.
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'first task' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
    });

    expect(mockState.runTaskCalls.map((c) => c.task)).toEqual(['first task']);

    // Type the follow-up while runTask #1 is still hanging.
    fireEvent.change(textarea, {
      target: {
        value: 'actually wait — your suggestion does not work for this case',
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
    });

    // Expected: cancelTask was called (to abort the in-flight turn),
    // then runTask was called with the new text.
    expect(mockState.cancelCalls.length).toBeGreaterThanOrEqual(1);
    expect(mockState.cancelCalls[mockState.cancelCalls.length - 1]?.sessionId)
      .toBe('s-1');
    expect(mockState.runTaskCalls.map((c) => c.task)).toContain(
      'actually wait — your suggestion does not work for this case',
    );

    // Cleanup: let the hanging promise resolve so React effects unwind.
    resolveFirst();
    await act(async () => {
      await firstFinished;
    });
  });

  it('auto-focuses the workspace project on the kshana session once both are ready', async () => {
    // The user has navigated into a project (chhaya_60s_anime) — the
    // workspace context exposes that as `projectName`. The chat panel
    // must tell the embedded core which project the user is in,
    // otherwise runTask throws "Session agent not configured" because
    // the session has no agent attached yet.
    mockWorkspaceProjectName = 'chhaya_60s_anime';

    render(<ChatPanelEmbedded />);

    await waitFor(() => {
      const focusProject = (window as unknown as {
        kshana: { focusProject: jest.Mock };
      }).kshana.focusProject;
      expect(focusProject).toHaveBeenCalledWith({
        sessionId: 's-1',
        projectName: 'chhaya_60s_anime',
        // The mock workspace exposes the dir as /tmp/<name>.kshana — the
        // panel passes it through so the bridge can pin KSHANA_PROJECTS_DIR.
        projectDir: '/tmp/chhaya_60s_anime.kshana',
      });
    });
  });

  it('does not call focusProject when no project is selected', async () => {
    mockWorkspaceProjectName = null;
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    const focusProject = (window as unknown as {
      kshana: { focusProject: jest.Mock };
    }).kshana.focusProject;
    expect(focusProject).not.toHaveBeenCalled();
  });

  it('tool_result event updates the matching tool card from in_progress to completed', async () => {
    const { container } = render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    act(() => {
      publishEvent('tool_call', {
        toolCallId: 'tc-42',
        toolName: 'kshana_list_items',
        arguments: {},
        status: 'in_progress',
      });
    });

    // Compact card: in_progress = ⋯ glyph; completed = ✓.
    await waitFor(() => {
      expect(container.textContent).toContain('⋯');
    });
    expect(container.textContent).not.toContain('✓');

    act(() => {
      publishEvent('tool_result', {
        toolCallId: 'tc-42',
        toolName: 'kshana_list_items',
        result: { items: [] },
        isError: false,
      });
    });

    await waitFor(() => {
      expect(container.textContent).toContain('✓');
      expect(container.textContent).not.toContain('⋯');
    });
  });

  it('renders each tool stream chunk as its own discrete progress row (not one concatenated blob)', async () => {
    // The user explicitly wants each [info] / [N/M] / [tool] →
    // completed line to appear as its own block in the chat — NOT
    // fused into one <pre>. After the muting redesign these rows
    // are wrapped in a collapsible group (default collapsed); this
    // test verifies the underlying granularity by expanding the
    // group and counting individual rows.
    const { container } = render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    act(() => {
      publishEvent('tool_call', {
        toolCallId: 'tc-run',
        toolName: 'kshana_run_to',
        arguments: { project: 'BurgerEating' },
        status: 'in_progress',
      });
    });

    // Three discrete log events arrive over time. The production
    // 250ms coalescing window is irrelevant here because newlines
    // always break rows.
    act(() => {
      publishEvent('stream_chunk', {
        toolCallId: 'tc-run',
        content: '  [info] [0/27] Working on: Plot Outline\n  [info] [1/27] Working on: Full Story\n  [info] [2/27] Working on: Story Essence\n',
        done: false,
      });
    });

    // Expand the group so every row is visible — the killer
    // assertion still holds: each progress line is its own DOM row.
    const expander = await screen.findByRole('button', {
      name: /expand run progress/i,
    });
    fireEvent.click(expander);

    await waitFor(() => {
      const progressRows = container.querySelectorAll(
        '[aria-label="Run progress"]',
      );
      expect(progressRows.length).toBe(3);
    });

    expect(container.textContent).toContain('Working on: Plot Outline');
    expect(container.textContent).toContain('Working on: Full Story');
    expect(container.textContent).toContain('Working on: Story Essence');
  });

  it('drops tool-tagged chunks whose parent tool is NOT a kshana_* tool (filters bash/read/grep noise)', async () => {
    // Without this filter, every line of `bash ls -la` and every
    // file Read by pi-agent would dump its contents into the chat
    // as progress rows. The user only wants to see kshana_run_to /
    // kshana_render_* progress; everything else is internal noise.
    const { container } = render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    // tool_call for a non-kshana tool first (this is what the
    // chat-noise scenario looked like in the wild — pi-agent ran
    // bash and `ls -la` output flooded the chat).
    act(() => {
      publishEvent('tool_call', {
        toolCallId: 'tc-bash-1',
        toolName: 'bash',
        arguments: { command: 'ls -la /tmp' },
        status: 'in_progress',
      });
    });
    act(() => {
      publishEvent('stream_chunk', {
        toolCallId: 'tc-bash-1',
        content: 'drwxr-xr-x  2 ganaraj  staff   64  3 May 13:25 videos\n',
        done: false,
      });
    });
    act(() => {
      publishEvent('stream_chunk', {
        toolCallId: 'tc-bash-1',
        content: 'drwxr-xr-x  2 ganaraj  staff   64  3 May 13:25 imported\n',
        done: false,
      });
    });

    await new Promise((r) => setTimeout(r, 0));

    // The bash tool card itself appears (compact one-liner).
    expect(container.textContent).toContain('bash');
    // But NO progress rows — the bash output is dropped.
    expect(
      container.querySelectorAll('[aria-label="Run progress"]').length,
    ).toBe(0);
    expect(container.textContent).not.toContain('drwxr-xr-x');
  });

  it('drops tool-tagged chunks with no recorded parent (orphan, e.g. session-replay edge)', async () => {
    // Defense in depth: if a stream_chunk somehow arrives without
    // its tool_call having been seen first (replay, race), drop it
    // rather than rendering it as a mystery progress row.
    const { container } = render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    act(() => {
      publishEvent('stream_chunk', {
        toolCallId: 'orphan-id',
        content: '  [some_tool] orphan\n',
        done: false,
      });
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(
      container.querySelectorAll('[aria-label="Run progress"]').length,
    ).toBe(0);
    expect(container.textContent).not.toContain('orphan');
  });

  it('stream_chunk followed by agent_response with same text shows only one bubble (no duplicate)', async () => {
    // Real agent flow: chunks stream in, the final agent_response
    // arrives with the full text. The panel must not append a second
    // bubble — the streaming bubble already contains the same text.
    const { container } = render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    act(() => {
      publishEvent('stream_chunk', { content: 'Looking at the project. ', done: false });
    });
    act(() => {
      publishEvent('stream_chunk', { content: 'Found 38 assets.', done: true });
    });
    act(() => {
      publishEvent('agent_response', {
        output: 'Looking at the project. Found 38 assets.',
        status: 'completed',
      });
    });

    await waitFor(() => {
      expect(container.textContent).toContain('Looking at the project. Found 38 assets.');
    });
    // The full text should appear EXACTLY once — not duplicated by
    // both the streaming bubble and the final agent_response.
    const matches = container.textContent?.match(/Looking at the project\. Found 38 assets\./g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('renders an assistant bubble exactly once even when the same long stream_chunk arrives twice (dedup safety net)', async () => {
    // The upstream LLM stream sometimes emits the full response
    // twice as two stream_chunk events, which used to render as a
    // doubled bubble in the chat. The render-layer dedupeDoubled
    // collapses it.
    const { container } = render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    // 200-char paragraph — well above the 120-char dedup threshold.
    const paragraph =
      'Not yet — shot image prompts are still in progress. Here is where they stand: scene 1 has 17 shots total, 7 completed, 1 in progress, 9 pending. The pipeline is working through them.';
    expect(paragraph.length).toBeGreaterThan(120);

    act(() => {
      publishEvent('stream_chunk', { content: paragraph, done: false });
    });
    act(() => {
      publishEvent('stream_chunk', { content: paragraph, done: true });
    });

    // After both chunks accumulate, the bubble's RAW text is
    // paragraph + paragraph (doubled). dedupeDoubled at render time
    // collapses it back to one copy.
    await waitFor(() => {
      expect(container.textContent).toContain(paragraph);
    });
    const matches =
      container.textContent?.match(
        /Not yet — shot image prompts are still in progress\./g,
      ) ?? [];
    expect(matches.length).toBe(1);
  });

  it('does NOT collapse short repeated phrases (false-positive guard)', async () => {
    // "Yes! Yes!" is doubled but only 10 chars. Must NOT be
    // collapsed — the dedup threshold (120 chars) skips it.
    const { container } = render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    act(() => {
      publishEvent('agent_response', {
        output: 'Yes! Yes!',
        status: 'completed',
      });
    });

    await waitFor(() => {
      expect(container.textContent).toContain('Yes! Yes!');
    });
  });

  it('stream_chunk events accumulate into a single assistant message that grows as chunks arrive', async () => {
    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    act(() => {
      publishEvent('stream_chunk', { content: 'Hello ', done: false });
    });
    act(() => {
      publishEvent('stream_chunk', { content: 'world!', done: false });
    });
    act(() => {
      publishEvent('stream_chunk', { content: '', done: true });
    });

    // The two chunks merged into one assistant message — NOT two separate
    // bubbles labelled "Hello " and "world!".
    await waitFor(() => {
      expect(screen.getByText(/Hello world!/i)).toBeInTheDocument();
    });
    expect(screen.queryAllByText(/^Hello $/).length).toBe(0);
  });

  // ── Background-run session ────────────────────────────────────
  // Long pipeline runs (1–4h) execute in a SEPARATE pi-agent
  // session so the user can keep chatting on the main session in
  // parallel. Resume/Stop in the header target the background
  // session; the inline send button stays Send-only.

  it('clicking Resume runs kshana_run_to on the main session (which dispatches via BackgroundTaskRunner)', async () => {
    // Architecture: kshana_run_to was previously dispatched on a
    // dedicated bg session; now kshana-core's runner singleton
    // handles detached execution, so the chat panel can fire from
    // the main session directly. The kickoff text still goes
    // through runTask — pi-agent calls kshana_run_to which the
    // dist now redirects to the runner.
    mockWorkspaceProjectName = 'BurgerEating';
    (window as unknown as { electron: unknown }).electron = {
      project: {
        readFile: jest.fn(async (path: string) =>
          path.endsWith('project.json')
            ? JSON.stringify({
                style: 'cinematic_realism',
                templateId: 'narrative',
                targetDuration: 60,
              })
            : null,
        ),
        exportChatJson: jest.fn(async () => undefined),
      },
      logger: { logUserInput: jest.fn() },
    };

    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(
      () => {
        expect(
          screen.queryByRole('button', { name: /resume run/i }),
        ).not.toBeNull();
      },
      { timeout: 1500 },
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /resume run/i }));
    });

    expect(mockState.runTaskCalls.length).toBeGreaterThanOrEqual(1);
    const last = mockState.runTaskCalls[mockState.runTaskCalls.length - 1];
    // The kickoff fires on the main session — the runner takes
    // over from there, so we don't need a separate bg session id
    // anymore.
    expect(last?.sessionId).toBe('s-1');
    expect(last?.task).toMatch(/kshana_run_to/);
  });

  it('clicking Resume kicks off a kshana_run_to task, then Stop appears once runnerStatus reports active', async () => {
    mockWorkspaceProjectName = 'BurgerEating';
    (window as unknown as { electron: unknown }).electron = {
      project: {
        readFile: jest.fn(async (path: string) =>
          path.endsWith('project.json')
            ? JSON.stringify({
                style: 'cinematic_realism',
                templateId: 'narrative',
                targetDuration: 60,
              })
            : null,
        ),
        exportChatJson: jest.fn(async () => undefined),
      },
      logger: { logUserInput: jest.fn() },
    };

    // Mock the IPCs. Runner is idle until Resume is clicked, then
    // the next poll observes active=true.
    const runnerCancel = jest.fn(async () => ({ cancelled: true }));
    let runnerActive = false;
    (window as unknown as { kshana: Record<string, unknown> }).kshana.runnerCancel =
      runnerCancel as never;
    (window as unknown as { kshana: Record<string, unknown> }).kshana.runnerStatus =
      jest.fn(async () => ({ active: runnerActive })) as never;

    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(
      () => {
        expect(
          screen.queryByRole('button', { name: /resume run/i }),
        ).not.toBeNull();
      },
      { timeout: 1500 },
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /resume run/i }));
    });

    // Simulate the runner picking up the task.
    runnerActive = true;
    await waitFor(
      () => {
        expect(
          screen.queryByRole('button', { name: /stop run/i }),
        ).not.toBeNull();
      },
      { timeout: 3000 },
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /stop run/i }));
    });

    expect(runnerCancel).toHaveBeenCalledTimes(1);
  });

  it('inline send button stays "Send" while a background run is in progress (never becomes Cancel)', async () => {
    // The whole point of the bg-session split: the user can chat
    // freely while the long pipeline runs. The inline button must NOT
    // morph into a Stop control — Stop lives in the header.
    mockWorkspaceProjectName = 'BurgerEating';
    (window as unknown as { electron: unknown }).electron = {
      project: {
        readFile: jest.fn(async (path: string) =>
          path.endsWith('project.json')
            ? JSON.stringify({
                style: 'cinematic_realism',
                templateId: 'narrative',
                targetDuration: 60,
              })
            : null,
        ),
        exportChatJson: jest.fn(async () => undefined),
      },
      logger: { logUserInput: jest.fn() },
    };

    (
      window as unknown as { kshana: { runTask: jest.Mock } }
    ).kshana.runTask = jest.fn(async (req: { sessionId: string; task: string }) => {
      mockState.runTaskCalls.push(req);
      return new Promise<{ ok: boolean }>(() => {});
    }) as never;
    // Runner reports active — same scenario as a long pipeline mid-run.
    (window as unknown as { kshana: Record<string, unknown> }).kshana.runnerStatus =
      jest.fn(async () => ({ active: true, kind: 'run_to' })) as never;

    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(
      () => {
        expect(
          screen.queryByRole('button', { name: /stop run/i }),
        ).not.toBeNull();
      },
      { timeout: 3000 },
    );

    // Header has Stop (runner active) — but the INLINE send button
    // must stay Send. There must be exactly ONE button labelled
    // /send/i and ZERO labelled /^cancel$/i in the textarea region.
    expect(screen.queryByRole('button', { name: /^send$/i })).not.toBeNull();
    // Only the header has Stop. The textarea region must not contain a Cancel.
    const cancelButtons = screen.queryAllByRole('button', { name: /^cancel$/i });
    expect(cancelButtons.length).toBe(0);
  });

  // ── Single source of truth: runnerStatus drives the Stop button ──
  //
  // Earlier the header Stop button was driven by a hard-coded
  // tool-name allowlist (`LONG_RUNNING_KSHANA_TOOLS`). That broke
  // whenever pi-agent generated a project via a path that didn't
  // call one of those exact tools — the runner would be busy for
  // hours but the button would never appear, and the user couldn't
  // stop the run. Fix: poll `window.kshana.runnerStatus()` and
  // treat its `.active` field as the only truth.
  describe('header Stop button — runnerStatus is the source of truth', () => {
    const setupProjectFiles = () => {
      (window as unknown as { electron: unknown }).electron = {
        project: {
          readFile: jest.fn(async (path: string) =>
            path.endsWith('project.json')
              ? JSON.stringify({
                  style: 'cinematic_realism',
                  templateId: 'narrative',
                  targetDuration: 60,
                })
              : null,
          ),
          exportChatJson: jest.fn(async () => undefined),
        },
        logger: { logUserInput: jest.fn() },
      };
    };

    it('GIVEN runnerStatus reports active=true WHEN the panel mounts THEN Stop is visible (no tool_call needed)', async () => {
      mockWorkspaceProjectName = 'BurgerEating';
      setupProjectFiles();
      // Mock the runner as already busy — same shape as a real
      // `kshana-core` task running in the background.
      (window as unknown as { kshana: Record<string, unknown> }).kshana.runnerStatus =
        jest.fn(async () => ({
          active: true,
          taskId: 'task-abc',
          kind: 'run_to',
          projectName: 'BurgerEating',
        })) as never;

      render(<ChatPanelEmbedded />);
      await waitFor(() => screen.getByRole('textbox'));

      // Allow the mount-time poll + first interval tick to land.
      await waitFor(
        () => {
          expect(
            screen.queryByRole('button', { name: /stop run/i }),
          ).not.toBeNull();
        },
        { timeout: 3000 },
      );
      // And no Resume button — the run IS active.
      expect(screen.queryByRole('button', { name: /resume run/i })).toBeNull();
    });

    it('GIVEN runnerStatus reports active=false THEN Stop is NOT visible even when a tool_call(kshana_run_to) fires', async () => {
      mockWorkspaceProjectName = 'BurgerEating';
      setupProjectFiles();
      // Runner is idle. The OLD design would have shown Stop based
      // on the tool_call alone — pin that this no longer happens.
      (window as unknown as { kshana: Record<string, unknown> }).kshana.runnerStatus =
        jest.fn(async () => ({ active: false })) as never;

      render(<ChatPanelEmbedded />);
      await waitFor(() => screen.getByRole('textbox'));
      await waitFor(() =>
        expect(mockState.listeners.some((l) => l.active)).toBe(true),
      );

      // Fire a synthetic tool_call as the OLD code path used to —
      // this should NOT cause Stop to appear under the new contract.
      await act(async () => {
        mockState.listeners.forEach((l) => {
          if (l.active) {
            l.cb({
              eventName: 'tool_call',
              sessionId: 's-1',
              data: {
                toolCallId: 'tc-1',
                toolName: 'kshana_run_to',
                status: 'in_progress',
              },
            } as never);
          }
        });
      });

      // Wait long enough for one poll cycle to confirm runnerStatus
      // is still reporting idle.
      await new Promise((resolve) => setTimeout(resolve, 1700));
      expect(screen.queryByRole('button', { name: /stop run/i })).toBeNull();
    });

    it('GIVEN runnerStatus flips from active=true to active=false WHEN polled THEN Stop disappears', async () => {
      mockWorkspaceProjectName = 'BurgerEating';
      setupProjectFiles();
      let active = true;
      (window as unknown as { kshana: Record<string, unknown> }).kshana.runnerStatus =
        jest.fn(async () => ({ active })) as never;

      render(<ChatPanelEmbedded />);
      await waitFor(() => screen.getByRole('textbox'));
      await waitFor(
        () => {
          expect(
            screen.queryByRole('button', { name: /stop run/i }),
          ).not.toBeNull();
        },
        { timeout: 3000 },
      );

      // Run finishes — flip the mock and let the next poll observe it.
      active = false;
      await waitFor(
        () => {
          expect(
            screen.queryByRole('button', { name: /stop run/i }),
          ).toBeNull();
        },
        { timeout: 3000 },
      );
    });

    it('GIVEN runnerStatus reports active=true WHEN user clicks Stop THEN runnerCancel() is invoked', async () => {
      mockWorkspaceProjectName = 'BurgerEating';
      setupProjectFiles();
      const runnerCancel = jest.fn(async () => ({ cancelled: true }));
      (window as unknown as { kshana: Record<string, unknown> }).kshana.runnerStatus =
        jest.fn(async () => ({ active: true, kind: 'run_to' })) as never;
      (window as unknown as { kshana: Record<string, unknown> }).kshana.runnerCancel =
        runnerCancel as never;

      render(<ChatPanelEmbedded />);
      await waitFor(() => screen.getByRole('textbox'));
      await waitFor(
        () => {
          expect(
            screen.queryByRole('button', { name: /stop run/i }),
          ).not.toBeNull();
        },
        { timeout: 3000 },
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /stop run/i }));
      });
      expect(runnerCancel).toHaveBeenCalledTimes(1);
    });
  });
});
