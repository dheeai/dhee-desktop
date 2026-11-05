import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { SoundtrackEditor } from './SoundtrackEditor';

const plan = {
  dialogueSha256: 'a'.repeat(64),
  bedSha256: 'b'.repeat(64),
  bedGain: 0.5,
  duckGain: 0.1,
  fadeSec: 0.15,
  speech: [
    { startSec: 1, endSec: 3 },
    { startSec: 5, endSec: 7 },
  ],
};
function setup(content = JSON.stringify(plan)) {
  const onChange = jest.fn();
  const onPendingChange = jest.fn();
  const view = render(
    <SoundtrackEditor
      content={content}
      onChange={onChange}
      onPendingChange={onPendingChange}
    />,
  );
  return { onChange, onPendingChange, ...view };
}
it('applies readable levels while preserving exact source hashes and speech timings', () => {
  const f = setup();
  fireEvent.change(screen.getByLabelText('Music level (%)'), {
    target: { value: '30' },
  });
  expect(f.onChange).not.toHaveBeenCalled();
  expect(f.onPendingChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Apply settings to draft' }),
  );
  expect(JSON.parse(f.onChange.mock.calls[0][0])).toEqual({
    ...plan,
    bedGain: 0.3,
  });
  expect(f.onPendingChange).toHaveBeenLastCalledWith(false);
});
it('refuses blank and overlapping speech times instead of silently keeping old values', () => {
  const f = setup();
  fireEvent.change(screen.getByLabelText('Speech 2 start (seconds)'), {
    target: { value: '2' },
  });
  expect(
    screen.getByRole('button', { name: 'Apply settings to draft' }),
  ).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('overlap');
  fireEvent.change(screen.getByLabelText('Speech 2 start (seconds)'), {
    target: { value: '' },
  });
  expect(
    screen.getByRole('button', { name: 'Apply settings to draft' }),
  ).toBeDisabled();
  expect(f.onChange).not.toHaveBeenCalled();
});
it('requires deliberate timing for a new speech interval', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Add speech interval' }));
  expect(screen.getByLabelText('Speech 3 start (seconds)')).toHaveValue(null);
  expect(
    screen.getByRole('button', { name: 'Apply settings to draft' }),
  ).toBeDisabled();
});
it('discards unapplied changes without editing the saved draft', () => {
  const f = setup();
  fireEvent.change(screen.getByLabelText('Music level (%)'), {
    target: { value: '90' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Discard settings changes' }),
  );
  expect(screen.getByLabelText('Music level (%)')).toHaveValue(50);
  expect(f.onChange).not.toHaveBeenCalled();
  expect(f.onPendingChange).toHaveBeenLastCalledWith(false);
});
it('resets when a different material is loaded', () => {
  const f = setup();
  fireEvent.change(screen.getByLabelText('Music level (%)'), {
    target: { value: '90' },
  });
  f.rerender(
    <SoundtrackEditor
      content={JSON.stringify({ ...plan, bedGain: 0.2 })}
      onChange={f.onChange}
      onPendingChange={f.onPendingChange}
    />,
  );
  expect(screen.getByLabelText('Music level (%)')).toHaveValue(20);
  expect(f.onPendingChange).toHaveBeenLastCalledWith(false);
});
it('leaves unrelated JSON to its existing editor', () => {
  setup('{"scenes":[]}');
  expect(screen.queryByText('Soundtrack settings')).not.toBeInTheDocument();
});
it('accepts explicit silence and retains a zero music level', () => {
  const f = setup();
  fireEvent.change(screen.getByLabelText('Music level (%)'), {
    target: { value: '0' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Remove speech interval 2' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Remove speech interval 1' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Apply settings to draft' }),
  );
  expect(JSON.parse(f.onChange.mock.calls[0][0])).toMatchObject({
    bedGain: 0,
    speech: [],
  });
});
it('shows readable milliseconds without rounding unchanged sample-accurate timings on apply', () => {
  const precise = {
    ...plan,
    speech: [{ startSec: 0.45, endSec: 1.9825170068027211 }],
  };
  const f = setup(JSON.stringify(precise));
  expect(screen.getByLabelText('Speech 1 end (seconds)')).toHaveValue(1.983);
  fireEvent.change(screen.getByLabelText('Music level (%)'), {
    target: { value: '25' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Apply settings to draft' }),
  );
  expect(JSON.parse(f.onChange.mock.calls[0][0]).speech).toEqual(
    precise.speech,
  );
});
