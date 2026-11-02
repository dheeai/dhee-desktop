/* eslint-disable compat/compat -- Electron test runtime supports Promise. */
import '@testing-library/jest-dom';
import { expect, it, jest } from '@jest/globals';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MediaChecksPanel } from './MediaChecksPanel';

it('checks only on request and clears the report when expectations change', async () => {
  const mediaCheck = jest.fn(
    async (): Promise<any> => ({
      ok: true,
      result: {
        technicalStatus: 'passed',
        checkedAt: 'now',
        source: { versionId: 'v1', outputPath: 'clip.mp4', sha256: 'abc' },
        checks: [
          {
            code: 'decode',
            status: 'pass',
            message: 'Complete decode succeeded.',
          },
        ],
        manualChecks: ['Listen manually.'],
      },
    }),
  );
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: {
      mediaCheck,
      gpuPreparation: async () => ({
        ok: true,
        result: {
          targets: [{ nodeId: 'clip', format: 'video', status: 'completed' }],
          branches: [{ branchId: 'main' }],
        },
      }),
    },
  });
  render(<MediaChecksPanel projectDir="/project" />);
  await screen.findByRole('option', { name: 'clip' });
  expect(mediaCheck).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Media to check'), {
    target: { value: '0' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Check selected media' }));
  await screen.findByText('Complete decode succeeded.');
  expect(mediaCheck).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'media.check',
      nodeId: 'clip',
      branchId: 'main',
    }),
  );
  fireEvent.click(screen.getByLabelText('Expect audio'));
  expect(screen.queryByText('Complete decode succeeded.')).toBeNull();
});
it('discards a check response after the project changes', async () => {
  let finish: (value: any) => void = () => {};
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: {
      mediaCheck: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      gpuPreparation: async () => ({
        ok: true,
        result: {
          targets: [{ nodeId: 'clip', format: 'video', status: 'completed' }],
          branches: [{ branchId: 'main' }],
        },
      }),
    },
  });
  const view = render(<MediaChecksPanel projectDir="/first" />);
  await screen.findByRole('option', { name: 'clip' });
  fireEvent.change(screen.getByLabelText('Media to check'), {
    target: { value: '0' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Check selected media' }));
  view.rerender(<MediaChecksPanel projectDir="/second" />);
  await screen.findByRole('option', { name: 'clip' });
  await act(async () => {
    finish({
      ok: true,
      result: {
        technicalStatus: 'passed',
        checkedAt: 'old',
        source: { versionId: 'v1' },
        checks: [{ code: 'decode', status: 'pass', message: 'Stale report' }],
        manualChecks: [],
      },
    });
  });
  expect(screen.queryByText('Stale report')).toBeNull();
});
