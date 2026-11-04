/** @jest-environment node */
/* eslint-disable import/no-relative-packages */
import { expect, it } from '@jest/globals';
import { buildH3Prompt } from '../../packages/dhee-runner-production/src/h3Prompt';

function fixture(): any {
  return {
    id: 'clinic',
    durationSec: 5,
    locationId: 'clinic',
    camera: 'Fixed two shot',
    framing: ['Both faces visible'],
    actors: [
      {
        characterId: 'doctor',
        movement: 'stationary',
        mustRemainStationary: true,
        action: 'Stay seated',
      },
      {
        characterId: 'patient',
        movement: 'exit',
        action: 'Leave through the door',
      },
    ],
    states: [
      {
        entityId: 'doctor',
        property: 'glasses',
        start: 'on face',
        end: 'on face',
      },
    ],
    referenceBindings: [
      { entityId: 'doctor', referenceIds: ['doctor-ref'] },
      { entityId: 'patient', referenceIds: ['patient-ref'] },
    ],
    assets: [
      { id: 'doctor-ref', kind: 'image' },
      { id: 'patient-ref', kind: 'image' },
      { id: 'voice', kind: 'audio' },
    ],
    dialogue: [
      {
        speakerId: 'narrator',
        voiceId: 'voice',
        mode: 'narration',
        text: 'A doctor’s visit ends.',
        startSec: 0,
        endSec: 2,
      },
    ],
  };
}
it('uses six sections and explicit actor/action/reference ownership without narration text', () => {
  const prompt = buildH3Prompt(
    fixture(),
    { refs: ['patient-ref', 'doctor-ref'] },
    {},
  );
  [
    '1. SCENE AND INTENT',
    '2. REFERENCES AND IDENTITY',
    '3. ACTION',
    '4. CAMERA',
    '5. LIGHTING AND FINISH',
    '6. AUDIO',
  ].forEach((title) => expect(prompt).toContain(title));
  expect(prompt).toContain('<Picture 1>: patient-ref');
  expect(prompt).toContain('entities: patient');
  expect(prompt).toContain('doctor: stationary');
  expect(prompt).toContain('Fixed two shot');
  expect(prompt).toContain('on face');
  expect(prompt).not.toContain('A doctor’s visit ends.');
  expect(prompt).toContain('No generated speech');
});
it('routes only visible dialogue to its own voice and lip-sync interval', () => {
  const scene = fixture();
  scene.dialogue = [
    {
      speakerId: 'doctor',
      voiceId: 'voice',
      mode: 'on-screen',
      text: 'Any questions?',
      startSec: 1,
      endSec: 2,
    },
  ];
  const prompt = buildH3Prompt(
    scene,
    { refs: ['doctor-ref', 'patient-ref'], audio_refs: ['voice'] },
    {},
  );
  expect(prompt).toContain('<Audio 1>');
  expect(prompt).toContain('doctor');
  expect(prompt).toContain('1–2s');
  expect(prompt).toContain('Any questions?');
  expect(prompt).toContain('Listeners do not speak');
});
it.each([
  'wrong-label',
  'wrong-modality',
  'missing-voice',
  'fractional-duration',
  'unknown-slot',
])('rejects %s', (mode) => {
  const scene = fixture();
  const bindings: any = { refs: ['doctor-ref', 'patient-ref'] };
  const labels: any = {};
  if (mode === 'wrong-label') labels.refs = ['<Picture 2>', '<Picture 1>'];
  if (mode === 'wrong-modality') bindings.refs.push('voice');
  if (mode === 'missing-voice') scene.dialogue[0].mode = 'on-screen';
  if (mode === 'fractional-duration') scene.durationSec = 4.5;
  if (mode === 'unknown-slot') bindings.images = bindings.refs;
  expect(() => buildH3Prompt(scene, bindings, labels)).toThrow();
});
