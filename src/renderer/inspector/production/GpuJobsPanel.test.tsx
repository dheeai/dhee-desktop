import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GpuJobsPanel } from './GpuJobsPanel';

it('keeps cancellation requested distinct from stopped and allows refresh', async () => {
  const job = {
    id: 'a',
    workflow: 'video',
    phase: 'tracked',
    state: 'running',
    jobId: 'j1',
  };
  const call = jest.fn(async (req) => ({
    ok: true,
    jobs: [{ ...job, cancelRequested: req.action === 'cancel' }],
  }));
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { queueJobs: call },
  });
  render(<GpuJobsPanel projectDir="/project" />);
  await screen.findByText('video');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel job' }));
  await screen.findByText(/Cancellation requested/);
  expect(screen.getByText(/running/)).toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Refresh status' }),
    ).toBeEnabled(),
  );
});
it('offers local retrieval only for finished remote outputs', async () => {
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: {
      queueJobs: jest.fn(async () => ({
        ok: true,
        jobs: [
          {
            id: 'a',
            workflow: 'video',
            phase: 'tracked',
            state: 'done',
            jobId: 'j1',
          },
        ],
      })),
    },
  });
  render(<GpuJobsPanel projectDir="/project" />);
  expect(
    await screen.findByRole('button', { name: 'Save outputs locally' }),
  ).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: 'Cancel job' }),
  ).not.toBeInTheDocument();
});

it('permits retry after a failed cancellation request and reload', async () => {
  const job = {
    id: 'a',
    workflow: 'video',
    phase: 'tracked',
    state: 'running',
    jobId: 'j1',
    cancelRequested: true,
  };
  const call = jest.fn(async () => ({ ok: true, jobs: [job] }));
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { queueJobs: call },
  });
  render(<GpuJobsPanel projectDir="/project" />);
  const button = await screen.findByRole('button', {
    name: 'Retry cancellation',
  });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith({
      projectDir: '/project',
      action: 'cancel',
      id: 'a',
    }),
  );
});
