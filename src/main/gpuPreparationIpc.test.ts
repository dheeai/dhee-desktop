import { it, expect, jest } from '@jest/globals';
import { registerGpuPreparationIpc } from './gpuPreparationIpc';

it('routes preparation through Core using the saved Desktop endpoint', async () => {
  let handler: any;
  const executeProductionRequest = jest.fn(async () => ({
    ok: true as const,
    result: { selectionId: 'saved' },
  }));
  registerGpuPreparationIpc(
    {
      handle: (_channel, fn) => {
        handler = fn;
      },
    },
    () => ({ gpuQueueUrl: 'http://gpu/mcp' }),
    async () => ({ executeProductionRequest }),
  );
  expect(
    await handler(null, {
      action: 'gpu.prepare',
      projectDir: '/project',
      nodeId: 'clip',
    }),
  ).toMatchObject({ ok: true });
  expect(executeProductionRequest).toHaveBeenCalledWith({
    action: 'gpu.prepare',
    projectDir: '/project',
    nodeId: 'clip',
    endpoint: 'http://gpu/mcp',
  });
});
it('does not expose rendering or arbitrary control operations', async () => {
  let handler: any;
  const load = jest.fn(async () => {
    throw new Error('must not load');
  });
  registerGpuPreparationIpc(
    {
      handle: (_channel, fn) => {
        handler = fn;
      },
    },
    () => ({}),
    load,
  );
  expect(
    await handler(null, { action: 'project.run', projectDir: '/project' }),
  ).toMatchObject({ ok: false });
  expect(load).not.toHaveBeenCalled();
});
