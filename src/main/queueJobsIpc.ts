import { isAbsolute } from 'node:path';
import { dhee_CHANNELS as channels } from '../shared/dheeIpc';
import type { QueueJobSummary, QueueJobsResponse } from '../shared/gpuQueue';

interface StoredJob extends QueueJobSummary {
  job?: { state: string; error?: string | null };
}
interface QueueCore {
  QueueJobs: new (projectDir: string) => {
    list(): StoredJob[];
    refresh(id: string): Promise<unknown>;
    cancel(id: string): Promise<unknown>;
    download(id: string): Promise<unknown>;
  };
}
const coreDagModule = 'dhee-core/dag';
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
    import(/* webpackIgnore: true */ coreDagModule),
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
      if (!core.QueueJobs)
        throw new Error(
          'Build the matching Core version to manage saved GPU jobs.',
        );
      const store = new core.QueueJobs(req.projectDir);
      if (
        req.action === 'refresh' ||
        req.action === 'cancel' ||
        req.action === 'download'
      )
        await store[req.action](req.id as string);
      return {
        ok: true,
        jobs: store.list().map((record) => ({
          id: record.id,
          workflow: record.workflow,
          phase: record.phase,
          jobId: record.jobId,
          state: record.job?.state,
          cancelRequested: record.cancelRequested,
          error: record.error || record.job?.error || undefined,
          files: record.files?.map((file) => ({
            path: file.path,
            sha256: file.sha256,
            bytes: file.bytes,
          })),
        })),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
export default registerQueueJobsIpc;
