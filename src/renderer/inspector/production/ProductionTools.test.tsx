import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import ProductionTools from './ProductionTools';

it('switches tools without losing drafts and opens the selected controls', () => {
  render(
    <ProductionTools
      panels={[
        {
          id: 'edit',
          label: 'Edit materials',
          description: 'Edit your inputs.',
          content: (
            <details>
              <summary>Edit</summary>
              <input aria-label="Draft" defaultValue="original" />
            </details>
          ),
        },
        {
          id: 'jobs',
          label: 'RTX jobs',
          description: 'Track your renders.',
          content: (
            <details>
              <summary>Queue</summary>
              <p>Saved outputs</p>
            </details>
          ),
        },
      ]}
    />,
  );
  fireEvent.change(screen.getByLabelText('Draft'), {
    target: { value: 'my unsaved edit' },
  });
  fireEvent.click(screen.getByRole('tab', { name: 'RTX jobs' }));
  expect(screen.getByRole('tabpanel', { name: 'RTX jobs' })).toBeVisible();
  expect(screen.getByText('Queue').closest('details')).toHaveAttribute('open');
  expect(screen.getByLabelText('Draft')).not.toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Edit materials' }));
  expect(screen.getByLabelText('Draft')).toHaveValue('my unsaved edit');
});

it('supports arrow, Home and End navigation with a single tab stop', () => {
  render(
    <ProductionTools
      panels={[
        {
          id: 'edit',
          label: 'Edit materials',
          description: 'Edit.',
          content: <p>Editor</p>,
        },
        {
          id: 'jobs',
          label: 'RTX jobs',
          description: 'Track.',
          content: <p>Queue</p>,
        },
      ]}
    />,
  );
  const edit = screen.getByRole('tab', { name: 'Edit materials' });
  const jobs = screen.getByRole('tab', { name: 'RTX jobs' });
  edit.focus();
  fireEvent.keyDown(edit, { key: 'ArrowRight' });
  expect(jobs).toHaveFocus();
  expect(jobs).toHaveAttribute('aria-selected', 'true');
  expect(edit).toHaveAttribute('tabindex', '-1');
  fireEvent.keyDown(jobs, { key: 'Home' });
  expect(edit).toHaveFocus();
  fireEvent.keyDown(edit, { key: 'End' });
  expect(jobs).toHaveFocus();
});
