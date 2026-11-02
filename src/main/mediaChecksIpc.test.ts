import { expect, it, jest } from '@jest/globals';
import { registerMediaChecksIpc } from './mediaChecksIpc';

it('only allows selected-media checks and delegates to Core', async () => {
  let handler: any;
  const executeProductionRequest = jest.fn(
    async (): Promise<any> => ({ ok: true, result: {} }),
  );
  registerMediaChecksIpc(
    {
      handle: (_channel, fn) => {
        handler = fn;
      },
    },
    async () => ({ executeProductionRequest }),
  );
  expect(await handler(null, { action: 'project.run' })).toMatchObject({
    ok: false,
  });
  expect(executeProductionRequest).not.toHaveBeenCalled();
  const req = { action: 'media.check', projectDir: '/project', nodeId: 'clip' };
  expect(await handler(null, req)).toMatchObject({ ok: true });
  expect(executeProductionRequest).toHaveBeenCalledWith(req);
});
