import { z } from 'zod';
import { readPcm } from './narrationTiming.js';

export const voiceLimitsSchema = z
  .object({
    maxPauseSec: z.number().finite().min(0.2).max(10).default(1.2),
    silenceThresholdDb: z.number().finite().min(-70).max(-30).default(-45),
    availableDurationSec: z.number().finite().positive().max(120).optional(),
  })
  .strict();
export type VoiceFinding = {
  id: string;
  status: 'pass' | 'review' | 'fail' | 'unchecked';
  detail: string;
};
/** Signal heuristics only: these cannot score acting, identity or naturalness. */
export function analyzeVoice(
  wav: Buffer,
  options: z.input<typeof voiceLimitsSchema> = {},
) {
  const limits = voiceLimitsSchema.parse(options);
  const { pcm, rate, channels, stride, frames } = readPcm(wav);
  const durationSec = frames / rate;
  if (durationSec > 120)
    throw Error('Voice checks support at most 120 seconds');
  const window = Math.max(1, Math.round(rate * 0.02));
  const levels: number[] = [];
  let peak = 0;
  let rails = 0;
  for (let f = 0; f < frames; f += window) {
    const count = Math.min(window, frames - f);
    const sums = Array<number>(channels).fill(0);
    for (let j = 0; j < count; j += 1)
      for (let c = 0; c < channels; c += 1) {
        const raw = pcm.readInt16LE((f + j) * stride + c * 2);
        const sample = raw / 32768;
        sums[c] += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
        if (raw === 32767 || raw === -32768) rails += 1;
      }
    levels.push(10 * Math.log10(Math.max(...sums) / count || 1e-12));
  }
  const active = levels
    .filter((v) => v > limits.silenceThresholdDb)
    .sort((a, b) => a - b);
  const pauses: Array<{
    startSec: number;
    endSec: number;
    durationSec: number;
    kind: string;
  }> = [];
  let start: number | undefined;
  for (let i = 0; i <= levels.length; i += 1) {
    if (i < levels.length && levels[i] <= limits.silenceThresholdDb) {
      start ??= i;
    } else if (start !== undefined) {
      const from = (start * window) / rate;
      const to = Math.min(durationSec, (i * window) / rate);
      let kind = 'internal';
      if (start === 0) kind = 'leading';
      else if (i === levels.length) kind = 'trailing';
      if (to - from >= 0.2)
        pauses.push({
          startSec: from,
          endSec: to,
          durationSec: to - from,
          kind,
        });
      start = undefined;
    }
  }
  const medianActiveDb = active.length
    ? active[Math.floor(active.length / 2)]
    : null;
  const activeLevelSpreadDb = active.length
    ? active[Math.floor((active.length - 1) * 0.9)] -
      active[Math.floor((active.length - 1) * 0.1)]
    : null;
  let durationStatus: VoiceFinding['status'] = 'unchecked';
  if (limits.availableDurationSec !== undefined)
    durationStatus =
      durationSec > limits.availableDurationSec ? 'fail' : 'pass';
  const findings: VoiceFinding[] = [
    {
      id: 'audible-signal',
      status: active.length ? 'pass' : 'fail',
      detail: active.length
        ? 'Signal exceeds the configured activity threshold.'
        : 'No signal exceeds the configured activity threshold; speech is not established.',
    },
    {
      id: 'clipping',
      status: rails ? 'review' : 'pass',
      detail: `${rails} samples reach a PCM16 rail; rail hits may indicate clipping, not a perceptual distortion verdict.`,
    },
    {
      id: 'level',
      status:
        medianActiveDb === null || medianActiveDb < -32 ? 'review' : 'pass',
      detail: `Median active 20ms window: ${medianActiveDb?.toFixed(1) ?? 'unavailable'} dBFS. Below -32 dBFS flags quiet playback; this is not LUFS.`,
    },
    {
      id: 'pauses',
      status: pauses.some((p) => p.durationSec > limits.maxPauseSec)
        ? 'review'
        : 'pass',
      detail: `${pauses.filter((p) => p.durationSec > limits.maxPauseSec).length} pauses exceed ${limits.maxPauseSec}s. Review against intended dialogue beats.`,
    },
    {
      id: 'level-spread',
      status:
        activeLevelSpreadDb !== null && activeLevelSpreadDb > 20
          ? 'review'
          : 'pass',
      detail: `Active-window p90–p10 spread ${activeLevelSpreadDb?.toFixed(1) ?? 'unavailable'} dB; >20 dB flags level variation, not poor acting.`,
    },
    {
      id: 'duration-fit',
      status: durationStatus,
      detail:
        limits.availableDurationSec === undefined
          ? 'No scene duration budget supplied.'
          : `${durationSec.toFixed(3)}s audio / ${limits.availableDurationSec}s available.`,
    },
    {
      id: 'performance',
      status: 'unchecked',
      detail:
        'No perceptual audio evaluator configured. Naturalness, emotion, pronunciation quality, character fit and cross-character distinction are unverified.',
    },
  ];
  return {
    durationSec,
    rate,
    channels,
    peakDb: peak ? 20 * Math.log10(peak) : null,
    medianActiveDb,
    activeLevelSpreadDb,
    pauses,
    limits,
    findings,
    perceptualStatus: 'unchecked' as const,
    creativeApproval: 'required' as const,
    deliveryReady: false as const,
  };
}
