import { it, expect, jest } from '@jest/globals';
import { registerQueueJobsIpc } from './queueJobsIpc';

it('refreshes the persisted job through Core and returns a compact project list', async () => {
  let handler: any;
  const refresh = jest.fn(async () => ({}));
  const jobs = [
    {
      id: 'a'.repeat(64),
      workflow: 'video',
      phase: 'tracked',
      jobId: 'j1',
      job: { state: 'running' },
      inputs: { privatePrompt: 'omit' },
    },
  ];
  registerQueueJobsIpc(
    {
      handle: (_channel, fn) => {
        handler = fn;
      },
    },
    async () =>
      ({
        QueueJobs: class {
          records = jobs;

          list = () => this.records;

          refresh = refresh;

          cancel = refresh;

          download = refresh;
        },
      }) as any,
  );
  const result = await handler(null, {
    projectDir: '/project',
    action: 'refresh',
    id: 'a'.repeat(64),
  });
  expect(refresh).toHaveBeenCalledWith('a'.repeat(64));
  expect(result.jobs[0]).toMatchObject({ state: 'running', jobId: 'j1' });
  expect(result.jobs[0].inputs).toBeUndefined();
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
