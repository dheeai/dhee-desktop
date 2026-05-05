/**
 * Tests for `useKshanaSession` — the renderer hook that wraps
 * `window.kshana.*` to give React components a clean session API.
 *
 * Goal: verify the hook
 *   1. creates a session on mount
 *   2. exposes runTask / cancelTask / redoNode / configureProject
 *      that delegate to window.kshana
 *   3. subscribes to streaming events via .on() and unsubscribes on unmount
 *   4. tracks `status` ('idle' | 'running' | 'error') based on runTask result
 *
 * Strategy: stub `window.kshana` with a recording mock; render the hook
 * via a TestComponent; assert side effects.
 */
import '@testing-library/jest-dom';
import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { useKshanaSession } from './useKshanaSession';
import type { KshanaEvent, KshanaEventName } from '../../shared/kshanaIpc';

type EventListener = (e: KshanaEvent) => void;

interface KshanaMockState {
  createSessionCount: number;
  runTaskArgs: Array<{ sessionId: string; task: string; stopAtStage?: string }>;
  cancelTaskArgs: Array<{ sessionId: string }>;
  redoNodeArgs: Array<{ sessionId: string; nodeId: string; editedPrompt?: string }>;
  configureProjectArgs: Array<{ sessionId: string; projectDir: string }>;
  listeners: Array<{ eventName: KshanaEventName | '*'; cb: EventListener; active: boolean }>;
  nextSessionId: string;
  runTaskResult: { ok: boolean; error?: string };
}

let mockState: KshanaMockState;

function resetMockState(): void {
  mockState = {
    createSessionCount: 0,
    runTaskArgs: [],
    cancelTaskArgs: [],
    redoNodeArgs: [],
    configureProjectArgs: [],
    listeners: [],
    nextSessionId: 's-1',
    runTaskResult: { ok: true },
  };
}

beforeEach(() => {
  resetMockState();
  (window as unknown as { kshana: unknown }).kshana = {
    createSession: jest.fn(async () => {
      mockState.createSessionCount += 1;
      return { sessionId: mockState.nextSessionId };
    }),
    configureProject: jest.fn(async (req: { sessionId: string; projectDir: string }) => {
      mockState.configureProjectArgs.push(req);
      return { ok: true };
    }),
    runTask: jest.fn(async (req: { sessionId: string; task: string; stopAtStage?: string }) => {
      mockState.runTaskArgs.push(req);
      return mockState.runTaskResult;
    }),
    cancelTask: jest.fn(async (req: { sessionId: string }) => {
      mockState.cancelTaskArgs.push(req);
      return { cancelled: true };
    }),
    redoNode: jest.fn(async (req: { sessionId: string; nodeId: string; editedPrompt?: string }) => {
      mockState.redoNodeArgs.push(req);
      return { ok: true };
    }),
    on: jest.fn((eventName: KshanaEventName | '*', cb: EventListener) => {
      const entry = { eventName, cb, active: true };
      mockState.listeners.push(entry);
      return () => {
        entry.active = false;
      };
    }),
    sendResponse: jest.fn(async () => ({ ok: true })),
    focusProject: jest.fn(async () => ({ ok: true })),
    setAutonomous: jest.fn(async () => ({ ok: true })),
    deleteSession: jest.fn(async () => ({ ok: true })),
  };
});

function TestHarness({
  onSession,
  onApi,
}: {
  onSession?: (sessionId: string | null) => void;
  onApi?: (api: ReturnType<typeof useKshanaSession>) => void;
}) {
  const session = useKshanaSession();
  useEffect(() => onSession?.(session.sessionId), [session.sessionId, onSession]);
  useEffect(() => onApi?.(session), [session, onApi]);
  return null;
}

describe('useKshanaSession', () => {
  it('creates a session on mount', async () => {
    render(<TestHarness />);
    await waitFor(() => {
      expect(mockState.createSessionCount).toBe(1);
    });
  });

  it('exposes the created sessionId', async () => {
    let observedSessionId: string | null = null;
    render(<TestHarness onSession={(s) => { observedSessionId = s; }} />);
    await waitFor(() => {
      expect(observedSessionId).toBe('s-1');
    });
  });

  it('runTask delegates to window.kshana.runTask with the current sessionId', async () => {
    let api: ReturnType<typeof useKshanaSession> | null = null;
    render(<TestHarness onApi={(a) => { api = a; }} />);
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

  it('cancelTask delegates to window.kshana.cancelTask', async () => {
    let api: ReturnType<typeof useKshanaSession> | null = null;
    render(<TestHarness onApi={(a) => { api = a; }} />);
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));
    await act(async () => { await api!.cancel(); });
    expect(mockState.cancelTaskArgs).toHaveLength(1);
    expect(mockState.cancelTaskArgs[0]?.sessionId).toBe('s-1');
  });

  it('redoNode delegates with sessionId and editedPrompt', async () => {
    let api: ReturnType<typeof useKshanaSession> | null = null;
    render(<TestHarness onApi={(a) => { api = a; }} />);
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));
    await act(async () => {
      await api!.redoNode('shot_image:scene_1_shot_4', { editedPrompt: 'new prompt' });
    });
    expect(mockState.redoNodeArgs[0]).toMatchObject({
      sessionId: 's-1',
      nodeId: 'shot_image:scene_1_shot_4',
      editedPrompt: 'new prompt',
    });
  });

  it('configureProject delegates with sessionId + opts', async () => {
    let api: ReturnType<typeof useKshanaSession> | null = null;
    render(<TestHarness onApi={(a) => { api = a; }} />);
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));
    await act(async () => {
      await api!.configureProject({ projectDir: '/path/to/parvati', templateId: 'narrative' });
    });
    expect(mockState.configureProjectArgs[0]).toMatchObject({
      sessionId: 's-1',
      projectDir: '/path/to/parvati',
    });
  });

  it('status flips to "running" while runTask is awaiting and back to "idle" after success', async () => {
    let api: ReturnType<typeof useKshanaSession> | null = null;
    render(<TestHarness onApi={(a) => { api = a; }} />);
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));
    expect(api!.status).toBe('idle');
    let runPromise: Promise<unknown>;
    act(() => {
      runPromise = api!.runTask('hi');
    });
    // Status should be running before the promise resolves.
    await waitFor(() => expect(api!.status).toBe('running'));
    await act(async () => { await runPromise; });
    await waitFor(() => expect(api!.status).toBe('idle'));
  });

  it('status flips to "error" when runTask returns ok:false', async () => {
    mockState.runTaskResult = { ok: false, error: 'something broke' };
    let api: ReturnType<typeof useKshanaSession> | null = null;
    render(<TestHarness onApi={(a) => { api = a; }} />);
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));
    await act(async () => { await api!.runTask('hi'); });
    expect(api!.status).toBe('error');
  });

  it('subscribe(event, cb) registers a listener; returned unsubscribe deactivates it', async () => {
    let api: ReturnType<typeof useKshanaSession> | null = null;
    render(<TestHarness onApi={(a) => { api = a; }} />);
    await waitFor(() => expect(api?.sessionId).toBe('s-1'));

    const handler = jest.fn();
    let unsubscribe: (() => void) | null = null;
    act(() => {
      unsubscribe = api!.subscribe('tool_call', handler);
    });

    expect(mockState.listeners).toHaveLength(1);
    expect(mockState.listeners[0]?.eventName).toBe('tool_call');
    expect(mockState.listeners[0]?.active).toBe(true);

    unsubscribe!();
    expect(mockState.listeners[0]?.active).toBe(false);
  });
});
