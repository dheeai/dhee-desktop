/** @jest-environment node */
/* Tests exercise the workspace package source before packaging. */
/* eslint-disable import/no-relative-packages */
import { afterEach, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ffmpegBin } from '../../packages/dhee-runner-production/src/ffmpegBin.js';
import { ffmpegReplaceAudioRunner } from '../../packages/dhee-runner-production/src/ffmpegReplaceAudio.js';
import type { RunnerContext } from '../../packages/dhee-runner-production/src/index.js';

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })),
);
function fixture() {
  const projectDir = mkdtempSync(join(tmpdir(), 'replace-audio-'));
  dirs.push(projectDir);
  const run = (args: string[]) =>
    execFileSync(ffmpegBin(), ['-v', 'error', '-y', ...args]);
  run([
    '-f',
    'lavfi',
    '-i',
    'color=s=64x64:r=24:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=900:duration=2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    join(projectDir, 'video.mp4'),
  ]);
  run([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:duration=1',
    '-c:a',
    'pcm_s16le',
    join(projectDir, 'voice.wav'),
  ]);
  const ctx = {
    projectDir,
    inputs: {
      picture: join(projectDir, 'video.mp4'),
      narration: join(projectDir, 'voice.wav'),
    },
    node: {
      id: 'composed',
      kind: 'stage',
      inputs: [],
      outputs: { format: 'video', pattern: 'result.mov' },
      runner: {
        tool: 'ffmpeg.replace_audio',
        config: {
          videoInput: 'picture',
          audioInput: 'narration',
          outputPath: 'result.mov',
          offsetSec: 0.25,
        },
      },
    },
    log: () => {},
  } as RunnerContext;
  return { projectDir, ctx, run };
}
it('replaces generated audio with sample-exact narration and explicit silence placement', async () => {
  const { projectDir, ctx, run } = fixture();
  const source = readFileSync(join(projectDir, 'voice.wav'));
  const result = await ffmpegReplaceAudioRunner.run(ctx);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.metadata).toMatchObject({
    generatedAudioRemoved: true,
    offsetSec: 0.25,
    audioCodec: 'pcm_s16le',
  });
  run([
    '-i',
    join(projectDir, 'voice.wav'),
    '-f',
    's16le',
    join(projectDir, 'source.pcm'),
  ]);
  run([
    '-i',
    join(projectDir, 'result.mov'),
    '-map',
    '0:a:0',
    '-f',
    's16le',
    join(projectDir, 'result.pcm'),
  ]);
  const pcm = readFileSync(join(projectDir, 'result.pcm'));
  const approved = readFileSync(join(projectDir, 'source.pcm'));
  const offset = Math.round(44100 * 0.25) * 2;
  expect(pcm.subarray(offset, offset + approved.length).equals(approved)).toBe(
    true,
  );
  expect(pcm.subarray(0, offset).every((x) => x === 0)).toBe(true);
  expect(pcm.subarray(offset + approved.length).every((x) => x === 0)).toBe(
    true,
  );
  expect(readFileSync(join(projectDir, 'voice.wav')).equals(source)).toBe(true);
});
it('rejects placement that would truncate narration', async () => {
  const { ctx } = fixture();
  ctx.node.runner.config.offsetSec = 1.5;
  expect(await ffmpegReplaceAudioRunner.run(ctx)).toMatchObject({
    ok: false,
    error: expect.stringMatching(/exceed|truncate/i),
  });
});
it('rejects output replacing an input and paths outside the project', async () => {
  const { ctx } = fixture();
  ctx.node.runner.config.outputPath = '../escape.mov';
  expect(await ffmpegReplaceAudioRunner.run(ctx)).toMatchObject({ ok: false });
  ctx.node.runner.config.outputPath = 'video.mp4';
  expect(await ffmpegReplaceAudioRunner.run(ctx)).toMatchObject({ ok: false });
});
it('honors cancellation before starting', async () => {
  const { ctx } = fixture();
  ctx.signal = AbortSignal.abort();
  expect(await ffmpegReplaceAudioRunner.run(ctx)).toMatchObject({
    ok: false,
    error: expect.stringMatching(/abort/i),
  });
});
it('exports MP4 with only the selected narration and declares lossy delivery encoding', async () => {
  const { projectDir, ctx, run } = fixture();
  ctx.node.runner.config.outputPath = 'delivery.mp4';
  ctx.node.runner.config.offsetSec = 0;
  const result = await ffmpegReplaceAudioRunner.run(ctx);
  expect(result).toMatchObject({
    ok: true,
    metadata: {
      audioCodec: 'aac',
      generatedAudioRemoved: true,
      deliveryReady: false,
    },
  });
  run([
    '-i',
    join(projectDir, 'delivery.mp4'),
    '-map',
    '0:a:0',
    '-f',
    's16le',
    join(projectDir, 'delivery.pcm'),
  ]);
  run([
    '-i',
    join(projectDir, 'voice.wav'),
    '-f',
    's16le',
    join(projectDir, 'approved.pcm'),
  ]);
  const actual = readFileSync(join(projectDir, 'delivery.pcm'));
  const expected = readFileSync(join(projectDir, 'approved.pcm'));
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < expected.length; i += 2) {
    const a = actual.readInt16LE(i);
    const b = expected.readInt16LE(i);
    dot += a * b;
    aa += a * a;
    bb += b * b;
  }
  expect(dot / Math.sqrt(aa * bb)).toBeGreaterThan(0.995);
});
it('rejects a shifted video timeline instead of putting narration before picture', async () => {
  const { projectDir, ctx, run } = fixture();
  run([
    '-i',
    join(projectDir, 'video.mp4'),
    '-c',
    'copy',
    '-output_ts_offset',
    '1',
    join(projectDir, 'shifted.mp4'),
  ]);
  ctx.inputs.picture = join(projectDir, 'shifted.mp4');
  expect(await ffmpegReplaceAudioRunner.run(ctx)).toMatchObject({
    ok: false,
    error: expect.stringMatching(/start|timeline/i),
  });
});
it('rejects even a one-sample narration overrun without silently trimming', async () => {
  const { projectDir, ctx, run } = fixture();
  run([
    '-f',
    'lavfi',
    '-i',
    'sine=sample_rate=8000:duration=2.000125',
    '-c:a',
    'pcm_s16le',
    join(projectDir, 'one-over.wav'),
  ]);
  ctx.inputs.narration = join(projectDir, 'one-over.wav');
  ctx.node.runner.config.offsetSec = 0;
  expect(await ffmpegReplaceAudioRunner.run(ctx)).toMatchObject({
    ok: false,
    error: expect.stringMatching(/exceed|truncate/i),
  });
});
it('never overwrites an existing output during publication', async () => {
  const { ctx, projectDir } = fixture();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(projectDir, 'result.mov'), 'existing approved output');
  expect(await ffmpegReplaceAudioRunner.run(ctx)).toMatchObject({ ok: false });
  expect(readFileSync(join(projectDir, 'result.mov'), 'utf8')).toBe(
    'existing approved output',
  );
});
