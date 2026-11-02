import { expect, it, jest } from '@jest/globals';
import { registerAssemblyIpc } from './assemblyIpc';

it('restricts assembly IPC to shared list/run operations', async () => {
  let handler: any;
  const executeProductionRequest = jest.fn(
    async (): Promise<any> => ({ ok: true, result: {} }),
  );
  registerAssemblyIpc(
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
  const req = { action: 'assembly.targets', projectDir: '/project' };
  expect(await handler(null, req)).toMatchObject({ ok: true });
  expect(executeProductionRequest).toHaveBeenCalledWith(req);
  const run = { ...req, action: 'assembly.run' };
  expect(await handler(null, run)).toMatchObject({ ok: true });
  expect(executeProductionRequest).toHaveBeenCalledWith(run);
});
