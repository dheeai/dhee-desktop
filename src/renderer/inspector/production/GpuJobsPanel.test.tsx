import '@testing-library/jest-dom';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from '@testing-library/react';
import { GpuJobsPanel } from './GpuJobsPanel';
import * as Recovery from './GpuRecoveryForm';

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

it('does not report an empty queue while loading or after a failed lookup', async () => {
  let finish: (value: any) => void = () => {};
  const call = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { queueJobs: call },
  });
  render(<GpuJobsPanel projectDir="/project" />);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Loading saved RTX jobs',
  );
  expect(
    screen.queryByText('No saved GPU jobs in this project yet.'),
  ).toBeNull();
  await act(async () => {
    finish({ ok: false, error: 'Queue record unavailable' });
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Queue record unavailable',
  );
  expect(
    screen.queryByText('No saved GPU jobs in this project yet.'),
  ).toBeNull();
});

it('shows download progress and only marks outputs saved after retrieval succeeds', async () => {
  let finish: (value: any) => void = () => {};
  const job = {
    id: 'a',
    workflow: 'video',
    phase: 'tracked',
    state: 'done',
    jobId: 'j1',
  };
  const call = jest.fn((req) =>
    req.action === 'download'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ ok: true, jobs: [job] }),
  );
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { queueJobs: call },
  });
  render(<GpuJobsPanel projectDir="/project" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Save outputs locally' }),
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Saving RTX outputs to this project',
  );
  expect(screen.queryByText('Saved locally · j1')).toBeNull();
  await act(async () => {
    finish({
      ok: true,
      jobs: [
        {
          ...job,
          phase: 'downloaded',
          files: [{ path: 'clip.mp4', sha256: 'a'.repeat(64), bytes: 1024 }],
        },
      ],
    });
  });
  expect(screen.getByText('Saved locally · j1')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Save outputs locally' }),
  ).toBeNull();
  expect(call.mock.calls.map(([req]) => req.action)).toEqual([
    'list',
    'download',
  ]);
});

it('reveals the exact downloaded output without submitting or downloading again', async () => {
  const queue = jest.fn().mockResolvedValue({
    ok: true,
    jobs: [
      {
        id: 'a',
        workflow: 'video',
        phase: 'downloaded',
        state: 'done',
        jobId: 'j1',
        files: [
          {
            path: 'assets/gpu/clip.mp4',
            sha256: 'a'.repeat(64),
            bytes: 2048,
          },
        ],
      },
    ],
  });
  const reveal = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { queueJobs: queue },
  });
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { project: { revealInFinder: reveal } },
  });
  render(<GpuJobsPanel projectDir="/project" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Show clip.mp4 in folder' }),
  );
  await waitFor(() =>
    expect(reveal).toHaveBeenCalledWith('/project/assets/gpu/clip.mp4'),
  );
  expect(screen.getByText('2 KiB')).toBeInTheDocument();
  expect(
    screen.getByText(/Downloaded outputs still need review/),
  ).toBeInTheDocument();
  expect(queue).toHaveBeenCalledTimes(1);
});

it('refuses paths outside the project and reports reveal errors', async () => {
  const queue = jest.fn().mockResolvedValue({
    ok: true,
    jobs: [
      {
        id: 'a',
        workflow: 'video',
        phase: 'downloaded',
        state: 'done',
        files: [
          { path: '../outside.mp4', sha256: 'a'.repeat(64), bytes: 10 },
          { path: 'assets/clip.mp4', sha256: 'b'.repeat(64), bytes: 10 },
        ],
      },
    ],
  });
  const reveal = jest
    .fn()
    .mockRejectedValue(new Error('File is no longer available'));
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { queueJobs: queue },
  });
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { project: { revealInFinder: reveal } },
  });
  render(<GpuJobsPanel projectDir="/project" />);
  expect(
    await screen.findByRole('button', { name: 'Show outside.mp4 in folder' }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Show clip.mp4 in folder' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'File is no longer available',
  );
  expect(reveal).toHaveBeenCalledTimes(1);
});

it('checks remote jobs without resubmission and continues after a partial failure', async () => {
  const jobs = [
    {
      id: 'a',
      workflow: 'scene A',
      phase: 'tracked',
      state: 'running',
      jobId: 'remote-a',
    },
    {
      id: 'b',
      workflow: 'scene B',
      phase: 'tracked',
      state: 'running',
      jobId: 'remote-b',
    },
    {
      id: 'saved',
      workflow: 'saved',
      phase: 'downloaded',
      state: 'done',
      jobId: 'remote-saved',
    },
    { id: 'unknown', workflow: 'unknown', phase: 'unknown' },
  ];
  const call = jest.fn(async (req) => {
    if (req.action === 'refresh' && req.id === 'a')
      return { ok: false, error: 'Gateway temporarily unavailable' };
    return {
      ok: true,
      jobs:
        req.id === 'b'
          ? jobs.map((j) => (j.id === 'b' ? { ...j, state: 'done' } : j))
          : jobs,
    };
  });
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { queueJobs: call },
  });
  render(<GpuJobsPanel projectDir="/project" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Check all remote jobs' }),
  );
  await waitFor(() => expect(call).toHaveBeenCalledTimes(3));
  expect(call.mock.calls.map(([r]) => [r.action, r.id])).toEqual([
    ['list', undefined],
    ['refresh', 'a'],
    ['refresh', 'b'],
  ]);
  expect(await screen.findByRole('alert')).toHaveTextContent('scene A');
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Gateway temporarily unavailable',
  );
  expect(
    await screen.findByText('1 completed job ready to save.'),
  ).toBeInTheDocument();
});

it('stops dispatching a batch when the project changes and ignores its late result', async () => {
  let finish: (value: any) => void = () => {};
  const jobs = ['a', 'b'].map((id) => ({
    id,
    workflow: `old ${id}`,
    phase: 'tracked',
    state: 'running',
    jobId: id,
  }));
  const call = jest.fn((req) =>
    req.action === 'refresh'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({
          ok: true,
          jobs: req.projectDir === '/first' ? jobs : [],
        }),
  );
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { queueJobs: call },
  });
  const view = render(<GpuJobsPanel projectDir="/first" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Check all remote jobs' }),
  );
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith({
      projectDir: '/first',
      action: 'refresh',
      id: 'a',
    }),
  );
  view.rerender(<GpuJobsPanel projectDir="/second" />);
  await screen.findByText('No saved GPU jobs in this project yet.');
  await act(async () => {
    finish({ ok: true, jobs });
  });
  expect(screen.queryByText('old a')).toBeNull();
  expect(call.mock.calls.filter(([r]) => r.action === 'refresh')).toHaveLength(
    1,
  );
});

it('allows another batch after recovery completion supersedes a pending check', async () => {
  const recovery = jest
    .spyOn(Recovery, 'GpuRecoveryForm')
    .mockImplementation(({ onLinked }) => (
      <button onClick={onLinked} type="button">
        Complete pending recovery
      </button>
    ));
  let finish: (value: any) => void = () => {};
  const jobs = [
    {
      id: 'a',
      workflow: 'tracked',
      phase: 'tracked',
      state: 'running',
      jobId: 'remote-a',
    },
    { id: 'b', workflow: 'recovering', phase: 'unknown' },
  ];
  const call = jest.fn((req) =>
    req.action === 'refresh'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ ok: true, jobs }),
  );
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { queueJobs: call },
  });
  try {
    render(<GpuJobsPanel projectDir="/project" />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Check all remote jobs' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Complete pending recovery' }),
    );
    const button = screen.getByRole('button', {
      name: 'Check all remote jobs',
    });
    await waitFor(() => expect(button).toBeEnabled());
    await act(async () => {
      finish({ ok: true, jobs });
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        call.mock.calls.filter(([r]) => r.action === 'refresh'),
      ).toHaveLength(2),
    );
    await act(async () => {
      finish({ ok: true, jobs });
    });
  } finally {
    recovery.mockRestore();
  }
});

it('filters queue states with accurate counts and keeps saved outputs separate from approval', async () => {
  const call = jest.fn().mockResolvedValue({
    ok: true,
    jobs: [
      {
        id: 'active',
        workflow: 'Working shot',
        phase: 'tracked',
        state: 'running',
        jobId: 'a',
      },
      {
        id: 'failed',
        workflow: 'Failed shot',
        phase: 'tracked',
        state: 'failed',
        jobId: 'b',
        error: 'Long gateway validation details',
      },
      { id: 'unknown', workflow: 'Unknown shot', phase: 'unknown' },
      {
        id: 'ready',
        workflow: 'Ready shot',
        phase: 'tracked',
        state: 'done',
        jobId: 'c',
      },
      { id: 'saved', workflow: 'Saved shot', phase: 'downloaded', jobId: 'd' },
    ],
  });
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { queueJobs: call },
  });
  render(<GpuJobsPanel projectDir="/project" />);
  fireEvent.click(screen.getByText(/RTX 5090 queue/));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Needs attention (2)' }),
  );
  expect(screen.getByRole('heading', { name: 'Failed shot' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Working shot' })).toBeNull();
  expect(screen.getByText('Long gateway validation details')).not.toBeVisible();
  fireEvent.click(screen.getByText('View job error', { exact: true }));
  expect(screen.getByText('Long gateway validation details')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Ready to save (1)' }));
  expect(
    screen.getByRole('button', { name: 'Save outputs locally' }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Saved locally (1)' }));
  expect(screen.getByRole('heading', { name: 'Saved shot' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Cancel job' })).toBeNull();
  expect(call).toHaveBeenCalledTimes(1);
});

it('preserves a recovery draft across filters and resets the view for another project', async () => {
  const call = jest.fn().mockResolvedValue({
    ok: true,
    jobs: [{ id: 'a'.repeat(64), workflow: 'Unknown shot', phase: 'unknown' }],
  });
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { queueJobs: call },
  });
  const view = render(<GpuJobsPanel projectDir="/first" />);
  fireEvent.click(screen.getByText(/RTX 5090 queue/));
  fireEvent.change(await screen.findByLabelText('Existing gateway job ID'), {
    target: { value: 'my-job' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Saved locally (0)' }));
  expect(screen.getByText('No jobs match this view.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Needs attention (1)' }));
  expect(screen.getByLabelText('Existing gateway job ID')).toHaveValue(
    'my-job',
  );
  view.rerender(<GpuJobsPanel projectDir="/second" />);
  expect(
    await screen.findByRole('button', { name: 'All jobs (1)' }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Existing gateway job ID')).toHaveValue('');
});
