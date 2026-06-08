/**
 * productionLayers — derive the Production View's layer bar from the run
 * model's stages. Bundle-agnostic: nothing here knows "shots" or "video".
 *
 *   · Film    — the terminal single visual artifact (the finished cut), if any.
 *   · Script  — ALL text stages collapsed into one reading room.
 *   · gallery — a visual stage whose items encode scenes (→ scene film-strips).
 *   · board   — a visual stage whose items don't (→ flat reference board).
 *
 * Order: Film, Script, galleries (bundle order), boards (bundle order).
 * See productionLayers.test.ts.
 */
import type { RunStageView } from './deriveRunModel';
import { humanizeId } from './vocab';
import { groupByScene, hasScenes } from './sceneGroups';

export type LayerKind = 'film' | 'script' | 'gallery' | 'board';

export interface ProductionLayer {
  /** 'film' | 'script' | a stage id. */
  id: string;
  label: string;
  kind: LayerKind;
  /** Stage ids this layer renders (Script spans many; others one). */
  stageIds: string[];
  /** Total items across the layer's stages (for the count badge). */
  count: number;
}

/**
 * The terminal single-artifact visual stage (the finished cut), or null.
 * Must be a single 'stage' node (not a 1-item collection) so a fan-out
 * stage that happens to have one item isn't mistaken for the final cut.
 */
function findFilmStage(stages: RunStageView[]): RunStageView | null {
  let film: RunStageView | null = null;
  for (const s of stages) {
    if (s.kind === 'visual' && s.total === 1 && !s.collection) film = s; // last one wins
  }
  return film;
}

export function buildProductionLayers(stages: RunStageView[]): ProductionLayer[] {
  const film = findFilmStage(stages);
  const textStages = stages.filter((s) => s.kind === 'text');
  const visualStages = stages.filter((s) => s.kind === 'visual' && s !== film);

  const galleries: ProductionLayer[] = [];
  const boards: ProductionLayer[] = [];
  for (const s of visualStages) {
    const layer: ProductionLayer = {
      id: s.id,
      label: humanizeId(s.id),
      kind: hasScenes(groupByScene(s.items)) ? 'gallery' : 'board',
      stageIds: [s.id],
      count: s.total,
    };
    (layer.kind === 'gallery' ? galleries : boards).push(layer);
  }

  const layers: ProductionLayer[] = [];
  if (film) {
    layers.push({ id: 'film', label: 'Film', kind: 'film', stageIds: [film.id], count: film.total });
  }
  if (textStages.length > 0) {
    layers.push({
      id: 'script',
      label: 'Script',
      kind: 'script',
      stageIds: textStages.map((s) => s.id),
      count: textStages.reduce((a, s) => a + s.total, 0),
    });
  }
  return layers.concat(galleries, boards);
}

/**
 * Sensible default layer: Film once any visual artifact has landed; else the
 * Script reading room (the writing phase); else the first layer.
 */
export function pickDefaultLayer(stages: RunStageView[], layers: ProductionLayer[]): string | null {
  if (layers.length === 0) return null;
  const hasVisualOutput = stages.some((s) => s.kind === 'visual' && s.done > 0);
  if (hasVisualOutput && layers.some((l) => l.kind === 'film')) return 'film';
  const script = layers.find((l) => l.kind === 'script');
  if (script && !hasVisualOutput) return 'script';
  return layers[0].id;
}
