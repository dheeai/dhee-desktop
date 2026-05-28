/**
 * Mirror of dhee-core's capabilities.test.ts for the renderer-side
 * query helper. Keep in sync — the two share the contract.
 */
import { describe, it, expect } from '@jest/globals';
import { findByCapability, findInstanceByCapability, listCompletedItemIds } from './bundleCapability';
import type { BundleSnapshot } from './bundleCapability';

function makeBundle(...nodes: BundleSnapshot['nodes']): BundleSnapshot {
  return {
    id: 'cap-test',
    version: '0.1.0',
    goal: nodes[nodes.length - 1]?.id ?? 'last',
    nodes,
  };
}

const node = (
  id: string,
  capability?: string,
  kind: 'stage' | 'collection' = 'collection',
): BundleSnapshot['nodes'][number] => ({
  id,
  kind,
  outputs: { format: 'json', pattern: `${id}.json` },
  ...(capability ? { displayCapability: capability } : {}),
});

describe('renderer bundleCapability lookup', () => {
  it('returns nodes tagged with the requested capability', () => {
    const bundle = makeBundle(
      node('shot_image_prompt', 'shot.prompt'),
      node('shot_image', 'shot.first_frame'),
    );
    const result = findByCapability(bundle, { walkState: { nodes: {} } }, 'shot.prompt');
    expect(result).toHaveLength(1);
    expect(result[0]!.node.id).toBe('shot_image_prompt');
  });

  it('falls back to executorState.nodes when walkState is absent (legacy projects)', () => {
    const bundle = makeBundle(node('shot_image_prompt', 'shot.prompt'));
    const project = {
      executorState: {
        nodes: { 'shot_image_prompt:scene_1_shot_1': { status: 'completed', outputPath: 'a.json' } },
      },
    };
    const result = findByCapability(bundle, project, 'shot.prompt');
    expect(result[0]!.instances).toHaveLength(1);
    expect(result[0]!.instances[0]!.outputPath).toBe('a.json');
  });

  it('prefers walkState when both are present', () => {
    const bundle = makeBundle(node('shot_image_prompt', 'shot.prompt'));
    const project = {
      walkState: {
        nodes: { 'shot_image_prompt:scene_1_shot_1': { status: 'completed', outputPath: 'new.json' } },
      },
      executorState: {
        nodes: { 'shot_image_prompt:scene_1_shot_1': { status: 'completed', outputPath: 'old.json' } },
      },
    };
    expect(findByCapability(bundle, project, 'shot.prompt')[0]!.instances[0]!.outputPath).toBe('new.json');
  });

  it('does not confuse prefix-sharing node ids', () => {
    const bundle = makeBundle(
      node('shot_image_prompt', 'shot.prompt'),
      node('shot_image', 'shot.first_frame'),
    );
    const state = {
      walkState: {
        nodes: {
          'shot_image_prompt:s1': { status: 'completed', outputPath: 'p.json' },
          'shot_image:s1': { status: 'completed', outputPath: 'i.png' },
        },
      },
    };
    expect(findByCapability(bundle, state, 'shot.prompt')[0]!.instances[0]!.outputPath).toBe('p.json');
    expect(findByCapability(bundle, state, 'shot.first_frame')[0]!.instances[0]!.outputPath).toBe('i.png');
  });

  it('handles null bundle / null project gracefully', () => {
    expect(findByCapability(null, null, 'shot.prompt')).toEqual([]);
    expect(findByCapability(undefined, undefined, 'shot.prompt')).toEqual([]);
    expect(findInstanceByCapability(null, null, 'shot.prompt', 'x')).toBeUndefined();
    expect(listCompletedItemIds(null, null, 'shot.prompt')).toEqual([]);
  });

  it('listCompletedItemIds dedupes across multiple capability sources', () => {
    const bundle = makeBundle(
      node('shot_image_prompt', 'shot.prompt'),
      node('insert_shot_prompt', 'shot.prompt'),
    );
    const state = {
      walkState: {
        nodes: {
          'shot_image_prompt:s1': { status: 'completed' },
          'insert_shot_prompt:s1': { status: 'completed' },
        },
      },
    };
    expect(listCompletedItemIds(bundle, state, 'shot.prompt')).toEqual(['s1']);
  });

  it('honors arbitrary custom capability strings (whacky bundles)', () => {
    const bundle = makeBundle(node('panel_1', 'storyboard.panel'));
    const state = { walkState: { nodes: { panel_1: { status: 'completed', outputPath: 'sb/1.png' } } } };
    expect(findByCapability(bundle, state, 'storyboard.panel')[0]!.instances[0]!.outputPath).toBe('sb/1.png');
  });
});
