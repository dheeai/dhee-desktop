/**
 * useRunnerStatus — shared polling hook for the active runner.
 *
 * Background: the engine doesn't push runner state to the renderer.
 * Status visibility comes from polling `window.dhee.runnerStatus()`
 * at a small interval (default 1.5s, matches what ChatPanel and
 * WorkspaceLayout used independently before this hook existed).
 *
 * The hook keeps the last successful response when a poll errors,
 * so a transient blip doesn't blank the status strip. Callers also
 * get a `cancel()` that wraps `window.dhee.runnerCancel()`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunnerStatusResponse } from '../../shared/dheeIpc';

export interface UseRunnerStatusOpts {
  /** Polling interval in ms. Default 1500. */
  intervalMs?: number;
}

export interface RunnerStatusHook {
  /** Latest non-error response, or null before the first poll resolves. */
  status: RunnerStatusResponse | null;
  /** Convenience: equivalent to `status?.active === true`. */
  active: boolean;
  /** Convenience: equivalent to `status?.cancelling === true`. */
  cancelling: boolean;
  /** Trigger runner cancellation via the existing IPC. */
  cancel: () => Promise<void>;
}

const DEFAULT_INTERVAL_MS = 1500;

export function useRunnerStatus(opts: UseRunnerStatusOpts = {}): RunnerStatusHook {
  const interval = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const [status, setStatus] = useState<RunnerStatusResponse | null>(null);
  const statusRef = useRef<RunnerStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const next = await window.dhee.runnerStatus();
        if (!cancelled) {
          statusRef.current = next;
          setStatus(next);
        }
      } catch {
        // Keep last good value — blips shouldn't blank the strip.
      }
    };

    void poll();
    const handle = setInterval(() => {
      void poll();
    }, interval);

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [interval]);

  const cancel = useCallback(async () => {
    if (typeof window.dhee?.runnerCancel === 'function') {
      await window.dhee.runnerCancel();
    }
  }, []);

  return {
    status,
    active: status?.active === true,
    cancelling: status?.cancelling === true,
    cancel,
  };
}
