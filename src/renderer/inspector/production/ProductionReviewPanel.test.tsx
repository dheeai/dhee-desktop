import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProductionReviewPanel } from './ProductionReviewPanel';
import type { ReviewCheckpoint } from '../../lib/runCockpit/productionReview';

const checkpoint: ReviewCheckpoint = {
  id: 'storyboard',
  title: 'Script & storyboard',
  status: 'incomplete',
  items: [
    { id: 'story', label: 'Script', status: 'ready', sectionId: 'story' },
    { id: 'scenes_plan', label: 'Scene plan', status: 'missing' },
  ],
};
describe('ProductionReviewPanel', () => {
  it('navigates only to existing sections and explains approval limits', () => {
    const navigate = jest.fn();
    render(
      <ProductionReviewPanel
        checkpoints={[checkpoint]}
        onNavigate={navigate}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Script' }));
    expect(navigate).toHaveBeenCalledWith('story');
    expect(screen.queryByRole('button', { name: 'Scene plan' })).toBeNull();
    expect(
      screen.getByText(/review decisions apply to the listed artifacts/),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
  });
  it('updates readiness when live artifacts change', () => {
    const { rerender } = render(
      <ProductionReviewPanel
        checkpoints={[checkpoint]}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText('Inputs incomplete')).toBeTruthy();
    rerender(
      <ProductionReviewPanel
        checkpoints={[
          {
            ...checkpoint,
            status: 'attention',
            items: [{ ...checkpoint.items[0], status: 'stale' }],
          },
        ]}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('Stale — regenerate')).toBeTruthy();
    expect(screen.queryByText('Inputs incomplete')).toBeNull();
  });
  it('renders nothing for unrelated bundles', () => {
    const { container } = render(
      <ProductionReviewPanel checkpoints={[]} onNavigate={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
