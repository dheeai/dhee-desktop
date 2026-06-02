/**
 * Regression: projects whose state lives only in `.dhee/events.jsonl`
 * (no walkState in project.json) lost their landing-tile thumbnail
 * because the desktop's resolver only read project.json.walkState.
 *
 * This guards the renderer-side projection that fixes the regression.
 *
 * Failure modes covered:
 *   1. Empty input → empty walkState.
 *   2. node.completed → entry appears keyed `nodeId:itemId`.
 *   3. node.completed without itemId → bare-nodeId key.
 *   4. Multiple node.completed for the same key → LAST one wins
 *      (mirrors walker semantics; the head of the version chain is
 *      the latest completed render).
 *   5. node.invalidated AFTER node.completed → entry removed.
 *   6. Re-completion AFTER invalidation → entry returns.
 *   7. Off-branch events filtered out (branchId !== 'main').
 *   8. Events with no branchId still admitted (legacy events).
 *   9. Torn last line (e.g. partial write on crash) silently dropped.
 *  10. Unrelated event kinds ignored (no leakage into walkState).
 */
import { describe, it, expect } from '@jest/globals';
import { projectStateFromEventsJsonl } from './projectStateFromEvents';

function event(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

describe('projectStateFromEventsJsonl', () => {
  it('1. empty input → empty walkState', () => {
    expect(projectStateFromEventsJsonl('')).toEqual({ nodes: {} });
    expect(projectStateFromEventsJsonl('\n\n')).toEqual({ nodes: {} });
  });

  it('2. node.completed with itemId produces nodeId:itemId entry', () => {
    const log = event({
      kind: 'node.completed',
      branchId: 'main',
      payload: { nodeId: 'shot_image', itemId: 'scene_1_shot_1', outputPath: 'a.png' },
    });
    const ws = projectStateFromEventsJsonl(log);
    expect(ws.nodes['shot_image:scene_1_shot_1']).toEqual({
      status: 'completed',
      outputPath: 'a.png',
    });
  });

  it('3. node.completed without itemId uses bare nodeId as key', () => {
    const log = event({
      kind: 'node.completed',
      branchId: 'main',
      payload: { nodeId: 'plot', outputPath: 'plans/plot.md' },
    });
    expect(projectStateFromEventsJsonl(log).nodes['plot']).toEqual({
      status: 'completed',
      outputPath: 'plans/plot.md',
    });
  });

  it('4. multiple completions for same key — LAST wins', () => {
    const log = [
      event({ kind: 'node.completed', branchId: 'main', payload: { nodeId: 'plot', outputPath: 'old.md' } }),
      event({ kind: 'node.completed', branchId: 'main', payload: { nodeId: 'plot', outputPath: 'new.md' } }),
    ].join('\n');
    expect(projectStateFromEventsJsonl(log).nodes['plot']?.outputPath).toBe('new.md');
  });

  it('5. node.invalidated removes a prior completion', () => {
    const log = [
      event({ kind: 'node.completed', branchId: 'main', payload: { nodeId: 'plot', outputPath: 'old.md' } }),
      event({ kind: 'node.invalidated', branchId: 'main', payload: { nodeId: 'plot' } }),
    ].join('\n');
    expect(projectStateFromEventsJsonl(log).nodes['plot']).toBeUndefined();
  });

  it('6. re-completion after invalidation puts the entry back', () => {
    const log = [
      event({ kind: 'node.completed', branchId: 'main', payload: { nodeId: 'plot', outputPath: 'v1.md' } }),
      event({ kind: 'node.invalidated', branchId: 'main', payload: { nodeId: 'plot' } }),
      event({ kind: 'node.completed', branchId: 'main', payload: { nodeId: 'plot', outputPath: 'v2.md' } }),
    ].join('\n');
    expect(projectStateFromEventsJsonl(log).nodes['plot']?.outputPath).toBe('v2.md');
  });

  it('7. off-branch events are ignored', () => {
    const log = [
      event({ kind: 'node.completed', branchId: 'main', payload: { nodeId: 'main_node', outputPath: 'a.png' } }),
      event({ kind: 'node.completed', branchId: 'experiment', payload: { nodeId: 'fork_node', outputPath: 'b.png' } }),
    ].join('\n');
    const ws = projectStateFromEventsJsonl(log);
    expect(ws.nodes['main_node']).toBeDefined();
    expect(ws.nodes['fork_node']).toBeUndefined();
  });

  it('8. events without branchId are admitted (legacy / pre-branch)', () => {
    const log = event({
      kind: 'node.completed',
      payload: { nodeId: 'legacy', outputPath: 'L.png' },
    });
    expect(projectStateFromEventsJsonl(log).nodes['legacy']).toBeDefined();
  });

  it('9. torn last line silently dropped — earlier events still landed', () => {
    const log = [
      event({ kind: 'node.completed', branchId: 'main', payload: { nodeId: 'plot', outputPath: 'a.md' } }),
      '{"kind":"node.com', // torn
    ].join('\n');
    expect(projectStateFromEventsJsonl(log).nodes['plot']).toBeDefined();
  });

  it('10. unrelated event kinds ignored', () => {
    const log = [
      event({ kind: 'node.started', branchId: 'main', payload: { nodeId: 'plot' } }),
      event({ kind: 'version.added', branchId: 'main', payload: { nodeId: 'plot', outputPath: 'v.md' } }),
      event({ kind: 'cost.recorded', branchId: 'main', payload: { nodeId: 'plot' } }),
    ].join('\n');
    expect(Object.keys(projectStateFromEventsJsonl(log).nodes)).toHaveLength(0);
  });

  // ── Higher-level regression: real-world events.jsonl shape from a
  // headless 9:16 30s run with multiple shot completions. The tile
  // resolver picks first_completed by lex stateKey, so a properly
  // projected walkState here MUST contain all 9 shot completions
  // and the lex-lowest is shot_1.
  it('regression: 9 shot_image completions all land in walkState', () => {
    const lines = Array.from({ length: 9 }, (_, i) =>
      event({
        kind: 'node.completed',
        branchId: 'main',
        payload: {
          nodeId: 'shot_image',
          itemId: `scene_1_shot_${i + 1}`,
          outputPath: `assets/images/shots/scene_1_shot_${i + 1}_first.png`,
        },
      }),
    );
    const ws = projectStateFromEventsJsonl(lines.join('\n'));
    expect(Object.keys(ws.nodes)).toHaveLength(9);
    expect(ws.nodes['shot_image:scene_1_shot_1']?.outputPath).toBe(
      'assets/images/shots/scene_1_shot_1_first.png',
    );
  });
});
