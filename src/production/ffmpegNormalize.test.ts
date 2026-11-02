/** @jest-environment node */
/* Tests exercise the workspace package source before packaging. */
/* eslint-disable import/no-relative-packages */
import { it, expect, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ffmpegBin, ffprobeBin } from '../../packages/dhee-runner-production/src/ffmpegBin.js';
import { ffmpegNormalizeRunner } from '../../packages/dhee-runner-production/src/ffmpegNormalize.js';
import type { RunnerContext } from '../../packages/dhee-runner-production/src/index.js';

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);
function fixture() {
  const projectDir = mkdtempSync(join(tmpdir(), 'normalize-'));
  dirs.push(projectDir);
  const source = join(projectDir, 'source.mp4');
  execFileSync(ffmpegBin(), [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=128x74:r=24:d=1.5',
    '-f',
    'lavfi',
    '-i',
    'sine=duration=1.5',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    source,
  ]);
  return {
    projectDir,
    source,
    ctx: {
      projectDir,
      inputs: { picture: source },
      node: {
        id: 'normalized',
        kind: 'stage',
        inputs: [],
        outputs: { format: 'video', pattern: 'normalized.mp4' },
        runner: {
          tool: 'ffmpeg.normalize',
          config: {
            videoInput: 'picture',
            outputPath: 'normalized.mp4',
            durationSec: 1,
            width: 128,
            height: 72,
            fps: 24,
            durationPolicy: 'trim',
            framing: 'crop',
            audio: 'drop',
          },
        },
      },
      log: () => {},
    } as RunnerContext,
  };
}
it('normalizes explicit duration/framing while preserving the source and recording edits', async () => {
  const { ctx, source, projectDir } = fixture();
  const original = readFileSync(source);
  const result = await ffmpegNormalizeRunner.run(ctx);
  expect(result).toMatchObject({
    ok: true,
    metadata: {
      durationPolicy: 'trim',
      framing: 'crop',
      audio: 'drop',
      deliveryReady: false,
    },
  });
  const probe = JSON.parse(
    execFileSync(
      ffprobeBin(),
      [
        '-v',
        'error',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        join(projectDir, 'normalized.mp4'),
      ],
      { encoding: 'utf8' },
    ),
  );
  expect(Number(probe.format.duration)).toBeCloseTo(1, 2);
  expect(probe.streams).toHaveLength(1);
  expect(probe.streams[0]).toMatchObject({ width: 128, height: 72 });
  expect(readFileSync(source).equals(original)).toBe(true);
});
it('rejects implicit destructive choices and invalid dimensions', async () => {
  const { ctx } = fixture();
  delete ctx.node.runner.config.framing;
  expect(await ffmpegNormalizeRunner.run(ctx)).toMatchObject({ ok: false });
  ctx.node.runner.config.framing = 'crop';
  ctx.node.runner.config.width = 127;
  expect(await ffmpegNormalizeRunner.run(ctx)).toMatchObject({ ok: false });
});
it('rejects extending with trim policy instead of silently freezing the picture', async () => {
  const { ctx } = fixture();
  ctx.node.runner.config.durationSec = 3;
  expect(await ffmpegNormalizeRunner.run(ctx)).toMatchObject({
    ok: false,
    error: expect.stringMatching(/pad|short|extend/i),
  });
});
it('honors cancellation and confines output paths', async () => {
  const { ctx } = fixture();
  ctx.signal = AbortSignal.abort();
  expect(await ffmpegNormalizeRunner.run(ctx)).toMatchObject({ ok: false });
  ctx.signal = undefined;
  ctx.node.runner.config.outputPath = '../escape.mp4';
  expect(await ffmpegNormalizeRunner.run(ctx)).toMatchObject({ ok: false });
});
it('pads explicitly with a frozen final frame and keeps audio when requested', async () => {
  const { ctx, projectDir } = fixture();
  Object.assign(ctx.node.runner.config, {
    durationSec: 3,
    durationPolicy: 'pad',
    framing: 'fit',
    audio: 'preserve',
  });
  expect(await ffmpegNormalizeRunner.run(ctx)).toMatchObject({
    ok: true,
    metadata: { padSec: 1.5, framing: 'fit', audio: 'preserve' },
  });
  const probe = JSON.parse(
    execFileSync(
      ffprobeBin(),
      [
        '-v',
        'error',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        join(projectDir, 'normalized.mp4'),
      ],
      { encoding: 'utf8' },
    ),
  );
  expect(Number(probe.format.duration)).toBeCloseTo(3, 2);
  expect(probe.streams.map((s: any) => s.codec_type)).toEqual([
    'video',
    'audio',
  ]);
  expect(probe.streams[0].nb_frames).toBe('72');
});
it('rejects non-square-pixel sources instead of silently changing their display proportions', async () => {
  const { ctx, projectDir } = fixture();
  const anamorphic = join(projectDir, 'anamorphic.mp4');
  execFileSync(ffmpegBin(), [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=120x120:r=24:d=1',
    '-vf',
    'setsar=2',
    '-c:v',
    'libx264',
    anamorphic,
  ]);
  ctx.inputs.picture = anamorphic;
  expect(await ffmpegNormalizeRunner.run(ctx)).toMatchObject({
    ok: false,
    error: expect.stringMatching(/aspect|square/i),
  });
});
it('never overwrites an existing destination, including a source alias', async () => {
  const { ctx, source, projectDir } = fixture();
  const { copyFileSync } = await import('node:fs');
  copyFileSync(source, join(projectDir, 'normalized.mp4'));
  const before = readFileSync(join(projectDir, 'normalized.mp4'));
  expect(await ffmpegNormalizeRunner.run(ctx)).toMatchObject({ ok: false });
  expect(readFileSync(join(projectDir, 'normalized.mp4')).equals(before)).toBe(
    true,
  );
});
