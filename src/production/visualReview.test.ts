/** @jest-environment node */
/* eslint-disable import/no-relative-packages, no-restricted-syntax, no-await-in-loop -- Sequential response cases exercise bounded transport failures. */
import { expect, it, jest, afterEach } from '@jest/globals';
import {
  interpretVisualReview,
  reviewFrames,
} from '../../packages/dhee-runner-production/src/visualReview.js';

const requirements = ['Doctor stays seated; patient exits.'];
const frameTimes = [0.1, 2, 3.8];
const response = (verdict = 'contradicted', confidence = 0.95) => ({
  observations: [
    {
      requirementIndex: 0,
      verdict,
      confidence,
      frameIndices: [0, 2],
      evidence: 'The doctor is standing at the door in the last sampled frame.',
    },
  ],
});
it('flags an evidenced wrong-actor contradiction with its source timestamps', () => {
  const result = interpretVisualReview(response(), requirements, frameTimes);
  expect(result.finding.status).toBe('fail');
  expect(result.observations[0].atSeconds).toEqual([0.1, 3.8]);
});
it('never certifies continuous action from sampled supporting frames', () => {
  expect(
    interpretVisualReview(response('supported'), requirements, frameTimes)
      .finding.status,
  ).toBe('unchecked');
  expect(
    interpretVisualReview(
      response('contradicted', 0.4),
      requirements,
      frameTimes,
    ).finding.status,
  ).toBe('unchecked');
});
it('rejects missing, duplicate and invented requirement IDs and frame evidence', () => {
  const good = response().observations[0];
  for (const observations of [
    [],
    [good, good],
    [{ ...good, requirementIndex: 1 }],
    [{ ...good, frameIndices: [3] }],
    [{ ...good, frameIndices: [] }],
  ])
    expect(() =>
      interpretVisualReview({ observations }, requirements, frameTimes),
    ).toThrow();
});
it('does not send frames anywhere when an explicit review endpoint is absent', async () => {
  const result = await reviewFrames(
    requirements,
    [{ atSec: 0.1, jpeg: Buffer.from('frame') }],
    undefined,
    {},
  );
  expect(result.finding.status).toBe('unchecked');
  expect(result.finding.detail).toMatch(/configured/i);
});
it('honors cancellation before a request', async () => {
  await expect(
    reviewFrames(
      requirements,
      [{ atSec: 0.1, jpeg: Buffer.from('frame') }],
      AbortSignal.abort(),
      {},
    ),
  ).rejects.toThrow();
});

afterEach(() => {
  jest.restoreAllMocks();
});
it('sends bounded timestamped image evidence to the explicitly configured service', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(response()) } }],
      }),
    ),
  );
  const frames = frameTimes.map((atSec) => ({
    atSec,
    jpeg: Buffer.from('sample'),
  }));
  const result = await reviewFrames(requirements, frames, undefined, {
    DHEE_REVIEW_VLM_BASE_URL: 'http://vision.invalid/v1',
    DHEE_REVIEW_VLM_MODEL: 'test-model',
  });
  expect(result.finding.status).toBe('fail');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0];
  expect(String(url)).toBe('http://vision.invalid/v1/chat/completions');
  const request = JSON.parse(options?.body as string);
  expect(request.messages[0].content).toHaveLength(4);
  expect(request.messages[0].content[0].text).toContain('[0.1,2,3.8]');
  expect(options?.redirect).toBe('error');
});
it('rejects oversized responses and service errors without exposing response content', async () => {
  const fetchMock = jest.spyOn(global, 'fetch');
  for (const reply of [
    new Response('private service detail', { status: 403 }),
    new Response('x'.repeat(65537)),
    new Response('{}'),
  ]) {
    fetchMock.mockResolvedValueOnce(reply);
    const result = await reviewFrames(
      requirements,
      [{ atSec: 0, jpeg: Buffer.from('sample') }],
      undefined,
      {
        DHEE_REVIEW_VLM_BASE_URL: 'http://vision.invalid/v1',
        DHEE_REVIEW_VLM_MODEL: 'test-model',
      },
    );
    expect(result.finding.status).toBe('unchecked');
    expect(result.finding.detail).not.toContain('private service detail');
  }
});

it('rejects repeated frame evidence instead of treating it as corroboration', () => {
  const raw = response();
  raw.observations[0].frameIndices = [0, 0];
  expect(() => interpretVisualReview(raw, requirements, frameTimes)).toThrow(
    /duplicate/,
  );
});

const configured = {
  DHEE_REVIEW_VLM_BASE_URL: 'http://vision.invalid/v1',
  DHEE_REVIEW_VLM_MODEL: 'test-model',
};
const sample = [{ atSec: 0, jpeg: Buffer.from('sample') }];
it('propagates caller cancellation while the vision request is pending', async () => {
  const controller = new AbortController();
  jest.spyOn(global, 'fetch').mockImplementation(async (_, init) => {
    // eslint-disable-next-line compat/compat -- Node test transport models pending network I/O.
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(init.signal?.reason),
        { once: true },
      );
      controller.abort(new Error('User cancelled review'));
    });
  });
  await expect(
    reviewFrames(requirements, sample, controller.signal, configured),
  ).rejects.toThrow('User cancelled review');
});
it('returns unchecked when the request deadline expires without cancelling the caller', async () => {
  const deadline = new AbortController();
  const caller = new AbortController();
  jest.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  jest.spyOn(global, 'fetch').mockImplementation(async (_, init) => {
    // eslint-disable-next-line compat/compat -- Node test transport models pending network I/O.
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(init.signal?.reason),
        { once: true },
      );
      deadline.abort(new DOMException('deadline', 'TimeoutError'));
    });
  });
  const result = await reviewFrames(
    requirements,
    sample,
    caller.signal,
    configured,
  );
  expect(result.finding.status).toBe('unchecked');
  expect(caller.signal.aborted).toBe(false);
});
