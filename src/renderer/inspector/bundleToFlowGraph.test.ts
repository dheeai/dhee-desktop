/**
 * Tests for the bundle → React Flow graph transformation. Pure function,
 * no React, no IO — feed in a bundle snapshot + walkState, get back
 * the FlowNode/Edge arrays the Inspector Canvas renders.
 *
 * Per the plan (docs/mockups/inspector-canvas-v1.html + Phase 2 of
 * Inspector Canvas):
 *
 *  - One FlowNode per bundle NodeDef. Collection nodes are ONE FlowNode
 *    each (the rail of per-item tiles is rendered internally by the
 *    node component, not exposed as React Flow children).
 *  - Edges derived from each node's `inputs[].from` declarations.
 *  - Node positions assigned by dagre auto-layout (topo left→right).
 *  - Per-node status derived from walkState: pending | running |
 *    completed | failed | invalidated. Stage nodes use the `<nodeId>`
 *    state key; collections derive aggregate status from their
 *    `<nodeId>:<itemId>` instances.
 *  - Edges referencing an upstream node id that doesn't exist in the
 *    bundle are dropped silently (don't crash).
 */
import { describe, it, expect } from '@jest/globals';
import { bundleToFlowGraph } from './bundleToFlowGraph';
import type { BundleSnapshot } from '../lib/bundleCapability';

const makeBundle = (
  nodes: Array<{
    id: string;
    kind?: 'stage' | 'collection';
    inputs?: Array<{ from: string }>;
    format?: string;
    displayCapability?: string;
    headlineField?: string;
  }>,
  goal?: string,
): BundleSnapshot => ({
  id: 'test',
  version: '0.1.0',
  goal: goal ?? nodes[nodes.length - 1]?.id ?? 'last',
  nodes: nodes.map((n) => ({
    id: n.id,
    kind: n.kind ?? 'stage',
    outputs: { format: n.format ?? 'json', pattern: `${n.id}.${n.format ?? 'json'}` },
    inputs: n.inputs ?? [],
    ...(n.displayCapability ? { displayCapability: n.displayCapability } : {}),
    ...(n.headlineField ? { headlineField: n.headlineField } : {}),
  })),
});

describe('bundleToFlowGraph', () => {
  describe('shape', () => {
    it('returns empty arrays for an empty bundle', () => {
      const result = bundleToFlowGraph(makeBundle([], 'none'), { nodes: {} });
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it('returns empty arrays when the bundle is null', () => {
      const result = bundleToFlowGraph(null, { nodes: {} });
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it('emits one FlowNode per bundle node', () => {
      const b = makeBundle([
        { id: 'plot' },
        { id: 'story' },
        { id: 'scenes_plan' },
      ]);
      const { nodes } = bundleToFlowGraph(b, { nodes: {} });
      expect(nodes.map((n) => n.id)).toEqual(['plot', 'story', 'scenes_plan']);
    });

    it('emits one FlowNode (not N) for a collection — rail tiles are internal to the node component', () => {
      const b = makeBundle([
        { id: 'shot_image', kind: 'collection' },
      ]);
      const state = {
        nodes: {
          'shot_image:scene_1_shot_1': { status: 'completed', outputPath: 'a.png' },
          'shot_image:scene_1_shot_2': { status: 'completed', outputPath: 'b.png' },
        },
      };
      const { nodes } = bundleToFlowGraph(b, state);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]!.id).toBe('shot_image');
    });

    it('attaches the bundle node definition to FlowNode data', () => {
      const b = makeBundle([
        { id: 'shot_image_prompt', kind: 'collection', format: 'json', displayCapability: 'shot.prompt', headlineField: 'deltaText' },
      ]);
      const { nodes } = bundleToFlowGraph(b, { nodes: {} });
      expect(nodes[0]!.data.bundleNode.id).toBe('shot_image_prompt');
      expect(nodes[0]!.data.bundleNode.outputs.format).toBe('json');
      expect(nodes[0]!.data.bundleNode.headlineField).toBe('deltaText');
      expect(nodes[0]!.data.bundleNode.displayCapability).toBe('shot.prompt');
    });

    it('uses a stable React Flow node type for the custom renderer', () => {
      // The Inspector mounts a single custom node renderer that
      // dispatches to per-kind UI internally. xyflow needs every node
      // to declare the registered type string.
      const b = makeBundle([{ id: 'plot' }]);
      const { nodes } = bundleToFlowGraph(b, { nodes: {} });
      expect(nodes[0]!.type).toBe('inspector');
    });
  });

  describe('edges', () => {
    it('emits one edge per inputs[].from', () => {
      const b = makeBundle([
        { id: 'plot' },
        { id: 'story', inputs: [{ from: 'plot' }] },
      ]);
      const { edges } = bundleToFlowGraph(b, { nodes: {} });
      expect(edges).toHaveLength(1);
      expect(edges[0]!.source).toBe('plot');
      expect(edges[0]!.target).toBe('story');
    });

    it('emits one edge per multi-input', () => {
      const b = makeBundle([
        { id: 'world_style' },
        { id: 'scenes_plan' },
        { id: 'shot_image_prompt', inputs: [{ from: 'scenes_plan' }, { from: 'world_style' }] },
      ]);
      const { edges } = bundleToFlowGraph(b, { nodes: {} });
      expect(edges).toHaveLength(2);
      expect(edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
        'scenes_plan->shot_image_prompt',
        'world_style->shot_image_prompt',
      ]);
    });

    it('drops edges whose `from` references a node not in the bundle', () => {
      // Defensive: a malformed bundle (or a project on an older bundle
      // where a node was renamed) shouldn't crash the canvas.
      const b = makeBundle([
        { id: 'story', inputs: [{ from: 'this_node_does_not_exist' }, { from: 'plot' }] },
        { id: 'plot' },
      ]);
      const { edges } = bundleToFlowGraph(b, { nodes: {} });
      expect(edges).toHaveLength(1);
      expect(edges[0]!.source).toBe('plot');
    });

    it('emits stable edge ids (source-target)', () => {
      const b = makeBundle([
        { id: 'plot' },
        { id: 'story', inputs: [{ from: 'plot' }] },
      ]);
      const { edges } = bundleToFlowGraph(b, { nodes: {} });
      expect(edges[0]!.id).toBe('plot->story');
    });

    it('deduplicates duplicate edges between the same pair', () => {
      // A bundle author could (incorrectly) declare two inputs with the
      // same `from`. We render one edge.
      const b = makeBundle([
        { id: 'a' },
        { id: 'b', inputs: [{ from: 'a' }, { from: 'a' }] },
      ]);
      const { edges } = bundleToFlowGraph(b, { nodes: {} });
      expect(edges).toHaveLength(1);
    });
  });

  describe('status derivation', () => {
    it('stage status: pending when no walkState entry', () => {
      const b = makeBundle([{ id: 'plot' }]);
      const { nodes } = bundleToFlowGraph(b, { nodes: {} });
      expect(nodes[0]!.data.status).toBe('pending');
    });

    it('stage status: completed when walkState has status completed', () => {
      const b = makeBundle([{ id: 'plot' }]);
      const { nodes } = bundleToFlowGraph(b, {
        nodes: { plot: { status: 'completed', outputPath: 'plans/plot.md' } },
      });
      expect(nodes[0]!.data.status).toBe('completed');
    });

    it('stage status: running, failed, invalidated all surface', () => {
      const b = makeBundle([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
      const state = {
        nodes: {
          a: { status: 'running' },
          b: { status: 'failed' },
          c: { status: 'invalidated' },
        },
      };
      const { nodes } = bundleToFlowGraph(b, state);
      expect(nodes[0]!.data.status).toBe('running');
      expect(nodes[1]!.data.status).toBe('failed');
      expect(nodes[2]!.data.status).toBe('invalidated');
    });

    it('collection status: completed when ALL materialized instances are completed', () => {
      const b = makeBundle([{ id: 'shot_image', kind: 'collection' }]);
      const state = {
        nodes: {
          'shot_image:s1': { status: 'completed', outputPath: 'a.png' },
          'shot_image:s2': { status: 'completed', outputPath: 'b.png' },
        },
      };
      const { nodes } = bundleToFlowGraph(b, state);
      expect(nodes[0]!.data.status).toBe('completed');
    });

    it('collection status: failed when ANY instance failed (the worst-case wins)', () => {
      const b = makeBundle([{ id: 'shot_image', kind: 'collection' }]);
      const state = {
        nodes: {
          'shot_image:s1': { status: 'completed', outputPath: 'a.png' },
          'shot_image:s2': { status: 'failed' },
          'shot_image:s3': { status: 'completed', outputPath: 'c.png' },
        },
      };
      const { nodes } = bundleToFlowGraph(b, state);
      expect(nodes[0]!.data.status).toBe('failed');
    });

    it('collection status: running takes precedence over completed but not over failed', () => {
      const b = makeBundle([{ id: 'shot_image', kind: 'collection' }]);
      const state = {
        nodes: {
          'shot_image:s1': { status: 'completed', outputPath: 'a.png' },
          'shot_image:s2': { status: 'running' },
        },
      };
      const { nodes } = bundleToFlowGraph(b, state);
      expect(nodes[0]!.data.status).toBe('running');
    });

    it('collection status: pending when no materialized instances', () => {
      const b = makeBundle([{ id: 'shot_image', kind: 'collection' }]);
      const { nodes } = bundleToFlowGraph(b, { nodes: {} });
      expect(nodes[0]!.data.status).toBe('pending');
    });
  });

  describe('instances', () => {
    it('attaches all materialized instances to a collection node', () => {
      const b = makeBundle([{ id: 'shot_image', kind: 'collection' }]);
      const state = {
        nodes: {
          'shot_image:scene_1_shot_1': { status: 'completed', outputPath: 'a.png' },
          'shot_image:scene_1_shot_2': { status: 'completed', outputPath: 'b.png' },
          'shot_image:scene_1_shot_3': { status: 'pending' },
        },
      };
      const { nodes } = bundleToFlowGraph(b, state);
      expect(nodes[0]!.data.instances).toHaveLength(3);
      const ids = nodes[0]!.data.instances.map((i) => i.itemId).sort();
      expect(ids).toEqual(['scene_1_shot_1', 'scene_1_shot_2', 'scene_1_shot_3']);
    });

    it('attaches a single (stage) instance for stage nodes', () => {
      const b = makeBundle([{ id: 'plot' }]);
      const state = {
        nodes: { plot: { status: 'completed', outputPath: 'plans/plot.md' } },
      };
      const { nodes } = bundleToFlowGraph(b, state);
      expect(nodes[0]!.data.instances).toHaveLength(1);
      expect(nodes[0]!.data.instances[0]!.itemId).toBeUndefined();
      expect(nodes[0]!.data.instances[0]!.outputPath).toBe('plans/plot.md');
    });

    it('attaches an empty instances array for unmaterialized stage nodes', () => {
      const b = makeBundle([{ id: 'plot' }]);
      const { nodes } = bundleToFlowGraph(b, { nodes: {} });
      expect(nodes[0]!.data.instances).toEqual([]);
    });
  });

  describe('layout', () => {
    it('assigns positions to every node', () => {
      const b = makeBundle([
        { id: 'plot' },
        { id: 'story', inputs: [{ from: 'plot' }] },
        { id: 'scenes_plan', inputs: [{ from: 'story' }] },
      ]);
      const { nodes } = bundleToFlowGraph(b, { nodes: {} });
      for (const n of nodes) {
        expect(typeof n.position.x).toBe('number');
        expect(typeof n.position.y).toBe('number');
        expect(Number.isFinite(n.position.x)).toBe(true);
        expect(Number.isFinite(n.position.y)).toBe(true);
      }
    });

    it('places downstream nodes to the right of their upstream (topo flow)', () => {
      const b = makeBundle([
        { id: 'plot' },
        { id: 'story', inputs: [{ from: 'plot' }] },
        { id: 'scenes_plan', inputs: [{ from: 'story' }] },
      ]);
      const { nodes } = bundleToFlowGraph(b, { nodes: {} });
      const by = Object.fromEntries(nodes.map((n) => [n.id, n.position.x]));
      expect(by['plot']!).toBeLessThan(by['story']!);
      expect(by['story']!).toBeLessThan(by['scenes_plan']!);
    });

    it('places parallel branches at different y so they don\'t overlap', () => {
      const b = makeBundle([
        { id: 'scenes_plan' },
        { id: 'character_image_prompt', inputs: [{ from: 'scenes_plan' }] },
        { id: 'setting_image_prompt', inputs: [{ from: 'scenes_plan' }] },
      ]);
      const { nodes } = bundleToFlowGraph(b, { nodes: {} });
      const byId = Object.fromEntries(nodes.map((n) => [n.id, n.position]));
      expect(byId['character_image_prompt']!.y).not.toEqual(byId['setting_image_prompt']!.y);
    });
  });
});
