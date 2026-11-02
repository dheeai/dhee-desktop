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

it('forwards recovery evidence and acknowledgement through Core', async () => {
  let handler: any;
  const recovery = { fingerprint: 'b'.repeat(64) };
  const executeProductionRequest = jest.fn(async () => ({
    ok: true,
    result: { jobs: [], recovery },
  }));
  registerQueueJobsIpc(
    {
      handle: (_channel, fn) => {
        handler = fn;
      },
    },
    async () => ({ executeProductionRequest }) as any,
  );
  expect(
    await handler(null, {
      projectDir: '/project',
      action: 'inspect-recovery',
      id: 'a'.repeat(64),
      jobId: 'job1',
    }),
  ).toMatchObject({ ok: true, recovery });
  await handler(null, {
    projectDir: '/project',
    action: 'link-existing',
    id: 'a'.repeat(64),
    jobId: 'job1',
    expectedFingerprint: 'b'.repeat(64),
    humanAcknowledged: true,
  });
  expect(executeProductionRequest).toHaveBeenLastCalledWith({
    action: 'gpu.recovery.link',
    projectDir: '/project',
    id: 'a'.repeat(64),
    jobId: 'job1',
    expectedFingerprint: 'b'.repeat(64),
    humanAcknowledged: true,
  });
});
