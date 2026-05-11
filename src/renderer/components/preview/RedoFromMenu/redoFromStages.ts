/**
 * User-facing "Redo from..." stages.
 *
 * The dropdown in the PreviewPanel header uses these labels — internal
 * stage names (scene_video_prompt, shot_image_prompt, …) NEVER appear
 * in the UI. Each entry maps to the kshana-core typeId(s) that get
 * marked pending plus a friendly downstream description for the
 * confirmation modal.
 *
 * Order is the natural writing → rendering progression. Resetting
 * from a stage marks that stage AND everything below it pending,
 * matching the executor's dependents-cascade behavior.
 */

export interface RedoFromStage {
  /** Stable key used by the dropdown UI; not surfaced to the user. */
  key: string;
  /** User-facing label — what they see in the dropdown. */
  label: string;
  /** One-line plain-English description for the confirmation modal. */
  description: string;
  /**
   * kshana-core typeIds to invalidate. Per-item nodes of these types
   * (e.g. `scene_video_prompt:scene_1`, `scene_video_prompt:scene_2`,
   * …) are all marked pending. Cascade-invalidation through the
   * dependents chain takes care of everything downstream.
   */
  typeIds: string[];
}

/**
 * Ordered top → bottom: top entries redo the most work, bottom
 * entries the least. The dropdown lists them in this order so users
 * scan from "earliest in the pipeline" to "latest."
 */
export const REDO_FROM_STAGES: RedoFromStage[] = [
  {
    key: 'plot',
    label: 'Story idea',
    description: 'Rewrite the initial plot outline from your input.',
    typeIds: ['plot'],
  },
  {
    key: 'story',
    label: 'Screenplay',
    description: 'Rewrite the full story / screenplay prose.',
    typeIds: ['story'],
  },
  {
    key: 'characters',
    label: 'Characters & settings',
    description: 'Regenerate every character and setting profile.',
    typeIds: ['character', 'setting'],
  },
  {
    key: 'scene',
    label: 'Scene scripts',
    description: 'Rewrite the per-scene prose for every scene.',
    typeIds: ['scene'],
  },
  {
    key: 'world_style',
    label: 'Visual style',
    description: 'Rewrite the visual-style sheet that anchors every image.',
    typeIds: ['world_style'],
  },
  {
    key: 'reference_images',
    label: 'Reference images',
    description: 'Regenerate every character, setting, and object reference image.',
    typeIds: ['character_image', 'setting_image', 'object_image'],
  },
  {
    key: 'scene_breakdowns',
    label: 'Scene breakdowns',
    description: 'Replan each scene\'s shot list and per-shot details from scratch.',
    typeIds: ['scene_shot_plan', 'shot_breakdown', 'scene_video_prompt'],
  },
  {
    key: 'shot_compositions',
    label: 'Shot compositions',
    description: 'Rewrite every shot\'s image-generation prompt.',
    typeIds: ['shot_image_prompt'],
  },
  {
    key: 'shot_motion_directives',
    label: 'Shot motion directives',
    description: 'Rewrite every shot\'s motion / camera-move directive.',
    typeIds: ['shot_motion_directive'],
  },
  {
    key: 'shot_images',
    label: 'Shot images',
    description: 'Re-render every shot\'s first and last frame images.',
    typeIds: ['shot_image', 'shot_image_last_frame'],
  },
  {
    key: 'shot_videos',
    label: 'Shot videos',
    description: 'Re-render every per-shot video clip.',
    typeIds: ['shot_video'],
  },
  {
    key: 'final_video',
    label: 'Final video',
    description: 'Re-stitch the final assembled video from the existing shot clips.',
    typeIds: ['final_video'],
  },
];

/**
 * Given a target stage, return the ordered list of stages that will
 * actually get redone — the target stage plus everything below it.
 * The confirmation modal renders this as a bullet list.
 */
export function downstreamStages(target: RedoFromStage): RedoFromStage[] {
  const i = REDO_FROM_STAGES.findIndex(s => s.key === target.key);
  if (i < 0) return [];
  return REDO_FROM_STAGES.slice(i);
}

/**
 * Pick out the executor node ids whose typeId is in `typeIds`. Reads
 * the project.json executorState — the desktop already has this on
 * disk via the workspace's project directory.
 *
 * Returns full node ids (e.g. `scene_video_prompt:scene_1`) so the
 * existing `session.invalidateNodes(nodeIds)` IPC can cascade the
 * mark-pending walk via applyInvalidation server-side.
 */
export function resolveNodeIdsForTypeIds(
  projectJsonText: string,
  typeIds: string[],
): string[] {
  const wanted = new Set(typeIds);
  let parsed: { executorState?: { nodes?: Record<string, { typeId?: string }> } };
  try {
    parsed = JSON.parse(projectJsonText);
  } catch {
    return [];
  }
  const nodes = parsed.executorState?.nodes ?? {};
  const ids: string[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    if (node && typeof node === 'object' && typeof node.typeId === 'string' && wanted.has(node.typeId)) {
      ids.push(id);
    }
  }
  return ids;
}
