/* eslint-disable compat/compat -- Electron test runtime supports Promise. */
import '@testing-library/jest-dom';
import { expect, it, jest } from '@jest/globals';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MediaChecksPanel } from './MediaChecksPanel';
import { MediaMeasurements } from './MediaMeasurements';

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

it('shows measured media and actionable silence intervals without granting approval', async () => {
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: {
      gpuPreparation: async () => ({ ok: true, result: { targets: [{ nodeId: 'final_video', format: 'video', status: 'completed' }] } }),
      mediaCheck: async () => ({ ok: true, result: {
        technicalStatus: 'review', checkedAt: 'now', source: { versionId: 'real-v1', outputPath: 'final_video.mp4', sha256: 'abc' },
        checks: [{ code: 'silence', status: 'warning', message: 'Review intentional pauses.' }], manualChecks: ['Listen manually.'],
        media: { durationSec: 4, video: { width: 1280, height: 720, fps: 24 }, audio: { channels: 1, sampleRate: 44100, peakDb: -4.3, meanDb: -23.3 }, silenceIntervals: [{ start: 1.45048, end: 4.01705 }, { start: 12.1 }] },
      } }),
    },
  });
  render(<MediaChecksPanel projectDir="/project" />);
  await screen.findByRole('option', { name: 'final_video' });
  fireEvent.change(screen.getByLabelText('Media to check'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Check selected media' }));
  await screen.findByText('1.450–4.017 s');
  expect(screen.getByText('12.100 s–end not detected')).not.toBeNull();
  expect(screen.getByText('1280 × 720 · 24 fps')).not.toBeNull();
  expect(screen.getByText('1 channel · 44100 Hz')).not.toBeNull();
  expect(screen.getByText('Peak −4.3 dBFS · mean −23.3 dBFS')).not.toBeNull();
  expect(screen.getByText('Creative review still required')).not.toBeNull();
  fireEvent.click(screen.getByLabelText('Expect audio'));
  expect(screen.queryByRole('region', { name: 'Measured media' })).toBeNull();
  expect(screen.queryByText('1.450–4.017 s')).toBeNull();
});

it('does not invent measured details for older reports or unavailable levels', () => {
  const view = render(<MediaMeasurements media={undefined} />);
  expect(screen.queryByRole('region', { name: 'Measured media' })).toBeNull();
  view.rerender(<MediaMeasurements media={{ video: { width: 1280, height: 720, fps: null }, audio: { channels: 2, sampleRate: 48000, peakDb: null }, silenceIntervals: [] }} />);
  expect(screen.getByText('1280 × 720 · unknown fps')).not.toBeNull();
  expect(screen.getByText('Peak not available · mean not available')).not.toBeNull();
  expect(screen.queryByRole('list', { name: 'Silence intervals' })).toBeNull();
});
