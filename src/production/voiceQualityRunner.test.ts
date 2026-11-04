/** @jest-environment node */
/* eslint-disable import/no-relative-packages */
import { it, expect, afterEach } from '@jest/globals';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ffmpegBin } from '../../packages/dhee-runner-production/src/ffmpegBin';
import {
  runners,
  type RunnerContext,
} from '../../packages/dhee-runner-production/src/index';

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })),
);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'voice-quality-'));
  dirs.push(root);
  execFileSync(ffmpegBin(), [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-c:a',
    'pcm_s16le',
    join(root, 'voice.wav'),
  ]);
  const ctx = {
    projectDir: root,
    inputs: { voice: 'voice.wav' },
    node: {
      id: 'check',
      kind: 'stage',
      inputs: [],
      outputs: { format: 'json', pattern: 'report.json' },
      runner: {
        tool: 'audio.check_voice',
        config: {
          audioInput: 'voice',
          outputPath: 'report.json',
          intent: 'Warm natural character dialogue',
          priorRejection: 'User rejected this performance',
        },
      },
    },
    log: () => {},
  } as RunnerContext;
  return { root, ctx };
}
it('is discoverable and saves hash-bound review without editing or approving the voice', async () => {
  const { root, ctx } = fixture();
  const before = readFileSync(join(root, 'voice.wav'));
  const runner = runners.find(
    (r) => r.manifest.tool === 'audio.check_voice',
  )?.runner;
  expect(runner).toBeDefined();
  const result = await runner!.run(ctx);
  expect(result.ok).toBe(true);
  const report = JSON.parse(readFileSync(join(root, 'report.json'), 'utf8'));
  expect(report).toMatchObject({
    status: 'review',
    deliveryReady: false,
    perceptualStatus: 'unchecked',
    priorRejection: 'User rejected this performance',
  });
  expect(report.source.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.speech.finding.status).toBe('unchecked');
  expect(readFileSync(join(root, 'voice.wav'))).toEqual(before);
  expect((await runner!.run(ctx)).ok).toBe(false);
});
it('refuses output escape and symlinked external input', async () => {
  const { root, ctx } = fixture();
  const runner = runners.find(
    (r) => r.manifest.tool === 'audio.check_voice',
  )?.runner;
  expect(runner).toBeDefined();
  ctx.node.runner.config = {
    ...ctx.node.runner.config,
    outputPath: '../escape.json',
  };
  expect((await runner!.run(ctx)).ok).toBe(false);
  const other = fixture();
  symlinkSync(join(other.root, 'voice.wav'), join(root, 'outside.wav'));
  ctx.inputs.voice = 'outside.wav';
  ctx.node.runner.config = {
    ...ctx.node.runner.config,
    outputPath: 'report.json',
  };
  expect((await runner!.run(ctx)).ok).toBe(false);
});
it('does not replace existing files on failure', async () => {
  const { root, ctx } = fixture();
  writeFileSync(join(root, 'report.json'), 'keep');
  const runner = runners.find(
    (r) => r.manifest.tool === 'audio.check_voice',
  )?.runner;
  expect(runner).toBeDefined();
  expect((await runner!.run(ctx)).ok).toBe(false);
  expect(readFileSync(join(root, 'report.json'), 'utf8')).toBe('keep');
});

it('checks the exact selected collection item and refuses missing item fallback', async () => {
  const { root, ctx } = fixture();
  ctx.inputs.voice = { pip: 'voice.wav' };
  ctx.node.runner.config = { ...ctx.node.runner.config, audioItemId: 'zip' };
  const { runner } = runners.find(
    (r) => r.manifest.tool === 'audio.check_voice',
  )!;
  expect((await runner.run(ctx)).ok).toBe(false);
  ctx.node.runner.config = { ...ctx.node.runner.config, audioItemId: 'pip' };
  expect((await runner.run(ctx)).ok).toBe(true);
  expect(
    JSON.parse(readFileSync(join(root, 'report.json'), 'utf8')).source.path,
  ).toBe('voice.wav');
});
