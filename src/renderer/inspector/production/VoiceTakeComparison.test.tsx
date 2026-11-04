import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { VoiceTakeComparison } from './VoiceTakeComparison';

const current = {
  absolutePath: '/project/approved.wav',
  sha256: 'current-hash',
};
const candidate = { absolutePath: '/candidate.wav', sha256: 'candidate-hash' };
const saved = { absolutePath: '/project/old.wav', sha256: 'saved-hash' };
let pause: jest.SpyInstance;
beforeEach(() => {
  pause = jest
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => {});
});
afterEach(() => pause.mockRestore());
it('distinguishes current, unsaved replacement and saved voice without asserting approval', () => {
  render(
    <VoiceTakeComparison
      current={current}
      candidate={candidate}
      saved={saved}
    />,
  );
  expect(
    screen.getByRole('heading', { name: 'Current voice' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Replacement candidate · not saved' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Saved voice take' }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Current voice preview')).toHaveAttribute(
    'src',
    expect.stringContaining('approved.wav'),
  );
  expect(screen.getByLabelText('Reference preview')).toHaveAttribute(
    'src',
    expect.stringContaining('candidate.wav'),
  );
  expect(screen.getByLabelText('Saved version preview')).toHaveAttribute(
    'src',
    expect.stringContaining('old.wav'),
  );
  expect(screen.queryByText('Approved')).toBeNull();
});
it('pauses the previously played take and stops playback when source identity changes', () => {
  const view = render(
    <VoiceTakeComparison
      current={current}
      candidate={undefined}
      saved={saved}
    />,
  );
  const first = screen.getByLabelText('Reference preview');
  const second = screen.getByLabelText('Saved version preview');
  fireEvent.play(first);
  expect(pause).not.toHaveBeenCalled();
  fireEvent.play(second);
  expect(pause).toHaveBeenCalledTimes(1);
  expect(pause.mock.instances[0]).toBe(first);
  view.rerender(
    <VoiceTakeComparison
      current={current}
      candidate={candidate}
      saved={saved}
    />,
  );
  expect(pause).toHaveBeenCalledTimes(2);
  expect(pause.mock.instances[1]).toBe(second);
  fireEvent.play(screen.getByLabelText('Reference preview'));
  view.unmount();
  expect(pause).toHaveBeenCalledTimes(3);
});
it('shows a failed take and recovers when that source changes', () => {
  const view = render(
    <VoiceTakeComparison
      current={current}
      candidate={undefined}
      saved={undefined}
    />,
  );
  fireEvent.error(screen.getByLabelText('Reference preview'));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Could not load Current voice',
  );
  view.rerender(
    <VoiceTakeComparison
      current={{ ...current, sha256: 'new' }}
      candidate={undefined}
      saved={undefined}
    />,
  );
  expect(screen.queryByRole('alert')).toBeNull();
});
