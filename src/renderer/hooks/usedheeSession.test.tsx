/**
 * Tests for `useDheeSession` — the renderer hook that wraps
 * `window.dhee.*` to give React components a clean session API.
 *
 * Goal: verify the hook
 *   1. creates a session on mount
 *   2. exposes runTask / cancelTask / redoNode / configureProject
 *      that delegate to window.dhee
 *   3. subscribes to streaming events via .on() and unsubscribes on unmount
 *   4. tracks `status` ('idle' | 'running' | 'error') based on runTask result
 *
 * Strategy: stub `window.dhee` with a recording mock; render the hook
 * via a TestComponent; assert side effects.
 */
import '@testing-library/jest-dom';
import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { DheeSessionProvider, useDheeSession } from './useDheeSession';
import type {
  ClearChatHistoryRequest,
  CreateSessionRequest,
  dheeEvent,
  dheeEventName,
  FocusProjectRequest,
  HistorySnapshot,
} from '../../shared/dheeIpc';

type EventListener = (e: dheeEvent) => void;

interface dheeMockState {
  createSessionCount: number;
  createSessionArgs: CreateSessionRequest[];
  runTaskArgs: Array<{ sessionId: string; task: string; stopAtStage?: string }>;
  cancelTaskArgs: Array<{ sessionId: string }>;
  redoNodeArgs: Array<{
    sessionId: string;
    nodeId: string;
    editedPrompt?: string;
  }>;
  configureProjectArgs: Array<{ sessionId: string; projectDir: string }>;
  focusProjectArgs: FocusProjectRequest[];
  clearChatHistoryArgs: ClearChatHistoryRequest[];
  listeners: Array<{
    eventName: dheeEventName | '*';
    cb: EventListener;
    active: boolean;
  }>;
  nextSessionId: string;
  clearChatHistoryNextSessionId: string;
  runTaskResult: { ok: boolean; error?: string };
  historyBySessionId: Record<string, HistorySnapshot | null>;
}

let mockState: dheeMockState;

function resetMockState(): void {
  mockState = {
    createSessionCount: 0,
    createSessionArgs: [],
    runTaskArgs: [],
    cancelTaskArgs: [],
    redoNodeArgs: [],
    configureProjectArgs: [],
    focusProjectArgs: [],
    clearChatHistoryArgs: [],
    listeners: [],
    nextSessionId: 's-1',
    clearChatHistoryNextSessionId: 's-cleared',
    runTaskResult: { ok: true },
    historyBySessionId: {},
  };
}

beforeEach(() => {
  resetMockState();
  window.localStorage.clear();
  (window as unknown as { dhee: unknown }).dhee = {
    createSession: jest.fn(async (req?: CreateSessionRequest) => {
      mockState.createSessionCount += 1;
      mockState.createSessionArgs.push(req ?? {});
      if (req?.resumeSessionId) {
        const history = mockState.historyBySessionId[req.resumeSessionId];
        return {
          sessionId: req.resumeSessionId,
          resumed: true,
          ...(history ? { history } : {}),
        };
      }
      return { sessionId: mockState.nextSessionId };
    }),
    configureProject: jest.fn(
      async (req: { sessionId: string; projectDir: string }) => {
        mockState.configureProjectArgs.push(req);
        return { ok: true };
      },
    ),
    runTask: jest.fn(
      async (req: {
        sessionId: string;
        task: string;
        stopAtStage?: string;
      }) => {
        mockState.runTaskArgs.push(req);
        return mockState.runTaskResult;
      },
    ),
    cancelTask: jest.fn(async (req: { sessionId: string }) => {
      mockState.cancelTaskArgs.push(req);
      return { cancelled: true };
    }),
    redoNode: jest.fn(
      async (req: {
        sessionId: string;
        nodeId: string;
        editedPrompt?: string;
      }) => {
        mockState.redoNodeArgs.push(req);
        return { ok: true };
      },
    ),
    on: jest.fn((eventName: dheeEventName | '*', cb: EventListener) => {
      const entry = { eventName, cb, active: true };
      mockState.listeners.push(entry);
      return () => {
        entry.active = false;
      };
    }),
    sendResponse: jest.fn(async () => ({ ok: true })),
    focusProject: jest.fn(async (req: FocusProjectRequest) => {
      mockState.focusProjectArgs.push(req);
      return { ok: true };
    }),
    setAutonomous: jest.fn(async () => ({ ok: true })),
    deleteSession: jest.fn(async () => ({ ok: true })),
    clearChatHistory: jest.fn(async (req: ClearChatHistoryRequest) => {
      mockState.clearChatHistoryArgs.push(req);
      return {
        oldSessionId: req.sessionId,
        newSessionId: mockState.clearChatHistoryNextSessionId,
      };
    }),
    getHistory: jest.fn(async (req: { sessionId: string }) => ({
      sessionId: req.sessionId,
      history: mockState.historyBySessionId[req.sessionId] ?? null,
    })),
  };
});

function TestHarness({
  onSession,
  onApi,
}: {
  onSession?: (sessionId: string | null) => void;
  onApi?: (api: ReturnType<typeof useDheeSession>) => void;
}) {
  const session = useDheeSession();
  useEffect(
    () => onSession?.(session.sessionId),
    [session.sessionId, onSession],
  );
  useEffect(() => onApi?.(session), [session, onApi]);
  return null;
}

TestHarness.defaultProps = {
  onSession: undefined,
  onApi: undefined,
};

function readProjectSessionMap(): Record<string, string> {
  return JSON.parse(
    window.localStorage.getItem('dhee.projectSessions.v1') ?? '{}',
  ) as Record<string, string>;
}

describe('useDheeSession', () => {
  it('creates a session on mount', async () => {
    render(
      <DheeSessionProvider>
        <TestHarness />
      </DheeSessionProvider>,
    );
    await waitFor(() => {
      expect(mockState.createSessionCount).toBe(1);
    });
  });

  it('exposes the created sessionId', async () => {
    let observedSessionId: string | null = null;
    render(
      <DheeSessionProvider>
        <TestHarness
          onSession={(s) => {
            observedSessionId = s;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => {
      expect(observedSessionId).toBe('s-1');
    });
  });

  it('creates and stores separate session ids per project directory', async () => {
    let api: ReturnType<typeof useDheeSession> | null = null;
    const { rerender } = render(
      <DheeSessionProvider
        projectDirectory="/tmp/project-a"
        projectName="project-a"
      >
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );

    await waitFor(() => expect(api?.sessionId).toBe('s-1'));
    expect(mockState.focusProjectArgs.at(-1)).toMatchObject({
      sessionId: 's-1',
      projectName: 'project-a',
      projectDir: '/tmp/project-a',
    });

    mockState.nextSessionId = 's-2';
    rerender(
      <DheeSessionProvider
        projectDirectory="/tmp/project-b"
        projectName="project-b"
      >
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );

    await waitFor(() => expect(api?.sessionId).toBe('s-2'));
    expect(mockState.focusProjectArgs.at(-1)).toMatchObject({
      sessionId: 's-2',
      projectName: 'project-b',
      projectDir: '/tmp/project-b',
    });
    expect(readProjectSessionMap()).toMatchObject({
      '/tmp/project-a': 's-1',
      '/tmp/project-b': 's-2',
    });
  });

  it('resumes the stored session id when switching back to a project', async () => {
    let api: ReturnType<typeof useDheeSession> | null = null;
    const { rerender } = render(
      <DheeSessionProvider
        projectDirectory="/tmp/project-a"
        projectName="project-a"
      >
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));

    mockState.nextSessionId = 's-2';
    rerender(
      <DheeSessionProvider
        projectDirectory="/tmp/project-b"
        projectName="project-b"
      >
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-2'));

    rerender(
      <DheeSessionProvider
        projectDirectory="/tmp/project-a/"
        projectName="project-a"
      >
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );

    await waitFor(() => expect(api?.sessionId).toBe('s-1'));
    expect(mockState.createSessionArgs.at(-1)).toMatchObject({
      resumeSessionId: 's-1',
      role: 'interactive',
    });
  });

  it('clearChatHistory replaces only the active project session id', async () => {
    let api: ReturnType<typeof useDheeSession> | null = null;
    const { rerender } = render(
      <DheeSessionProvider
        projectDirectory="/tmp/project-a"
        projectName="project-a"
      >
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));

    mockState.nextSessionId = 's-2';
    rerender(
      <DheeSessionProvider
        projectDirectory="/tmp/project-b"
        projectName="project-b"
      >
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-2'));

    mockState.clearChatHistoryNextSessionId = 's-b-new';
    await act(async () => {
      await api!.clearChatHistory();
    });

    expect(mockState.clearChatHistoryArgs.at(-1)).toMatchObject({
      sessionId: 's-2',
      role: 'interactive',
    });
    expect(readProjectSessionMap()).toMatchObject({
      '/tmp/project-a': 's-1',
      '/tmp/project-b': 's-b-new',
    });
    expect(api!.sessionId).toBe('s-b-new');
  });

  it('self-heal resumes the active project session id, not another project id', async () => {
    let api: ReturnType<typeof useDheeSession> | null = null;
    const { rerender } = render(
      <DheeSessionProvider
        projectDirectory="/tmp/project-a"
        projectName="project-a"
      >
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));

    mockState.nextSessionId = 's-2';
    rerender(
      <DheeSessionProvider
        projectDirectory="/tmp/project-b"
        projectName="project-b"
      >
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-2'));

    let runCalls = 0;
    (window as unknown as { dhee: { runTask: jest.Mock } }).dhee.runTask =
      jest.fn(async (req: { sessionId: string; task: string }) => {
        runCalls += 1;
        if (runCalls === 1) {
          return { ok: false, error: `Session not found: ${req.sessionId}` };
        }
        mockState.runTaskArgs.push(req);
        return { ok: true };
      });

    await act(async () => {
      await api!.runTask('recover project b');
    });

    expect(mockState.createSessionArgs.at(-1)).toMatchObject({
      resumeSessionId: 's-2',
      role: 'interactive',
    });
    expect(mockState.runTaskArgs.at(-1)).toMatchObject({
      sessionId: 's-2',
      task: 'recover project b',
    });
  });

  it('runTask delegates to window.dhee.runTask with the current sessionId', async () => {
    let api: ReturnType<typeof useDheeSession> | null = null;
    render(
      <DheeSessionProvider>
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));
    await act(async () => {
      await api!.runTask('write a noir story', { stopAtStage: 'shot_image' });
    });
    expect(mockState.runTaskArgs).toHaveLength(1);
    expect(mockState.runTaskArgs[0]).toMatchObject({
      sessionId: 's-1',
      task: 'write a noir story',
      stopAtStage: 'shot_image',
    });
  });

  it('cancelTask delegates to window.dhee.cancelTask', async () => {
    let api: ReturnType<typeof useDheeSession> | null = null;
    render(
      <DheeSessionProvider>
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));
    await act(async () => {
      await api!.cancel();
    });
    expect(mockState.cancelTaskArgs).toHaveLength(1);
    expect(mockState.cancelTaskArgs[0]?.sessionId).toBe('s-1');
  });

  it('redoNode delegates with sessionId and editedPrompt', async () => {
    let api: ReturnType<typeof useDheeSession> | null = null;
    render(
      <DheeSessionProvider>
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));
    await act(async () => {
      await api!.redoNode('shot_image:scene_1_shot_4', {
        editedPrompt: 'new prompt',
      });
    });
    expect(mockState.redoNodeArgs[0]).toMatchObject({
      sessionId: 's-1',
      nodeId: 'shot_image:scene_1_shot_4',
      editedPrompt: 'new prompt',
    });
  });

  it('configureProject delegates with sessionId + opts', async () => {
    let api: ReturnType<typeof useDheeSession> | null = null;
    render(
      <DheeSessionProvider>
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));
    await act(async () => {
      await api!.configureProject({
        projectDir: '/path/to/parvati',
        templateId: 'narrative',
      });
    });
    expect(mockState.configureProjectArgs[0]).toMatchObject({
      sessionId: 's-1',
      projectDir: '/path/to/parvati',
    });
  });

  it('status flips to "running" while runTask is awaiting and back to "idle" after success', async () => {
    let api: ReturnType<typeof useDheeSession> | null = null;
    render(
      <DheeSessionProvider>
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));
    expect(api!.status).toBe('idle');
    let runPromise: Promise<unknown>;
    act(() => {
      runPromise = api!.runTask('hi');
    });
    // Status should be running before the promise resolves.
    await waitFor(() => expect(api!.status).toBe('running'));
    await act(async () => {
      await runPromise;
    });
    await waitFor(() => expect(api!.status).toBe('idle'));
  });

  it('status flips to "error" when runTask returns ok:false', async () => {
    mockState.runTaskResult = { ok: false, error: 'something broke' };
    let api: ReturnType<typeof useDheeSession> | null = null;
    render(
      <DheeSessionProvider>
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));
    await act(async () => {
      await api!.runTask('hi');
    });
    expect(api!.status).toBe('error');
  });

  it('subscribe(event, cb) registers a listener; returned unsubscribe deactivates it', async () => {
    let api: ReturnType<typeof useDheeSession> | null = null;
    render(
      <DheeSessionProvider>
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));

    const handler = jest.fn();
    let unsubscribe: (() => void) | null = null;
    act(() => {
      unsubscribe = api!.subscribe('tool_call', handler);
    });

    const toolCallListener = mockState.listeners.find(
      (listener) => listener.eventName === 'tool_call',
    );
    expect(toolCallListener).toBeDefined();
    expect(toolCallListener?.active).toBe(true);

    unsubscribe!();
    expect(toolCallListener?.active).toBe(false);
  });

  // ── Resilience: createSession startup race ──────────────────────────────
  // The kshana-core manager boots async on the main process. If the
  // renderer's createSession fires before the IPC bridge is registered,
  // the call rejects. Pre-fix, the renderer surfaced an error and the
  // user had to ⌘+R to recover. The retry-with-backoff path should
  // transparently recover once the bridge comes up.

  it('createSession on mount retries when the IPC layer initially rejects (startup race)', async () => {
    let attempts = 0;
    (
      window as unknown as { dhee: { createSession: jest.Mock } }
    ).dhee.createSession = jest.fn(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error('No handler registered for kshana:createSession');
      }
      return { sessionId: 's-recovered' };
    });

    let observedSessionId: string | null = null;
    render(
      <DheeSessionProvider>
        <TestHarness
          onSession={(s) => {
            observedSessionId = s;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(
      () => {
        expect(observedSessionId).toBe('s-recovered');
      },
      { timeout: 4000 },
    );
    expect(attempts).toBeGreaterThanOrEqual(3);
  });

  // ── Resilience: mid-session "Session not found" ─────────────────────────
  // When kshana-core restarts (settings update / account change) it
  // wipes the in-memory sessions Map without notifying the renderer.
  // Any subsequent IPC call returns "Session not found: <id>". The
  // self-heal wrapper should re-run createSession transparently and
  // retry the operation once.

  it('IPC calls self-heal when the server reports "Session not found" mid-session', async () => {
    let api: ReturnType<typeof useDheeSession> | null = null;
    render(
      <DheeSessionProvider>
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));

    // First call returns "Session not found". After re-create, the
    // session id changes (server hands back 's-2' the second time
    // around — simulating a fresh in-memory entry).
    let runCalls = 0;
    let createSessionCalls = 0;
    (
      window as unknown as {
        dhee: { runTask: jest.Mock; createSession: jest.Mock };
      }
    ).dhee.runTask = jest.fn(async (req: { sessionId: string }) => {
      runCalls += 1;
      if (runCalls === 1) {
        return { ok: false, error: `Session not found: ${req.sessionId}` };
      }
      return { ok: true };
    });
    (
      window as unknown as { dhee: { createSession: jest.Mock } }
    ).dhee.createSession = jest.fn(async () => {
      createSessionCalls += 1;
      return { sessionId: 's-2' };
    });

    let runResult: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      runResult = await api!.runTask('hi');
    });

    // Self-heal triggered: createSession was called to revive, then
    // runTask succeeded on the retry.
    expect(createSessionCalls).toBeGreaterThanOrEqual(1);
    expect(runCalls).toBe(2);
    expect(runResult?.ok).toBe(true);
    // The renderer's session id was updated to the new server-side
    // session.
    await waitFor(() => expect(api!.sessionId).toBe('s-2'));
  });

  // ── Resume hydration on remount ─────────────────────────────────────────
  // The chat panel unmounts when the user nav's to Settings. The session
  // provider stays alive at app root, but the panel's local `messages`
  // state is gone. On remount, the panel calls `refreshHistory()` to
  // refetch the persisted snapshot from disk (the source of truth) and
  // re-seeds itself. Without this, the chat re-appears empty even though
  // the agent's server-side memory is intact.

  it('refreshHistory() fetches the persisted snapshot via window.dhee.getHistory and exposes it on `history`', async () => {
    const snapshot = {
      messages: [
        {
          id: 'm-1',
          type: 'user' as const,
          content: 'hello',
          timestamp: 1700000000000,
        },
      ],
      toolCalls: [],
      compactionCount: 0,
    };
    let getHistoryCalls = 0;
    (window as unknown as { dhee: { getHistory: jest.Mock } }).dhee.getHistory =
      jest.fn(async (req: { sessionId: string }) => {
        getHistoryCalls += 1;
        return { sessionId: req.sessionId, history: snapshot };
      });

    let api: ReturnType<typeof useDheeSession> | null = null;
    render(
      <DheeSessionProvider>
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));

    // Sanity: no history initially (fresh-session response carries none).
    expect(api!.history).toBeNull();

    await act(async () => {
      await api!.refreshHistory();
    });

    expect(getHistoryCalls).toBe(1);
    await waitFor(() => expect(api!.history).toEqual(snapshot));
    // consumeHistory should still drain it (one-shot semantics
    // preserved — the consumer reads-and-clears once).
    let drained: typeof snapshot | null = null;
    act(() => {
      drained = api!.consumeHistory() as typeof snapshot | null;
    });
    expect(drained).toEqual(snapshot);
    await waitFor(() => expect(api!.history).toBeNull());
  });

  it('refreshHistory() leaves history null when the backend has no snapshot', async () => {
    (window as unknown as { dhee: { getHistory: jest.Mock } }).dhee.getHistory =
      jest.fn(async () => ({ sessionId: 's-1', history: null }));

    let api: ReturnType<typeof useDheeSession> | null = null;
    render(
      <DheeSessionProvider>
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));

    await act(async () => {
      await api!.refreshHistory();
    });
    expect(api!.history).toBeNull();
  });

  it('non-"Session not found" errors are surfaced verbatim (no self-heal loop)', async () => {
    let api: ReturnType<typeof useDheeSession> | null = null;
    render(
      <DheeSessionProvider>
        <TestHarness
          onApi={(a) => {
            api = a;
          }}
        />
      </DheeSessionProvider>,
    );
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));

    let runCalls = 0;
    let createSessionCalls = 0;
    (
      window as unknown as {
        dhee: { runTask: jest.Mock; createSession: jest.Mock };
      }
    ).dhee.runTask = jest.fn(async () => {
      runCalls += 1;
      return { ok: false, error: 'something else broke' };
    });
    (
      window as unknown as { dhee: { createSession: jest.Mock } }
    ).dhee.createSession = jest.fn(async () => {
      createSessionCalls += 1;
      return { sessionId: 's-should-not-be-called' };
    });

    let runResult: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      runResult = await api!.runTask('hi');
    });

    // No retry, no createSession call — error returned as-is.
    expect(runCalls).toBe(1);
    expect(createSessionCalls).toBe(0);
    expect(runResult).toEqual({ ok: false, error: 'something else broke' });
  });
});
