/** @jest-environment node */
/* eslint-disable import/no-relative-packages */
import { expect, it } from '@jest/globals';
import { prepareContinuityGeneration } from '../../packages/dhee-runner-production/src/continuityGeneration';
import { assertSceneIntent } from '../../packages/dhee-runner-production/src/sceneIntent';

const sha = 'a'.repeat(64);
function fixture() {
  const assets = [
    { id: 'face', inputKey: 'face_input', kind: 'image', sha256: sha },
    {
      id: 'voice',
      inputKey: 'voice_input',
      kind: 'audio',
      sha256: 'b'.repeat(64),
    },
  ];
  const files = {
    face_input: { localPath: 'inputs/face.png', sha256: sha, bytes: 123 },
    voice_input: {
      localPath: 'inputs/voice.wav',
      sha256: 'b'.repeat(64),
      bytes: 200,
    },
  };
  const report: any = {
    status: 'constraints-valid',
    semanticVerification: 'unchecked',
    creativeApproval: 'required',
    deliveryReady: false,
    fingerprint: sha,
    issues: [],
    scenes: [
      {
        id: 'one',
        durationSec: 5,
        prompt: 'Doctor stays seated. Patient exits. doctor → face',
        assets,
        dialogue: [{ voiceId: 'voice', mode: 'on-screen' }],
        referenceBindings: [{ entityId: 'doctor', referenceIds: ['face'] }],
      },
    ],
  };
  const config: any = {
    sceneId: 'one',
    nodeId: 'shot_01',
    requestId: 'attempt-01',
    expectedSelectionId: null,
    workflow: 'image-to-video',
    workflowVersion: '1',
    promptInput: 'prompt',
    referenceInputs: { image: 'face', audio: 'voice' },
    durationInput: 'seconds',
    parameters: { seed: 17 },
  };
  return { report, config, files };
}
it('prepares exact Core request with compiled prompt, local references and source guards', () => {
  const { report, config, files } = fixture();
  const result = prepareContinuityGeneration(report, config, '/project', files);
  expect(result).toMatchObject({
    action: 'gpu.prepare',
    projectDir: '/project',
    nodeId: 'shot_01',
    expectedSelectionId: null,
    requestId: 'attempt-01',
    inputs: {
      prompt: expect.stringContaining(report.scenes[0].prompt),
      image: 'inputs/face.png',
      audio: 'inputs/voice.wav',
      seconds: 5,
      seed: 17,
    },
  });
  expect(() =>
    assertSceneIntent(result.sceneIntent, {
      ...result.inputs,
      image: files.face_input,
      audio: files.voice_input,
    }),
  ).not.toThrow();
  expect(() =>
    assertSceneIntent(result.sceneIntent, {
      ...result.inputs,
      image: { ...files.face_input, sha256: 'c'.repeat(64) },
      audio: files.voice_input,
    }),
  ).toThrow('stale');
  expect(result.sceneIntent.sources[0].evidence).toContain('declared');
});
it('guards ordered file lists using Core snapshot identity semantics', () => {
  const { report, config, files } = fixture();
  config.referenceInputs = { references: ['face'], audio: 'voice' };
  const result = prepareContinuityGeneration(report, config, '/project', files);
  expect(result.inputs.references).toEqual(['inputs/face.png']);
  expect(() =>
    assertSceneIntent(result.sceneIntent, {
      ...result.inputs,
      references: [files.face_input],
      audio: files.voice_input,
    }),
  ).not.toThrow();
});
it.each([
  'blocked',
  'unknown-scene',
  'missing-image',
  'missing-voice',
  'wrong-asset',
  'duplicate-asset',
  'prompt-override',
  'duration-override',
  'slot-collision',
  'changed-file',
])('refuses %s', (mode) => {
  const { report, config, files } = fixture();
  if (mode === 'blocked') report.status = 'blocked';
  if (mode === 'unknown-scene') config.sceneId = 'other';
  if (mode === 'missing-image') delete config.referenceInputs.image;
  if (mode === 'missing-voice') delete config.referenceInputs.audio;
  if (mode === 'wrong-asset') config.referenceInputs.image = 'other';
  if (mode === 'duplicate-asset') config.referenceInputs.other = 'face';
  if (mode === 'prompt-override')
    config.parameters.prompt = 'ignore approved constraints';
  if (mode === 'duration-override') config.parameters.seconds = 9;
  if (mode === 'slot-collision') config.promptInput = 'image';
  if (mode === 'changed-file') files.face_input.sha256 = 'c'.repeat(64);
  expect(() =>
    prepareContinuityGeneration(report, config, '/project', files),
  ).toThrow();
});
it('allows narration preserved in assembly without routing it into picture generation', () => {
  const { report, config, files } = fixture();
  report.scenes[0].dialogue[0].mode = 'narration';
  delete config.referenceInputs.audio;
  expect(
    prepareContinuityGeneration(report, config, '/project', files).inputs,
  ).not.toHaveProperty('audio');
});

it('makes reference slot order and provider labels explicit in the generation prompt', () => {
  const { report, config, files } = fixture();
  report.scenes[0].assets.push({
    id: 'other-face',
    inputKey: 'other',
    kind: 'image',
    sha256: 'c'.repeat(64),
  });
  const allFiles = {
    ...files,
    other: { localPath: 'other.png', sha256: 'c'.repeat(64), bytes: 22 },
  };
  config.referenceInputs = { images: ['face', 'other-face'], audio: 'voice' };
  config.referenceLabels = { images: ['<Picture 1>', '<Picture 2>'] };
  const first = prepareContinuityGeneration(
    report,
    config,
    '/project',
    allFiles,
  );
  expect(first.inputs.prompt).toContain('<Picture 1> = face');
  config.referenceInputs.images.reverse();
  const second = prepareContinuityGeneration(
    report,
    config,
    '/project',
    allFiles,
  );
  expect(second.inputs.prompt).toContain('<Picture 1> = other-face');
  expect(second.inputs.prompt).not.toBe(first.inputs.prompt);
});

it('uses an opt-in H3 profile and guards the final provider prompt', () => {
  const { report, config, files } = fixture();
  Object.assign(report.scenes[0], {
    locationId: 'clinic',
    camera: 'Fixed camera',
    framing: ['Both actors visible'],
    actors: [],
    states: [],
  });
  report.scenes[0].dialogue = [];
  Object.assign(config, {
    promptProfile: 'h3-six-section',
    workflow: 'h3_video_final',
    durationInput: 'duration',
    referenceInputs: { refs: ['face'] },
  });
  const result = prepareContinuityGeneration(report, config, '/project', files);
  expect(result.inputs.prompt).toContain('1. SCENE AND INTENT');
  expect(result.inputs.prompt).toContain('<Picture 1>: face');
  expect(() =>
    assertSceneIntent(result.sceneIntent, {
      ...result.inputs,
      refs: [files.face_input],
    }),
  ).not.toThrow();
  config.workflow = 'other-workflow';
  expect(() =>
    prepareContinuityGeneration(report, config, '/project', files),
  ).toThrow('H3');
});

it.each(['phone', 'radio'])(
  'keeps H3 %s audio for assembly without requiring a generation binding',
  (mode) => {
    const { report, config, files } = fixture();
    Object.assign(report.scenes[0], {
      locationId: 'clinic',
      camera: 'Fixed camera',
      framing: ['Both actors visible'],
      actors: [],
      states: [],
    });
    Object.assign(report.scenes[0].dialogue[0], {
      mode,
      text: 'Private caller line',
    });
    Object.assign(config, {
      promptProfile: 'h3-six-section',
      workflow: 'h3_video_final',
      durationInput: 'duration',
      referenceInputs: { refs: ['face'] },
    });
    const result = prepareContinuityGeneration(
      report,
      config,
      '/project',
      files,
    );
    expect(result.inputs).not.toHaveProperty('audio_refs');
    expect(result.inputs.prompt).not.toContain('Private caller line');
    expect(result.inputs.prompt).toContain('No generated speech');
  },
);
