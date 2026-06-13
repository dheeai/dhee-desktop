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
  | { kind: 'sheets'; id: string; label: string; entities: EntityCard[]; portrait: boolean }
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

const BLUEPRINT_RE = /_plan$|breakdown/i;

function entityPrefix(stageId: string): string {
  return stageId.split(/[_-]/)[0] || stageId;
}
function pluralLabel(prefix: string): string {
  const cap = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  return cap.endsWith('s') ? cap : `${cap}s`;
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
  // "first/last frame" only when the entity actually has two frames (shots);
  // a character portrait or a location still isn't a "first frame".
  const hasLast = refs.some((r) => r.frameRole === 'last');
  let pendingText: ArtifactRef | undefined;
  const push = (media: ArtifactRef | undefined, text: ArtifactRef | undefined) => {
    const expectVideo = media?.format === 'video' || (!!text && /motion|clip|video/i.test(text.nodeId));
    const role = media?.frameRole ?? text?.frameRole ?? null;
    const mediaTag = expectVideo
      ? 'clip'
      : role === 'last' ? 'last frame'
      : role === 'first' && hasLast ? 'first frame'
      : media?.stageLabel ?? text?.stageLabel ?? 'media';
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

/**
 * The grouping key for an entity sheet. Shots stay distinct (scene+shot), but
 * scene-level items collapse by SCENE NUMBER — so a scene's clip prompt and
 * ALL its clips (e.g. scene_1_chunk_1, scene_1_chunk_2) land in one sheet.
 * Non scene/shot ids (characters, settings) group on the id itself.
 */
function entityKey(itemId: string): string {
  const sc = parseSceneNo(itemId);
  const sh = parseShotNo(itemId);
  if (sc !== null && sh !== null) return `scene_${sc}_shot_${sh}`;
  if (sc !== null) return `scene_${sc}`;
  return itemId;
}

function buildEntities(shotStages: RunStageView[], headlineFields: Map<string, string | undefined>): EntityCard[] {
  const byItem = new Map<string, ArtifactRef[]>();
  const order: string[] = [];
  for (const stage of shotStages) {
    for (const it of stage.items) {
      if (!it.itemId) continue;
      const key = entityKey(it.itemId);
      const ref = toRef(it, stage, headlineFields.get(stage.id));
      const list = byItem.get(key);
      if (list) list.push(ref);
      else {
        byItem.set(key, [ref]);
        order.push(key);
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
      // prefer a completed still; fall back to a completed clip so scene
      // entities (no image, only a video) still preview their media.
      thumb:
        refs.find((r) => r.format === 'image' && r.status === 'completed' && r.outputPath)
        ?? refs.find((r) => r.format === 'video' && r.status === 'completed' && r.outputPath),
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
  const groupStageIds = new Map<string, string[]>();

  const pill = (s: RunStageView, sectionId: string): StagePill => ({
    stageId: s.id, label: s.label, status: s.status, done: s.done, total: s.total, sectionId,
  });

  for (const s of stages) {
    if (s === film) {
      const finalItem = s.items.find((i) => i.status === 'completed' && i.outputPath);
      sections.push({
        kind: 'film', id: 'film', label: s.label, phase: heroPhase(model, film),
        final: finalItem ? toRef(finalItem, s, undefined) : undefined,
        recent: stages.filter((x) => x.kind === 'visual').flatMap((x) => x.items)
          .filter((i) => i.status === 'completed' && i.outputPath && i.format === 'image').slice(-5)
          .map((i) => toRef(i, byId.get(i.nodeId) ?? s, undefined)),
      });
      pills.push(pill(s, 'film'));
      continue;
    }
    // Fan-out detection by ITEM-ID presence — NOT the bundle `collection`
    // flag, which is always false in production (the bundle's node `kind` is
    // the artifact kind image/json/…, never 'collection'). A stage whose
    // items carry item ids fans out per entity → group it by entity prefix.
    const isFanout = s.collection || s.items.some((i) => i.itemId);
    if (isFanout) {
      const pfx = entityPrefix(s.id);
      if (!groupStageIds.has(pfx)) {
        groupStageIds.set(pfx, []);
        sections.push({ kind: 'sheets', id: pfx, label: pluralLabel(pfx), entities: [], portrait: false }); // placeholder
      }
      groupStageIds.get(pfx)!.push(s.id);
      pills.push(pill(s, pfx));
      continue;
    }
    if (s.kind === 'visual') {
      // A single visual stage that isn't the film and doesn't fan out → board.
      // (Guard: visual content must NEVER fall into the text/doc path, which
      // would read images/videos as text.)
      const portrait = /char|cast|person|actor/i.test(s.id);
      sections.push({ kind: 'board', id: s.id, label: s.label, portrait, tiles: s.items.map((it) => toRef(it, s, undefined)) });
      pills.push(pill(s, s.id));
      continue;
    }
    sections.push({
      kind: 'doc', id: s.id, label: s.label, format: s.format, collapsed: BLUEPRINT_RE.test(s.id),
      writing: s.status === 'active', items: s.items.map((it) => toRef(it, s, headlineFields.get(s.id))),
    });
    pills.push(pill(s, s.id));
  }

  for (let i = 0; i < sections.length; i += 1) {
    const sec = sections[i];
    if (sec.kind !== 'sheets') continue;
    const grp = (groupStageIds.get(sec.id) ?? []).map((id) => byId.get(id)!).filter(Boolean);
    const hasText = grp.some((s) => s.kind === 'text');
    const hasMedia = grp.some((s) => s.kind === 'visual');
    // Portrait entities (characters, locations) carry reference stills that a
    // 16:9 frame would crop (heads cut off) — flag them for a portrait frame.
    const portrait = grp.some((s) => /char|cast|person|actor|setting|location|place/i.test(s.id));
    if (hasText && hasMedia) {
      sections[i] = { kind: 'sheets', id: sec.id, label: sec.label, entities: buildEntities(grp, headlineFields), portrait };
    } else if (hasMedia) {
      sections[i] = { kind: 'board', id: sec.id, label: sec.label, portrait, tiles: grp.flatMap((s) => s.items.map((it) => toRef(it, s, undefined))) };
    } else {
      sections[i] = {
        kind: 'doc', id: sec.id, label: sec.label, format: grp[0]?.format, collapsed: false,
        writing: grp.some((s) => s.status === 'active'),
        items: grp.flatMap((s) => s.items.map((it) => toRef(it, s, headlineFields.get(s.id)))),
      };
    }
  }

  attachSceneClipsToShots(stages, sections);
  return { pills, sections };
}

/**
 * Prompt-relay: a single scene CLIP is the realized output of all the shots
 * that relay into it. So surface that scene's clip on EVERY shot of the scene
 * — on the shot's motion-directive pair (or as a trailing pair) — so a shot
 * sheet shows the clip it's part of, not just an empty "queued" media. The
 * clip also lives in its own Scenes section; this is the per-shot context.
 */
function attachSceneClipsToShots(stages: RunStageView[], sections: Section[]): void {
  // scene clip = a completed video whose item id encodes a scene but NOT a shot.
  const sceneClip = new Map<number, ArtifactRef>();
  for (const s of stages) {
    if (s.kind !== 'visual') continue;
    for (const it of s.items) {
      if (it.format !== 'video' || it.status !== 'completed' || !it.outputPath) continue;
      const sn = parseSceneNo(it.itemId);
      if (sn !== null && parseShotNo(it.itemId) === null && !sceneClip.has(sn)) sceneClip.set(sn, toRef(it, s, undefined));
    }
  }
  if (sceneClip.size === 0) return;
  for (const sec of sections) {
    if (sec.kind !== 'sheets') continue;
    for (const e of sec.entities) {
      const sn = parseSceneNo(e.key);
      if (sn === null || parseShotNo(e.key) === null) continue; // shots only
      const clip = sceneClip.get(sn);
      if (!clip || e.pairs.some((p) => p.media?.format === 'video')) continue; // already has a clip
      const motion = e.pairs.find((p) => p.text && !p.media && /motion|directive|clip|video/i.test(p.text.nodeId));
      if (motion) { motion.media = clip; motion.mediaTag = 'scene clip'; motion.expectVideo = true; }
      else e.pairs.push({ media: clip, mediaTag: 'scene clip', expectVideo: true });
      if (!e.thumb) e.thumb = clip;
    }
  }
}
