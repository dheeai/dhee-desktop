/**
 * Phase 2 placeholder card. Renders the bundle node's id + a status
 * indicator + an instance count. Per-kind renderers (ImageNode,
 * JsonNode, etc.) replace this in Phase 3.
 *
 * The test contract: this card carries `data-testid="inspector-node-<id>"`
 * and `data-status="<aggregate>"` so the canvas scaffold tests can
 * assert without needing xyflow's full render path.
 */
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import type { InspectorNodeData } from '../bundleToFlowGraph';
import styles from '../InspectorCanvas.module.scss';

type StubNodeProps = NodeProps & { data: InspectorNodeData };

export function StubNode({ data }: StubNodeProps) {
  const { bundleNode, status, instances } = data;
  const completedCount = instances.filter((i) => i.status === 'completed').length;

  return (
    <div
      className={styles.node}
      data-testid={`inspector-node-${bundleNode.id}`}
      data-status={status}
      data-kind={bundleNode.kind}
      data-format={bundleNode.outputs.format}
    >
      {/* xyflow handles — invisible unless we choose to show them */}
      <Handle type="target" position={Position.Left} className={styles.handle} />

      <div className={styles.nodeHead}>
        <span
          className={`${styles.statusDot} ${styles[`status-${status}`] ?? ''}`}
          aria-label={`status: ${status}`}
        />
        <span className={styles.nodeName}>{bundleNode.id}</span>
        <span className={styles.nodeKind}>{bundleNode.outputs.format}</span>
      </div>
      <div className={styles.nodeBody}>
        {bundleNode.kind === 'collection' ? (
          <span className={styles.muted}>
            {completedCount} / {instances.length} items
          </span>
        ) : (
          <span className={styles.muted}>
            {instances[0]?.outputPath ?? 'not yet generated'}
          </span>
        )}
        {bundleNode.displayCapability ? (
          <span className={styles.capabilityTag}>
            {bundleNode.displayCapability}
          </span>
        ) : null}
      </div>

      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}
