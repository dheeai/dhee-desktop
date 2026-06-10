/**
 * Tests for Phase 6.5c.e — cancelTask order invariant.
 *
 * The bug being pinned: `await session.abort()` blocks until pi's
 * current operation finishes. If that operation is an in-flight
 * dhee_start_run (a BackgroundTaskRunner task), abort() waits for
 * the runner task itself — meaning the agent is "stuck busy" until
 * the runner ends. With the original cancel ordering (abort first,
 * runner cancel second), Stop was effectively a no-op while a bundle
 * was running.
 *
 * Fix: runner.cancel() FIRST (synchronous), THEN await session.abort().
 * The runner cancel makes the tool's terminal event fire, which lets
 * abort() resolve quickly.
 *
 * This test asserts that order by making session.abort() observable:
 * it records the value of `runner.cancel()`'s call count at the moment
 * abort fires. If runner.cancel was called first (the fix), the
 * recorded value is 1. If abort fires first (the regression), it's 0.
 */
import { describe, expect, it, jest } from '@jest/globals';

jest.mock('electron', () => ({
  app: { isPackaged: false },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, import/first
const { dheeCoreManager, __setRunnersLoader } =
  require('./dheeCoreManager') as typeof import('./dheeCoreManager');

describe('dheeCoreManager.cancelTask (Phase 6.5c.e)', () => {
  it('calls runner.cancel() BEFORE awaiting session.abort()', async () => {
    let runnerCancelCount = 0;
    let cancelCountAtAbortTime = -1;

    __setRunnersLoader(async () => ({
      getBackgroundTaskRunner: () => ({
        cancel: () => {
          runnerCancelCount += 1;
          return true;
        },
        getActive: () => null,
        isCancelling: () => false,
        dispatch: () => ({ status: 'started' as const, taskId: 't-stub' }),
        on: () => () => {},
      }),
    }) as never);

    const mgr = new dheeCoreManager();
    mgr.__setAgentSessionForTesting('s-stop', {
      subscribe: () => () => {},
      prompt: async () => {},
      abort: async () => {
        cancelCountAtAbortTime = runnerCancelCount;
      },
    });

    const ok = await mgr.cancelTask('s-stop');
    expect(ok).toBe(true);
    expect(runnerCancelCount).toBe(1);
    // The critical assertion: by the time abort is invoked, runner.cancel
    // has already fired exactly once.
    expect(cancelCountAtAbortTime).toBe(1);
  });

  it('still cancels the runner when no AgentSession exists for the session id', async () => {
    let cancelled = false;
    __setRunnersLoader(async () => ({
      getBackgroundTaskRunner: () => ({
        cancel: () => {
          cancelled = true;
          return true;
        },
        getActive: () => null,
        isCancelling: () => false,
        dispatch: () => ({ status: 'started' as const, taskId: 't-stub' }),
        on: () => () => {},
      }),
    }) as never);

    const mgr = new dheeCoreManager();
    const ok = await mgr.cancelTask('s-no-agent');
    expect(cancelled).toBe(true);
    expect(ok).toBe(true);
  });

  it('returns true when only the AgentSession abort succeeds (no active runner task)', async () => {
    __setRunnersLoader(async () => ({
      getBackgroundTaskRunner: () => ({
        cancel: () => false,
        getActive: () => null,
        isCancelling: () => false,
        dispatch: () => ({ status: 'started' as const, taskId: 't-stub' }),
        on: () => () => {},
      }),
    }) as never);

    const mgr = new dheeCoreManager();
    let aborted = false;
    mgr.__setAgentSessionForTesting('s-only-agent', {
      subscribe: () => () => {},
      prompt: async () => {},
      abort: async () => {
        aborted = true;
      },
    });
    const ok = await mgr.cancelTask('s-only-agent');
    expect(aborted).toBe(true);
    expect(ok).toBe(true);
  });

  it('swallows a throwing abort() so the cancel result is still reported correctly', async () => {
    __setRunnersLoader(async () => ({
      getBackgroundTaskRunner: () => ({
        cancel: () => true,
        getActive: () => null,
        isCancelling: () => false,
        dispatch: () => ({ status: 'started' as const, taskId: 't-stub' }),
        on: () => () => {},
      }),
    }) as never);

    const mgr = new dheeCoreManager();
    mgr.__setAgentSessionForTesting('s-throwy-abort', {
      subscribe: () => () => {},
      prompt: async () => {},
      abort: async () => {
        throw new Error('no current operation');
      },
    });
    const ok = await mgr.cancelTask('s-throwy-abort');
    // Runner cancel succeeded, so overall result is true regardless of
    // abort's tantrum.
    expect(ok).toBe(true);
  });
});
