/** @jest-environment node */
/* eslint-disable import/no-relative-packages */
import { expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { prepareNarration } from '../../packages/dhee-runner-production/src/narrationTiming';

// Known PCM samples with two speech-like regions and one quiet interval.
function fixture(channels = 1) {
  const rate = 8000;
  const pcm = Buffer.alloc(rate * 3 * channels * 2);
  for (let f = 0; f < rate * 3; f += 1)
    for (let c = 0; c < channels; c += 1)
      pcm.writeInt16LE(
        f >= rate && f < 2 * rate ? 0 : (f % 2 ? 1000 : -1000) + c,
        (f * channels + c) * 2,
      );
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * channels * 2, 28);
  wav.writeUInt16LE(channels * 2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  const plan = {
    sourceSha256: createHash('sha256').update(wav).digest('hex'),
    scenes: [
      { id: 'a', durationSec: 2, offsetSec: 0.2 },
      { id: 'b', durationSec: 2, offsetSec: 0.1 },
    ],
  };
  return { wav, pcm, rate, plan };
}
it.each([1, 2])(
  'preserves every PCM sample in order for %i channels and inserts only silence',
  (channels) => {
    const { wav, pcm, rate, plan } = fixture(channels);
    const result = prepareNarration(wav, plan);
    expect(result.wav.readUInt16LE(22)).toBe(channels);
    expect(result.wav.readUInt32LE(24)).toBe(rate);
    expect(result.wav.length).toBe(44 + rate * 4 * channels * 2);
    const reconstructed = Buffer.concat(
      result.metadata.segments.map((s) =>
        result.wav.subarray(
          44 + s.timelineStartSample * channels * 2,
          44 +
            (s.timelineStartSample + s.endSample - s.startSample) *
              channels *
              2,
        ),
      ),
    );
    expect(reconstructed.equals(pcm)).toBe(true);
    expect(
      result.wav
        .subarray(44, 44 + rate * 0.2 * channels * 2)
        .every((v) => v === 0),
    ).toBe(true);
    expect(result.metadata).toMatchObject({
      sourceSha256: plan.sourceSha256,
      semanticAlignment: 'unchecked',
      deliveryReady: false,
    });
  },
);
it('returns a selected scene with the same placement as the whole timeline', () => {
  const { wav, plan, rate } = fixture();
  const full = prepareNarration(wav, plan);
  const scene = prepareNarration(wav, plan, 'b');
  expect(scene.wav.subarray(44)).toEqual(full.wav.subarray(44 + rate * 2 * 2));
});
it('uses explicit hints only inside measured quiet intervals', () => {
  const { wav, plan } = fixture();
  expect(
    prepareNarration(wav, { ...plan, boundaryHintsSec: [1.3] }).metadata
      .segments[0].endSample,
  ).toBe(10400);
  expect(() =>
    prepareNarration(wav, { ...plan, boundaryHintsSec: [0.5] }),
  ).toThrow(/quiet|pause/i);
});
it('rejects insufficient pauses instead of cutting speech', () => {
  const { wav, plan } = fixture();
  expect(() =>
    prepareNarration(wav, {
      ...plan,
      scenes: [...plan.scenes, { id: 'c', durationSec: 2 }],
    }),
  ).toThrow(/ambiguous|pause/i);
});
it('rejects overflow instead of trimming or speeding up approved voice', () => {
  const { wav, plan } = fixture();
  expect(() =>
    prepareNarration(wav, {
      ...plan,
      scenes: [{ id: 'a', durationSec: 1 }, plan.scenes[1]],
    }),
  ).toThrow(/fit|exceed/i);
});
it('binds the timing plan to the exact approved source bytes', () => {
  const { wav, plan } = fixture();
  wav[100] = (wav[100] + 1) % 256;
  expect(() => prepareNarration(wav, plan)).toThrow(/hash|changed/i);
});
it('does not count a quiet left channel as silence while the right channel speaks', () => {
  const { wav, plan } = fixture(2);
  for (let frame = 8000; frame < 16000; frame += 1)
    wav.writeInt16LE(1000, 44 + frame * 4 + 2);
  plan.sourceSha256 = createHash('sha256').update(wav).digest('hex');
  expect(() => prepareNarration(wav, plan)).toThrow(/pause/i);
});
it('rounds cumulative scene timing without accumulating per-scene drift', () => {
  const { wav, plan, rate } = fixture();
  const result = prepareNarration(wav, {
    ...plan,
    scenes: [
      { id: 'a', durationSec: 2.00006 },
      { id: 'b', durationSec: 2.00006 },
    ],
  });
  expect(result.wav.length).toBe(44 + Math.round(4.00012 * rate) * 2);
});
it.each([
  {
    scenes: [
      { id: 'a', durationSec: 2 },
      { id: 'a', durationSec: 2 },
    ],
  },
  { scenes: [{ id: 'a', durationSec: Infinity }] },
  { scenes: [{ id: 'a', durationSec: 2, offsetSec: -1 }] },
  { boundaryHintsSec: [] },
  { silenceThresholdDb: 0 },
])('rejects invalid plans %j', (change) => {
  const { wav, plan } = fixture();
  expect(() => prepareNarration(wav, { ...plan, ...change })).toThrow();
});
it('rejects unknown scene selection', () => {
  const { wav, plan } = fixture();
  expect(() => prepareNarration(wav, plan, 'missing')).toThrow(/scene/i);
});
it('rejects malformed and non-PCM16 input', () => {
  const { wav, plan } = fixture();
  expect(() => prepareNarration(wav.subarray(0, 40), plan)).toThrow();
  wav.writeUInt16LE(3, 20);
  plan.sourceSha256 = createHash('sha256').update(wav).digest('hex');
  expect(() => prepareNarration(wav, plan)).toThrow(/PCM/i);
});
it('refuses an entirely silent source', () => {
  const { wav, plan } = fixture();
  wav.fill(0, 44);
  plan.sourceSha256 = createHash('sha256').update(wav).digest('hex');
  expect(() => prepareNarration(wav, plan)).toThrow(/silent|speech|pause/i);
});

it('refuses extra eligible pauses instead of guessing a sentence boundary', () => {
  const { wav, plan } = fixture();
  // Add another qualifying internal pause, separated by a voiced block.
  wav.fill(0, 44 + Math.round(0.1 * 8000) * 2, 44 + Math.round(0.9 * 8000) * 2);
  plan.sourceSha256 = createHash('sha256').update(wav).digest('hex');
  expect(() => prepareNarration(wav, plan)).toThrow(
    /Ambiguous pauses: found 2, need 1/,
  );
  expect(
    prepareNarration(wav, { ...plan, boundaryHintsSec: [1.5] }).metadata
      .segments[0].endSample,
  ).toBe(12000);
});
it('rejects duplicate hints within the same pause', () => {
  const { wav, plan } = fixture();
  expect(() =>
    prepareNarration(wav, {
      ...plan,
      scenes: [...plan.scenes, { id: 'c', durationSec: 2 }],
      boundaryHintsSec: [1.3, 1.6],
    }),
  ).toThrow(/different measured quiet pause/);
});
