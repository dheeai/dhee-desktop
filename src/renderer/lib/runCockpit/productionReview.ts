import type { DeriveBundleNode, RunModel } from './deriveRunModel';
import type { ProductionDoc } from './productionModel';

export type ReviewItemStatus =
  | 'ready'
  | 'missing'
  | 'running'
  | 'failed'
  | 'stale'
  | 'unconfigured';
export interface ReviewItem {
  id: string;
  label: string;
  status: ReviewItemStatus;
  sectionId?: string;
}
export interface ReviewCheckpoint {
  id: string;
  title: string;
  status: 'ready' | 'incomplete' | 'attention';
  items: ReviewItem[];
}
export function buildProductionReview(
  model: RunModel,
  nodes: DeriveBundleNode[],
  doc: ProductionDoc,
): ReviewCheckpoint[] {
  // Only the known narrative contract is mapped here. Other bundles keep their
  // generic production view until they declare their own review metadata.
  if (
    !nodes.some((n) => n.id === 'story') ||
    !nodes.some((n) => n.id === 'scenes_plan') ||
    !nodes.some((n) => n.id === 'final_video' && n.outputs?.format === 'video')
  )
    return [];

  const item = (id: string, label: string): ReviewItem => {
    const stage = model.stages.find((s) => s.id === id);
    let status: ReviewItemStatus = 'missing';
    if (!nodes.some((n) => n.id === id)) status = 'unconfigured';
    else if (stage) {
      if (stage.failed > 0) status = 'failed';
      else if (stage.invalidated > 0) status = 'stale';
      else if (stage.running > 0) status = 'running';
      else if (
        stage.total > 0 &&
        stage.items.length >= stage.total &&
        stage.items.every((i) => i.status === 'completed' && !!i.outputPath)
      )
        status = 'ready';
    }
    return {
      id,
      label,
      status,
      sectionId: doc.pills.find((p) => p.stageId === id)?.sectionId,
    };
  };
  const checkpoint = (
    id: string,
    title: string,
    items: ReviewItem[],
  ): ReviewCheckpoint => {
    let status: ReviewCheckpoint['status'] = 'incomplete';
    if (items.some((i) => i.status === 'failed' || i.status === 'stale'))
      status = 'attention';
    else if (items.every((i) => i.status === 'ready')) status = 'ready';
    return { id, title, items, status };
  };
  const optional = (ids: string[]) =>
    nodes
      .filter((n) => ids.includes(n.id))
      .map((n) => item(n.id, n.displayName ?? n.id.replace(/_/g, ' ')));
  return [
    checkpoint('storyboard', 'Script & storyboard', [
      item('story', 'Script'),
      item('scenes_plan', 'Scene plan'),
      ...optional(['shot_image_prompt', 'shot_motion_directive']),
    ]),
    checkpoint('references', 'Character & voice references', [
      item('character_image', 'Character references'),
      ...optional(['setting_image']),
      // Audio output alone cannot establish voice identity or reference intent.
      // No current narrative bundle declares an explicit voice-reference contract.
      {
        id: 'voice-reference',
        label: 'Voice reference — not configured; review speech in clips',
        status: 'unconfigured',
      },
    ]),
    checkpoint('rough-cut', 'Rough cut', [
      ...optional([
        'shot_image',
        'shot_image_last_frame',
        'shot_video',
        'scene_clip',
      ]),
      item('final_video', 'Assembled video'),
    ]),
  ];
}
