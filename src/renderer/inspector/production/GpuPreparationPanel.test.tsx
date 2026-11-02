import '@testing-library/jest-dom';
import { it, expect, jest } from '@jest/globals';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { GpuPreparationPanel } from './GpuPreparationPanel';

const target = {
  nodeId: 'scene_clip',
  itemId: 'scene_1',
  format: 'video',
  status: 'pending',
  tool: 'comfy.test',
  selectionId: null,
  unsupported: false,
};
const workflow = {
  name: 'video',
  version: 'v1',
  available: true,
  status: 'unchecked',
  description: 'video generation',
  inputs: {
    prompt: { type: 'string', required: true },
    refs: { type: 'file_list' },
    duration: { type: 'int', default: 5 },
    seed: { type: 'int', required: true, random_default: true },
  },
};
function setup() {
  const call = jest.fn(async (req: any): Promise<any> => {
    if (req.action === 'gpu.catalog')
      return { ok: true, result: { workflows: [workflow] } };
    if (req.action === 'gpu.prepare')
      return {
        ok: true,
        result: { selectionId: 'saved', attemptKey: 'attempt' },
      };
    return {
      ok: true,
      result: { targets: [target], branches: [{ branchId: 'main' }] },
    };
  });
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { gpuPreparation: call },
  });
  Object.defineProperty(window.crypto, 'randomUUID', {
    configurable: true,
    value: () => 'test-request-1234',
  });
  return call;
}
it('prepares explicit catalog inputs and never starts generation', async () => {
  const call = setup();
  render(<GpuPreparationPanel projectDir="/project" />);
  await screen.findByRole('option', { name: /scene_clip/ });
  fireEvent.change(screen.getByLabelText('Scene or reference'), {
    target: { value: JSON.stringify(['scene_clip', 'scene_1']) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Load workflows' }));
  await screen.findByRole('option', { name: /video · v1/ });
  fireEvent.change(screen.getByLabelText('Workflow'), {
    target: { value: 'video' },
  });
  fireEvent.change(screen.getByLabelText('prompt *'), {
    target: { value: 'Storyboard scene one' },
  });
  fireEvent.change(screen.getByLabelText('refs'), {
    target: { value: 'references/a.png\nreferences/b.png' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Save generation attempt' }),
  );
  await screen.findByText(/Attempt saved/);
  expect(call).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'gpu.prepare',
      nodeId: 'scene_clip',
      itemId: 'scene_1',
      workflowVersion: 'v1',
      inputs: {
        prompt: 'Storyboard scene one',
        refs: ['references/a.png', 'references/b.png'],
        duration: 5,
      },
      requestId: 'test-request-1234',
    }),
  );
  expect(call.mock.calls.some(([req]) => req.action === 'project.run')).toBe(
    false,
  );
});
it('keeps a failed save retry on the same request identity', async () => {
  const call = setup();
  let attempts = 0;
  call.mockImplementation(async (req: any) => {
    if (req.action === 'gpu.catalog')
      return { ok: true, result: { workflows: [workflow] } };
    if (req.action === 'gpu.prepare') {
      attempts += 1;
      if (attempts === 1) throw new Error('reply lost');
      return { ok: true, result: { selectionId: 'saved' } };
    }
    return {
      ok: true,
      result: { targets: [target], branches: [{ branchId: 'main' }] },
    };
  });
  render(<GpuPreparationPanel projectDir="/project" />);
  await screen.findByRole('option', { name: /scene_clip/ });
  fireEvent.change(screen.getByLabelText('Scene or reference'), {
    target: { value: JSON.stringify(['scene_clip', 'scene_1']) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Load workflows' }));
  await screen.findByRole('option', { name: /video · v1/ });
  fireEvent.change(screen.getByLabelText('Workflow'), {
    target: { value: 'video' },
  });
  fireEvent.change(screen.getByLabelText('prompt *'), {
    target: { value: 'scene' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Save generation attempt' }),
  );
  await screen.findByText('reply lost');
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Save generation attempt' })
        .matches(':disabled'),
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Save generation attempt' }),
  );
  await screen.findByText(/Attempt saved/);
  const saves = call.mock.calls.filter(([req]) => req.action === 'gpu.prepare');
  expect(saves[0][0].requestId).toBe(saves[1][0].requestId);
});

it('ignores a late target response after switching projects', async () => {
  const call = setup();
  let finish: (value: any) => void = () => {};
  call.mockImplementation(async (req: any) => {
    if (req.projectDir === '/first')
      return new Promise((resolve) => {
        finish = resolve;
      });
    return {
      ok: true,
      result: {
        targets: [{ ...target, nodeId: 'second_clip' }],
        branches: [{ branchId: 'main' }],
      },
    };
  });
  const view = render(<GpuPreparationPanel projectDir="/first" />);
  view.rerender(<GpuPreparationPanel projectDir="/second" />);
  await screen.findByRole('option', { name: /second_clip/ });
  await act(async () => finish({ ok: true, result: { targets: [target] } }));
  expect(screen.queryByRole('option', { name: /scene_clip/ })).toBeNull();
});

it('runs only the saved target and reports a creative pause without claiming completion', async () => {
  const call = setup();
  call.mockImplementation(async (req: any) =>
    req.action === 'gpu.run'
      ? { ok: true, result: { gatedAfter: 'review:references' } }
      : {
          ok: true,
          result: {
            targets: [
              {
                ...target,
                tool: 'gpu.queue',
                selectionId: 'saved',
                selection: {
                  workflow: 'video',
                  workflowVersion: 'v1',
                  preparationFingerprint: 'fingerprint',
                },
              },
            ],
            branches: [{ branchId: 'main' }],
          },
        },
  );
  render(<GpuPreparationPanel projectDir="/project" />);
  await screen.findByRole('option', { name: /scene_clip/ });
  fireEvent.change(screen.getByLabelText('Scene or reference'), {
    target: { value: JSON.stringify(['scene_clip', 'scene_1']) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Run saved attempt' }));
  await screen.findByText(/Approval required: references/);
  expect(call).toHaveBeenCalledWith({
    action: 'gpu.run',
    projectDir: '/project',
    branchId: 'main',
    nodeId: 'scene_clip',
    itemId: 'scene_1',
    expectedSelectionId: 'saved',
  });
  expect(screen.queryByText(/Selected output is ready/)).toBeNull();
});

it('allows resuming the saved attempt after interrupted in-progress work but forbids replacement', async () => {
  const call = setup();
  call.mockImplementation(async () => ({
    ok: true,
    result: {
      targets: [
        {
          ...target,
          status: 'in_progress',
          selectionId: 'saved',
          tool: 'gpu.queue',
          selection: {
            preparationFingerprint: 'fingerprint',
            workflow: 'video',
          },
        },
      ],
      branches: [{ branchId: 'main' }],
    },
  }));
  render(<GpuPreparationPanel projectDir="/project" />);
  await screen.findByRole('option', { name: /scene_clip/ });
  fireEvent.change(screen.getByLabelText('Scene or reference'), {
    target: { value: JSON.stringify(['scene_clip', 'scene_1']) },
  });
  expect(
    screen
      .getByRole('button', { name: 'Run saved attempt' })
      .matches(':disabled'),
  ).toBe(false);
  expect(
    screen
      .getByRole('button', { name: 'Save generation attempt' })
      .matches(':disabled'),
  ).toBe(true);
});

it('clears running feedback when the saved attempt fails', async () => {
  const call = setup();
  call.mockImplementation(async (req: any) =>
    req.action === 'gpu.run'
      ? { ok: false, error: 'Gateway unavailable' }
      : {
          ok: true,
          result: {
            targets: [
              {
                ...target,
                selectionId: 'saved',
                tool: 'gpu.queue',
                selection: { preparationFingerprint: 'fingerprint' },
              },
            ],
            branches: [{ branchId: 'main' }],
          },
        },
  );
  render(<GpuPreparationPanel projectDir="/project" />);
  await screen.findByRole('option', { name: /scene_clip/ });
  fireEvent.change(screen.getByLabelText('Scene or reference'), {
    target: { value: JSON.stringify(['scene_clip', 'scene_1']) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Run saved attempt' }));
  await screen.findByText('Gateway unavailable');
  expect(screen.queryByText(/Running the saved attempt/)).toBeNull();
});
