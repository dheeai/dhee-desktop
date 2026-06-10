import { describe, it, expect } from '@jest/globals';
import {
  parseProgressCounts,
  deriveActivityState,
  type ActivitySignals,
} from './activityState';

const IDLE: ActivitySignals = {
  agentBusy: false,
  runnerActive: false,
  pendingCancel: false,
};

describe('parseProgressCounts', () => {
  it('parses [N/M] counts and the trailing label', () => {
    expect(parseProgressCounts('[info] [12/40] Rendering shot 12, first light')).toEqual({
      completed: 12,
      total: 40,
      label: 'Rendering shot 12, first light',
    });
  });

  it('parses counts with no surrounding noise', () => {
    expect(parseProgressCounts('[3/3] done')).toEqual({
      completed: 3,
      total: 3,
      label: 'done',
    });
  });

  it('tolerates counts with no trailing label', () => {
    expect(parseProgressCounts('[12/40]')).toEqual({
      completed: 12,
      total: 40,
      label: '',
    });
  });

  it('returns null when there are no counts', () => {
    expect(parseProgressCounts('just some log line')).toBeNull();
    expect(parseProgressCounts('')).toBeNull();
  });
});

describe('deriveActivityState — priority + mapping', () => {
  it('is idle when nothing is happening', () => {
    expect(deriveActivityState(IDLE).kind).toBe('idle');
  });

  it('is thinking when the agent is busy with no active tool', () => {
    const s = deriveActivityState({ ...IDLE, agentBusy: true });
    expect(s.kind).toBe('thinking');
    expect(s.verb).toMatch(/think/i);
  });

  it('is working with a humanized verb when a tool is in flight', () => {
    const s = deriveActivityState({
      ...IDLE,
      agentBusy: true,
      activeTool: { toolName: 'dhee_critique_node' },
    });
    expect(s.kind).toBe('working');
    expect(s.verb).not.toMatch(/dhee_/);
    expect(s.verb).not.toContain('_');
  });

  it('is rendering with a meter when a run reports [N/M] progress', () => {
    const s = deriveActivityState({
      ...IDLE,
      runnerActive: true,
      latestProgress: '[12/40] Rendering shot 12',
    });
    expect(s.kind).toBe('rendering');
    expect(s.progress).toEqual({ completed: 12, total: 40, pct: 30 });
    expect(s.object).toContain('shot 12');
  });

  it('is working (not rendering) when a run is active but emits no counts', () => {
    const s = deriveActivityState({
      ...IDLE,
      runnerActive: true,
      latestProgress: 'starting up',
      activeTool: { toolName: 'dhee_start_run' },
    });
    expect(s.kind).toBe('working');
    expect(s.progress).toBeUndefined();
  });

  it('is paused when the run gated after a collection', () => {
    const s = deriveActivityState({ ...IDLE, gatedAfter: 'character_image' });
    expect(s.kind).toBe('paused');
    expect(s.object).toContain('character_image');
  });

  it('is failed and classifies a transient failure', () => {
    const s = deriveActivityState({
      ...IDLE,
      runnerActive: true,
      failure: 'comfy.image: transient upstream error after 3 attempts — 502',
    });
    expect(s.kind).toBe('failed');
    expect(s.failureClass).toBe('transient');
  });

  it('is failed and classifies a structural failure', () => {
    const s = deriveActivityState({
      ...IDLE,
      failure: 'schema validation failed: mood not in enum',
    });
    expect(s.kind).toBe('failed');
    expect(s.failureClass).toBe('structural');
  });

  it('shows a stopping state when a cancel is pending', () => {
    const s = deriveActivityState({ ...IDLE, runnerActive: true, pendingCancel: true });
    expect(s.kind).toBe('working');
    expect(s.verb).toMatch(/stop/i);
  });

  it('failure outranks gate, gate outranks cancel, cancel outranks run progress', () => {
    expect(
      deriveActivityState({
        agentBusy: true,
        runnerActive: true,
        pendingCancel: true,
        gatedAfter: 'character_image',
        failure: 'fetch failed',
        latestProgress: '[1/2] x',
      }).kind,
    ).toBe('failed');

    expect(
      deriveActivityState({
        agentBusy: true,
        runnerActive: true,
        pendingCancel: true,
        gatedAfter: 'character_image',
        latestProgress: '[1/2] x',
      }).kind,
    ).toBe('paused');

    expect(
      deriveActivityState({
        agentBusy: true,
        runnerActive: true,
        pendingCancel: true,
        latestProgress: '[1/2] x',
      }).kind,
    ).toBe('working');
  });
});
