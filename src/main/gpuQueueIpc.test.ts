import { it, expect, jest } from '@jest/globals';
import { registerGpuQueueIpc } from './gpuQueueIpc';
import { dhee_CHANNELS as channels } from '../shared/dheeIpc';

it('checks the catalog through Core and returns failures without claiming connection', async () => {
  let handler: any;
  const list = jest.fn(async () => [
    {
      name: 'image',
      available: true,
      status: 'unchecked',
      description: 'Image',
      inputs: {},
    },
  ]);
  const load = async () => ({
    executeProductionRequest: async () => ({
      ok: true as const,
      result: { workflows: await list() },
    }),
  });
  registerGpuQueueIpc(
    {
      handle: (name, fn) => {
        expect(name).toBe(channels.GPU_QUEUE_CATALOG);
        handler = fn;
      },
    },
    load,
  );
  expect(
    await handler(null, { endpoint: 'http://localhost:9000/mcp' }),
  ).toMatchObject({ ok: true, workflows: [{ status: 'unchecked' }] });
  list.mockRejectedValueOnce(new Error('HTTP 403') as never);
  expect(
    await handler(null, { endpoint: 'http://localhost:9000/mcp' }),
  ).toEqual({ ok: false, error: 'HTTP 403' });
});
it('rejects malformed IPC input before loading Core', async () => {
  let handler: any;
  const load = jest.fn(async () => {
    throw new Error('must not load');
  });
  registerGpuQueueIpc(
    {
      handle: (_name, fn) => {
        handler = fn;
      },
    },
    load,
  );
  expect(await handler(null, {})).toMatchObject({ ok: false });
  expect(load).not.toHaveBeenCalled();
});
