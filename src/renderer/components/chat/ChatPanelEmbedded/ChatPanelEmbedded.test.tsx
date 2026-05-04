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

// react-markdown is ESM-only; Jest's CJS env can't transform its
// `export` syntax. Replace it with a passthrough <div> for tests —
// behavior we care about is that the assistant text reaches the DOM.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: string }) => <div>{children}</div>,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => null }));

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

  it('repeated final agent_response with the same text updates the last assistant bubble', async () => {
    const { container } = render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    act(() => {
      publishEvent('agent_response', {
        output: 'Project kushi is created!',
        status: 'completed',
      });
    });
    act(() => {
      publishEvent('agent_response', {
        output: 'Project kushi is created!',
        status: 'completed',
      });
    });

    await waitFor(() => {
      expect(container.textContent).toContain('Project kushi is created!');
    });
    const matches = container.textContent?.match(/Project kushi is created!/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('done stream_chunk containing full final text replaces partial streamed text', async () => {
    const { container } = render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    await waitFor(() => {
      expect(mockState.listeners.some((l) => l.active)).toBe(true);
    });

    act(() => {
      publishEvent('stream_chunk', {
        content: 'What would you like to do with this?',
        done: false,
      });
    });
    act(() => {
      publishEvent('stream_chunk', {
        content:
          'What would you like to do with this? A few options come to mind.',
        done: true,
      });
    });

    await waitFor(() => {
      expect(container.textContent).toContain(
        'What would you like to do with this? A few options come to mind.',
      );
    });
    const matches =
      container.textContent?.match(/What would you like to do with this\?/g) ?? [];
    expect(matches.length).toBe(1);
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

  it('cancel button calls window.kshana.cancelTask while running', async () => {
    // Make runTask hang so the panel stays in 'running' state long
    // enough for the cancel button to render and be clicked.
    let resolveRunTask: ((v: { ok: boolean }) => void) | null = null;
    (window as unknown as { kshana: { runTask: jest.Mock } }).kshana.runTask = jest.fn(
      async (req: { sessionId: string; task: string }) => {
        mockState.runTaskCalls.push(req);
        return new Promise<{ ok: boolean }>((resolve) => {
          resolveRunTask = resolve;
        });
      },
    ) as never;

    render(<ChatPanelEmbedded />);
    await waitFor(() => screen.getByRole('textbox'));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'long task' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    });
    expect(mockState.cancelCalls).toHaveLength(1);

    // Tidy up the dangling promise so jest doesn't leak it between tests.
    if (resolveRunTask) (resolveRunTask as (v: { ok: boolean }) => void)({ ok: true });
  });
});
