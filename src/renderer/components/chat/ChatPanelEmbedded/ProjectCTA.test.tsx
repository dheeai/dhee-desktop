import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import ProjectCTA, {
  __testing__,
  type CTAAction,
} from './ProjectCTA';

const PROJECT_DIR = '/Users/me/projects/BurgerEating';
const PROJECT_NAME = 'BurgerEating';

describe('ProjectCTA — in_progress', () => {
  it('renders a "Continue" primary action and supporting actions', () => {
    const onAction = jest.fn();
    render(
      <ProjectCTA
        state="in_progress"
        projectName={PROJECT_NAME}
        projectDir={PROJECT_DIR}
        onAction={onAction}
      />,
    );
    expect(screen.queryByText(/Continue where you left off/i)).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: /Continue the pipeline/i }),
    ).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: /current status/i }),
    ).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: /edit a scene or shot/i }),
    ).not.toBeNull();
  });

  it('fires onAction with the matching CTAAction when "Continue" is clicked', () => {
    const onAction = jest.fn();
    render(
      <ProjectCTA
        state="in_progress"
        projectName={PROJECT_NAME}
        projectDir={PROJECT_DIR}
        onAction={onAction}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /Continue the pipeline/i }),
    );
    expect(onAction).toHaveBeenCalledTimes(1);
    const arg = onAction.mock.calls[0]?.[0] as { id: string; task: string };
    expect(arg.id).toBe('continue_pipeline');
    // The dispatched task must contain the absolute project dir so
    // pi-agent's dhee_run_to skips its convention probe.
    expect(arg.task).toContain(PROJECT_DIR);
    expect(arg.task).toContain(PROJECT_NAME);
    expect(arg.task).toMatch(/dhee_run_to/);
  });
});

describe('ProjectCTA — completed', () => {
  it('renders a "Show final video" primary action and polish/rerun secondaries', () => {
    const onAction = jest.fn();
    render(
      <ProjectCTA
        state="completed"
        projectName={PROJECT_NAME}
        projectDir={PROJECT_DIR}
        onAction={onAction}
      />,
    );
    expect(screen.queryByText(/Your project is ready/i)).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: /Show me the final video/i }),
    ).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: /Polish a specific shot/i }),
    ).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: /Re-run a stage/i }),
    ).not.toBeNull();
  });

  it('fires onAction with show_final_video task when primary is clicked', () => {
    const onAction = jest.fn();
    render(
      <ProjectCTA
        state="completed"
        projectName={PROJECT_NAME}
        projectDir={PROJECT_DIR}
        onAction={onAction}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /Show me the final video/i }),
    );
    const arg = onAction.mock.calls[0]?.[0] as { id: string; task: string };
    expect(arg.id).toBe('show_final_video');
    expect(arg.task).toMatch(/dhee_show_final_video/);
    expect(arg.task).toContain(PROJECT_DIR);
  });
});

describe('buildActions contract', () => {
  it('every in_progress action embeds the absolute projectDir (no convention fallback)', () => {
    const { actions } = __testing__.buildActions(
      'in_progress',
      PROJECT_NAME,
      PROJECT_DIR,
    );
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      expect(a.task).toContain(`projectDir="${PROJECT_DIR}"`);
      expect(a.task).toContain(`project="${PROJECT_NAME}"`);
    }
  });

  it('every completed action embeds the absolute projectDir', () => {
    const { actions } = __testing__.buildActions(
      'completed',
      PROJECT_NAME,
      PROJECT_DIR,
    );
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      expect(a.task).toContain(`projectDir="${PROJECT_DIR}"`);
      expect(a.task).toContain(`project="${PROJECT_NAME}"`);
    }
  });

  it('exactly one primary action per state (the leading CTA)', () => {
    const inProgress = __testing__.buildActions(
      'in_progress',
      PROJECT_NAME,
      PROJECT_DIR,
    );
    const completed = __testing__.buildActions(
      'completed',
      PROJECT_NAME,
      PROJECT_DIR,
    );
    expect(
      inProgress.actions.filter((a: CTAAction) => a.variant === 'primary').length,
    ).toBe(1);
    expect(
      completed.actions.filter((a: CTAAction) => a.variant === 'primary').length,
    ).toBe(1);
  });
});
