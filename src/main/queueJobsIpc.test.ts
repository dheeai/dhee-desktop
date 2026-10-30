import { it, expect, jest } from '@jest/globals';
import { registerQueueJobsIpc } from './queueJobsIpc';

it('uses the same structured Core operation as Codex', async () => {
  let handler: any;
  const executeProductionRequest = jest.fn(async () => ({
    ok: true,
    result: {
      jobs: [
        {
          id: 'a'.repeat(64),
          workflow: 'video',
          phase: 'tracked',
          state: 'running',
          jobId: 'j1',
        },
      ],
    },
  }));
  registerQueueJobsIpc(
    {
      handle: (_channel, fn) => {
        handler = fn;
      },
    },
    async () => ({ executeProductionRequest }) as any,
  );
  const result = await handler(null, {
    projectDir: '/project',
    action: 'refresh',
    id: 'a'.repeat(64),
  });
  expect(executeProductionRequest).toHaveBeenCalledWith({
    action: 'gpu.jobs',
    projectDir: '/project',
    operation: 'refresh',
    id: 'a'.repeat(64),
  });
  expect(result.jobs[0]).toMatchObject({ state: 'running', jobId: 'j1' });
});
it('rejects arbitrary operations without loading Core', async () => {
  let handler: any;
  const load = jest.fn(async () => {
    throw new Error('must not load');
  });
  registerQueueJobsIpc(
    {
      handle: (_channel, fn) => {
        handler = fn;
      },
    },
    load,
  );
  expect(
    await handler(null, { projectDir: '/project', action: 'submit' }),
  ).toMatchObject({ ok: false });
  expect(load).not.toHaveBeenCalled();
});
it('preserves structured Core errors', async () => {
  let handler: any;
  registerQueueJobsIpc(
    {
      handle: (_channel, fn) => {
        handler = fn;
      },
    },
    async () => ({
      executeProductionRequest: async () => ({
        ok: false,
        error: 'Job still running',
      }),
    }),
  );
  expect(
    await handler(null, {
      projectDir: '/project',
      action: 'download',
      id: 'a'.repeat(64),
    }),
  ).toEqual({ ok: false, error: 'Job still running' });
});
