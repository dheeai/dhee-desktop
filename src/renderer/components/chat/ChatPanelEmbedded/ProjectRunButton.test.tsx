import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import ProjectRunButton from './ProjectRunButton';

const baseProps = {
  ready: true,
  pendingCancel: false,
  onStart: jest.fn(),
  onCancel: jest.fn(),
};

describe('ProjectRunButton — state-driven visibility', () => {
  it('renders a Resume button when state is in_progress and not running', () => {
    render(
      <ProjectRunButton
        {...baseProps}
        projectState="in_progress"
        running={false}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /resume run/i }),
    ).not.toBeNull();
    expect(screen.queryByText(/resume/i)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull();
  });

  it('renders nothing for a completed project (the CTA owns "show video")', () => {
    const { container } = render(
      <ProjectRunButton
        {...baseProps}
        projectState="completed"
        running={false}
      />,
    );
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('renders nothing for a fresh project (the wizard is the entry point)', () => {
    const { container } = render(
      <ProjectRunButton
        {...baseProps}
        projectState="fresh"
        running={false}
      />,
    );
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('renders nothing while the lifecycle probe is in flight (projectState=null)', () => {
    const { container } = render(
      <ProjectRunButton
        {...baseProps}
        projectState={null}
        running={false}
      />,
    );
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('shows Stop while running, regardless of projectState', () => {
    render(
      <ProjectRunButton
        {...baseProps}
        projectState="completed"
        running
      />,
    );
    expect(screen.queryByRole('button', { name: /stop run/i })).not.toBeNull();
    expect(screen.queryByText(/^stop$/i)).not.toBeNull();
  });
});

describe('ProjectRunButton — click handlers', () => {
  it('clicking Resume invokes onStart once', () => {
    const onStart = jest.fn();
    render(
      <ProjectRunButton
        {...baseProps}
        onStart={onStart}
        projectState="in_progress"
        running={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /resume run/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('Resume is disabled when ready=false', () => {
    render(
      <ProjectRunButton
        {...baseProps}
        ready={false}
        projectState="in_progress"
        running={false}
      />,
    );
    const btn = screen.getByRole('button', { name: /resume run/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('clicking Stop fires onCancel exactly once', () => {
    const onCancel = jest.fn();
    render(
      <ProjectRunButton
        {...baseProps}
        onCancel={onCancel}
        projectState="in_progress"
        running
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /stop run/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('ProjectRunButton — pendingCancel feedback', () => {
  it('renders "Stopping…" when pendingCancel=true while running', () => {
    // The parent owns pendingCancel and flips it true synchronously
    // when EITHER stop button (header or inline) is clicked, then we
    // re-render here with the new prop. The button immediately shows
    // the spinner + "Stopping…" label.
    render(
      <ProjectRunButton
        {...baseProps}
        projectState="in_progress"
        running
        pendingCancel
      />,
    );
    expect(screen.queryByText(/stopping/i)).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: /stopping run/i }),
    ).not.toBeNull();
  });

  it('disables the Stop button while pendingCancel=true so impatient clicks are ignored', () => {
    const onCancel = jest.fn();
    render(
      <ProjectRunButton
        {...baseProps}
        onCancel={onCancel}
        projectState="in_progress"
        running
        pendingCancel
      />,
    );
    const btn = screen.getByRole('button', { name: /stopping run/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('reverts to Resume once running flips false (parent has cleared pendingCancel)', () => {
    const { rerender } = render(
      <ProjectRunButton
        {...baseProps}
        projectState="in_progress"
        running
        pendingCancel
      />,
    );
    expect(screen.queryByText(/stopping/i)).not.toBeNull();

    // Run finished — parent clears running and pendingCancel together.
    rerender(
      <ProjectRunButton
        {...baseProps}
        projectState="in_progress"
        running={false}
        pendingCancel={false}
      />,
    );

    expect(screen.queryByText(/stopping/i)).toBeNull();
    expect(
      screen.queryByRole('button', { name: /resume run/i }),
    ).not.toBeNull();
  });
});
