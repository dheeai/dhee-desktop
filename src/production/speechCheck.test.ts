/** @jest-environment node */
/* eslint-disable import/no-relative-packages */
import { expect, it } from '@jest/globals';
import { compareSpeech } from '../../packages/dhee-runner-production/src/speechCheck.js';

const words = (sentence: string, probability = 0.99) =>
  sentence.split(' ').map((text, i) => ({
    text,
    start: i * 0.2,
    end: (i + 1) * 0.2,
    probability,
  }));
it('catches the actual unwanted Narrator prefix as an extra word', () => {
  const result = compareSpeech(
    'But the work has begun.',
    words('Narrator But the work has begun.'),
  );
  expect(result.finding.status).toBe('fail');
  expect(result.differences).toContainEqual(
    expect.objectContaining({ kind: 'insert', heard: 'narrator', startSec: 0 }),
  );
});
it('normalizes punctuation without hiding omitted or substituted words', () => {
  expect(
    compareSpeech('A doctor’s visit ends.', words("A doctor's visit ends"))
      .finding.status,
  ).toBe('pass');
  expect(
    compareSpeech(
      'The doctor stays seated.',
      words('The patient stays seated.'),
    ).finding.status,
  ).toBe('fail');
  expect(
    compareSpeech('The doctor stays seated.', words('The doctor seated.'))
      .finding.status,
  ).not.toBe('pass');
});
it('marks uncertain recognition unchecked and preserves the mismatch evidence', () => {
  const r = compareSpeech(
    "A doctor's visit ends.",
    words("and doctors visit N's.", 0.35),
  );
  expect(r.finding.status).toBe('unchecked');
  expect(r.differences.length).toBeGreaterThan(0);
});
it('cannot pass silent or malformed recognizer output', () => {
  expect(compareSpeech('Hello', []).finding.status).not.toBe('pass');
  expect(() =>
    compareSpeech('Hello', [
      { text: 'Hello', start: 1, end: 0, probability: 1 },
    ]),
  ).toThrow();
});
