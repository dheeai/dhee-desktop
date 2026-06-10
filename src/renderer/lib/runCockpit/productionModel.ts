/**
 * productionModel — THE pure function behind the Production View.
 *
 * Event source (run model) → one fully-resolved view-model shape. ALL of the
 * grouping, classification, pairing, labelling and status rollup happens here,
 * ONCE — so the React layer is a dumb loop with no logic and nothing to
 * recompute per render. Pure + unit-tested (productionModel.test.ts).
 *
 * The shape:
 *   ProductionDoc { pills, sections }
 *     pills    — one per stage, carrying live status (running pill lights up);
 *                each points at the section it scrolls to.
 *     sections — ordered; each fully resolved by kind:
 *       · 'doc'    readable document(s) — story/essence/world, or a collection
 *                  of per-item docs (e.g. character prompts). `collapsed` for
 *                  the *_plan blueprint breakdowns.
 *       · 'board'  gallery of media tiles (non-shot visual collection).
 *       · 'sheets' per-shot sheets — each entity card already has its artifacts
 *                  PAIRED (media + the text that produced it), side by side.
 *       · 'film'   the finished cut (terminal single visual), with hero phase.
 */
import type { RunModel, RunStageView, RunDeliverable, StageStatus } from './deriveRunModel';
import type { ArtifactFormat } from './artifactFormat';
import { parseSceneNo, parseShotNo } from './sceneGroups';

export type EntityStatus = 'done' | 'running' | 'queued';

export interface ArtifactRef {
  key: string;
  nodeId: string;
  itemId?: string;
  stageLabel: string;
  /** Humanized item label (for board tile captions). */
  label: string;
  outputPath?: string;
  format: ArtifactFormat;
  status: RunDeliverable['status'];
  ts?: number;
  /** json/md → render readable text; else render media. */
  isText: boolean;
  headlineField?: string;
  /** 'last' for last-frame artifacts, 'first' for other frame media, else null. */
  frameRole: 'first' | 'last' | null;
}

/** A media artifact paired with the text that produced it (frame+prompt, clip+directive). */
export interface ArtifactPair {
  media?: ArtifactRef;
  text?: ArtifactRef;
  /** Short tag for the media side: 'first frame' | 'last frame' | 'clip' | stage label. */
  mediaTag: string;
  expectVideo: boolean;
}

export interface EntityCard {
  key: string;
  label: string;
  status: EntityStatus;
  pairs: ArtifactPair[];
  /** Header thumbnail (first completed image), if any. */
  thumb?: ArtifactRef;
  artifactCount: number;
}

export type HeroPhase = 'new' | 'writing' | 'rendering' | 'assembling' | 'finished';

export type Section =
  | { kind: 'doc'; id: string; label: string; format?: string; collapsed: boolean; writing: boolean; items: ArtifactRef[] }
  | { kind: 'board'; id: string; label: string; portrait: boolean; tiles: ArtifactRef[] }
  | { kind: 'sheets'; id: string; label: string; entities: EntityCard[] }
  | { kind: 'film'; id: string; label: string; phase: HeroPhase; final?: ArtifactRef; recent: ArtifactRef[] };

export interface StagePill {
  stageId: string;
  label: string;
  status: StageStatus;
  done: number;
  total: number;
  sectionId: string;
}

export interface ProductionDoc {
  pills: StagePill[];
  sections: Section[];
}

const SHOTS_ID = 'shots';
const BLUEPRINT_RE = /_plan$|breakdown/i;

function isShotKeyed(stage: RunStageView): boolean {
  if (!stage.collection) return false;
  const withItems = stage.items.filter((i) => i.itemId);
  if (withItems.length > 0) {
    return withItems.some((i) => parseSceneNo(i.itemId) !== null && parseShotNo(i.itemId) !== null);
  }
  return /shot/i.test(stage.id);
}

function findFilmStage(stages: RunStageView[]): RunStageView | null {
  let film: RunStageView | null = null;
  for (const s of stages) {
    if (s.kind === 'visual' && s.total === 1 && !s.collection) film = s;
  }
  return film;
}

function toRef(it: RunDeliverable, stage: RunStageView, headlineField: string | undefined): ArtifactRef {
  const hay = `${stage.id} ${it.outputPath ?? ''}`;
  const frameRole: 'first' | 'last' | null = /last/i.test(hay) ? 'last' : it.format === 'image' ? 'first' : null;
  return {
    key: it.key,
    nodeId: it.nodeId,
    itemId: it.itemId,
    stageLabel: stage.label,
    label: it.label,
    outputPath: it.outputPath,
    format: it.format,
    status: it.status,
    ts: it.ts,
    isText: it.format === 'json' || it.format === 'md',
    headlineField,
    frameRole,
  };
}

/** Pair media with the nearest preceding unpaired text (pipeline order). */
function pairEntries(refs: ArtifactRef[]): ArtifactPair[] {
  const pairs: ArtifactPair[] = [];
  let pendingText: ArtifactRef | undefined;
  const push = (media: ArtifactRef | undefined, text: ArtifactRef | undefined) => {
    const expectVideo = media?.format === 'video' || (!!text && /motion|clip|video/i.test(text.nodeId));
    const role = media?.frameRole ?? text?.frameRole ?? null;
    const mediaTag = expectVideo ? 'clip' : role === 'last' ? 'last frame' : role === 'first' ? 'first frame' : media?.stageLabel ?? text?.stageLabel ?? 'media';
    pairs.push({ media, text, mediaTag, expectVideo });
  };
  for (const r of refs) {
    if (r.isText) {
      if (pendingText) push(undefined, pendingText);
      pendingText = r;
    } else {
      push(r, pendingText);
      pendingText = undefined;
    }
  }
  if (pendingText) push(undefined, pendingText);
  return pairs;
}

function rollup(refs: ArtifactRef[]): EntityStatus {
  if (refs.some((r) => r.status === 'in_progress')) return 'running';
  if (refs.length > 0 && refs.every((r) => r.status === 'completed')) return 'done';
  return 'queued';
}

function entityLabel(itemId: string): string {
  const sc = parseSceneNo(itemId);
  const sh = parseShotNo(itemId);
  if (sc !== null && sh !== null) return `Scene ${sc} · Shot ${sh}`;
  if (sh !== null) return `Shot ${sh}`;
  if (sc !== null) return `Scene ${sc}`;
  return itemId.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildEntities(shotStages: RunStageView[], headlineFields: Map<string, string | undefined>): EntityCard[] {
  const byItem = new Map<string, ArtifactRef[]>();
  const order: string[] = [];
  for (const stage of shotStages) {
    for (const it of stage.items) {
      if (!it.itemId) continue;
      const ref = toRef(it, stage, headlineFields.get(stage.id));
      const list = byItem.get(it.itemId);
      if (list) list.push(ref);
      else {
        byItem.set(it.itemId, [ref]);
        order.push(it.itemId);
      }
    }
  }
  const cards: EntityCard[] = order.map((itemId) => {
    const refs = byItem.get(itemId)!;
    return {
      key: itemId,
      label: entityLabel(itemId),
      status: rollup(refs),
      pairs: pairEntries(refs),
      thumb: refs.find((r) => r.format === 'image' && r.status === 'completed' && r.outputPath),
      artifactCount: refs.length,
    };
  });
  cards.sort((a, b) => {
    const [as, bs] = [parseSceneNo(a.key), parseSceneNo(b.key)];
    const [ash, bsh] = [parseShotNo(a.key), parseShotNo(b.key)];
    if (as !== bs) return (as ?? 1e9) - (bs ?? 1e9);
    if (ash !== bsh) return (ash ?? 1e9) - (bsh ?? 1e9);
    return a.key.localeCompare(b.key);
  });
  return cards;
}

function heroPhase(model: RunModel, film: RunStageView | null): HeroPhase {
  const anyVisualDone = model.stages.some((s) => s.kind === 'visual' && s.done > 0);
  const running = model.activity === 'running' || model.activity === 'thinking' || model.activity === 'cancelling';
  if (film && film.done > 0) return 'finished';
  if (film && film.running > 0) return 'assembling';
  if (anyVisualDone) return 'rendering';
  if (running) return 'writing';
  return 'new';
}

export function buildProductionDoc(
  model: RunModel,
  headlineFields: Map<string, string | undefined> = new Map(),
): ProductionDoc {
  const stages = model.stages;
  const film = findFilmStage(stages);
  const byId = new Map(stages.map((s) => [s.id, s]));
  const sections: Section[] = [];
  const pills: StagePill[] = [];
  let shotStageIds: string[] = [];

  const pill = (s: RunStageView, sectionId: string): StagePill => ({
    stageId: s.id, label: s.label, status: s.status, done: s.done, total: s.total, sectionId,
  });

  for (const s of stages) {
    if (s === film) {
      sections.push({
        kind: 'film', id: 'film', label: s.label, phase: heroPhase(model, film),
        final: s.items.find((i) => i.status === 'completed' && i.outputPath) && toRef(s.items.find((i) => i.status === 'completed' && i.outputPath)!, s, undefined),
        recent: stages.filter((x) => x.kind === 'visual').flatMap((x) => x.items)
          .filter((i) => i.status === 'completed' && i.outputPath && i.format === 'image').slice(-5)
          .map((i) => toRef(i, byId.get(i.nodeId) ?? s, undefined)),
      });
      pills.push(pill(s, 'film'));
      continue;
    }
    if (isShotKeyed(s)) {
      if (shotStageIds.length === 0) sections.push({ kind: 'sheets', id: SHOTS_ID, label: 'Shots', entities: [] });
      shotStageIds.push(s.id);
      pills.push(pill(s, SHOTS_ID));
      continue;
    }
    if (s.kind === 'visual') {
      const portrait = s.format === 'image' && /char|cast|person|actor/i.test(s.id);
      sections.push({ kind: 'board', id: s.id, label: s.label, portrait, tiles: s.items.map((it) => toRef(it, s, undefined)) });
      pills.push(pill(s, s.id));
      continue;
    }
    // text/json single-or-collection → readable doc (collapsed for *_plan blueprints).
    sections.push({
      kind: 'doc', id: s.id, label: s.label, format: s.format, collapsed: BLUEPRINT_RE.test(s.id),
      writing: s.status === 'active', items: s.items.map((it) => toRef(it, s, headlineFields.get(s.id))),
    });
    pills.push(pill(s, s.id));
  }

  // Resolve the merged shots section's entities now that all shot stages are known.
  if (shotStageIds.length > 0) {
    const shotsSection = sections.find((sec) => sec.id === SHOTS_ID);
    if (shotsSection && shotsSection.kind === 'sheets') {
      shotsSection.entities = buildEntities(shotStageIds.map((id) => byId.get(id)!), headlineFields);
    }
  }

  return { pills, sections };
}
