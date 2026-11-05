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
it('shows automatic check failures alongside the creative review pause', async () => {
  setup({
    ok: true,
    result: {
      gatedAfter: 'review:rough-cut',
      deliveryReady: false,
      verification: {
        status: 'fail',
        deliveryReady: false,
        reportPath: 'audit.json',
        checks: [
          {
            id: 'voice:1',
            status: 'fail',
            detail: 'Narration timing differs',
            atSec: 4.4,
          },
        ],
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
  await screen.findByText(/Automatic check: fail/);
  expect(screen.getByText(/Narration timing differs/)).not.toBeNull();
  expect(
    screen.getByText(/Creative review required: rough-cut/),
  ).not.toBeNull();
  fireEvent.change(screen.getByLabelText('Assembly stage'), {
    target: { value: '' },
  });
  expect(screen.queryByText(/Automatic check: fail/)).toBeNull();
});
it('labels a missing automatic check and never substitutes success', async () => {
  setup({
    ok: true,
    result: {
      selectedOutput: {
        nodeId: 'final',
        outputRel: 'final.mp4',
        outputAbs: '/project/final.mp4',
      },
      verification: {
        status: 'not-configured',
        deliveryReady: false,
        reason: 'No automatic check is configured.',
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
  await screen.findByText(/Automatic check: not-configured/);
  expect(screen.getByText('No automatic check is configured.')).not.toBeNull();
});
it('keeps long findings collapsed with their status visible and full evidence available', async () => {
  const detail = 'Observed actor position. '.repeat(30);
  setup({
    ok: true,
    result: {
      verification: {
        status: 'review',
        deliveryReady: false,
        checks: [{ id: 'scene-meaning', status: 'unchecked', detail }],
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
  const evidence = await screen.findByText(
    (_, element) =>
      !!element?.textContent?.includes(detail.trim()) &&
      element.children.length === 0,
  );
  const disclosure = evidence.closest('details');
  expect(disclosure).not.toBeNull();
  expect(disclosure?.hasAttribute('open')).toBe(false);
  expect(disclosure?.querySelector('summary')?.textContent).toContain(
    'unchecked',
  );
});

it('distinguishes loading, failure and an empty assembly workflow', async () => {
  const call = setup();
  let resolve: (value: any) => void = () => {};
  call.mockImplementation(() => new Promise(r => { resolve = r; }));
  render(<AssemblyPanel projectDir="/project" />);
  expect(screen.getByText('Loading assembly stages…')).not.toBeNull();
  expect(screen.queryByText(/No assembly stages available/)).toBeNull();
  await act(async () => { resolve({ ok: false, error: 'Core unavailable' }); });
  expect(screen.queryByText('Loading assembly stages…')).toBeNull();
  expect(screen.queryByText(/No assembly stages available/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reload assembly' }));
  await act(async () => { resolve({ ok: true, result: { targets: [] } }); });
  expect(screen.getByText(/No assembly stages available/)).not.toBeNull();
});

it('invalidates assembly evidence when production materials change and ignores the old response', async () => {
  const call = setup();
  let finish: (value: any) => void = () => {};
  const original = call.getMockImplementation()!;
  call.mockImplementation((req: any) => req.action === 'assembly.targets' ? original(req) : new Promise(r => { finish = r; }));
  render(<AssemblyPanel projectDir="/project" />);
  await screen.findByRole('option', { name: /final/ });
  fireEvent.change(screen.getByLabelText('Assembly stage'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Assemble selected stage' }));
  act(() => window.dispatchEvent(new CustomEvent('dhee:production-changed', { detail: { projectDir: '/project' } })));
  await screen.findByRole('option', { name: /final/ });
  await act(async () => { finish({ok: true, result: { selectedOutput: {outputRel: 'stale.mov'}, verification: { status: 'review', checks: [] } }}); });
  expect(screen.queryByText(/stale.mov/)).toBeNull();
  expect(screen.queryByText(/Automatic check:/)).toBeNull();
  expect((screen.getByRole('button', {name:'Assemble selected stage'}) as HTMLButtonElement).disabled).toBe(true);
});

it('summarizes passed, failed and unresolved checks without granting approval', async () => {
  setup({ok:true,result:{gatedAfter:'review:rough-cut',verification:{status:'fail',deliveryReady:false,checks:[
    {id:'decode',status:'pass',detail:'Decoded'}, {id:'voice',status:'fail',detail:'Wrong voice'}, {id:'visual',status:'unchecked',detail:'No service'},
  ]}}});
  render(<AssemblyPanel projectDir="/project" />);
  await screen.findByRole('option', {name:/final/});
  fireEvent.change(screen.getByLabelText('Assembly stage'), {target:{value:'0'}});
  fireEvent.click(screen.getByRole('button', {name:'Assemble selected stage'}));
  expect(await screen.findByText('1 passed · 1 failed · 1 unchecked')).not.toBeNull();
  expect(screen.getByText(/Delivery is not approved/)).not.toBeNull();
});
