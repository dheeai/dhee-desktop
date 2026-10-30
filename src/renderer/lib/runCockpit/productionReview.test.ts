import { describe, expect, it } from '@jest/globals';
import { deriveRunModel } from './deriveRunModel';
import { buildProductionDoc } from './productionModel';
import { buildProductionReview } from './productionReview';
import type { InstanceGraphNode } from '../../../shared/dheeIpc';

const nodes = [
  { id: 'story', outputs: { format: 'md' } },
  { id: 'scenes_plan', outputs: { format: 'json' } },
  { id: 'character_image', kind: 'collection', outputs: { format: 'image' } },
  { id: 'final_video', outputs: { format: 'video' } },
];
function review(
  instances?: InstanceGraphNode[],
  expectedTotals?: Record<string, number>,
) {
  const model = deriveRunModel({
    instances: instances ?? [],
    edges: [],
    bundleNodes: nodes,
    expectedTotals,
    runnerActive: false,
    cancelling: false,
    agentBusy: false,
    now: 0,
  });
  return buildProductionReview(model, nodes, buildProductionDoc(model));
}
const done = (nodeId: string): InstanceGraphNode => ({
  nodeId,
  status: 'completed',
  outputPath: `${nodeId}.json`,
});

describe('creative review readiness', () => {
  it('shows all three checkpoints before instances materialize', () => {
    const checkpoints = review();
    expect(checkpoints.map((c) => c.title)).toEqual([
      'Script & storyboard',
      'Character & voice references',
      'Rough cut',
    ]);
    expect(checkpoints.every((c) => c.status === 'incomplete')).toBe(true);
    expect(checkpoints[0].items.every((i) => i.status === 'missing')).toBe(
      true,
    );
  });
  it('requires both script and scene plan and an output path', () => {
    expect(review([done('story')])[0].status).toBe('incomplete');
    expect(
      review([done('story'), { nodeId: 'scenes_plan', status: 'completed' }])[0]
        .status,
    ).toBe('incomplete');
    expect(review([done('story'), done('scenes_plan')])[0].status).toBe(
      'ready',
    );
  });
  it('does not mistake a partial collection for readiness', () => {
    const cast = { ...done('character_image'), itemId: 'a' };
    expect(review([cast], { character_image: 3 })[1].items[0].status).toBe(
      'missing',
    );
  });
  it.each(['failed', 'invalidated'] as const)(
    'surfaces %s artifacts even with an old output path',
    (status) => {
      const checkpoint = review([
        { ...done('story'), status },
        done('scenes_plan'),
      ])[0];
      expect(checkpoint.status).toBe('attention');
      expect(checkpoint.items[0].status).toBe(
        status === 'failed' ? 'failed' : 'stale',
      );
    },
  );
  it('keeps voice reference coverage explicit', () => {
    const refs = review([done('character_image')])[1];
    expect(refs.status).toBe('incomplete');
    expect(refs.items.find((i) => i.id === 'voice_reference')?.status).toBe(
      'unconfigured',
    );
  });
  it('provides a navigation target for existing artifacts', () => {
    expect(review([done('story')])[0].items[0].sectionId).toBe('story');
    expect(review()[0].items[0].sectionId).toBeUndefined();
  });
  it('does not label unrelated or audio-only bundles as film workflows', () => {
    const model = deriveRunModel({
      instances: [],
      edges: [],
      runnerActive: false,
      cancelling: false,
      agentBusy: false,
      now: 0,
    });
    expect(buildProductionReview(model, [], buildProductionDoc(model))).toEqual(
      [],
    );
    expect(
      buildProductionReview(
        model,
        nodes.map((n) => ({ ...n, outputs: { format: 'audio' } })),
        buildProductionDoc(model),
      ),
    ).toEqual([]);
  });
});
