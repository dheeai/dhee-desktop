import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readPcm, writePcm } from './narrationTiming.js';

const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const schema = z
  .object({
    dialogueSha256: z.string().regex(/^[a-f0-9]{64}$/),
    bedSha256: z.string().regex(/^[a-f0-9]{64}$/),
    bedGain: z.number().finite().min(0).max(1),
    duckGain: z.number().finite().min(0).max(1).default(0.1),
    fadeSec: z.number().finite().min(0.01).max(5).default(0.15),
    speech: z
      .array(
        z
          .object({
            startSec: z.number().finite().nonnegative(),
            endSec: z.number().finite().positive(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

/** Add a bed without altering dialogue gain, timing, rate or source files. */
export function mixSoundtrack(dialogue: Buffer, bed: Buffer, rawPlan: unknown) {
  const plan = schema.parse(rawPlan);
  if (
    digest(dialogue) !== plan.dialogueSha256 ||
    digest(bed) !== plan.bedSha256
  )
    throw Error('Soundtrack source hash changed');
  const voice = readPcm(dialogue);
  const music = readPcm(bed);
  if (voice.rate !== music.rate || voice.channels !== music.channels)
    throw Error('Match bed sample rate and channels explicitly before mixing');
  if (voice.frames > 300 * voice.rate || music.frames < voice.frames)
    throw Error(
      'Dialogue must be at most 300 seconds and bed must cover its full duration',
    );
  const windows = plan.speech.map((s, index) => {
    const start = Math.round(s.startSec * voice.rate);
    const end = Math.round(s.endSec * voice.rate);
    if (
      start >= end ||
      end > voice.frames ||
      (index > 0 && s.startSec < plan.speech[index - 1].endSec)
    )
      throw Error(
        'Speech windows must be ordered, non-overlapping and inside the dialogue timeline',
      );
    return { start, end, voiceEnergy: 0, bedEnergy: 0 };
  });
  const fade = Math.max(1, Math.round(plan.fadeSec * voice.rate));
  const pcm = Buffer.alloc(voice.pcm.length);
  let speechIndex = 0;
  let peak = 0;
  for (let frame = 0; frame < voice.frames; frame += 1) {
    while (speechIndex < windows.length && frame >= windows[speechIndex].end)
      speechIndex += 1;
    const current = windows[speechIndex];
    const speech = current && frame >= current.start ? current : undefined;
    let envelope = Math.min(1, frame / fade, (voice.frames - 1 - frame) / fade);
    let duck = 1;
    // Only the preceding/current windows can affect this frame. Adjacent ramps overlap by minimum gain.
    for (const w of [windows[speechIndex - 1], current]) {
      if (w && frame >= w.start - fade && frame < w.end + fade) {
        const distance =
          frame < w.start ? w.start - frame : Math.max(0, frame - w.end);
        duck = Math.min(
          duck,
          plan.duckGain + (1 - plan.duckGain) * Math.min(1, distance / fade),
        );
      }
    }
    envelope *= duck * plan.bedGain;
    for (let channel = 0; channel < voice.channels; channel += 1) {
      const offset = frame * voice.stride + channel * 2;
      const v = voice.pcm.readInt16LE(offset);
      if (!speech && Math.abs(v) > 32768 * 10 ** (-45 / 20))
        throw Error('Speech windows do not cover all audible dialogue');
      const b = Math.round(music.pcm.readInt16LE(offset) * envelope);
      const mixed = v + b;
      if (mixed < -32768 || mixed > 32767)
        throw Error(
          'Mix would clip; reduce the bed gain, never normalize approved dialogue',
        );
      pcm.writeInt16LE(mixed, offset);
      peak = Math.max(peak, Math.abs(mixed));
      if (speech) {
        speech.voiceEnergy += v * v;
        speech.bedEnergy += b * b;
      }
    }
  }
  const margins = windows.map((w) => {
    if (w.voiceEnergy === 0)
      throw Error('Declared speech window contains no dialogue');
    const marginDb =
      w.bedEnergy === 0 ? null : 10 * Math.log10(w.voiceEnergy / w.bedEnergy);
    if (marginDb !== null && marginDb < 14)
      throw Error(
        'Dialogue must exceed the bed by at least 14 dB in each speech window',
      );
    return {
      startSec: w.start / voice.rate,
      endSec: w.end / voice.rate,
      marginDb,
    };
  });
  return {
    wav: writePcm(pcm, voice.rate, voice.channels),
    metadata: {
      dialogueSha256: plan.dialogueSha256,
      bedSha256: plan.bedSha256,
      outputPcmSha256: digest(pcm),
      dialogueGain: 1,
      clippedSamples: 0,
      peakPCM16: peak,
      durationSec: voice.frames / voice.rate,
      sampleRate: voice.rate,
      channels: voice.channels,
      speechMargins: margins,
      bedTrimmedFrames: music.frames - voice.frames,
      semanticAudioReview: 'unchecked',
      creativeApproval: 'required',
      deliveryReady: false,
    },
  };
}
