/** @jest-environment node */
/* eslint-disable import/no-relative-packages */
import { expect, it } from '@jest/globals';
import { checkContinuity } from '../../packages/dhee-runner-production/src/continuityPreflight';

const hash = 'a'.repeat(64);
function fixture() {
  return {
    spec: {
      schemaVersion: 1,
      storyboard: { inputKey: 'story', sha256: hash },
      assets: [
        { id: 'doctor_ref', inputKey: 'doctor', kind: 'image', sha256: hash },
        { id: 'patient_ref', inputKey: 'patient', kind: 'image', sha256: hash },
        { id: 'doctor_voice', inputKey: 'speech', kind: 'audio', sha256: hash },
        { id: 'clinic_ref', inputKey: 'clinic', kind: 'image', sha256: hash },
      ],
      characters: [
        { id: 'doctor', referenceIds: ['doctor_ref'], voiceId: 'doctor_voice' },
        { id: 'patient', referenceIds: ['patient_ref'] },
      ],
      locations: [{ id: 'clinic', referenceIds: ['clinic_ref'] }],
      props: [{ id: 'glasses', referenceIds: [] }],
      scenes: [
        {
          id: 'opening',
          durationSec: 5,
          locationId: 'clinic',
          camera: 'Steady two shot',
          framing: ['Both faces remain visible'],
          actors: [
            {
              characterId: 'doctor',
              movement: 'stationary',
              mustRemainStationary: true,
              action: 'Remain seated',
            },
            {
              characterId: 'patient',
              movement: 'exit',
              action: 'Leave the room',
            },
          ],
          dialogue: [
            {
              speakerId: 'doctor',
              voiceId: 'doctor_voice',
              mode: 'on-screen',
              startSec: 0,
              endSec: 1,
              text: 'Any questions?',
            },
          ],
          states: [
            {
              entityId: 'glasses',
              property: 'position',
              start: 'in pocket',
              end: 'in pocket',
            },
          ],
        },
      ],
    },
    inputs: {
      story: { sha256: hash, kind: 'text' as const },
      doctor: { sha256: hash, kind: 'image' as const },
      patient: { sha256: hash, kind: 'image' as const },
      speech: { sha256: hash, kind: 'audio' as const },
      clinic: { sha256: hash, kind: 'image' as const },
    },
  };
}
it('compiles actor-specific constraints without claiming visual verification or approval', () => {
  const { spec, inputs } = fixture();
  const report = checkContinuity(spec, inputs);
  expect(report).toMatchObject({
    status: 'constraints-valid',
    semanticVerification: 'unchecked',
    creativeApproval: 'required',
    deliveryReady: false,
    issues: [],
  });
  expect(report.scenes[0].prompt).toContain('doctor: stationary');
  expect(report.scenes[0].prompt).toContain('patient: exit');
  expect(report.scenes[0].visualRequirements.join(' ')).toContain(
    'Both faces remain visible',
  );
  expect(report.scenes[0].dialogue[0]).toMatchObject({
    voiceId: 'doctor_voice',
    lipSyncRequired: true,
  });
});
it('blocks the wrong person moving while required to remain seated', () => {
  const { spec, inputs } = fixture();
  spec.scenes[0].actors[0].movement = 'exit';
  expect(checkContinuity(spec, inputs).issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'stationary-conflict',
        sceneId: 'opening',
      }),
    ]),
  );
});
it('blocks missing or stale material before generation', () => {
  const { spec, inputs } = fixture();
  inputs.doctor.sha256 = 'b'.repeat(64);
  delete (inputs as Partial<typeof inputs>).speech;
  expect(checkContinuity(spec, inputs).issues.map((i) => i.code)).toEqual(
    expect.arrayContaining(['stale-input', 'missing-input']),
  );
});
it('blocks a wrong voice or a visible speaker not present in the shot', () => {
  const { spec, inputs } = fixture();
  spec.scenes[0].dialogue[0].speakerId = 'patient';
  expect(checkContinuity(spec, inputs).issues.map((i) => i.code)).toContain(
    'voice-mismatch',
  );
  spec.scenes[0].dialogue[0].speakerId = 'doctor';
  spec.scenes[0].actors.shift();
  expect(checkContinuity(spec, inputs).issues.map((i) => i.code)).toContain(
    'speaker-not-visible',
  );
});
it('allows off-screen speech without claiming lip sync', () => {
  const { spec, inputs } = fixture();
  spec.scenes[0].dialogue[0].mode = 'phone';
  spec.scenes[0].actors.shift();
  const report = checkContinuity(spec, inputs);
  expect(report.status).toBe('constraints-valid');
  expect(report.scenes[0].dialogue[0].lipSyncRequired).toBe(false);
});
it('blocks narration assigned to an on-screen performer and dialogue outside scene time', () => {
  const { spec, inputs } = fixture();
  spec.scenes[0].dialogue[0].mode = 'narration';
  spec.scenes[0].dialogue[0].endSec = 6;
  expect(checkContinuity(spec, inputs).issues.map((i) => i.code)).toEqual(
    expect.arrayContaining(['narrator-mismatch', 'dialogue-timing']),
  );
});
it('blocks unintended overlapping dialogue', () => {
  const { spec, inputs } = fixture();
  spec.scenes[0].dialogue.push({
    ...spec.scenes[0].dialogue[0],
    startSec: 0.5,
    endSec: 2,
  });
  expect(checkContinuity(spec, inputs).issues.map((i) => i.code)).toContain(
    'dialogue-overlap',
  );
});
it('tracks prop states across an intercut rather than only the adjacent shot', () => {
  const { spec, inputs } = fixture();
  spec.scenes.push({ ...spec.scenes[0], id: 'intercut', states: [] });
  spec.scenes.push({
    ...spec.scenes[0],
    id: 'return',
    states: [
      {
        entityId: 'glasses',
        property: 'position',
        start: 'on face',
        end: 'on face',
      },
    ],
  });
  expect(checkContinuity(spec, inputs).issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'state-discontinuity',
        sceneId: 'return',
      }),
    ]),
  );
});
it('requires explicit reasons for intentional entry and within-scene state changes', () => {
  const { spec, inputs } = fixture();
  spec.scenes[0].states[0].end = 'on face';
  expect(checkContinuity(spec, inputs).issues.map((i) => i.code)).toContain(
    'unexplained-state-change',
  );
  const changed = structuredClone(spec) as any;
  changed.scenes[0].states[0].changeReason = 'Patient puts on glasses';
  changed.scenes.push({
    ...changed.scenes[0],
    id: 'later',
    states: [
      {
        entityId: 'glasses',
        property: 'position',
        start: 'in pocket',
        end: 'in pocket',
        entryReason: 'Later that evening, after putting them away',
      },
    ],
  });
  expect(checkContinuity(changed, inputs).status).toBe('constraints-valid');
});
it('blocks duplicate IDs, unknown actors and mismatched reference types', () => {
  const { spec, inputs } = fixture();
  spec.characters[0].referenceIds = ['doctor_voice'];
  spec.scenes[0].actors[1].characterId = 'stranger';
  spec.props.push({ id: 'doctor', referenceIds: [] });
  expect(checkContinuity(spec, inputs).issues.map((i) => i.code)).toEqual(
    expect.arrayContaining([
      'duplicate-entity',
      'unknown-character',
      'reference-kind',
    ]),
  );
});
it('does not resolve inherited property names as source inputs', () => {
  const { spec, inputs } = fixture();
  spec.storyboard.inputKey = 'constructor';
  expect(checkContinuity(spec, inputs).issues.map((i) => i.code)).toContain(
    'missing-input',
  );
});
it('changes fingerprint when the constraints or selected source changes', () => {
  const { spec, inputs } = fixture();
  const before = checkContinuity(spec, inputs).fingerprint;
  spec.scenes[0].camera = 'Gentle push in';
  expect(checkContinuity(spec, inputs).fingerprint).not.toBe(before);
});

it('preserves explicit entity bindings even when reference names carry no meaning', () => {
  const { spec, inputs } = fixture();
  spec.assets[0].id = 'r1';
  spec.assets[1].id = 'r2';
  spec.characters[0].referenceIds = ['r1'];
  spec.characters[1].referenceIds = ['r2'];
  const scene = checkContinuity(spec, inputs).scenes[0];
  expect(scene.referenceBindings).toEqual(
    expect.arrayContaining([
      { entityId: 'doctor', referenceIds: ['r1'] },
      { entityId: 'patient', referenceIds: ['r2'] },
      { entityId: 'clinic', referenceIds: ['clinic_ref'] },
    ]),
  );
  expect(scene.prompt).toContain('doctor → r1');
  expect(scene.prompt).toContain('patient → r2');
});

it('carries known actor state through an intercut into the returning shot', () => {
  const { spec, inputs } = fixture();
  spec.scenes[0].states = [
    {
      entityId: 'doctor',
      property: 'glasses',
      start: 'on face',
      end: 'on face',
    },
  ];
  spec.scenes.push({
    ...spec.scenes[0],
    id: 'intercut',
    actors: [],
    dialogue: [],
    states: [],
  });
  spec.scenes.push({ ...spec.scenes[0], id: 'return', states: [] });
  const report = checkContinuity(spec, inputs);
  expect(report.status).toBe('constraints-valid');
  expect(report.scenes[1].prompt).not.toContain('doctor.glasses');
  expect(report.scenes[2].prompt).toContain(
    "doctor.glasses: start 'on face', end 'on face'",
  );
});

it('blocks identical voice bytes hidden behind distinct asset IDs', () => {
  const { spec, inputs } = fixture();
  spec.assets.push({ ...spec.assets[2], id: 'alias_voice' });
  spec.characters[1].voiceId = 'alias_voice';
  expect(checkContinuity(spec, inputs).issues.map((i) => i.code)).toContain(
    'shared-voice',
  );
});
