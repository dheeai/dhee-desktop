import '@testing-library/jest-dom';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from '@testing-library/react';
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

it('inspects a candidate before allowing explicitly acknowledged linking', async () => {
  const job = { id: 'a'.repeat(64), workflow: 'video', phase: 'unknown' };
  const recovery = {
    id: job.id,
    fingerprint: 'b'.repeat(64),
    evidence: 'incomplete',
    local: {
      workflow: 'video',
      version: 'v1',
      createdAt: '2026-11-02',
      inputs: { prompt: 'scene' },
    },
    job: { jobId: 'job1', state: 'running' },
  };
  const call = jest.fn(async (req) => ({
    ok: true,
    jobs: [job],
    ...(req.action === 'inspect-recovery' ? { recovery } : {}),
  }));
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { queueJobs: call },
  });
  render(<GpuJobsPanel projectDir="/project" />);
  const input = await screen.findByLabelText('Existing gateway job ID');
  fireEvent.change(input, { target: { value: 'job1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Inspect existing job' }));
  await screen.findByText(/cannot prove this is the same submission/i);
  const link = screen.getByRole('button', { name: 'Link existing job' });
  expect(link).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(link);
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith({
      projectDir: '/project',
      action: 'link-existing',
      id: job.id,
      jobId: 'job1',
      expectedFingerprint: recovery.fingerprint,
      humanAcknowledged: true,
    }),
  );
  expect(call.mock.calls.some(([req]) => req.action === 'submit')).toBe(false);
});

it('discards old recovery evidence when switching projects', async () => {
  const job = { id: 'a'.repeat(64), workflow: 'video', phase: 'unknown' };
  let finish: (value: any) => void = () => {};
  const call = jest.fn(
    async (req): Promise<any> =>
      req.action === 'inspect-recovery'
        ? // Test-only deferred response; this runs in Node/jsdom.
          // eslint-disable-next-line compat/compat
          new Promise((resolve) => {
            finish = resolve;
          })
        : { ok: true, jobs: [job] },
  );
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { queueJobs: call },
  });
  const view = render(<GpuJobsPanel projectDir="/first" />);
  fireEvent.change(await screen.findByLabelText('Existing gateway job ID'), {
    target: { value: 'job1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Inspect existing job' }));
  view.rerender(<GpuJobsPanel projectDir="/second" />);
  await screen.findByLabelText('Existing gateway job ID');
  await act(async () =>
    finish({
      ok: true,
      jobs: [job],
      recovery: {
        id: job.id,
        fingerprint: 'b'.repeat(64),
        evidence: 'incomplete',
        local: { workflow: 'old', version: '1', createdAt: 'now', inputs: {} },
        job: { jobId: 'job1', state: 'running' },
      },
    }),
  );
  expect(
    screen.queryByRole('button', { name: 'Link existing job' }),
  ).toBeNull();
  expect(screen.getByLabelText('Existing gateway job ID')).toHaveValue('');
});
