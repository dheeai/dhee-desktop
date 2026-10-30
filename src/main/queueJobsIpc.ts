import { isAbsolute } from 'node:path';
import { dhee_CHANNELS as channels } from '../shared/dheeIpc';
import type { QueueJobSummary, QueueJobsResponse } from '../shared/gpuQueue';

interface QueueCore {
  executeProductionRequest(
    request: unknown,
  ): Promise<
    | { ok: true; result: { jobs: QueueJobSummary[] } }
    | { ok: false; error: string }
  >;
}
const coreControlModule = 'dhee-core/control';
export function registerQueueJobsIpc(
  ipc: {
    handle(
      channel: string,
      listener: (
        event: unknown,
        request: unknown,
      ) => Promise<QueueJobsResponse>,
    ): void;
  },
  load: () => Promise<QueueCore> = () =>
    import(/* webpackIgnore: true */ coreControlModule),
) {
  ipc.handle(channels.QUEUE_JOBS, async (_event, request) => {
    try {
      const req = request as {
        projectDir?: unknown;
        action?: unknown;
        id?: unknown;
      } | null;
      if (
        !req ||
        typeof req.projectDir !== 'string' ||
        !isAbsolute(req.projectDir)
      )
        throw new Error('An absolute project directory is required.');
      if (
        !['list', 'refresh', 'cancel', 'download'].includes(String(req.action))
      )
        throw new Error('Unknown queue operation.');
      if (
        req.action !== 'list' &&
        (typeof req.id !== 'string' || !/^[a-f0-9]{64}$/.test(req.id))
      )
        throw new Error('A saved queue record id is required.');
      const core = await load();
      if (typeof core.executeProductionRequest !== 'function')
        throw new Error(
          'Build the matching Core version to manage saved GPU jobs.',
        );
      const result = await core.executeProductionRequest({
        action: 'gpu.jobs',
        projectDir: req.projectDir,
        operation: req.action,
        ...(req.id ? { id: req.id } : {}),
      });
      return result.ok ? { ok: true, jobs: result.result.jobs } : result;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
export default registerQueueJobsIpc;
