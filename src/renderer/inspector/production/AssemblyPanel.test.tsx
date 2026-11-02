/* eslint-disable compat/compat -- Electron test runtime supports Promise. */
import '@testing-library/jest-dom';
import { expect, it, jest } from '@jest/globals';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AssemblyPanel } from './AssemblyPanel';

function setup(
  runResult: any = { ok: true, result: { gatedAfter: 'review:rough-cut' } },
) {
  const assembly = jest.fn(
    async (req: any): Promise<any> =>
      req.action === 'assembly.targets'
        ? {
            ok: true,
            result: {
              targets: [
                {
                  nodeId: 'final',
                  tool: 'ffmpeg.concat',
                  selectionId: null,
                  status: 'pending',
                },
              ],
              branches: [{ branchId: 'main' }],
            },
          }
        : runResult,
  );
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { assembly },
  });
  return assembly;
}
it('runs only the explicit pinned stage and shows review pauses without claiming delivery', async () => {
  const call = setup();
  render(<AssemblyPanel projectDir="/project" />);
  await screen.findByRole('option', { name: /final/ });
  expect(call).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Assembly stage'), {
    target: { value: '0' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Assemble selected stage' }),
  );
  await screen.findByText(/Creative review required: rough-cut/);
  expect(call).toHaveBeenLastCalledWith({
    action: 'assembly.run',
    projectDir: '/project',
    branchId: 'main',
    nodeId: 'final',
    itemId: undefined,
    expectedSelectionId: null,
  });
});
it('shows output as needing delivery checks', async () => {
  setup({
    ok: true,
    result: {
      selectedOutput: {
        nodeId: 'final',
        outputRel: 'final.mp4',
        outputAbs: '/project/final.mp4',
      },
    },
  });
  render(<AssemblyPanel projectDir="/project" />);
  await screen.findByRole('option', { name: /final/ });
  fireEvent.change(screen.getByLabelText('Assembly stage'), {
    target: { value: '0' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Assemble selected stage' }),
  );
  await screen.findByText(/Assembly available: final.mp4/);
  expect(screen.queryByText('Delivery ready')).toBeNull();
});

it('clears running feedback on failure and permits retry', async () => {
  setup({ ok: false, error: 'Prerequisite clip is incomplete.' });
  render(<AssemblyPanel projectDir="/project" />);
  await screen.findByRole('option', { name: /final/ });
  fireEvent.change(screen.getByLabelText('Assembly stage'), {
    target: { value: '0' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Assemble selected stage' }),
  );
  await screen.findByText('Prerequisite clip is incomplete.');
  expect(screen.queryByText('Assembling selected stage…')).toBeNull();
  expect(
    (
      screen.getByRole('button', {
        name: 'Assemble selected stage',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});
it('discards an old assembly result after switching projects', async () => {
  let finish: (result: any) => void = () => {};
  const call = setup();
  call.mockImplementation(
    async (req: any): Promise<any> =>
      req.action === 'assembly.targets'
        ? {
            ok: true,
            result: {
              targets: [
                {
                  nodeId: 'final',
                  tool: 'ffmpeg.concat',
                  selectionId: null,
                  status: 'pending',
                },
              ],
            },
          }
        : new Promise((resolve) => {
            finish = resolve;
          }),
  );
  const view = render(<AssemblyPanel projectDir="/first" />);
  await screen.findByRole('option', { name: /final/ });
  fireEvent.change(screen.getByLabelText('Assembly stage'), {
    target: { value: '0' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Assemble selected stage' }),
  );
  view.rerender(<AssemblyPanel projectDir="/second" />);
  await screen.findByRole('option', { name: /final/ });
  await act(async () => {
    finish({ ok: true, result: { selectedOutput: { outputRel: 'old.mp4' } } });
  });
  expect(screen.queryByText(/old.mp4/)).toBeNull();
});
it('identifies narration replacement and explains removal of generated audio', async () => {
  const call = setup();
  call.mockResolvedValue({
    ok: true,
    result: {
      targets: [
        {
          nodeId: 'narrated',
          tool: 'ffmpeg.replace_audio',
          selectionId: 'audio-selection',
          status: 'pending',
        },
      ],
    },
  });
  render(<AssemblyPanel projectDir="/project" />);
  await screen.findByRole('option', { name: /narrated.*Preserve narration/ });
  fireEvent.change(screen.getByLabelText('Assembly stage'), {
    target: { value: '0' },
  });
  expect(await screen.findByText(/Generated audio is removed/)).not.toBeNull();
});
it('identifies normalization with explicit edit guidance', async () => {
  const call = setup();
  call.mockResolvedValue({
    ok: true,
    result: {
      targets: [
        {
          nodeId: 'normalized',
          tool: 'ffmpeg.normalize',
          selectionId: null,
          status: 'pending',
        },
      ],
    },
  });
  render(<AssemblyPanel projectDir="/project" />);
  await screen.findByRole('option', { name: /normalized.*Normalize clip/ });
  fireEvent.change(screen.getByLabelText('Assembly stage'), {
    target: { value: '0' },
  });
  expect(await screen.findByText(/Trimming removes the tail/)).not.toBeNull();
});
