import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, jest } from '@jest/globals';
import type { TimelineItem } from '../../../hooks/useTimelineData';
import ShotRegenerateModal from './ShotRegenerateModal';

const shotItem: TimelineItem = {
  id: 'segment_2_shot_1',
  type: 'image',
  startTime: 0,
  endTime: 4,
  duration: 4,
  label: 'Shot 1',
  sourceType: 'server_timeline',
  sceneNumber: 3,
  shotNumber: 1,
  segmentId: 'segment_2_shot_1',
  prompt: 'Original shot prompt',
  mediaTypeContext: 'image',
  mediaPathContext: 'assets/images/scene-3-shot-1.png',
};

describe('ShotRegenerateModal', () => {
  it('renders shot context and the existing prompt', () => {
    render(
      <ShotRegenerateModal
        item={shotItem}
        isOpen
        onClose={jest.fn()}
        onSubmit={jest.fn() as (prompt: string) => void}
      />,
    );

    expect(screen.queryByText('Regenerate Scene 3 Shot 1')).not.toBeNull();
    expect(screen.queryByDisplayValue('Original shot prompt')).not.toBeNull();
    expect(screen.queryByText(/Segment ID: segment_2_shot_1/)).not.toBeNull();
  });

  it('submits the edited prompt directly', () => {
    const onSubmit = jest.fn<(prompt: string) => void>();

    render(
      <ShotRegenerateModal
        item={shotItem}
        isOpen
        onClose={jest.fn()}
        onSubmit={onSubmit}
      />,
    );

    const textarea = screen.getByLabelText('Shot Prompt');
    fireEvent.change(textarea, { target: { value: 'Edited modal prompt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSubmit).toHaveBeenCalledWith('Edited modal prompt');
  });
});
