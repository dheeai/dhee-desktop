import '@testing-library/jest-dom';
import { expect, it, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProductionEditingPanel } from './ProductionEditingPanel';
const bundle: any = {
  fileInputs: [{ id: 'brief', path: 'inputs/story.md' }],
  nodes: [
    {
      id: 'story',
      kind: 'stage',
      displayName: 'Storyboard',
      outputs: { format: 'md', pattern: 'inputs/story.md' },
    },
  ],
};
function setup() {
  const call = jest.fn(async (req: any): Promise<any> => {
    if (req.action === 'version.list')
      return {
        ok: true,
        result: {
          versions: [
            {
              versionId: 'old',
              path: 'inputs/story.v1.md',
              available: true,
              kind: 'preserved',
              selected: false,
            },
          ],
        },
      };
    if (req.action === 'artifact.read')
      return { ok: true, result: { text: 'Original script' } };
    if (req.action.endsWith('Preview') || req.action === 'input.preview')
      return {
        ok: true,
        result: {
          fingerprint: 'exact',
          downstream: [{ nodeId: 'scene_clip' }],
        },
      };
    return { ok: true, result: { started: false } };
  });
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { productionEditing: call },
  });
  return call;
}
it('requires preview and explicit save, and clears preview when the draft changes', async () => {
  const call = setup();
  render(<ProductionEditingPanel projectDir="/project" bundle={bundle} />);
  fireEvent.change(screen.getByLabelText('Material'), {
    target: { value: 'brief' },
  });
  await screen.findByDisplayValue('Original script');
  fireEvent.change(screen.getByLabelText('Script or storyboard text'), {
    target: { value: 'Revised' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview change' }));
  await screen.findByText('scene clip');
  expect(
    call.mock.calls.filter(([r]: any) => r.action === 'input.write'),
  ).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Script or storyboard text'), {
    target: { value: 'Revised again' },
  });
  expect(screen.queryByRole('button', { name: 'Save this change' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Preview change' }));
  await screen.findByRole('button', { name: 'Save this change' });
  fireEvent.click(screen.getByRole('button', { name: 'Save this change' }));
  await screen.findByText(/Saved. Previous files/);
  expect(call).toHaveBeenCalledWith({
    action: 'input.write',
    projectDir: '/project',
    inputId: 'brief',
    payload: { kind: 'text', content: 'Revised again' },
    expectedFingerprint: 'exact',
    humanAcknowledged: true,
  });
});
it('previews a history restore and only writes after confirmation', async () => {
  const call = setup();
  render(<ProductionEditingPanel projectDir="/project" bundle={bundle} />);
  fireEvent.change(screen.getByLabelText('Material'), {
    target: { value: 'brief' },
  });
  await screen.findByDisplayValue('Original script');
  fireEvent.change(screen.getByLabelText('Saved version'), {
    target: { value: 'old' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview restore' }));
  await screen.findByRole('button', { name: 'Restore this version' });
  expect(
    call.mock.calls.filter(([r]: any) => r.action === 'version.restore'),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
  await screen.findByText(/Saved. Previous files/);
  expect(call).toHaveBeenCalledWith({
    action: 'version.restore',
    projectDir: '/project',
    nodeId: 'story',
    versionId: 'old',
    expectedFingerprint: 'exact',
    humanAcknowledged: true,
  });
});
it('keeps replacement preview separate from inspected history and clears history on selection changes', async () => {
  const call = setup();
  call.mockImplementation(async (req: any): Promise<any> => {
    if (req.action === 'version.list')
      return {
        ok: true,
        result: {
          versions: [
            { versionId: 'a', path: 'a.wav', available: true },
            { versionId: 'b', path: 'b.wav', available: true },
          ],
        },
      };
    if (req.action === 'reference.pick')
      return {
        ok: true,
        result: {
          payload: {
            kind: 'localFile',
            sourcePath: '/replacement.wav',
            expectedSha256: 'new',
          },
        },
      };
    if (req.action === 'artifact.read')
      return {
        ok: true,
        result: {
          absolutePath: req.versionId ? '/history.wav' : '/current.wav',
          sha256: 'hash',
        },
      };
    return { ok: true, result: { fingerprint: 'exact', downstream: [] } };
  });
  render(
    <ProductionEditingPanel
      projectDir="/project"
      bundle={{
        ...bundle,
        nodes: [
          {
            ...bundle.nodes[0],
            outputs: { format: 'audio', pattern: 'inputs/story.md' },
          },
        ],
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText('Material'), {
    target: { value: 'brief' },
  });
  await screen.findByLabelText('Reference preview');
  fireEvent.click(
    screen.getByRole('button', { name: 'Choose replacement file' }),
  );
  await screen.findByText('Replacement: replacement.wav');
  fireEvent.change(screen.getByLabelText('Saved version'), {
    target: { value: 'a' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Inspect saved version' }),
  );
  await screen.findByLabelText('Saved version preview');
  expect(
    screen.getByLabelText('Reference preview').getAttribute('src'),
  ).toContain('replacement.wav');
  fireEvent.change(screen.getByLabelText('Saved version'), {
    target: { value: 'b' },
  });
  expect(screen.queryByLabelText('Saved version preview')).toBeNull();
});
