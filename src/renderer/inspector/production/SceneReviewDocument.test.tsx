import { expect, it } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SceneReviewDocument } from './SceneReviewDocument';

it('shows every scene in order with narration, action and a complete duration total', () => {
  const scenes = Array.from({ length: 7 }, (_, i) => ({
    id: `scene_${i + 1}`,
    durationSec: 4,
    narration: `Line ${i + 1}`,
    action: `Action ${i + 1}`,
  }));
  render(
    <SceneReviewDocument
      images={[]}
      content={JSON.stringify({
        scenes,
        sourceHashes: { voice: 'hash-value' },
      })}
      outputPath="scenes.json"
    />,
  );
  const cards = screen.getAllByRole('article');
  expect(cards).toHaveLength(7);
  expect(within(cards[6]).getByText('Line 7')).not.toBeNull();
  expect(screen.getByText('28s planned')).not.toBeNull();
  expect(screen.getByText(/hash-value/).closest('details')).not.toBeNull();
});
it('does not invent missing narration or a total when scene timing is incomplete', () => {
  render(
    <SceneReviewDocument
      images={[]}
      content={JSON.stringify({
        scenes: [
          { durationSec: -1, action: 'Doctor stays seated.' },
          { narration: 'Next line' },
        ],
      })}
      outputPath="scenes.json"
    />,
  );
  expect(screen.getByText('Narration not provided')).not.toBeNull();
  expect(screen.getByText('Action not provided')).not.toBeNull();
  expect(screen.queryByText(/s planned/)).toBeNull();
  expect(screen.getAllByText('Timing not set')).toHaveLength(2);
});
it('keeps unsupported data readable instead of pretending it is a scene plan', () => {
  render(
    <SceneReviewDocument
      images={[]}
      content={JSON.stringify({
        scenes: 'not an array',
        note: 'Original source',
      })}
      outputPath="other.json"
    />,
  );
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  expect(screen.getByText('Original source')).not.toBeNull();
});

it('uses only an explicit unique review image key and reports failed images', () => {
  const content = JSON.stringify({
    scenes: [
      { imagePreviewKey: 'frame-one', narration: 'Opening' },
      { image: 'https://untrusted.invalid/guess.png', narration: 'No binding' },
    ],
  });
  render(
    <SceneReviewDocument
      images={[{ key: 'frame-one', src: 'file:///saved/frame.png' }]}
      content={content}
      outputPath="scenes.json"
    />,
  );
  const image = screen.getByRole('img', { name: 'Scene 1 storyboard frame' });
  expect(image.getAttribute('src')).toBe('file:///saved/frame.png');
  expect(screen.getAllByRole('img')).toHaveLength(1);
  expect(screen.getByText('No linked storyboard frame')).not.toBeNull();
  fireEvent.error(image);
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText('Storyboard frame unavailable')).not.toBeNull();
});
it('does not choose between ambiguous image keys', () => {
  render(
    <SceneReviewDocument
      images={[
        { key: 'same', src: 'file:///one.png' },
        { key: 'same', src: 'file:///two.png' },
      ]}
      content={JSON.stringify({ scenes: [{ imagePreviewKey: 'same' }] })}
      outputPath="scenes.json"
    />,
  );
  expect(screen.queryByRole('img')).toBeNull();
});
