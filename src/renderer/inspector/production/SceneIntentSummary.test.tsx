import { expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { SceneIntentSummary } from './SceneIntentSummary';

it('makes unchecked attempts explicit', () => {
  render(<SceneIntentSummary />);
  expect(screen.getByText(/Scene intent has not been checked/)).not.toBeNull();
});
it('shows requirements and source evidence without claiming automatic understanding', () => {
  render(
    <SceneIntentSummary
      value={{
        requirements: [
          {
            id: 'doctor',
            description: 'Doctor remains seated',
            expected: 'seated',
          },
        ],
        sources: [
          {
            id: 'frame',
            evidence: 'Viewed original reference; doctor is exiting',
          },
        ],
      }}
    />,
  );
  expect(screen.getByText(/Doctor remains seated/)).not.toBeNull();
  expect(screen.getByText(/doctor is exiting/)).not.toBeNull();
  expect(screen.getByText(/recorded observations/)).not.toBeNull();
});
it('shows malformed saved contracts safely instead of crashing production', () => {
  render(<SceneIntentSummary value={{ requirements: [null], sources: [] }} />);
  expect(screen.getByText(/Saved scene intent is invalid/)).not.toBeNull();
});
it('does not render arbitrary objects as observation text', () => {
  render(
    <SceneIntentSummary
      value={{
        requirements: [
          { id: 'r', description: { bad: true }, expected: 'seated' },
        ],
        sources: [],
      }}
    />,
  );
  expect(screen.getByText(/Saved scene intent is invalid/)).not.toBeNull();
});
