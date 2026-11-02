/** @jest-environment node */
/* Tests exercise the workspace package source before packaging. */
/* eslint-disable import/no-relative-packages */
import { expect, it } from '@jest/globals';
import {
  checkSceneIntent,
  sceneInputDigest,
} from '../../packages/dhee-runner-production/src/sceneIntent.js';

const intent = () => ({
  requirements: [
    {
      id: 'doctor-position',
      description: 'Doctor stays seated',
      expected: 'seated',
      sources: ['frame', 'motion'],
    },
  ],
  sources: [
    {
      id: 'frame',
      inputKey: 'image',
      sha256: 'a'.repeat(64),
      evidence: 'Viewed initial frame',
      facts: { 'doctor-position': 'exiting' } as Record<string, string>,
    },
    {
      id: 'motion',
      inputKey: 'prompt',
      sha256: sceneInputDigest('Doctor stays seated.'),
      evidence: 'Read motion prompt',
      facts: { 'doctor-position': 'seated' } as Record<string, string>,
    },
  ],
});
it('reports actor-action contradiction with evidence and expected correction', () => {
  expect(checkSceneIntent(intent()).issues).toContainEqual(
    expect.objectContaining({
      requirementId: 'doctor-position',
      sourceId: 'frame',
      status: 'conflict',
      expected: 'seated',
      observed: 'exiting',
    }),
  );
  expect(checkSceneIntent(intent()).status).toBe('blocked');
});
it('does not interpret missing facts as agreement', () => {
  const value = intent();
  value.sources[0]!.facts = {};
  expect(checkSceneIntent(value)).toMatchObject({
    status: 'blocked',
    issues: [expect.objectContaining({ status: 'unknown' })],
  });
});
it('accepts consistent recorded observations without granting creative approval', () => {
  const value = intent();
  value.sources[0]!.facts['doctor-position'] = 'seated';
  expect(checkSceneIntent(value)).toMatchObject({
    status: 'consistent',
    creativeApproval: 'required',
    basis: 'recorded-observations',
  });
});
it('rejects vacuous contracts and duplicate requirement IDs', () => {
  expect(() => checkSceneIntent({ requirements: [], sources: [] })).toThrow();
  const value = intent();
  value.requirements.push(value.requirements[0]!);
  expect(() => checkSceneIntent(value)).toThrow(/duplicate/i);
});
