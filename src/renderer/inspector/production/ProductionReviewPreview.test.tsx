/* eslint-disable compat/compat -- Electron supports native Promise. */
import { beforeEach, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProductionReviewPreview } from './ProductionReviewPreview';

const read = jest.fn<any>();
const preview = {
  key: 'story',
  versionId: 'v1',
  previewPath: 'old.md',
  format: 'md' as const,
};
beforeEach(() => {
  read.mockReset();
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { project: { readFile: read } },
  });
});
it('does not count a missing or empty script as loaded for review', async () => {
  read.mockResolvedValue('   ');
  const onLoaded = jest.fn();
  render(
    <ProductionReviewPreview
      projectDir="/project"
      preview={preview}
      onLoaded={onLoaded}
    />,
  );
  await screen.findByRole('alert');
  expect(onLoaded).not.toHaveBeenCalledWith('story', true);
  expect(onLoaded).toHaveBeenCalledWith('story', false);
});
it('clears a previous load error when a new version loads', async () => {
  read
    .mockRejectedValueOnce(Error('missing'))
    .mockResolvedValueOnce('New storyboard');
  const onLoaded = jest.fn();
  const view = render(
    <ProductionReviewPreview
      projectDir="/project"
      preview={preview}
      onLoaded={onLoaded}
    />,
  );
  await screen.findByRole('alert');
  view.rerender(
    <ProductionReviewPreview
      projectDir="/project"
      preview={{ ...preview, versionId: 'v2', previewPath: 'new.md' }}
      onLoaded={onLoaded}
    />,
  );
  await screen.findAllByText('New storyboard');
  expect(screen.queryByRole('alert')).toBeNull();
});
it('removes old text while a different version is loading', async () => {
  read
    .mockResolvedValueOnce('Old storyboard')
    .mockImplementationOnce(() => new Promise(() => {}));
  const onLoaded = jest.fn();
  const view = render(
    <ProductionReviewPreview
      projectDir="/project"
      preview={preview}
      onLoaded={onLoaded}
    />,
  );
  await screen.findAllByText('Old storyboard');
  view.rerender(
    <ProductionReviewPreview
      projectDir="/project"
      preview={{ ...preview, versionId: 'v2', previewPath: 'new.md' }}
      onLoaded={onLoaded}
    />,
  );
  await waitFor(() =>
    expect(screen.queryAllByText('Old storyboard')).toHaveLength(0),
  );
  expect(onLoaded).toHaveBeenLastCalledWith('story', false);
});
it('renders the exact saved script snapshot as readable prose with source available', async () => {
  const source = '# Opening\n\nA **doctor** stays seated.';
  read.mockResolvedValue(source);
  render(
    <ProductionReviewPreview
      projectDir="/project"
      preview={preview}
      onLoaded={jest.fn()}
    />,
  );
  // The repository maps Markdown to a text stub; verify the snapshot is supplied
  // to the readable surface separately from the exact-source disclosure.
  await screen.findByText(
    (_, element) =>
      element?.tagName === 'SPAN' && element.textContent === source,
  );
  expect(
    screen
      .getByText(
        (_, element) =>
          element?.tagName === 'PRE' && element.textContent === source,
      )
      .closest('details'),
  ).not.toBeNull();
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith('/project/old.md');
});
it('renders storyboard fields without reading a newer working artifact', async () => {
  read.mockResolvedValue(
    JSON.stringify({
      scenes: [
        {
          id: 'scene_1',
          narration: "A doctor's visit ends.",
          action: 'Doctor stays seated; patient exits.',
        },
      ],
    }),
  );
  render(
    <ProductionReviewPreview
      projectDir="/project"
      preview={{ ...preview, format: 'json', previewPath: 'snapshot.json' }}
      onLoaded={jest.fn()}
    />,
  );
  await screen.findByText('Doctor stays seated; patient exits.');
  expect(screen.getByText('Narration')).not.toBeNull();
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith('/project/snapshot.json');
});

it('keeps loaded media eligible when the same snapshot is returned as a new object', () => {
  const onLoaded = jest.fn();
  const mediaPreview = {
    ...preview,
    format: 'image' as const,
    previewPath: 'image.png',
  };
  const view = render(
    <ProductionReviewPreview
      projectDir="/project"
      preview={mediaPreview}
      onLoaded={onLoaded}
    />,
  );
  fireEvent.load(screen.getByRole('img'));
  expect(onLoaded).toHaveBeenLastCalledWith('story', true);
  onLoaded.mockClear();
  view.rerender(
    <ProductionReviewPreview
      projectDir="/project"
      preview={{ ...mediaPreview }}
      onLoaded={onLoaded}
    />,
  );
  expect(onLoaded).not.toHaveBeenCalledWith('story', false);
  view.rerender(
    <ProductionReviewPreview
      projectDir="/project"
      preview={{ ...mediaPreview, versionId: 'v2', previewPath: 'new.png' }}
      onLoaded={onLoaded}
    />,
  );
  expect(onLoaded).toHaveBeenLastCalledWith('story', false);
  fireEvent.load(screen.getByRole('img'));
  expect(onLoaded).toHaveBeenLastCalledWith('story', true);
});
