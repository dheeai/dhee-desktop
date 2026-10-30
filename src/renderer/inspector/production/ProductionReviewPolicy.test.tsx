/* eslint-disable compat/compat -- Electron supports native Promise. */
import { beforeEach, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProductionReviewPolicy } from './ProductionReviewPolicy';

const read = jest.fn<any>();
const save = jest.fn<any>();
beforeEach(() => {
  read.mockReset().mockResolvedValue({ ok: true, enabled: false });
  save.mockReset().mockResolvedValue({ ok: true, enabled: true });
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { readReviewPolicy: read, setReviewPolicy: save },
  });
});
it('requires an explicit choice and warns about missing voice configuration', async () => {
  render(<ProductionReviewPolicy projectDir="/one" voiceConfigured={false} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Require creative approvals' }),
  );
  await screen.findByText('Creative approvals required');
  expect(save).toHaveBeenCalledWith({ projectDir: '/one', enabled: true });
  expect(screen.getByText(/audio audition/)).toBeTruthy();
});
it('keeps the saved state when policy changes are locked', async () => {
  save.mockResolvedValue({ ok: false, error: 'A run is in progress.' });
  render(<ProductionReviewPolicy projectDir="/one" voiceConfigured />);
  await screen.findByRole('button', { name: 'Require creative approvals' });
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button'));
  await screen.findByRole('alert');
  expect(screen.getByText('Creative approvals optional')).toBeTruthy();
});
it('ignores policy responses from the old project', async () => {
  let finish: (v: any) => void = () => {};
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { rerender } = render(
    <ProductionReviewPolicy projectDir="/one" voiceConfigured />,
  );
  rerender(<ProductionReviewPolicy projectDir="/two" voiceConfigured />);
  await screen.findByText('Creative approvals optional');
  finish({ ok: true, enabled: true });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Creative approvals required')).toBeNull();
});
