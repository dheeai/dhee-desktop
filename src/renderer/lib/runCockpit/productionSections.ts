/**
 * productionSections — derive the Production View's scrolling-document layout
 * AND its per-stage status/navigation pills from the run model.
 *
 * Replaces the coarse Film/Script/gallery "layers" (productionLayers.ts).
 * The reported bug: the old layer pills collapsed every text stage into one
 * "Script" pill and never followed the run, so story→prompts→motion all kept
 * "Script" lit. Here EVERY stage gets its own pill carrying its own live
 * status (so the running stage lights up), and stages map to body SECTIONS in
 * a single scrolling document. Pills navigate (scroll) to their section; they
 * never move the view on their own — the running state is indicate-only.
 *
 * Section kinds (bundle-agnostic — derived from stage kind + item id shape):
 *  - 'doc'    single-instance text/json stage → readable document (story, plan…)
 *  - 'board'  visual collection that ISN'T shot-keyed → reference board (cast, sets)
 *  - 'shots'  ALL shot-keyed collection stages MERGED → per-shot shot sheets
 *             (image prompt + frame(s) + motion directive + clip, joined by item id)
 *  - 'film'   terminal single visual artifact → the finished cut
 *
 * Pure; see productionSections.test.ts.
 */
import type { RunStageView, StageStatus } from './deriveRunModel';
import { parseSceneNo, parseShotNo } from './sceneGroups';

export type SectionKind = 'doc' | 'board' | 'shots' | 'film';

export interface ProductionSection {
  /** DOM id / scroll anchor + react key. */
  id: string;
  kind: SectionKind;
  label: string;
  /** Stage ids rendered in this section (the 'shots' section spans many). */
  stageIds: string[];
}

export interface StagePill {
  stageId: string;
  label: string;
  status: StageStatus;
  done: number;
  total: number;
  /** Section this pill scrolls to (several shot pills share the 'shots' id). */
  sectionId: string;
}

export interface ProductionLayout {
  sections: ProductionSection[];
  pills: StagePill[];
}

/** The id used for the single merged shot-sheets section. */
export const SHOTS_SECTION_ID = 'shots';

/**
 * A stage is "shot-keyed" when its items fan out per shot (item ids encode
 * both a scene and a shot). Falls back to an id heuristic before any item has
 * materialized so the pill still classifies correctly at run start.
 */
export function isShotKeyedStage(stage: RunStageView): boolean {
  if (!stage.collection) return false;
  const withItems = stage.items.filter((i) => i.itemId);
  if (withItems.length > 0) {
    return withItems.some(
      (i) => parseSceneNo(i.itemId) !== null && parseShotNo(i.itemId) !== null,
    );
  }
  // No items yet — guess from the node id (e.g. shot_image_prompt, shot_video).
  return /shot/i.test(stage.id);
}

/** The terminal single-artifact visual stage (the finished cut), or null. */
function findFilmStage(stages: RunStageView[]): RunStageView | null {
  let film: RunStageView | null = null;
  for (const s of stages) {
    if (s.kind === 'visual' && s.total === 1 && !s.collection) film = s; // last wins
  }
  return film;
}

export function buildProductionLayout(stages: RunStageView[]): ProductionLayout {
  const film = findFilmStage(stages);
  const sections: ProductionSection[] = [];
  const pills: StagePill[] = [];
  let shotsSectionPlaced = false;

  for (const s of stages) {
    if (s === film) {
      sections.push({ id: 'film', kind: 'film', label: s.label, stageIds: [s.id] });
      pills.push(pillFor(s, 'film'));
      continue;
    }

    if (isShotKeyedStage(s)) {
      // Every shot-keyed stage feeds the single merged shot-sheets section.
      if (!shotsSectionPlaced) {
        sections.push({ id: SHOTS_SECTION_ID, kind: 'shots', label: 'Shots', stageIds: [s.id] });
        shotsSectionPlaced = true;
      } else {
        const shotsSection = sections.find((sec) => sec.id === SHOTS_SECTION_ID);
        shotsSection?.stageIds.push(s.id);
      }
      pills.push(pillFor(s, SHOTS_SECTION_ID));
      continue;
    }

    if (s.kind === 'visual') {
      // Non-shot-keyed visual collection (or single) → reference board.
      sections.push({ id: s.id, kind: 'board', label: s.label, stageIds: [s.id] });
      pills.push(pillFor(s, s.id));
      continue;
    }

    // text / json single-or-small stage → its own readable document section.
    sections.push({ id: s.id, kind: 'doc', label: s.label, stageIds: [s.id] });
    pills.push(pillFor(s, s.id));
  }

  return { sections, pills };
}

function pillFor(s: RunStageView, sectionId: string): StagePill {
  return {
    stageId: s.id,
    label: s.label,
    status: s.status,
    done: s.done,
    total: s.total,
    sectionId,
  };
}
