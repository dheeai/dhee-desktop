import { createHash } from 'node:crypto';
import { z } from 'zod';

export interface NarrationSegment {
  id: string;
  startSample: number;
  endSample: number;
  sceneStartSample: number;
  durationSamples: number;
  offsetSamples: number;
  timelineStartSample: number;
}
export interface NarrationMetadata {
  sourceSha256: string;
  sourcePcmSha256: string;
  outputPcmSha256: string;
  sampleRate: number;
  channels: number;
  sourceSamples: number;
  durationSec: number;
  selectedSceneId?: string;
  segments: NarrationSegment[];
  pauses: Array<{ startSample: number; endSample: number }>;
  semanticAlignment: 'unchecked';
  deliveryReady: false;
}
const digest = (value: Buffer) =>
  createHash('sha256').update(value).digest('hex');
const MAX_BYTES = 128 * 1024 * 1024;
const planSchema = z
  .object({
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    scenes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            durationSec: z.number().finite().positive().max(300),
            offsetSec: z.number().finite().nonnegative().max(300).default(0),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    boundaryHintsSec: z
      .array(z.number().finite().positive())
      .max(99)
      .optional(),
    minPauseSec: z.number().finite().min(0.2).max(5).default(0.8),
    silenceThresholdDb: z.number().finite().min(-70).max(-35).default(-45),
  })
  .strict();

/** Parse without decoding/re-encoding so source sample bytes cannot change. */
export function readPcm(wav: Buffer) {
  if (
    wav.length < 44 ||
    wav.length > MAX_BYTES ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE' ||
    wav.readUInt32LE(4) + 8 !== wav.length
  )
    throw Error('Expected a complete PCM16 RIFF WAV no larger than 128 MiB');
  let fmt: Buffer | undefined;
  let pcm: Buffer | undefined;
  let position = 12;
  while (position < wav.length) {
    if (position + 8 > wav.length) throw Error('Truncated WAV chunk header');
    const name = wav.toString('ascii', position, position + 4);
    const size = wav.readUInt32LE(position + 4);
    const end = position + 8 + size;
    if (end + (size % 2) > wav.length) throw Error('Truncated WAV chunk');
    if (name === 'fmt ') {
      if (fmt) throw Error('Duplicate WAV format chunk');
      fmt = wav.subarray(position + 8, end);
    }
    if (name === 'data') {
      if (pcm) throw Error('Duplicate WAV data chunk');
      pcm = wav.subarray(position + 8, end);
    }
    position = end + (size % 2);
  }
  if (
    !fmt ||
    fmt.length < 16 ||
    !pcm?.length ||
    fmt.readUInt16LE(0) !== 1 ||
    fmt.readUInt16LE(14) !== 16
  )
    throw Error(
      'Narration requires PCM16 WAV; convert and approve unsupported audio explicitly',
    );
  const channels = fmt.readUInt16LE(2);
  const rate = fmt.readUInt32LE(4);
  const stride = channels * 2;
  if (
    ![1, 2].includes(channels) ||
    rate < 8000 ||
    rate > 192000 ||
    fmt.readUInt16LE(12) !== stride ||
    fmt.readUInt32LE(8) !== rate * stride ||
    pcm.length % stride
  )
    throw Error(
      'Invalid PCM16 sample rate, channel layout or sample alignment',
    );
  return { pcm, rate, channels, stride, frames: pcm.length / stride };
}
export function writePcm(pcm: Buffer, rate: number, channels: number) {
  const out = Buffer.alloc(44 + pcm.length);
  out.write('RIFF');
  out.writeUInt32LE(out.length - 8, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * channels * 2, 28);
  out.writeUInt16LE(channels * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(pcm.length, 40);
  pcm.copy(out, 44);
  return out;
}
export function prepareNarration(
  wav: Buffer,
  rawPlan: unknown,
  sceneId?: string,
): { wav: Buffer; metadata: NarrationMetadata } {
  const plan = planSchema.parse(rawPlan);
  const sourceSha256 = digest(wav);
  if (sourceSha256 !== plan.sourceSha256)
    throw Error(
      'Narration source hash changed; use the reviewed recording and a current timing plan',
    );
  if (new Set(plan.scenes.map((s) => s.id)).size !== plan.scenes.length)
    throw Error('Scene IDs must be unique');
  if (sceneId !== undefined && !plan.scenes.some((s) => s.id === sceneId))
    throw Error('Unknown scene selection');
  const { pcm, rate, channels, stride, frames } = readPcm(wav);
  const window = Math.max(1, Math.round(rate * 0.01));
  const threshold = 32768 * 10 ** (plan.silenceThresholdDb / 20);
  const minPause = Math.ceil(plan.minPauseSec * rate);
  const pauses: NarrationMetadata['pauses'] = [];
  let quietStart: number | undefined;
  let audible = false;
  for (let start = 0; start < frames; start += window) {
    const end = Math.min(frames, start + window);
    let quiet = true;
    for (let byte = start * stride; byte < end * stride; byte += 2) {
      if (Math.abs(pcm.readInt16LE(byte)) > threshold) {
        quiet = false;
        break;
      }
    }
    if (quiet && quietStart === undefined) quietStart = start;
    if (!quiet) {
      audible = true;
      // Exclude leading/trailing silence: neither separates two scene parts.
      if (
        quietStart !== undefined &&
        quietStart > 0 &&
        start - quietStart >= minPause
      )
        pauses.push({ startSample: quietStart, endSample: start });
      quietStart = undefined;
    }
  }
  if (!audible)
    throw Error(
      'Source is silent or below the quiet threshold; review the recording',
    );
  const needed = plan.scenes.length - 1;
  let cuts: number[];
  if (plan.boundaryHintsSec !== undefined) {
    if (plan.boundaryHintsSec.length !== needed)
      throw Error(
        'Provide exactly one boundary hint between each pair of scenes',
      );
    const used = new Set<number>();
    cuts = plan.boundaryHintsSec.map((time, i) => {
      const sample = Math.round(time * rate);
      const pause = pauses.findIndex(
        (p) =>
          sample >= p.startSample + window && sample <= p.endSample - window,
      );
      if (
        pause < 0 ||
        used.has(pause) ||
        (i > 0 && time <= plan.boundaryHintsSec![i - 1])
      )
        throw Error(
          'Each boundary hint must select a different measured quiet pause, in source order',
        );
      used.add(pause);
      return sample;
    });
  } else if (!needed) cuts = [];
  else {
    if (pauses.length !== needed)
      throw Error(
        `Ambiguous pauses: found ${pauses.length}, need ${needed}. Supply boundaryHintsSec inside measured pauses or revise the timing plan; no audio was cut.`,
      );
    cuts = pauses.map((p) => Math.floor((p.startSample + p.endSample) / 2));
  }
  const boundaries = [0, ...cuts, frames];
  let elapsed = 0;
  const segments = plan.scenes.map((scene, index): NarrationSegment => {
    const sceneStartSample = Math.round(elapsed * rate);
    elapsed += scene.durationSec;
    const durationSamples = Math.round(elapsed * rate) - sceneStartSample;
    const offsetSamples = Math.round(scene.offsetSec * rate);
    const startSample = boundaries[index];
    const endSample = boundaries[index + 1];
    if (offsetSamples + endSample - startSample > durationSamples)
      throw Error(
        `Narration for scene ${scene.id} does not fit its duration and offset; extend the scene or revise timing, never truncate approved audio`,
      );
    return {
      id: scene.id,
      startSample,
      endSample,
      sceneStartSample,
      durationSamples,
      offsetSamples,
      timelineStartSample: sceneStartSample + offsetSamples,
    };
  });
  const totalSamples = Math.round(elapsed * rate);
  if (
    !Number.isSafeInteger(totalSamples) ||
    totalSamples * stride > MAX_BYTES - 44
  )
    throw Error('Prepared narration exceeds the 128 MiB output limit');
  const selected =
    sceneId === undefined ? undefined : segments.find((s) => s.id === sceneId)!;
  const output = Buffer.alloc(
    (selected?.durationSamples ?? totalSamples) * stride,
  );
  for (const segment of selected ? [selected] : segments) {
    const target = selected
      ? segment.offsetSamples
      : segment.timelineStartSample;
    pcm.copy(
      output,
      target * stride,
      segment.startSample * stride,
      segment.endSample * stride,
    );
  }
  return {
    wav: writePcm(output, rate, channels),
    metadata: {
      sourceSha256,
      sourcePcmSha256: digest(pcm),
      outputPcmSha256: digest(output),
      sampleRate: rate,
      channels,
      sourceSamples: frames,
      durationSec: output.length / stride / rate,
      selectedSceneId: sceneId,
      segments,
      pauses,
      semanticAlignment: 'unchecked',
      deliveryReady: false,
    },
  };
}
