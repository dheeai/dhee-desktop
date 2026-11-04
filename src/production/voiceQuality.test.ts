/** @jest-environment node */
/* eslint-disable import/no-relative-packages */
import { it, expect } from '@jest/globals';
import { analyzeVoice } from '../../packages/dhee-runner-production/src/voiceQuality';

function wav(samples: number[], rate = 8000, channels = 1) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => b.writeInt16LE(s, 44 + i * 2));
  return b;
}
const tone = (seconds: number, amplitude = 4000) =>
  Array.from({ length: seconds * 8000 }, (_, i) =>
    Math.round(amplitude * Math.sin((i * Math.PI) / 10)),
  );
it('fails a silent audition instead of approving readable bytes', () => {
  expect(analyzeVoice(wav(Array(8000).fill(0))).findings).toContainEqual(
    expect.objectContaining({ id: 'audible-signal', status: 'fail' }),
  );
});
it('detects rail samples on either stereo channel without downmix cancellation', () => {
  const b = wav(
    Array.from({ length: 16000 }, (_, i) => (i % 2 ? -32768 : 32767)),
    8000,
    2,
  );
  expect(analyzeVoice(b).findings).toContainEqual(
    expect.objectContaining({ id: 'clipping', status: 'review' }),
  );
});
it('locates a long internal pause and keeps it a review finding', () => {
  const r = analyzeVoice(
    wav([...tone(1), ...Array(24000).fill(0), ...tone(1)]),
  );
  expect(r.pauses).toContainEqual({
    startSec: 1,
    endSec: 4,
    durationSec: 3,
    kind: 'internal',
  });
  expect(r.findings).toContainEqual(
    expect.objectContaining({ id: 'pauses', status: 'review' }),
  );
});
it('reports quiet audio and overflow without modifying source', () => {
  const b = wav(tone(2, 30));
  const before = Buffer.from(b);
  const r = analyzeVoice(b, { availableDurationSec: 1 });
  expect(r.findings).toContainEqual(
    expect.objectContaining({ id: 'level', status: 'review' }),
  );
  expect(r.findings).toContainEqual(
    expect.objectContaining({ id: 'duration-fit', status: 'fail' }),
  );
  expect(b).toEqual(before);
});
it('never certifies emotion or naturalness from a clean waveform', () => {
  const r = analyzeVoice(wav(tone(1)));
  expect(r.perceptualStatus).toBe('unchecked');
  expect(r.deliveryReady).toBe(false);
  expect(r.findings).toContainEqual(
    expect.objectContaining({ id: 'performance', status: 'unchecked' }),
  );
});
it('rejects incomplete audio and invalid limits', () => {
  expect(() => analyzeVoice(Buffer.from('bad'))).toThrow();
  expect(() => analyzeVoice(wav(tone(1)), { maxPauseSec: -1 })).toThrow();
});
