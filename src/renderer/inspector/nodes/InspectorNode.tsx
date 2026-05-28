/**
 * InspectorNode — the kind dispatcher.
 *
 * Single React Flow node type. Reads `bundleNode.kind` to choose
 * between stage (single artifact) and collection (rail of per-item
 * artifacts), then dispatches on `bundleNode.outputs.format` to the
 * right kind-specific renderer.
 *
 * The status shell (data-status, status dot, header) lives here so all
 * kinds share status visualization. Per-kind renderers focus on the
 * artifact body — they don't worry about borders, dots, or capability
 * badges.
 */
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import type { InspectorNodeData } from '../bundleToFlowGraph';
import { MdNodeStage, MdNodeTile } from './MdNode';
import { JsonNodeStage, JsonNodeTile } from './JsonNode';
import { ImageNodeStage, ImageNodeTile } from './ImageNode';
import { VideoNodeStage, VideoNodeTile } from './VideoNode';
import { AudioNodeStage, AudioNodeTile } from './AudioNode';
import { TextNodeStage, TextNodeTile } from './TextNode';
import { RegenerateMenu } from './RegenerateMenu';
import { useInspectorActions } from '../InspectorActionContext';
import styles from '../InspectorCanvas.module.scss';

type Props = NodeProps & { data: InspectorNodeData };

/**
 * Visible-tile cap for collection rails. Anything beyond renders as a
 * "+ N more" indicator. The cap is set so the rail fits inside the
 * 360px-wide collection card without elk needing to allocate extra
 * horizontal space. 3 visible tiles + one "+ N more" + horizontal
 * scroll for the rest covers the zoomed-out view; the user pans
 * inside the rail to see more.
 */
const RAIL_VISIBLE_CAP = 3;

interface KindRenderers {
  Stage: (props: { outputPath?: string; headlineField?: string }) => JSX.Element;
  Tile: (props: { outputPath?: string; headlineField?: string; itemId?: string; status: string }) => JSX.Element;
}

function rendererFor(format: string): KindRenderers {
  switch (format) {
    case 'md':
      return { Stage: MdNodeStage, Tile: MdNodeTile };
    case 'json':
      return { Stage: JsonNodeStage, Tile: JsonNodeTile };
    case 'image':
      return { Stage: ImageNodeStage, Tile: ImageNodeTile };
    case 'video':
      return { Stage: VideoNodeStage, Tile: VideoNodeTile };
    case 'audio':
      return { Stage: AudioNodeStage, Tile: AudioNodeTile };
    case 'text':
    default:
      return { Stage: TextNodeStage, Tile: TextNodeTile };
  }
}

export function InspectorNode({ data }: Props) {
  const { bundleNode, status, instances, isGoal } = data;
  const format = bundleNode.outputs.format;
  const { Stage, Tile } = rendererFor(format);
  const { onGoalClick } = useInspectorActions();

  const completedInstance = instances.find((i) => i.status === 'completed');
  // For stages, regen targets the bare nodeId. For collections, the
  // CARD-level menu (right-click on the rail header) targets the
  // bundle node id with no item — meaning "rerun every item". Per-
  // item regen lives on the individual tile (one level below, in
  // CollectionBody).
  const cardRegenNodeId = completedInstance || bundleNode.kind === 'collection'
    ? bundleNode.id
    : undefined;

  const body = bundleNode.kind === 'collection' ? (
    <CollectionBody
      bundleNodeId={bundleNode.id}
      instances={instances}
      headlineField={bundleNode.headlineField}
      Tile={Tile}
    />
  ) : (
    <Stage
      outputPath={completedInstance?.outputPath}
      headlineField={bundleNode.headlineField}
    />
  );

  // Goal-node click: fire the deep-link callback (e.g. open Watch
  // tab). Wired to the body div, not the head — the head exposes
  // status info + capability tag the user might want to read.
  const onBodyClick = isGoal && onGoalClick
    ? () => onGoalClick(bundleNode.id)
    : undefined;

  return (
    <RegenerateMenu
      nodeId={cardRegenNodeId}
      outputPath={completedInstance?.outputPath}
    >
      <div
        className={`${styles.node} ${isGoal ? styles.goal : ''}`}
        data-testid={`inspector-node-${bundleNode.id}`}
        data-status={status}
        data-kind={bundleNode.kind}
        data-format={format}
        data-goal={isGoal ? 'true' : undefined}
      >
        {isGoal ? <div className={styles.goalFlag}>Goal</div> : null}
        <Handle type="target" position={Position.Left} className={styles.handle} />
        <div className={styles.nodeHead}>
          <span
            className={`${styles.statusDot} ${styles[`status-${status}`] ?? ''}`}
            aria-label={`status: ${status}`}
          />
          <span className={styles.nodeName}>{bundleNode.id}</span>
          <span className={styles.nodeKind}>{format}</span>
        </div>
        <div
          className={`${styles.nodeBody} ${onBodyClick ? styles.clickable : ''}`}
          onClick={onBodyClick}
        >
          {body}
        </div>
        {bundleNode.displayCapability ? (
          <div className={styles.nodeFoot}>
            <span className={styles.capabilityTag}>{bundleNode.displayCapability}</span>
          </div>
        ) : null}
        <Handle type="source" position={Position.Right} className={styles.handle} />
      </div>
    </RegenerateMenu>
  );
}

interface CollectionBodyProps {
  bundleNodeId: string;
  instances: InspectorNodeData['instances'];
  headlineField?: string;
  Tile: KindRenderers['Tile'];
}

function CollectionBody({ bundleNodeId, instances, headlineField, Tile }: CollectionBodyProps) {
  if (instances.length === 0) {
    return (
      <div className={styles.railEmpty} data-testid="collection-empty">
        no items yet
      </div>
    );
  }
  const visible = instances.slice(0, RAIL_VISIBLE_CAP);
  const overflow = instances.length - visible.length;
  return (
    <div className={styles.rail}>
      {visible.map((inst) => {
        // Per-instance regen — collection instance key is the contract
        // PromptsView + the dhee-core ConversationManager.redoNode
        // both follow: '<nodeId>:<itemId>' targets one shot, one
        // character, etc.
        const tileNodeId = inst.itemId
          ? `${bundleNodeId}:${inst.itemId}`
          : undefined;
        return (
          <RegenerateMenu
            key={inst.stateKey}
            nodeId={tileNodeId}
            outputPath={inst.outputPath}
          >
            <Tile
              outputPath={inst.outputPath}
              headlineField={headlineField}
              itemId={inst.itemId}
              status={inst.status}
            />
          </RegenerateMenu>
        );
      })}
      {overflow > 0 ? (
        <div className={styles.railMore} data-testid="collection-more">
          + {overflow} more
        </div>
      ) : null}
    </div>
  );
}
