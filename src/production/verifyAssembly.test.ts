/** @jest-environment node */
/* eslint-disable import/no-relative-packages */
import { it, expect, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  runners,
  RunnerContext,
} from '../../packages/dhee-runner-production/src/index.js';
import { ffmpegBin } from '../../packages/dhee-runner-production/src/ffmpegBin.js';

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);
function fixture() {
  const projectDir = mkdtempSync(join(tmpdir(), 'assembly-check-'));
  dirs.push(projectDir);
  execFileSync(ffmpegBin(), [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=128x72:r=24:d=1',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=437:duration=1',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    join(projectDir, 'clip.mp4'),
  ]);
  execFileSync(ffmpegBin(), [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=437:duration=1',
    join(projectDir, 'voice.wav'),
  ]);
  return {
    projectDir,
    inputs: { final: 'clip.mp4', clip: 'clip.mp4', voice: 'voice.wav' },
    node: {
      id: 'verification',
      kind: 'stage',
      inputs: [],
      outputs: { format: 'json', pattern: 'check.json' },
      runner: {
        tool: 'media.verify_assembly',
        config: {
          videoInput: 'final',
          outputPath: 'check.json',
          segments: [
            {
              videoInput: 'clip',
              durationSec: 1,
              audioInput: 'voice',
              audioOffsetSec: 0,
            },
          ],
        },
      },
    },
    log: () => {},
  } as RunnerContext;
}
async function run(ctx: RunnerContext) {
  const entry = runners.find(
    (r) => r.manifest.tool === 'media.verify_assembly',
  );
  expect(entry).toBeDefined();
  return entry!.runner.run(ctx);
}
it('checks real picture and narration but does not invent semantic or transcript approval', async () => {
  const ctx = fixture();
  expect(await run(ctx)).toMatchObject({ ok: true, outputPath: 'check.json' });
  const report = JSON.parse(
    readFileSync(join(ctx.projectDir, 'check.json'), 'utf8'),
  );
  expect(report).toMatchObject({ status: 'review', deliveryReady: false });
  expect(
    report.checks.filter((c: { status: string }) => c.status === 'fail'),
  ).toHaveLength(0);
  expect(report.checks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'picture:0', status: 'pass' }),
      expect.objectContaining({ id: 'voice:0', status: 'pass' }),
      expect.objectContaining({ id: 'transcript', status: 'unchecked' }),
      expect.objectContaining({ id: 'scene-meaning', status: 'unchecked' }),
    ]),
  );
  expect(report.inputs.final.sha256).toMatch(/^[a-f0-9]{64}$/);
});
it('detects wrong picture and wrong narrator rather than passing a playable file', async () => {
  const ctx = fixture();
  execFileSync(ffmpegBin(), [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=white:s=128x72:r=24:d=1',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=830:duration=1',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    join(ctx.projectDir, 'wrong.mp4'),
  ]);
  ctx.inputs.final = 'wrong.mp4';
  expect(await run(ctx)).toMatchObject({ ok: true });
  const report = JSON.parse(
    readFileSync(join(ctx.projectDir, 'check.json'), 'utf8'),
  );
  expect(report.status).toBe('fail');
  expect(report.checks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'picture:0', status: 'fail' }),
      expect.objectContaining({ id: 'voice:0', status: 'fail' }),
    ]),
  );
});
it('rejects unsafe report output and does not overwrite media', async () => {
  const ctx = fixture();
  ctx.node.runner.config.outputPath = '../check.json';
  expect(await run(ctx)).toMatchObject({ ok: false });
});
it('reports duration mismatch and missing selected narration', async () => {
  const ctx = fixture();
  ctx.node.runner.config.segments = [{ videoInput: 'clip', durationSec: 2 }];
  expect(await run(ctx)).toMatchObject({ ok: true });
  const report = JSON.parse(
    readFileSync(join(ctx.projectDir, 'check.json'), 'utf8'),
  );
  expect(report.checks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'duration', status: 'fail' }),
      expect.objectContaining({ id: 'voice:0', status: 'unchecked' }),
    ]),
  );
});
it('fails narration shifted from its planned position', async () => {
  const ctx = fixture();
  ctx.node.runner.config.segments = [
    {
      videoInput: 'clip',
      durationSec: 1,
      audioInput: 'voice',
      audioOffsetSec: 0.1,
    },
  ];
  expect(await run(ctx)).toMatchObject({ ok: true });
  const report = JSON.parse(
    readFileSync(join(ctx.projectDir, 'check.json'), 'utf8'),
  );
  expect(report.checks).toContainEqual(
    expect.objectContaining({ id: 'voice:0', status: 'fail' }),
  );
});
it('does not overwrite a prior report and honors cancellation', async () => {
  const ctx = fixture();
  expect(await run(ctx)).toMatchObject({ ok: true });
  const original = readFileSync(join(ctx.projectDir, 'check.json'));
  expect(await run(ctx)).toMatchObject({ ok: false });
  expect(readFileSync(join(ctx.projectDir, 'check.json'))).toEqual(original);
  ctx.signal = AbortSignal.abort();
  expect(await run(ctx)).toMatchObject({ ok: false });
});
it('accepts an expected script but reports missing ASR configuration instead of a pass', async () => {
  const ctx=fixture();ctx.node.runner.config.expectedScript="A doctor's visit ends.";
  const previous=process.env.DHEE_ASR_MODEL_PATH;delete process.env.DHEE_ASR_MODEL_PATH;
  try {
    expect(await run(ctx)).toMatchObject({ok:true});
    const report=JSON.parse(readFileSync(join(ctx.projectDir,'check.json'),'utf8'));
    expect(report.checks).toContainEqual(expect.objectContaining({id:'transcript',status:'unchecked',detail:expect.stringMatching(/model/i)}));
  } finally {if(previous!==undefined)process.env.DHEE_ASR_MODEL_PATH=previous;}
});
