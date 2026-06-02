/**
 * cardDetailModel — TDD coverage.
 *
 * Failure modes:
 *   instanceKey:
 *     1. With itemId → `${nodeId}:${itemId}`
 *     2. Without itemId → just `${nodeId}`
 *
 *   openModal / closeModal:
 *     3. openModal sets the key
 *     4. openModal twice with same key returns same reference
 *        (so React doesn't re-render unnecessarily)
 *     5. openModal then close returns to closed state
 *     6. closeModal on already-closed returns same reference
 *     7. opening a different key swaps in the new one
 *
 *   availableActions:
 *     8. completed text artifact → open-file, regenerate, invalidate,
 *        edit, show-versions
 *     9. completed image artifact → no `edit`
 *    10. in_progress → no regenerate, no edit, no invalidate
 *    11. pending → only show-versions (nothing else available)
 *    12. failed with outputPath → regenerate, open-file, show-versions
 *    13. failed without outputPath → only regenerate + show-versions
 *    14. invalidated → regenerate + show-versions, no invalidate
 *    15. completed without outputPath → no open-file, no edit
 *
 *   actionLabel:
 *    16. Every CardAction has a non-empty label
 */
import { describe, it, expect } from '@jest/globals';
import {
  instanceKey,
  openModal,
  closeModal,
  availableActions,
  actionLabel,
  closedModalState,
  type CardAction,
} from './cardDetailModel';

describe('instanceKey', () => {
  it('1. with itemId → nodeId:itemId', () => {
    expect(instanceKey({ nodeId: 'shot_image', itemId: 'scene_1_shot_3' })).toBe('shot_image:scene_1_shot_3');
  });
  it('2. without itemId → just nodeId', () => {
    expect(instanceKey({ nodeId: 'plot' })).toBe('plot');
  });
});

describe('openModal / closeModal', () => {
  it('3. openModal sets the key', () => {
    const s = openModal(closedModalState, 'a');
    expect(s.openInstanceKey).toBe('a');
  });

  it('4. openModal with same key returns same reference (no needless re-render)', () => {
    const s1 = openModal(closedModalState, 'a');
    const s2 = openModal(s1, 'a');
    expect(s2).toBe(s1);
  });

  it('5. open then close returns to closed state', () => {
    const s1 = openModal(closedModalState, 'a');
    const s2 = closeModal(s1);
    expect(s2.openInstanceKey).toBeNull();
  });

  it('6. closeModal on closed returns same reference', () => {
    const s1 = closeModal(closedModalState);
    expect(s1).toBe(closedModalState);
  });

  it('7. opening a different key swaps in the new one', () => {
    const s1 = openModal(closedModalState, 'a');
    const s2 = openModal(s1, 'b');
    expect(s2.openInstanceKey).toBe('b');
    expect(s2).not.toBe(s1);
  });
});

describe('availableActions', () => {
  it('8. completed text artifact → full set incl. edit', () => {
    const acts = availableActions({ nodeId: 'plot', status: 'completed', outputPath: 'plans/plot.md' });
    expect(acts).toEqual(expect.arrayContaining(['open-file', 'regenerate', 'invalidate', 'edit', 'show-versions']));
  });

  it('9. completed image → no edit', () => {
    const acts = availableActions({ nodeId: 'shot_image', itemId: 's1', status: 'completed', outputPath: 'shots/s1.png' });
    expect(acts).toEqual(expect.arrayContaining(['open-file', 'regenerate', 'invalidate', 'show-versions']));
    expect(acts).not.toContain('edit');
  });

  it('10. in_progress → only show-versions', () => {
    const acts = availableActions({ nodeId: 'shot_image', status: 'in_progress' });
    expect(acts).toEqual(['show-versions']);
  });

  it('11. pending → only show-versions', () => {
    const acts = availableActions({ nodeId: 'shot_image', status: 'pending' });
    expect(acts).toEqual(['show-versions']);
  });

  it('12. failed with outputPath → regen + open-file + show-versions', () => {
    const acts = availableActions({ nodeId: 'shot_image', status: 'failed', outputPath: 'shots/s1.png' });
    expect(acts).toEqual(expect.arrayContaining(['open-file', 'regenerate', 'show-versions']));
    expect(acts).not.toContain('invalidate');
    expect(acts).not.toContain('edit');
  });

  it('13. failed without outputPath → regen + show-versions only', () => {
    const acts = availableActions({ nodeId: 'shot_image', status: 'failed' });
    expect(acts.sort()).toEqual(['regenerate', 'show-versions']);
  });

  it('14. invalidated → regen + show-versions, no invalidate-again', () => {
    const acts = availableActions({ nodeId: 'shot_image', status: 'invalidated', outputPath: 'shots/s1.png' });
    expect(acts).toContain('regenerate');
    expect(acts).toContain('open-file');
    expect(acts).not.toContain('invalidate');
  });

  it('15. completed without outputPath → no open-file / no edit', () => {
    const acts = availableActions({ nodeId: 'plot', status: 'completed' });
    expect(acts).not.toContain('open-file');
    expect(acts).not.toContain('edit');
    expect(acts).toContain('regenerate');
    expect(acts).toContain('invalidate');
  });
});

describe('actionLabel', () => {
  it('16. every CardAction has a non-empty label', () => {
    const all: CardAction[] = ['open-file', 'regenerate', 'edit', 'invalidate', 'show-versions'];
    for (const a of all) {
      const label = actionLabel(a);
      expect(label).toBeTruthy();
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
