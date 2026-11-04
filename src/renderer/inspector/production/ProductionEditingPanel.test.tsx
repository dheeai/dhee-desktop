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
  expect(
    screen.getByLabelText('Current voice preview').getAttribute('src'),
  ).toContain('current.wav');
  expect(
    screen.getByRole('heading', { name: 'Replacement candidate · not saved' }),
  ).not.toBeNull();
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
it('links scenes through preview/save and invalidates a preview after another image choice', async () => {
  const call = setup();
  const original = {
    title: 'Film',
    scenes: [{ narration: 'Words', action: 'Patient exits' }],
  };
  call.mockImplementation(async (req: any): Promise<any> => {
    if (req.action === 'artifact.read')
      return {
        ok: true,
        result:
          req.nodeId === 'scenes_plan'
            ? { text: JSON.stringify(original) }
            : { absolutePath: '/project/frame.png', sha256: 'hash' },
      };
    if (req.action === 'version.list')
      return { ok: true, result: { versions: [] } };
    if (req.action === 'input.preview')
      return {
        ok: true,
        result: {
          fingerprint: 'exact',
          downstream: [{ nodeId: 'scene_clip' }],
        },
      };
    return { ok: true, result: {} };
  });
  const linkedBundle: any = {
    fileInputs: [{ id: 'plan', path: 'inputs/scenes.json' }],
    nodes: [
      {
        id: 'scenes_plan',
        kind: 'stage',
        inputs: [{ from: 'frame' }],
        outputs: { format: 'json', pattern: 'inputs/scenes.json' },
      },
      {
        id: 'frame',
        kind: 'stage',
        displayName: 'Opening',
        outputs: { format: 'image', pattern: 'inputs/frame.png' },
      },
    ],
  };
  render(
    <ProductionEditingPanel projectDir="/project" bundle={linkedBundle} />,
  );
  fireEvent.change(screen.getByLabelText('Material'), {
    target: { value: 'plan' },
  });
  await screen.findByRole('option', { name: 'Opening' });
  fireEvent.change(screen.getByLabelText('Image for scene 1'), {
    target: { value: 'frame' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview change' }));
  await screen.findByRole('button', { name: 'Save this change' });
  expect(
    call.mock.calls.filter(([r]: any) => r.action === 'input.write'),
  ).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Image for scene 1'), {
    target: { value: '' },
  });
  expect(screen.queryByRole('button', { name: 'Save this change' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Image for scene 1'), {
    target: { value: 'frame' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview change' }));
  await screen.findByRole('button', { name: 'Save this change' });
  fireEvent.click(screen.getByRole('button', { name: 'Save this change' }));
  await screen.findByText(/Saved. Previous files/);
  const write = call.mock.calls.find(
    ([r]: any) => r.action === 'input.write',
  )?.[0] as any;
  expect(JSON.parse(write.payload.content)).toEqual({
    ...original,
    scenes: [{ ...original.scenes[0], imagePreviewKey: 'frame' }],
  });
  expect(write.expectedFingerprint).toBe('exact');
});
it('opens the exact editable image input from a scene, protects drafts, and returns to the storyboard', async () => {
  const call = setup();
  const original = {
    scenes: [{ narration: 'Words', imagePreviewKey: 'frame' }],
  };
  call.mockImplementation(async (req: any): Promise<any> => {
    if (req.action === 'artifact.read')
      return {
        ok: true,
        result:
          req.nodeId === 'scenes_plan'
            ? { text: JSON.stringify(original) }
            : { absolutePath: '/project/frame.png', sha256: 'hash' },
      };
    if (req.action === 'version.list')
      return { ok: true, result: { versions: [] } };
    return { ok: true, result: {} };
  });
  const imageBundle: any = {
    fileInputs: [
      { id: 'plan', path: 'inputs/scenes.json' },
      { id: 'image_input', path: 'inputs/frame.png' },
    ],
    nodes: [
      {
        id: 'scenes_plan',
        kind: 'stage',
        inputs: [{ from: 'frame' }],
        outputs: { format: 'json', pattern: 'inputs/scenes.json' },
      },
      {
        id: 'frame',
        kind: 'stage',
        displayName: 'Opening',
        outputs: { format: 'image', pattern: 'inputs/frame.png' },
      },
    ],
  };
  render(<ProductionEditingPanel projectDir="/project" bundle={imageBundle} />);
  fireEvent.change(screen.getByLabelText('Material'), {
    target: { value: 'plan' },
  });
  await screen.findByAltText('Selected scene reference');
  fireEvent.change(screen.getByLabelText('Image for scene 1'), {
    target: { value: '' },
  });
  expect(
    (
      screen.getByRole('button', {
        name: 'Edit Opening image file',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Script or storyboard text'), {
    target: { value: JSON.stringify(original) },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Replace image for scene 1' }),
  );
  await screen.findByRole('button', { name: 'Choose replacement file' });
  expect((screen.getByLabelText('Material') as HTMLSelectElement).value).toBe(
    'image_input',
  );
  expect(
    call.mock.calls.filter(
      ([r]: any) => r.action === 'input.write' || r.action === 'reference.pick',
    ),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Back to storyboard' }));
  await screen.findByLabelText('Image for scene 1');
  expect((screen.getByLabelText('Material') as HTMLSelectElement).value).toBe(
    'plan',
  );
});
it('keeps scene text edits as drafts and requires a fresh preview after a further edit', async () => {
  const call = setup();
  const original = {
    scenes: [
      {
        narration: 'Words',
        action: 'Patient exits',
        durationSec: 4,
        imagePreviewKey: 'frame',
      },
    ],
  };
  call.mockImplementation(async (req: any): Promise<any> => {
    if (req.action === 'artifact.read')
      return { ok: true, result: { text: JSON.stringify(original) } };
    if (req.action === 'version.list')
      return { ok: true, result: { versions: [] } };
    return {
      ok: true,
      result: {
        fingerprint: 'text-edit',
        downstream: [{ nodeId: 'scene_clip' }],
      },
    };
  });
  const plan: any = {
    fileInputs: [{ id: 'plan', path: 'inputs/scenes.json' }],
    nodes: [
      {
        id: 'scenes_plan',
        kind: 'stage',
        outputs: { format: 'json', pattern: 'inputs/scenes.json' },
      },
    ],
  };
  render(<ProductionEditingPanel projectDir="/project" bundle={plan} />);
  fireEvent.change(screen.getByLabelText('Material'), {
    target: { value: 'plan' },
  });
  await screen.findByLabelText('Narration for scene 1');
  fireEvent.change(screen.getByLabelText('Narration for scene 1'), {
    target: { value: 'Revised words' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview change' }));
  await screen.findByRole('button', { name: 'Save this change' });
  expect(
    call.mock.calls.filter(([r]: any) => r.action === 'input.write'),
  ).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Action for scene 1'), {
    target: { value: 'Doctor stays seated' },
  });
  expect(screen.queryByRole('button', { name: 'Save this change' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Preview change' }));
  await screen.findByRole('button', { name: 'Save this change' });
  fireEvent.click(screen.getByRole('button', { name: 'Save this change' }));
  await screen.findByText(/Saved. Previous files/);
  const write = call.mock.calls.find(
    ([r]: any) => r.action === 'input.write',
  )?.[0] as any;
  expect(JSON.parse(write.payload.content)).toEqual({
    scenes: [
      {
        ...original.scenes[0],
        narration: 'Revised words',
        action: 'Doctor stays seated',
      },
    ],
  });
  expect(write.expectedFingerprint).toBe('text-edit');
});
