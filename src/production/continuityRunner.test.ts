/** @jest-environment node */
/* eslint-disable import/no-relative-packages */
import { afterEach, expect, it, jest } from '@jest/globals';
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { continuityPreflightRunner } from '../../packages/dhee-runner-production/src/continuityRunner';
import {
  runners,
  type RunnerContext,
} from '../../packages/dhee-runner-production/src/index';

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })),
);
function fixture() {
  const projectDir = mkdtempSync(join(tmpdir(), 'continuity-'));
  dirs.push(projectDir);
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT1sAAAAASUVORK5CYII=',
    'base64',
  );
  writeFileSync(join(projectDir, 'reference.png'), image);
  const hash = (value: string | Buffer) =>
    createHash('sha256').update(value).digest('hex');
  const spec = {
    schemaVersion: 1,
    storyboard: {
      inputKey: 'story',
      sha256: hash('Patient exits; doctor stays seated.'),
    },
    assets: [
      { id: 'group', kind: 'image', inputKey: 'picture', sha256: hash(image) },
    ],
    characters: [
      { id: 'doctor', referenceIds: ['group'] },
      { id: 'patient', referenceIds: ['group'] },
    ],
    locations: [{ id: 'clinic', referenceIds: ['group'] }],
    scenes: [
      {
        id: 'opening',
        durationSec: 4,
        locationId: 'clinic',
        camera: 'Fixed camera',
        framing: ['Both actors visible'],
        actors: [
          {
            characterId: 'doctor',
            movement: 'stationary',
            mustRemainStationary: true,
            action: 'Remain seated',
          },
          { characterId: 'patient', movement: 'exit', action: 'Walk out' },
        ],
      },
    ],
  };
  const ctx = {
    projectDir,
    inputs: {
      spec,
      story: 'Patient exits; doctor stays seated.',
      picture: 'reference.png',
    },
    node: {
      id: 'preflight',
      kind: 'stage',
      inputs: [],
      outputs: { format: 'json', pattern: 'preflight.json' },
      runner: {
        tool: 'production.continuity_preflight',
        config: { specInput: 'spec', outputPath: 'preflight.json' },
      },
    },
    log: () => {},
  } as RunnerContext;
  return { ctx, projectDir, spec };
}
it('publishes checked material identities and usable per-scene constraints through the runner', async () => {
  const { ctx, projectDir } = fixture();
  expect(await continuityPreflightRunner.run(ctx)).toMatchObject({
    ok: true,
    outputPath: 'preflight.json',
  });
  const report = JSON.parse(
    readFileSync(join(projectDir, 'preflight.json'), 'utf8'),
  );
  expect(report).toMatchObject({
    status: 'constraints-valid',
    semanticVerification: 'unchecked',
    creativeApproval: 'required',
    deliveryReady: false,
  });
  expect(report.scenes[0].prompt).toContain('doctor: stationary');
  expect(
    runners
      .find((r) => r.manifest.tool === 'production.continuity_preflight')
      ?.runner.describe().id,
  ).toBe('production.continuity_preflight');
});
it('returns failure and no usable artifact when actions contradict the requirements', async () => {
  const { ctx, projectDir, spec } = fixture();
  spec.scenes[0].actors[0].movement = 'exit';
  expect(await continuityPreflightRunner.run(ctx)).toMatchObject({
    ok: false,
    error: expect.stringContaining('stationary-conflict'),
  });
  expect(existsSync(join(projectDir, 'preflight.json'))).toBe(false);
});
it('refuses changed reference bytes', async () => {
  const { ctx, projectDir } = fixture();
  const bytes = readFileSync(join(projectDir, 'reference.png'));
  bytes[40] += 1;
  writeFileSync(join(projectDir, 'reference.png'), bytes);
  expect(await continuityPreflightRunner.run(ctx)).toMatchObject({
    ok: false,
    error: expect.stringContaining('stale-input'),
  });
});
it('rejects a file that is not the declared media type even when its hash matches', async () => {
  const { ctx, projectDir, spec } = fixture();
  writeFileSync(join(projectDir, 'reference.png'), 'not an image');
  spec.assets[0].sha256 = createHash('sha256')
    .update('not an image')
    .digest('hex');
  expect(await continuityPreflightRunner.run(ctx)).toMatchObject({ ok: false });
});
it.each(['../outside.json', '/tmp/outside.json'])(
  'refuses unsafe output %s',
  async (path) => {
    const { ctx } = fixture();
    ctx.node.runner.config.outputPath = path;
    expect(await continuityPreflightRunner.run(ctx)).toMatchObject({
      ok: false,
    });
  },
);
it('does not overwrite an existing artifact', async () => {
  const { ctx, projectDir } = fixture();
  writeFileSync(join(projectDir, 'preflight.json'), 'keep');
  expect(await continuityPreflightRunner.run(ctx)).toMatchObject({ ok: false });
  expect(readFileSync(join(projectDir, 'preflight.json'), 'utf8')).toBe('keep');
});
it('rejects references escaping the project through a symlink', async () => {
  const { ctx, projectDir } = fixture();
  const other = fixture();
  symlinkSync(
    join(other.projectDir, 'reference.png'),
    join(projectDir, 'external.png'),
  );
  ctx.inputs.picture = 'external.png';
  expect(await continuityPreflightRunner.run(ctx)).toMatchObject({ ok: false });
});
it('cancels without publishing', async () => {
  const { ctx, projectDir } = fixture();
  const abort = new AbortController();
  abort.abort();
  ctx.signal = abort.signal;
  expect(await continuityPreflightRunner.run(ctx)).toMatchObject({ ok: false });
  expect(existsSync(join(projectDir, 'preflight.json'))).toBe(false);
});
it('rejects parsed spec changes during publication preparation', async () => {
  const { ctx, projectDir, spec } = fixture();
  const write = fsPromises.writeFile;
  const spy = jest
    .spyOn(fsPromises, 'writeFile')
    .mockImplementationOnce(async (...args) => {
      await write(...args);
      spec.scenes[0].actors[0].movement = 'exit';
    });
  try {
    expect(await continuityPreflightRunner.run(ctx)).toMatchObject({
      ok: false,
      error: expect.stringContaining('changed'),
    });
    expect(existsSync(join(projectDir, 'preflight.json'))).toBe(false);
  } finally {
    spy.mockRestore();
  }
});

it('emits a Core GPU preparation request bound to the checked scene and selected file', async () => {
  const { ctx, projectDir } = fixture();
  ctx.node.runner.config.generation = {
    sceneId: 'opening',
    nodeId: 'shot_image',
    requestId: 'request-01',
    expectedSelectionId: null,
    workflow: 'reference-image',
    workflowVersion: '1',
    promptInput: 'prompt',
    referenceInputs: { images: ['group'] },
    parameters: { seed: 9 },
  };
  const result = await continuityPreflightRunner.run(ctx);
  expect(result).toMatchObject({ ok: true });
  const report = JSON.parse(
    readFileSync(join(projectDir, 'preflight.json'), 'utf8'),
  );
  expect(report.generationRequest).toMatchObject({
    action: 'gpu.prepare',
    projectDir: realpathSync(projectDir),
    nodeId: 'shot_image',
    inputs: { images: ['reference.png'], seed: 9 },
  });
  expect(report.generationRequest.inputs.prompt).toContain(
    report.scenes[0].prompt,
  );
  expect(
    report.generationRequest.sceneIntent.sources.find(
      (s: any) => s.inputKey === 'images',
    ),
  ).toBeDefined();
  expect(report.deliveryReady).toBe(false);
});
