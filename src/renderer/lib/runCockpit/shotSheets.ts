/**
 * shotSheets — join every per-shot artifact into one "shot sheet".
 *
 * The shot-keyed stages (image prompt, frame, last-frame prompt, last frame,
 * motion directive, clip) all fan out on the SAME item id, e.g.
 * `scene_1_shot_3`. The Production View's permanent home for prompts &
 * directives is a per-shot card that shows ALL of that shot's artifacts
 * together. This reducer groups the run model's shot-keyed instances by item
 * id into ordered ShotSheets — bundle-agnostic: it doesn't know "first frame"
 * or "motion", it just collects each shot-keyed stage's artifact for the shot,
 * in pipeline order, and lets the renderer project each by format.
 *
 * Presence/absence falls out naturally: a single-frame shot simply has no
 * last-frame entries; a shot mid-render has its clip entry still in_progress.
 *
 * Pure; see shotSheets.test.ts.
 */
import type { RunStageView, RunDeliverable } from './deriveRunModel';
import type { ArtifactFormat } from './artifactFormat';
import { isShotKeyedStage } from './productionSections';
import { parseSceneNo, parseShotNo } from './sceneGroups';

export type ShotSheetStatus = 'done' | 'running' | 'queued';

export interface ShotEntry {
  /** Deliverable key `${nodeId}:${itemId}` — opens the detail modal. */
  key: string;
  stageId: string;
  stageLabel: string;
  format: ArtifactFormat;
  status: RunDeliverable['status'];
  outputPath?: string;
  ts?: number;
  /** Set for json/md text artifacts so the renderer can project the headline. */
  headlineField?: string;
  /** True for json/md → render readable text; false → render media. */
  isText: boolean;
  /** 'last' for last-frame artifacts, 'first' for other frame media, else null. */
  frameRole: 'first' | 'last' | null;
}

export interface ShotSheet {
  /** The shared item id, e.g. `scene_1_shot_3`. */
  key: string;
  itemId: string;
  sceneNo: number | null;
  shotNo: number | null;
  label: string;
  /** Entries in pipeline (stage) order. */
  entries: ShotEntry[];
  status: ShotSheetStatus;
}

function frameRoleOf(stageId: string, outputPath: string | undefined, format: ArtifactFormat): 'first' | 'last' | null {
  const hay = `${stageId} ${outputPath ?? ''}`;
  if (/last/i.test(hay)) return 'last';
  if (format === 'image') return 'first';
  return null;
}

function rollup(entries: ShotEntry[]): ShotSheetStatus {
  if (entries.some((e) => e.status === 'in_progress')) return 'running';
  if (entries.length > 0 && entries.every((e) => e.status === 'completed')) return 'done';
  return 'queued';
}

/**
 * @param stages         the run model's stages (already in pipeline order)
 * @param headlineFields per-stageId headlineField (from bundle node metadata)
 */
export function buildShotSheets(
  stages: RunStageView[],
  headlineFields: Map<string, string | undefined> = new Map(),
): ShotSheet[] {
  const shotStages = stages.filter(isShotKeyedStage);
  const byItem = new Map<string, ShotEntry[]>();
  const orderSeen: string[] = [];

  for (const stage of shotStages) {
    for (const it of stage.items) {
      if (!it.itemId) continue;
      const isText = it.format === 'json' || it.format === 'md';
      const entry: ShotEntry = {
        key: it.key,
        stageId: stage.id,
        stageLabel: stage.label,
        format: it.format,
        status: it.status,
        outputPath: it.outputPath,
        ts: it.ts,
        headlineField: headlineFields.get(stage.id),
        isText,
        frameRole: frameRoleOf(stage.id, it.outputPath, it.format),
      };
      const list = byItem.get(it.itemId);
      if (list) list.push(entry);
      else {
        byItem.set(it.itemId, [entry]);
        orderSeen.push(it.itemId);
      }
    }
  }

  const sheets: ShotSheet[] = orderSeen.map((itemId) => {
    const entries = byItem.get(itemId)!;
    const sceneNo = parseSceneNo(itemId);
    const shotNo = parseShotNo(itemId);
    const label =
      sceneNo !== null && shotNo !== null
        ? `Scene ${sceneNo} · Shot ${shotNo}`
        : shotNo !== null
          ? `Shot ${shotNo}`
          : itemId;
    return { key: itemId, itemId, sceneNo, shotNo, label, entries, status: rollup(entries) };
  });

  // Sort by scene then shot (numeric), unknowns last by item id.
  sheets.sort((a, b) => {
    if (a.sceneNo !== b.sceneNo) return (a.sceneNo ?? 1e9) - (b.sceneNo ?? 1e9);
    if (a.shotNo !== b.shotNo) return (a.shotNo ?? 1e9) - (b.shotNo ?? 1e9);
    return a.itemId.localeCompare(b.itemId);
  });

  return sheets;
}
