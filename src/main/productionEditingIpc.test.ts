import { expect, it, jest } from '@jest/globals';
import { registerProductionEditingIpc } from './productionEditingIpc';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
it('restricts editor operations and forwards exact Core requests', async () => {
  let handler: any;
  const executeProductionRequest = jest.fn(
    async (): Promise<any> => ({ ok: true, result: {} }),
  );
  registerProductionEditingIpc(
    {
      handle: (_channel, fn) => {
        handler = fn;
      },
    },
    async () => ({ executeProductionRequest }),
    async () => undefined,
  );
  expect(await handler(null, { action: 'project.run' })).toMatchObject({
    ok: false,
  });
  expect(executeProductionRequest).not.toHaveBeenCalled();
  const request = {
    action: 'input.write',
    projectDir: '/project',
    inputId: 'brief',
    payload: { kind: 'text', content: 'text' },
    expectedFingerprint: 'exact',
    humanAcknowledged: true,
  };
  expect(await handler(null, request)).toMatchObject({ ok: true });
  expect(executeProductionRequest).toHaveBeenCalledWith(request);
  expect(await handler(null, { action: 'reference.pick' })).toEqual({
    ok: true,
    result: { cancelled: true },
  });
});
it('snapshots the chosen reference hash without changing the file or calling Core', async () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-edit-'));
  try {
    const path = join(root, 'voice.wav');
    const bytes = Buffer.from([0, 255, 128]);
    writeFileSync(path, bytes);
    let handler: any;
    const executeProductionRequest = jest.fn(
      async (): Promise<any> => ({ ok: true, result: {} }),
    );
    registerProductionEditingIpc(
      {
        handle: (_channel, fn) => {
          handler = fn;
        },
      },
      async () => ({ executeProductionRequest }),
      async () => path,
    );
    expect(await handler(null, { action: 'reference.pick' })).toEqual({
      ok: true,
      result: {
        payload: {
          kind: 'localFile',
          sourcePath: path,
          expectedSha256: createHash('sha256').update(bytes).digest('hex'),
        },
      },
    });
    expect(executeProductionRequest).not.toHaveBeenCalled();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
