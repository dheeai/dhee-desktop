/* eslint-disable compat/compat, react/jsx-props-no-spreading -- Electron promises and reusable test props. */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { SceneImageLinkEditor } from './SceneImageLinkEditor';

const bundle: any = {
  nodes: [
    {
      id: 'scenes_plan',
      kind: 'stage',
      inputs: [{ from: 'frame' }],
      outputs: { format: 'json' },
    },
    {
      id: 'frame',
      kind: 'stage',
      displayName: 'Opening reference',
      outputs: { format: 'image' },
    },
    { id: 'unrelated', kind: 'stage', outputs: { format: 'image' } },
  ],
};
const content = JSON.stringify({
  title: 'Film',
  extra: { keep: true },
  scenes: [{ id: 's1', narration: 'Words', action: 'Stay seated', custom: 7 }],
});
const api = jest.fn();
beforeEach(() => {
  api.mockReset().mockResolvedValue({
    ok: true,
    result: { absolutePath: '/project/frame.png', sha256: 'hash' },
  });
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { productionEditing: api },
  });
});
it('offers only upstream images without inferring a selection and preserves all other data', async () => {
  const change = jest.fn();
  render(
    <SceneImageLinkEditor
      projectDir="/project"
      nodeId="scenes_plan"
      bundle={bundle}
      content={content}
      onChange={change}
    />,
  );
  const select = await screen.findByLabelText('Image for scene 1');
  await screen.findByRole('option', { name: 'Opening reference' });
  expect(select).toHaveValue('');
  expect(api).toHaveBeenCalledTimes(1);
  expect(api).toHaveBeenCalledWith({
    action: 'artifact.read',
    projectDir: '/project',
    nodeId: 'frame',
  });
  fireEvent.change(select, { target: { value: 'frame' } });
  expect(JSON.parse(change.mock.calls[0][0])).toEqual({
    ...JSON.parse(content),
    scenes: [{ ...JSON.parse(content).scenes[0], imagePreviewKey: 'frame' }],
  });
});
it('supports unlinking while retaining unavailable saved links until explicitly changed', async () => {
  api.mockResolvedValue({ ok: false, error: 'Reference missing' });
  const change = jest.fn();
  const linked = JSON.stringify({
    scenes: [{ imagePreviewKey: 'old', narration: 'Words' }],
  });
  render(
    <SceneImageLinkEditor
      projectDir="/project"
      nodeId="scenes_plan"
      bundle={bundle}
      content={linked}
      onChange={change}
    />,
  );
  await screen.findByText(/Reference missing/);
  expect(screen.getByLabelText('Image for scene 1')).toHaveValue('old');
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Image for scene 1'), {
    target: { value: '' },
  });
  expect(JSON.parse(change.mock.calls[0][0])).toEqual({
    scenes: [{ narration: 'Words' }],
  });
});
it('does not accept an old project image after switching projects', async () => {
  let oldResolve: any;
  api.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        oldResolve = resolve;
      }),
  );
  const props = {
    nodeId: 'scenes_plan',
    bundle,
    content: JSON.stringify({ scenes: [{ imagePreviewKey: 'frame' }] }),
    onChange: jest.fn(),
  };
  const view = render(<SceneImageLinkEditor {...props} projectDir="/old" />);
  view.rerender(<SceneImageLinkEditor {...props} projectDir="/new" />);
  await screen.findByRole('option', { name: 'Opening reference' });
  await act(async () => {
    oldResolve({
      ok: true,
      result: { absolutePath: '/old/wrong.png', sha256: 'old' },
    });
  });
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  expect(screen.getByAltText('Selected scene reference')).toHaveAttribute(
    'src',
    'file:///project/frame.png?v=hash',
  );
  fireEvent.change(screen.getByLabelText('Image for scene 1'), {
    target: { value: 'frame' },
  });
  expect(props.onChange).toHaveBeenCalledTimes(1);
});
it('explains missing image inputs and does not offer unrelated images', () => {
  render(
    <SceneImageLinkEditor
      projectDir="/project"
      nodeId="story"
      bundle={bundle}
      content={content}
      onChange={jest.fn()}
    />,
  );
  expect(screen.getByText(/no upstream image inputs/i)).toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});

it('leaves malformed JSON for raw editing and does not fetch image references', () => {
  const { container } = render(
    <SceneImageLinkEditor
      projectDir="/project"
      nodeId="scenes_plan"
      bundle={bundle}
      content="{"
      onChange={jest.fn()}
    />,
  );
  expect(container).toBeEmptyDOMElement();
  expect(api).not.toHaveBeenCalled();
});
it('edits narration and action without changing timing, references, metadata or other scenes', () => {
  const original = {
    title: 'Film',
    scenes: [
      {
        id: 's1',
        narration: 'Old',
        action: 'Patient exits',
        durationSec: 4,
        imagePreviewKey: 'frame',
        custom: { keep: true },
      },
      { id: 's2', narration: 'Next' },
    ],
  };
  const change = jest.fn();
  render(
    <SceneImageLinkEditor
      projectDir="/project"
      nodeId="scenes_plan"
      bundle={null}
      content={JSON.stringify(original)}
      onChange={change}
    />,
  );
  fireEvent.change(screen.getByLabelText('Narration for scene 1'), {
    target: { value: 'New narration' },
  });
  expect(JSON.parse(change.mock.calls[0][0])).toEqual({
    ...original,
    scenes: [
      { ...original.scenes[0], narration: 'New narration' },
      original.scenes[1],
    ],
  });
  fireEvent.change(screen.getByLabelText('Action for scene 1'), {
    target: { value: 'Doctor stays seated' },
  });
  expect(JSON.parse(change.mock.calls[1][0])).toEqual({
    ...original,
    scenes: [
      { ...original.scenes[0], action: 'Doctor stays seated' },
      original.scenes[1],
    ],
  });
});
it('edits legacy picture in place and preserves structured narration for source editing', () => {
  const original = {
    scenes: [
      {
        picture: 'Old action',
        narration: { speaker: 'Doctor', text: 'Hello' },
      },
    ],
  };
  const change = jest.fn();
  render(
    <SceneImageLinkEditor
      projectDir="/project"
      nodeId="scenes_plan"
      bundle={null}
      content={JSON.stringify(original)}
      onChange={change}
    />,
  );
  expect(
    screen.getByText(/Narration uses structured data/),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText('Narration for scene 1')).toBeNull();
  fireEvent.change(screen.getByLabelText('Action for scene 1'), {
    target: { value: 'Correct action' },
  });
  expect(JSON.parse(change.mock.calls[0][0])).toEqual({
    scenes: [{ ...original.scenes[0], picture: 'Correct action' }],
  });
});
