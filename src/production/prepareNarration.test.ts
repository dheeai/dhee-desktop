/** @jest-environment node */
/* eslint-disable import/no-relative-packages */
import { afterEach, expect, it, jest } from '@jest/globals';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import fsPromises from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ffmpegBin } from '../../packages/dhee-runner-production/src/ffmpegBin';
import { prepareNarrationRunner } from '../../packages/dhee-runner-production/src/prepareNarration';
import {
  runners,
  type RunnerContext,
} from '../../packages/dhee-runner-production/src/index';

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })),
);
function fixture() {
  const projectDir = mkdtempSync(join(tmpdir(), 'prepare-narration-'));
  dirs.push(projectDir);
  execFileSync(ffmpegBin(), [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-c:a',
    'pcm_s16le',
    join(projectDir, 'voice.wav'),
  ]);
  const source = readFileSync(join(projectDir, 'voice.wav'));
  const sourceSha256 = createHash('sha256').update(source).digest('hex');
  writeFileSync(
    join(projectDir, 'plan.json'),
    JSON.stringify({
      sourceSha256,
      scenes: [{ id: 'one', durationSec: 2, offsetSec: 0.2 }],
    }),
  );
  const ctx = {
    projectDir,
    inputs: { voice: 'voice.wav', plan: 'plan.json' },
    node: {
      id: 'prepared',
      kind: 'stage',
      inputs: [],
      outputs: { format: 'audio', pattern: 'prepared.wav' },
      runner: {
        tool: 'audio.prepare_narration',
        config: {
          audioInput: 'voice',
          planInput: 'plan',
          outputPath: 'prepared.wav',
        },
      },
    },
    log: () => {},
  } as RunnerContext;
  return { ctx, projectDir, source };
}
it('publishes a playable scene-timed WAV and provenance without changing approved input', async () => {
  const { ctx, projectDir, source } = fixture();
  const result = await prepareNarrationRunner.run(ctx);
  expect(result).toMatchObject({
    ok: true,
    outputPath: 'prepared.wav',
    metadata: {
      durationSec: 2,
      semanticAlignment: 'unchecked',
      deliveryReady: false,
    },
  });
  expect(readFileSync(join(projectDir, 'voice.wav'))).toEqual(source);
  const pcm = execFileSync(ffmpegBin(), [
    '-v',
    'error',
    '-i',
    join(projectDir, 'prepared.wav'),
    '-f',
    's16le',
    '-',
  ]);
  expect(pcm.length).toBe(44100 * 2 * 2);
  expect(pcm.subarray(0, 8820 * 2).every((v) => v === 0)).toBe(true);
  expect(
    readdirSync(projectDir).some((p) => p.startsWith('.prepare-narration-')),
  ).toBe(false);
});
it('is discoverable from the Desktop extension', () => {
  expect(
    runners
      .find((r) => r.manifest.tool === 'audio.prepare_narration')
      ?.runner.describe().id,
  ).toBe('audio.prepare_narration');
});
it('does not overwrite an existing output', async () => {
  const { ctx, projectDir } = fixture();
  writeFileSync(join(projectDir, 'prepared.wav'), 'existing');
  expect((await prepareNarrationRunner.run(ctx)).ok).toBe(false);
  expect(readFileSync(join(projectDir, 'prepared.wav'), 'utf8')).toBe(
    'existing',
  );
});
it.each(['../escaped.wav', '/tmp/escaped.wav', 'voice.wav'])(
  'refuses unsafe output %s',
  async (outputPath) => {
    const { ctx, projectDir, source } = fixture();
    ctx.node.runner.config.outputPath = outputPath;
    expect((await prepareNarrationRunner.run(ctx)).ok).toBe(false);
    expect(readFileSync(join(projectDir, 'voice.wav'))).toEqual(source);
  },
);
it('refuses external input through a symlink', async () => {
  const { ctx, projectDir } = fixture();
  const other = fixture();
  symlinkSync(
    join(other.projectDir, 'voice.wav'),
    join(projectDir, 'external.wav'),
  );
  ctx.inputs.voice = 'external.wav';
  expect((await prepareNarrationRunner.run(ctx)).ok).toBe(false);
  expect(existsSync(join(projectDir, 'prepared.wav'))).toBe(false);
});
it('refuses a symlinked output parent', async () => {
  const { ctx, projectDir } = fixture();
  const other = fixture();
  symlinkSync(other.projectDir, join(projectDir, 'output'));
  ctx.node.runner.config.outputPath = 'output/prepared.wav';
  expect((await prepareNarrationRunner.run(ctx)).ok).toBe(false);
  expect(existsSync(join(other.projectDir, 'prepared.wav'))).toBe(false);
});
it('fails cleanly when the timing plan names another source', async () => {
  const { ctx, projectDir } = fixture();
  writeFileSync(
    join(projectDir, 'plan.json'),
    JSON.stringify({
      sourceSha256: '0'.repeat(64),
      scenes: [{ id: 'one', durationSec: 2 }],
    }),
  );
  const result = await prepareNarrationRunner.run(ctx);
  expect(result.ok).toBe(false);
  expect(result).toMatchObject({ error: expect.stringMatching(/hash/) });
  expect(existsSync(join(projectDir, 'prepared.wav'))).toBe(false);
});
it('honors cancellation without writing an output', async () => {
  const { ctx, projectDir } = fixture();
  const abort = new AbortController();
  abort.abort();
  ctx.signal = abort.signal;
  expect((await prepareNarrationRunner.run(ctx)).ok).toBe(false);
  expect(existsSync(join(projectDir, 'prepared.wav'))).toBe(false);
});

it('accepts the parsed JSON snapshot passed by Core for a JSON upstream node', async () => {
  const { ctx, projectDir } = fixture();
  ctx.inputs.plan = JSON.parse(
    readFileSync(join(projectDir, 'plan.json'), 'utf8'),
  );
  expect(await prepareNarrationRunner.run(ctx)).toMatchObject({
    ok: true,
    outputPath: 'prepared.wav',
  });
  expect(existsSync(join(projectDir, 'prepared.wav'))).toBe(true);
});

it('rejects a changed plan after preparing bytes and publishes nothing', async () => {
  const { ctx, projectDir } = fixture();
  const originalWrite = fsPromises.writeFile;
  const spy = jest
    .spyOn(fsPromises, 'writeFile')
    .mockImplementationOnce(async (...args) => {
      await originalWrite(...args);
      writeFileSync(join(projectDir, 'plan.json'), '{}');
    });
  try {
    const result = await prepareNarrationRunner.run(ctx);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      error: expect.stringMatching(/changed during preparation/),
    });
    expect(existsSync(join(projectDir, 'prepared.wav'))).toBe(false);
  } finally {
    spy.mockRestore();
  }
});
it('honors cancellation after preparing bytes without publication', async () => {
  const { ctx, projectDir } = fixture();
  const abort = new AbortController();
  ctx.signal = abort.signal;
  const originalWrite = fsPromises.writeFile;
  const spy = jest
    .spyOn(fsPromises, 'writeFile')
    .mockImplementationOnce(async (...args) => {
      await originalWrite(...args);
      abort.abort();
    });
  try {
    expect((await prepareNarrationRunner.run(ctx)).ok).toBe(false);
    expect(existsSync(join(projectDir, 'prepared.wav'))).toBe(false);
    expect(
      readdirSync(projectDir).some((p) => p.startsWith('.prepare-narration-')),
    ).toBe(false);
  } finally {
    spy.mockRestore();
  }
});
