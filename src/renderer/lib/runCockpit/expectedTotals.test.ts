import { describe, it, expect } from '@jest/globals';
import { computeExpectedTotals, type ExpectedTotalsNode } from './expectedTotals';
import type { InstanceGraphNode } from '../../../shared/dheeIpc';

function inst(
  nodeId: string,
  status: InstanceGraphNode['status'],
  outputPath?: string,
): InstanceGraphNode {
  return { nodeId, status, ...(outputPath ? { outputPath } : {}) };
}

describe('computeExpectedTotals', () => {
  it('counts a collection from the named array in its source stage plan', async () => {
    const nodes: ExpectedTotalsNode[] = [
      { id: 'scenes_plan', kind: 'stage' },
      { id: 'shot_prompt', kind: 'collection', itemSource: 'scenes_plan', itemKey: 'shots' },
      { id: 'clip_prompt', kind: 'collection', itemSource: 'scenes_plan', itemKey: 'scenes' },
    ];
    const instances = [inst('scenes_plan', 'completed', 'plans/scenes_plan.json')];
    const plan = { scenes: new Array(4).fill({}), shots: new Array(50).fill({}) };
    const readJson = async (p: string) => (p === 'plans/scenes_plan.json' ? plan : null);

    const out = await computeExpectedTotals(nodes, instances, readJson);
    expect(out.shot_prompt).toBe(50); // fans out over .shots
    expect(out.clip_prompt).toBe(4); // same source, fans out over .scenes
    expect(out.scenes_plan).toBeUndefined(); // a stage, not a collection
  });

  it('inherits the expected total 1:1 from a collection source', async () => {
    const nodes: ExpectedTotalsNode[] = [
      { id: 'scenes_plan', kind: 'stage' },
      { id: 'shot_prompt', kind: 'collection', itemSource: 'scenes_plan', itemKey: 'shots' },
      // shot_image fans out 1:1 off shot_prompt (a collection) — no itemKey.
      { id: 'shot_image', kind: 'collection', itemSource: 'shot_prompt' },
    ];
    const instances = [inst('scenes_plan', 'completed', 'plans/scenes_plan.json')];
    const readJson = async () => ({ shots: new Array(17).fill({}) });

    const out = await computeExpectedTotals(nodes, instances, readJson);
    expect(out.shot_prompt).toBe(17);
    expect(out.shot_image).toBe(17);
  });

  it('is bundle-agnostic — resolves an unrelated domain via the same path', async () => {
    // A finance bundle: line_item fans out over report_plan.lineItems. No
    // narrative terms are special-cased.
    const nodes: ExpectedTotalsNode[] = [
      { id: 'report_plan', kind: 'stage' },
      { id: 'line_item', kind: 'collection', itemSource: 'report_plan', itemKey: 'lineItems' },
    ];
    const instances = [inst('report_plan', 'completed', 'plans/report.json')];
    const readJson = async () => ({ lineItems: new Array(7).fill({}) });

    const out = await computeExpectedTotals(nodes, instances, readJson);
    expect(out.line_item).toBe(7);
  });

  it('returns no entry when the source plan has not completed yet', async () => {
    const nodes: ExpectedTotalsNode[] = [
      { id: 'scenes_plan', kind: 'stage' },
      { id: 'shot_prompt', kind: 'collection', itemSource: 'scenes_plan', itemKey: 'shots' },
    ];
    // scenes_plan still in progress — no output to read.
    const instances = [inst('scenes_plan', 'in_progress')];
    const readJson = async () => ({ shots: new Array(50).fill({}) });

    const out = await computeExpectedTotals(nodes, instances, readJson);
    expect(out.shot_prompt).toBeUndefined();
  });

  it('returns no entry when the named array is absent from the plan', async () => {
    const nodes: ExpectedTotalsNode[] = [
      { id: 'scenes_plan', kind: 'stage' },
      { id: 'shot_prompt', kind: 'collection', itemSource: 'scenes_plan', itemKey: 'shots' },
    ];
    const instances = [inst('scenes_plan', 'completed', 'plans/scenes_plan.json')];
    const readJson = async () => ({ scenes: [] }); // no `shots`

    const out = await computeExpectedTotals(nodes, instances, readJson);
    expect(out.shot_prompt).toBeUndefined();
  });
});
