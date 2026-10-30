import { describe, expect, it, jest } from '@jest/globals';
import { registerProductionReviewIpc } from './productionReviewIpc';
import { dhee_CHANNELS as channels } from '../shared/dheeIpc';

describe('production review IPC', () => {
  it('delegates reads and decisions to the same Core API', async () => {
    const handlers = new Map<
      string,
      (event: unknown, req: any) => Promise<unknown>
    >();
    const read = jest
      .fn<any>()
      .mockResolvedValue({ status: 'unreviewed', fingerprint: 'f' });
    const record = jest
      .fn<any>()
      .mockResolvedValue({ status: 'approved', fingerprint: 'f' });
    registerProductionReviewIpc(
      {
        handle: (channel, listener) => {
          handlers.set(channel, listener);
        },
      },
      async () => ({
        readProductionReview: read,
        recordProductionReview: record,
      }),
    );
    const req = {
      projectDir: '/project',
      gate: 'storyboard',
      targets: [{ nodeId: 'story' }],
    };
    expect(
      await handlers.get(channels.READ_PRODUCTION_REVIEW)!(null, req),
    ).toEqual({ ok: true, review: { status: 'unreviewed', fingerprint: 'f' } });
    expect(read).toHaveBeenCalledWith(req);
    await handlers.get(channels.RECORD_PRODUCTION_REVIEW)!(null, {
      ...req,
      decision: 'approved',
      expectedFingerprint: 'f',
    });
    expect(record).toHaveBeenCalledWith({
      ...req,
      decision: 'approved',
      expectedFingerprint: 'f',
    });
  });
  it('returns a visible error for an older Core build', async () => {
    const handlers = new Map<
      string,
      (event: unknown, req: any) => Promise<any>
    >();
    registerProductionReviewIpc(
      {
        handle: (channel, listener) => {
          handlers.set(channel, listener);
        },
      },
      async () => ({}) as any,
    );
    expect(
      (await handlers.get(channels.READ_PRODUCTION_REVIEW)!(null, {})).error,
    ).toMatch(/Core build/);
  });
});
