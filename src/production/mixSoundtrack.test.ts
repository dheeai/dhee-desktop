/** @jest-environment node */
/* eslint-disable import/no-relative-packages */
import { afterEach, expect, it, jest } from '@jest/globals';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  runners,
  type RunnerContext,
} from '../../packages/dhee-runner-production/src/index';

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })),
);
const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function wav(samples: number[], rate = 8000) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => b.writeInt16LE(s, 44 + i * 2));
  return b;
}
function fixture(voiceValue = 10000, bedValue = 1000) {
  const projectDir = mkdtempSync(join(tmpdir(), 'soundtrack-'));
  dirs.push(projectDir);
  const voice = wav(
    Array.from({ length: 16000 }, (_, i) =>
      i >= 4000 && i < 12000 ? voiceValue : 0,
    ),
  );
  const bed = wav(Array(16000).fill(bedValue));
  writeFileSync(join(projectDir, 'voice.wav'), voice);
  writeFileSync(join(projectDir, 'bed.wav'), bed);
  const plan = {
    dialogueSha256: digest(voice),
    bedSha256: digest(bed),
    bedGain: 0.5,
    duckGain: 0.1,
    fadeSec: 0.1,
    speech: [{ startSec: 0.5, endSec: 1.5 }],
  };
  const ctx = {
    projectDir,
    inputs: { voice: 'voice.wav', bed: 'bed.wav', plan },
    node: {
      id: 'mix',
      kind: 'stage',
      inputs: [],
      outputs: { format: 'audio', pattern: 'mix.wav' },
      runner: {
        tool: 'audio.mix_soundtrack',
        config: {
          dialogueInput: 'voice',
          bedInput: 'bed',
          planInput: 'plan',
          outputPath: 'mix.wav',
        },
      },
    },
    log: () => {},
  } as unknown as RunnerContext;
  const run = async () => {
    const entry = runners.find(
      (r) => r.manifest.tool === 'audio.mix_soundtrack',
    );
    expect(entry).toBeDefined();
    return entry!.runner.run(ctx);
  };
  return { ctx, plan, voice, bed, run, projectDir };
}
it('mixes a ducked bed at unity dialogue gain and preserves source bytes', async () => {
  const f = fixture();
  const result = await f.run();
  expect(result.ok).toBe(true);
  const mixed = readFileSync(join(f.projectDir, 'mix.wav'));
  expect(mixed.readInt16LE(44 + 8000 * 2)).toBe(10050);
  expect(mixed.readInt16LE(44 + 2000 * 2)).toBe(500);
  expect(mixed.readInt16LE(44)).toBe(0);
  expect(mixed.length).toBe(f.voice.length);
  expect(readFileSync(join(f.projectDir, 'voice.wav'))).toEqual(f.voice);
  expect(result.ok ? result.metadata : undefined).toMatchObject({
    dialogueGain: 1,
    clippedSamples: 0,
    deliveryReady: false,
  });
});
it('does not overwrite a selected output', async () => {
  const f = fixture();
  await f.run();
  expect((await f.run()).ok).toBe(false);
});
it('rejects changed source bytes', async () => {
  const f = fixture();
  f.plan.dialogueSha256 = '0'.repeat(64);
  expect((await f.run()).ok).toBe(false);
});
it('rejects clipping instead of turning down dialogue', async () => {
  const f = fixture(32760, 1000);
  expect((await f.run()).ok).toBe(false);
  expect(existsSync(join(f.projectDir, 'mix.wav'))).toBe(false);
});
it('rejects inadequate dialogue margin', async () => {
  const f = fixture(100, 10000);
  expect((await f.run()).ok).toBe(false);
});
it('rejects uncovered audible dialogue', async () => {
  const f = fixture();
  f.plan.speech = [];
  expect((await f.run()).ok).toBe(false);
});
it('allows intentional silence', async () => {
  const f = fixture(0);
  f.plan.speech = [];
  expect((await f.run()).ok).toBe(true);
});
it('rejects an incompatible bed format', async () => {
  const f = fixture();
  const bed = wav(Array(16000).fill(100), 16000);
  writeFileSync(join(f.projectDir, 'bed.wav'), bed);
  f.plan.bedSha256 = digest(bed);
  expect((await f.run()).ok).toBe(false);
});
it('refuses an escaping output path', async () => {
  const f = fixture();
  f.ctx.node.runner.config.outputPath = '../escape.wav';
  expect((await f.run()).ok).toBe(false);
});
it('accepts Core JSON snapshots and confined plan files', async () => {
  const f = fixture();
  writeFileSync(join(f.projectDir, 'plan.json'), JSON.stringify(f.plan));
  f.ctx.inputs.plan = 'plan.json';
  expect((await f.run()).ok).toBe(true);
});
it('rejects overlapping speech windows', async () => {
  const f = fixture();
  f.plan.speech.push({ startSec: 1, endSec: 1.8 });
  expect((await f.run()).ok).toBe(false);
});
it('rejects truncated music coverage', async () => {
  const f = fixture();
  const bed = wav(Array(8000).fill(100));
  writeFileSync(join(f.projectDir, 'bed.wav'), bed);
  f.plan.bedSha256 = digest(bed);
  expect((await f.run()).ok).toBe(false);
});

it('refuses publication after the output directory is replaced', async () => {
  const f = fixture();
  await fsPromises.mkdir(join(f.projectDir, 'out'));
  f.ctx.node.runner.config.outputPath = 'out/mix.wav';
  const original = fsPromises.writeFile.bind(fsPromises);
  const spy = jest
    .spyOn(fsPromises, 'writeFile')
    .mockImplementation(async (...args) => {
      await original(...args);
      await fsPromises.rename(
        join(f.projectDir, 'out'),
        join(f.projectDir, 'moved'),
      );
      await fsPromises.symlink(
        join(f.projectDir, 'moved'),
        join(f.projectDir, 'out'),
      );
    });
  try {
    expect((await f.run()).ok).toBe(false);
    expect(existsSync(join(f.projectDir, 'moved/mix.wav'))).toBe(false);
  } finally {
    spy.mockRestore();
  }
});
