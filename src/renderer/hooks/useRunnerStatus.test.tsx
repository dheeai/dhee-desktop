/**
 * useRunnerStatus — shared polling hook for the active runner.
 *
 * Lifted from ChatPanelEmbedded + WorkspaceLayout (both polled
 * independently with subtly drifting intervals + error handling).
 * The status-strip needs the same data so consolidation is overdue.
 */
import '@testing-library/jest-dom';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRunnerStatus } from './useRunnerStatus';

const runnerStatusMock = jest.fn();
beforeAll(() => {
  (window as unknown as { dhee: unknown }).dhee = {
    runnerStatus: () => runnerStatusMock(),
  };
});

beforeEach(() => {
  runnerStatusMock.mockReset();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useRunnerStatus', () => {
  it('returns null status on first render (before first poll resolves)', () => {
    runnerStatusMock.mockResolvedValue({ active: false });
    const { result } = renderHook(() => useRunnerStatus());
    expect(result.current.status).toBeNull();
    expect(result.current.active).toBe(false);
  });

  it('populates the status once the first poll resolves', async () => {
    runnerStatusMock.mockResolvedValue({
      active: true,
      kind: 'compose_video',
      taskId: 't1',
      startedAt: Date.now(),
    });
    const { result } = renderHook(() => useRunnerStatus());
    await waitFor(() => {
      expect(result.current.status?.active).toBe(true);
      expect(result.current.status?.kind).toBe('compose_video');
    });
    expect(result.current.active).toBe(true);
  });

  it('re-polls on the configured interval', async () => {
    runnerStatusMock.mockResolvedValue({ active: false });
    renderHook(() => useRunnerStatus({ intervalMs: 1000 }));
    await waitFor(() => expect(runnerStatusMock).toHaveBeenCalledTimes(1));
    act(() => { jest.advanceTimersByTime(1000); });
    await waitFor(() => expect(runnerStatusMock).toHaveBeenCalledTimes(2));
    act(() => { jest.advanceTimersByTime(1000); });
    await waitFor(() => expect(runnerStatusMock).toHaveBeenCalledTimes(3));
  });

  it('keeps the last good status when a poll throws (network blip)', async () => {
    runnerStatusMock.mockResolvedValueOnce({
      active: true,
      kind: 'render',
      taskId: 'r1',
      startedAt: Date.now(),
    });
    const { result } = renderHook(() => useRunnerStatus({ intervalMs: 500 }));
    await waitFor(() => expect(result.current.status?.active).toBe(true));

    runnerStatusMock.mockRejectedValueOnce(new Error('blip'));
    act(() => { jest.advanceTimersByTime(500); });
    await waitFor(() => expect(runnerStatusMock).toHaveBeenCalledTimes(2));

    // Status should still be the last good value.
    expect(result.current.status?.active).toBe(true);
    expect(result.current.status?.kind).toBe('render');
  });

  it('stops polling on unmount', async () => {
    runnerStatusMock.mockResolvedValue({ active: false });
    const { unmount } = renderHook(() => useRunnerStatus({ intervalMs: 500 }));
    await waitFor(() => expect(runnerStatusMock).toHaveBeenCalledTimes(1));
    unmount();
    act(() => { jest.advanceTimersByTime(2000); });
    // No additional polls fired after unmount.
    expect(runnerStatusMock).toHaveBeenCalledTimes(1);
  });

  it('exposes cancel() that calls window.dhee.runnerCancel', async () => {
    const runnerCancelMock = jest.fn().mockResolvedValue({ ok: true });
    (window as unknown as { dhee: unknown }).dhee = {
      runnerStatus: () => runnerStatusMock(),
      runnerCancel: () => runnerCancelMock(),
    };
    runnerStatusMock.mockResolvedValue({ active: true, kind: 'x', taskId: 't1', startedAt: Date.now() });
    const { result } = renderHook(() => useRunnerStatus());
    await waitFor(() => expect(result.current.status?.active).toBe(true));
    await act(async () => { await result.current.cancel(); });
    expect(runnerCancelMock).toHaveBeenCalled();
  });
});
