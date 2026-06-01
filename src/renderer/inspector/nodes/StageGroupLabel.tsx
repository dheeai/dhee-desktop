/**
 * StageGroupLabel — translucent labelled band behind a stage's
 * instance cards. Sits at z-index 0 so the InstanceCards render on
 * top. Used in the horizontal-row layout — label sits top-left with
 * the instance count alongside (×N for collection stages).
 */
interface StageGroupLabelData {
  stageId: string;
  width: number;
  height: number;
  instanceCount?: number;
}

export function StageGroupLabel({ data }: { data: StageGroupLabelData }) {
  return (
    <div
      style={{
        width: data.width,
        height: data.height,
        background: 'rgba(95, 136, 178, 0.04)',
        border: '1px dashed rgba(168, 156, 139, 0.16)',
        borderRadius: 14,
        pointerEvents: 'none',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 16,
          color: 'rgba(229, 225, 216, 0.65)',
          fontSize: 11,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontWeight: 700,
          letterSpacing: 0.9,
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <span>{data.stageId}</span>
        {data.instanceCount !== undefined && data.instanceCount > 1 && (
          <span style={{ color: 'rgba(229, 225, 216, 0.35)', fontSize: 10, fontWeight: 400, letterSpacing: 0.4 }}>
            ×{data.instanceCount}
          </span>
        )}
      </div>
    </div>
  );
}

export default StageGroupLabel;
