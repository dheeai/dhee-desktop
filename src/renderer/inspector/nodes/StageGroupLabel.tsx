/**
 * StageGroupLabel — a translucent labeled rectangle behind a stage's
 * instance cards. Pure decoration: no Handle, not selectable,
 * not draggable. Z-index 0 so it sits under the InstanceCard nodes.
 */
interface StageGroupLabelData {
  stageId: string;
  width: number;
  height: number;
}

export function StageGroupLabel({ data }: { data: StageGroupLabelData }) {
  return (
    <div
      style={{
        width: data.width,
        height: data.height,
        background: 'rgba(95, 136, 178, 0.05)',
        border: '1px dashed rgba(168, 156, 139, 0.18)',
        borderRadius: 12,
        pointerEvents: 'none',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 14,
          color: 'rgba(229, 225, 216, 0.55)',
          fontSize: 10,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontWeight: 600,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        }}
      >
        {data.stageId}
      </div>
    </div>
  );
}

export default StageGroupLabel;
