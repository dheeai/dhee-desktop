/**
 * Pins the kind dispatcher contract.
 *
 * InspectorNode replaces StubNode as the single React Flow node type
 * registered in InspectorCanvas. It reads `bundleNode.kind` and the
 * `outputs.format` to dispatch to the right per-kind renderer:
 *
 *   - kind === 'stage'      → StageBody, then per-format component
 *   - kind === 'collection' → CollectionBody (rail), then per-format
 *                              tile inside each rail item
 *
 * The status shell (data-status, regenerate hover) is shared and lives
 * around whichever body renders inside.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import type { InspectorNodeData } from '../bundleToFlowGraph';

// xyflow's Handle needs a ReactFlowProvider ancestor. The dispatcher
// test isolates kind selection / collection rail logic — Handle's
// edge-anchor behaviour belongs to the canvas scaffold test, not
// here. Stub it out.
jest.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

import { InspectorNode } from './InspectorNode';

const baseData = (
  overrides: Partial<InspectorNodeData> & {
    nodeOverrides?: Partial<InspectorNodeData['bundleNode']>;
  } = {},
): InspectorNodeData => ({
  bundleNode: {
    id: 'test_node',
    kind: 'stage',
    outputs: { format: 'md', pattern: 'plans/test.md' },
    inputs: [],
    ...(overrides.nodeOverrides ?? {}),
  },
  status: 'completed',
  instances: [],
  ...overrides,
});

// Mock the per-kind renderers so this test isolates the dispatcher.
// Each mock renders a stable testid that proves which branch ran.
jest.mock('./MdNode', () => ({
  MdNodeStage: ({ outputPath }: { outputPath?: string }) => (
    <div data-testid="md-stage">{outputPath ?? 'no-path'}</div>
  ),
  MdNodeTile: ({ outputPath }: { outputPath?: string }) => (
    <div data-testid="md-tile">{outputPath ?? 'no-path'}</div>
  ),
}));
jest.mock('./JsonNode', () => ({
  JsonNodeStage: ({ outputPath }: { outputPath?: string }) => (
    <div data-testid="json-stage">{outputPath ?? 'no-path'}</div>
  ),
  JsonNodeTile: ({ outputPath, headlineField }: { outputPath?: string; headlineField?: string }) => (
    <div data-testid="json-tile" data-headline-field={headlineField}>{outputPath ?? 'no-path'}</div>
  ),
}));
jest.mock('./ImageNode', () => ({
  ImageNodeStage: ({ outputPath }: { outputPath?: string }) => (
    <div data-testid="image-stage">{outputPath ?? 'no-path'}</div>
  ),
  ImageNodeTile: ({ outputPath }: { outputPath?: string }) => (
    <div data-testid="image-tile">{outputPath ?? 'no-path'}</div>
  ),
}));
jest.mock('./VideoNode', () => ({
  VideoNodeStage: ({ outputPath }: { outputPath?: string }) => (
    <div data-testid="video-stage">{outputPath ?? 'no-path'}</div>
  ),
  VideoNodeTile: ({ outputPath }: { outputPath?: string }) => (
    <div data-testid="video-tile">{outputPath ?? 'no-path'}</div>
  ),
}));
jest.mock('./AudioNode', () => ({
  AudioNodeStage: ({ outputPath }: { outputPath?: string }) => (
    <div data-testid="audio-stage">{outputPath ?? 'no-path'}</div>
  ),
  AudioNodeTile: ({ outputPath }: { outputPath?: string }) => (
    <div data-testid="audio-tile">{outputPath ?? 'no-path'}</div>
  ),
}));
jest.mock('./TextNode', () => ({
  TextNodeStage: ({ outputPath }: { outputPath?: string }) => (
    <div data-testid="text-stage">{outputPath ?? 'no-path'}</div>
  ),
  TextNodeTile: ({ outputPath }: { outputPath?: string }) => (
    <div data-testid="text-tile">{outputPath ?? 'no-path'}</div>
  ),
}));

// xyflow NodeProps has many fields the dispatcher doesn't touch. Cast
// through unknown so the test only declares the props InspectorNode
// actually reads.
const renderNode = (data: InspectorNodeData) => {
  const props = {
    id: data.bundleNode.id,
    data,
    type: 'inspector',
    dragging: false,
    isConnectable: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    selected: false,
    selectable: false,
    deletable: false,
    draggable: false,
    zIndex: 0,
  };
  return render(<InspectorNode {...(props as unknown as Parameters<typeof InspectorNode>[0])} />);
};

describe('InspectorNode — kind dispatcher (Phase 3)', () => {
  describe('shared shell', () => {
    it('always exposes data-status attribute for CSS-driven status states', () => {
      renderNode(baseData({ status: 'running' }));
      expect(screen.getByTestId('inspector-node-test_node')).toHaveAttribute('data-status', 'running');
    });

    it('exposes data-format on the outer shell', () => {
      renderNode(baseData({
        nodeOverrides: { outputs: { format: 'json', pattern: 'x.json' } },
      }));
      expect(screen.getByTestId('inspector-node-test_node')).toHaveAttribute('data-format', 'json');
    });

    it('always exposes data-kind on the outer shell', () => {
      renderNode(baseData({ nodeOverrides: { kind: 'collection' } }));
      expect(screen.getByTestId('inspector-node-test_node')).toHaveAttribute('data-kind', 'collection');
    });

    it('shows the node id as the card label', () => {
      renderNode(baseData());
      expect(screen.getByText('test_node')).toBeInTheDocument();
    });
  });

  describe('stage dispatch', () => {
    it('format: md → MdNodeStage', () => {
      renderNode(baseData({
        nodeOverrides: { outputs: { format: 'md', pattern: 'a.md' } },
        instances: [{ stateKey: 'test_node', status: 'completed', outputPath: 'plans/a.md' }],
      }));
      expect(screen.getByTestId('md-stage')).toBeInTheDocument();
    });

    it('format: json → JsonNodeStage', () => {
      renderNode(baseData({
        nodeOverrides: { outputs: { format: 'json', pattern: 'a.json' } },
        instances: [{ stateKey: 'test_node', status: 'completed', outputPath: 'plans/a.json' }],
      }));
      expect(screen.getByTestId('json-stage')).toBeInTheDocument();
    });

    it('format: image → ImageNodeStage', () => {
      renderNode(baseData({
        nodeOverrides: { outputs: { format: 'image', pattern: 'a.png' } },
        instances: [{ stateKey: 'test_node', status: 'completed', outputPath: 'a.png' }],
      }));
      expect(screen.getByTestId('image-stage')).toBeInTheDocument();
    });

    it('format: video → VideoNodeStage', () => {
      renderNode(baseData({
        nodeOverrides: { outputs: { format: 'video', pattern: 'a.mp4' } },
        instances: [{ stateKey: 'test_node', status: 'completed', outputPath: 'a.mp4' }],
      }));
      expect(screen.getByTestId('video-stage')).toBeInTheDocument();
    });

    it('format: audio → AudioNodeStage', () => {
      renderNode(baseData({
        nodeOverrides: { outputs: { format: 'audio', pattern: 'a.mp3' } },
        instances: [{ stateKey: 'test_node', status: 'completed', outputPath: 'a.mp3' }],
      }));
      expect(screen.getByTestId('audio-stage')).toBeInTheDocument();
    });

    it('format: text → TextNodeStage', () => {
      renderNode(baseData({
        nodeOverrides: { outputs: { format: 'text', pattern: 'a.txt' } },
        instances: [{ stateKey: 'test_node', status: 'completed', outputPath: 'a.txt' }],
      }));
      expect(screen.getByTestId('text-stage')).toBeInTheDocument();
    });

    it('passes outputPath from the (single) instance to the stage renderer', () => {
      renderNode(baseData({
        nodeOverrides: { outputs: { format: 'json', pattern: 'a.json' } },
        instances: [{ stateKey: 'test_node', status: 'completed', outputPath: 'plans/output.json' }],
      }));
      expect(screen.getByTestId('json-stage')).toHaveTextContent('plans/output.json');
    });

    it('stage with no completed instance renders the renderer with no outputPath (pending state)', () => {
      renderNode(baseData({
        nodeOverrides: { outputs: { format: 'md', pattern: 'a.md' } },
        instances: [],
        status: 'pending',
      }));
      expect(screen.getByTestId('md-stage')).toHaveTextContent('no-path');
    });
  });

  describe('collection dispatch', () => {
    const collection = (instances: InspectorNodeData['instances']) =>
      baseData({
        nodeOverrides: {
          kind: 'collection',
          outputs: { format: 'json', pattern: 'prompts/{{item_id}}.json' },
          headlineField: 'deltaText',
        },
        instances,
      });

    it('renders one tile per completed instance', () => {
      renderNode(collection([
        { stateKey: 'test_node:scene_1_shot_1', itemId: 'scene_1_shot_1', status: 'completed', outputPath: 'prompts/scene_1_shot_1.json' },
        { stateKey: 'test_node:scene_1_shot_2', itemId: 'scene_1_shot_2', status: 'completed', outputPath: 'prompts/scene_1_shot_2.json' },
        { stateKey: 'test_node:scene_1_shot_3', itemId: 'scene_1_shot_3', status: 'completed', outputPath: 'prompts/scene_1_shot_3.json' },
      ]));
      expect(screen.getAllByTestId('json-tile')).toHaveLength(3);
    });

    it('passes outputPath + headlineField to each tile', () => {
      renderNode(collection([
        { stateKey: 'test_node:s1', itemId: 's1', status: 'completed', outputPath: 'prompts/s1.json' },
      ]));
      const tile = screen.getByTestId('json-tile');
      expect(tile).toHaveTextContent('prompts/s1.json');
      expect(tile).toHaveAttribute('data-headline-field', 'deltaText');
    });

    it('shows pending tiles too (no outputPath)', () => {
      renderNode(collection([
        { stateKey: 'test_node:s1', itemId: 's1', status: 'completed', outputPath: 'prompts/s1.json' },
        { stateKey: 'test_node:s2', itemId: 's2', status: 'pending' },
      ]));
      expect(screen.getAllByTestId('json-tile')).toHaveLength(2);
    });

    it('renders empty rail (no tiles) when no instances materialized', () => {
      renderNode(collection([]));
      expect(screen.queryAllByTestId('json-tile')).toHaveLength(0);
      expect(screen.getByText(/no items yet/i)).toBeInTheDocument();
    });

    it('caps the rendered tile count and surfaces a "+ N more" indicator', () => {
      // Mockup specifies ~7 visible tiles + "+ N more" for big rails.
      // The exact cap is an implementation detail but the indicator
      // must appear once N > visible cap.
      const many = Array.from({ length: 31 }, (_, i) => ({
        stateKey: `test_node:s${i + 1}`,
        itemId: `s${i + 1}`,
        status: 'completed' as const,
        outputPath: `prompts/s${i + 1}.json`,
      }));
      renderNode(collection(many));
      const visible = screen.getAllByTestId('json-tile').length;
      expect(visible).toBeLessThan(31);
      expect(screen.getByText(/\+ \d+ more/i)).toBeInTheDocument();
    });

    it('dispatches to the kind-specific tile (image collection → image-tile)', () => {
      renderNode(baseData({
        nodeOverrides: {
          kind: 'collection',
          outputs: { format: 'image', pattern: 'assets/shots/{{item_id}}.png' },
        },
        instances: [
          { stateKey: 'test_node:s1', itemId: 's1', status: 'completed', outputPath: 'assets/shots/s1.png' },
        ],
      }));
      expect(screen.getByTestId('image-tile')).toBeInTheDocument();
      expect(screen.queryByTestId('json-tile')).toBeNull();
    });
  });
});
