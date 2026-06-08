/**
 * ProductionView — the cinematic canvas (default workspace view).
 *
 * Replaces the engineer's node-graph as the default. Everything is derived
 * from the run model (deriveRunModel) + layer derivation (productionLayers),
 * so it is bundle-agnostic: text stages render in the Script reading room,
 * visual stages as scene galleries / reference boards, the terminal single
 * artifact as the Film hero. Tiles show real stills/clips when rendered and
 * deterministic warm placeholders before; clicking one opens the existing
 * inspector detail modal (inspect / edit / regenerate / versions).
 *
 * Matches design-mockups/production-view.html. See the run-cockpit data
 * layer in ../../lib/runCockpit/ and the memory note
 * "Production View must be bundle-agnostic".
 */
import { useCallback, useMemo, useState } from 'react';
import { useRunModel } from '../../hooks/useRunModel';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useProject } from '../../contexts/ProjectContext';
import {
  buildProductionLayers,
  pickDefaultLayer,
  type ProductionLayer,
} from '../../lib/runCockpit/productionLayers';
import { groupByScene } from '../../lib/runCockpit/sceneGroups';
import type { RunModel, RunStageView, RunDeliverable } from '../../lib/runCockpit/deriveRunModel';
import type { InstanceGraphNode } from '../../../shared/dheeIpc';
import { toFileUrl } from '../../utils/pathResolver';
import { MarkdownCardBody } from '../nodes/content/MarkdownCardBody';
import { JsonCardBody } from '../nodes/content/JsonCardBody';
import { CardDetailModal } from '../CardDetailModal';
import type { CardAction } from '../cardDetailModel';
import styles from './ProductionView.module.scss';

const PLACEHOLDERS = [
  'linear-gradient(135deg,#7a5b3a,#3a2a1c)', 'linear-gradient(135deg,#8a6b42,#42301e)',
  'linear-gradient(135deg,#6e4f38,#2e2016)', 'linear-gradient(135deg,#9a7a4a,#4a3420)',
  'linear-gradient(135deg,#7d5d3e,#352318)', 'linear-gradient(135deg,#8e6840,#3e2a18)',
  'linear-gradient(160deg,#a07a46,#4a3018)', 'linear-gradient(160deg,#6a4e34,#2a1c12)',
];
/** Stable warm placeholder gradient for an item id (so a shot keeps its slot). */
function placeholderFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) | 0;
  return PLACEHOLDERS[Math.abs(h) % PLACEHOLDERS.length];
}

function fileUrl(projectDir: string, outputPath: string, ts?: number): string {
  return `${toFileUrl(`${projectDir}/${outputPath}`)}?t=${ts ?? 0}`;
}

type HeroPhase = 'new' | 'writing' | 'rendering' | 'assembling' | 'finished';

function heroPhase(model: RunModel, filmStage: RunStageView | null): HeroPhase {
  const anyVisualDone = model.stages.some((s) => s.kind === 'visual' && s.done > 0);
  const running = model.activity === 'running' || model.activity === 'thinking' || model.activity === 'cancelling';
  if (filmStage && filmStage.done > 0) return 'finished';
  if (filmStage && filmStage.running > 0) return 'assembling';
  if (anyVisualDone) return 'rendering';
  if (running) return 'writing';
  return 'new';
}

export function ProductionView() {
  const { model } = useRunModel();
  const { projectDirectory } = useWorkspace();
  const { bundle } = useProject();
  const projectDir = projectDirectory ?? null;

  const layers = useMemo(() => buildProductionLayers(model.stages), [model.stages]);
  const defaultLayer = useMemo(() => pickDefaultLayer(model.stages, layers), [model.stages, layers]);
  const [manual, setManual] = useState<string | null>(null);
  const activeId = (manual && layers.some((l) => l.id === manual)) ? manual : defaultLayer;
  const active = layers.find((l) => l.id === activeId) ?? null;

  const stageById = useMemo(() => {
    const m = new Map<string, RunStageView>();
    for (const s of model.stages) m.set(s.id, s);
    return m;
  }, [model.stages]);

  // flat key → deliverable, for the detail modal
  const itemByKey = useMemo(() => {
    const m = new Map<string, RunDeliverable>();
    for (const s of model.stages) for (const it of s.items) m.set(it.key, it);
    return m;
  }, [model.stages]);

  const [openKey, setOpenKey] = useState<string | null>(null);
  const openItem = openKey ? itemByKey.get(openKey) ?? null : null;
  const openInstance: InstanceGraphNode | null = openItem
    ? {
        nodeId: openItem.nodeId,
        status: openItem.status,
        ...(openItem.itemId ? { itemId: openItem.itemId } : {}),
        ...(openItem.outputPath ? { outputPath: openItem.outputPath } : {}),
        ...(openItem.ts ? { ts: openItem.ts } : {}),
      }
    : null;
  const openHeadlineField = openInstance
    ? bundle?.nodes.find((n) => n.id === openInstance.nodeId)?.headlineField
    : undefined;

  const onModalAction = useCallback(
    async (action: CardAction, inst: InstanceGraphNode) => {
      if (!projectDir) return;
      const key = inst.itemId ? `${inst.nodeId}:${inst.itemId}` : inst.nodeId;
      if (action === 'open-file' && inst.outputPath) {
        window.open(toFileUrl(`${projectDir}/${inst.outputPath}`), '_blank');
        return;
      }
      if (action === 'invalidate') {
        try { await window.dhee.invalidateNodes({ projectDir, nodeIds: [key], source: 'production_mark_stale' }); }
        catch (e) { console.error('[Production] invalidate failed', e); }
        setOpenKey(null);
        return;
      }
      if (action === 'regenerate') {
        try { await window.dhee.redoNode({ projectDir, nodeId: inst.nodeId, ...(inst.itemId ? { itemId: inst.itemId } : {}) }); }
        catch (e) { console.error('[Production] regenerate failed', e); }
        setOpenKey(null);
      }
    },
    [projectDir],
  );

  if (!projectDir) {
    return <div className={styles.root}><div className={styles.emptyNote}>Open a project to use the Production View.</div></div>;
  }

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <div className={styles.layers}>
          {layers.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`${styles.layer} ${l.id === activeId ? styles.layerOn : ''}`}
              onClick={() => setManual(l.id)}
            >
              {l.label}
              {l.kind !== 'film' && l.kind !== 'script' ? <span className={styles.layerCount}>{l.count}</span> : null}
            </button>
          ))}
        </div>
        <span className={styles.spacer} />
      </div>

      <div className={styles.bodyWrap}>
        {active ? renderLayer(active) : renderFilm(null)}
      </div>

      <CardDetailModal
        instance={openInstance}
        projectDir={projectDir}
        headlineField={openHeadlineField}
        onClose={() => setOpenKey(null)}
        onAction={onModalAction}
      />
    </div>
  );

  // ---- section renderers ----

  function renderLayer(layer: ProductionLayer) {
    if (layer.kind === 'film') return renderFilm(stageById.get(layer.stageIds[0]) ?? null);
    if (layer.kind === 'script') return renderScript(layer.stageIds.map((id) => stageById.get(id)).filter(Boolean) as RunStageView[]);
    const stage = stageById.get(layer.stageIds[0]);
    if (!stage) return null;
    return layer.kind === 'gallery' ? renderGallery(stage) : renderBoard(stage);
  }

  function sec(no: number, nm: string, ct: string) {
    return (
      <div className={styles.secHead}>
        <span className={styles.secNo}>No.{String(no).padStart(2, '0')}</span>
        <span className={styles.secNm}>{nm}</span>
        <span className={styles.secRule} />
        <span className={styles.secCt}>{ct}</span>
      </div>
    );
  }

  function tile(it: RunDeliverable, opts: { frame?: string; portrait?: boolean; captionName?: boolean; chips?: number[] } = {}) {
    const done = it.status === 'completed' && !!it.outputPath;
    const rendering = it.status === 'in_progress';
    const cls = `${styles.tile} ${opts.portrait ? styles.portrait : ''} ${done ? '' : rendering ? styles.tRendering : styles.tQueued}`;
    const hideOnError = (e: { currentTarget: HTMLElement }) => { e.currentTarget.style.display = 'none'; };
    const media = done && it.outputPath
      ? it.format === 'video'
        ? <video className={styles.thumb} src={fileUrl(projectDir!, it.outputPath, it.ts)} muted preload="metadata" onError={hideOnError} />
        : it.format === 'image'
          ? <img className={styles.thumb} src={fileUrl(projectDir!, it.outputPath, it.ts)} alt={it.label} onError={hideOnError} />
          : null
      : null;
    return (
      <div key={it.key} className={cls} onClick={() => setOpenKey(it.key)} role="button" tabIndex={0}>
        <span className={styles.thumbFill} style={{ background: placeholderFor(it.key) }} />
        {media}
        {opts.frame ? <span className={styles.fno}>{opts.frame}</span> : null}
        {it.format === 'video' && done ? <span className={styles.videoPin} /> : null}
        {rendering ? <span className={styles.badge2}>rendering</span> : !done ? <span className={styles.badge2}>queued</span> : null}
        {done ? (
          <span className={styles.ops}>
            <span className={styles.op} title="Inspect">⤢</span>
            <span className={styles.op} title="Regenerate">↻</span>
          </span>
        ) : null}
        {opts.captionName ? (
          <span className={`${styles.cap} ${styles.capName}`}>
            {it.label}
            {opts.chips && opts.chips.length ? <span className={styles.chips}>{opts.chips.map((s) => <b key={s}>Sc {s}</b>)}</span> : null}
          </span>
        ) : (
          <span className={styles.cap}>{it.label}</span>
        )}
      </div>
    );
  }

  function renderFilm(filmStage: RunStageView | null) {
    const phase = heroPhase(model, filmStage);
    const final = filmStage?.items.find((i) => i.status === 'completed' && i.outputPath) ?? null;
    const recent = model.stages
      .filter((s) => s.kind === 'visual')
      .flatMap((s) => s.items)
      .filter((i) => i.status === 'completed' && i.outputPath && i.format === 'image')
      .slice(-5);
    const sprock = (cls: string) => <div className={`${styles.heroSprock} ${cls}`}>{Array.from({ length: 22 }, (_, i) => <i key={i} />)}</div>;
    const kicker = phase === 'finished' ? 'Final Cut' : phase === 'assembling' ? 'Final Cut · assembling' : phase === 'rendering' ? 'Rough cut · not yet assembled' : phase === 'writing' ? 'Final Cut · pre-production' : 'Final Cut';
    const sub =
      phase === 'finished' ? 'Finished — click to play.'
      : phase === 'assembling' ? 'Relaying shots → final video…'
      : phase === 'rendering' ? `${model.overall.done} of ${model.overall.total} nodes in · the final assembles once every shot is ready`
      : phase === 'writing' ? 'Writing the screenplay — the storyboard appears once the plan is ready.'
      : 'No footage yet — direct Dhee in chat and your cut assembles here.';
    return (
      <>
        <div className={styles.hero}>
          {phase === 'finished' && final && final.outputPath ? (
            <video className={styles.heroVideo} src={fileUrl(projectDir!, final.outputPath, final.ts)} muted preload="metadata" />
          ) : recent.length ? (
            <div className={styles.heroMontage}>{recent.map((i) => <span key={i.key} style={{ background: placeholderFor(i.key) }} />)}</div>
          ) : (
            <div className={`${styles.heroMontage} ${styles.heroLeader}`} />
          )}
          {sprock(styles.heroSprockTop)}
          {sprock(styles.heroSprockBot)}
          <div className={styles.heroScrim} />
          <div className={styles.reeltag}>Reel 01{phase !== 'finished' && phase !== 'new' ? ` · ${phase}` : ''}</div>
          {phase === 'finished' && final ? <button type="button" className={styles.heroPlay} aria-label="Play" onClick={() => setOpenKey(final.key)} /> : null}
          <div className={styles.heroMeta}>
            <div className={styles.heroKicker}>{kicker}</div>
            <div className={styles.heroTtl}>{projectTitle()}</div>
            <div className={styles.heroSub}>{sub}</div>
            {phase === 'assembling' ? <div className={styles.hbar}><i /></div> : null}
          </div>
        </div>
        {model.stages.some((s) => s.kind === 'visual' && s.done > 0)
          ? renderStoryboardStages()
          : <div className={styles.emptyNote}>The storyboard appears here once the scene plan is ready.</div>}
      </>
    );
  }

  function renderStoryboardStages() {
    // show the primary scene-gallery stage(s) under the hero
    const gallery = model.stages.find((s) => s.kind === 'visual' && groupByScene(s.items).some((g) => g.sceneNo !== null));
    return gallery ? renderGallery(gallery, 3) : null;
  }

  function renderGallery(stage: RunStageView, no = 3) {
    const groups = groupByScene(stage.items);
    return (
      <div>
        {sec(no, stage.label, `${stage.done}/${stage.total}`)}
        {groups.map((g) => (
          <div key={g.key} className={styles.section}>
            <div className={styles.reelHead}>
              <span className={styles.slug}>{g.label}</span>
              <span className={styles.dur}>{g.items.filter((i) => i.status === 'completed').length}/{g.items.length}</span>
            </div>
            <div className={styles.strip}>
              <div className={styles.grid}>
                {g.items.map((it, k) => tile(it, { frame: g.sceneNo !== null ? `${g.sceneNo}.${String(k + 1).padStart(2, '0')}` : undefined }))}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderBoard(stage: RunStageView) {
    const portrait = stage.format === 'image' && /char|cast|person|actor/i.test(stage.id);
    return (
      <div>
        {sec(5, stage.label, `${stage.total} references`)}
        <div className={`${styles.board} ${portrait ? styles.boardCast : styles.boardLocs}`}>
          {stage.items.map((it) => tile(it, { portrait, captionName: true }))}
        </div>
      </div>
    );
  }

  function renderScript(stages: RunStageView[]) {
    // single-instance text stages = the readable documents (story, plans).
    const docs = stages.filter((s) => s.total <= 1 && s.items[0]?.outputPath);
    if (docs.length === 0) {
      return <div className={styles.emptyNote}>Your treatment appears here as Dhee writes it.<br />Tell it your story in chat to begin.</div>;
    }
    return (
      <div>
        {docs.map((s, i) => {
          const it = s.items[0];
          return (
            <div key={s.id} className={styles.scriptDoc}>
              {sec(i + 1, s.label, (s.format ?? 'text').toUpperCase())}
              <div className={styles.scriptDocBody}>
                {s.format === 'md'
                  ? <MarkdownCardBody projectDir={projectDir} outputPath={it.outputPath ?? null} />
                  : <JsonCardBody projectDir={projectDir} outputPath={it.outputPath ?? null} />}
              </div>
              {s.status === 'active' ? <div className={styles.writingLine}>Writing…</div> : null}
            </div>
          );
        })}
      </div>
    );
  }

  function projectTitle(): string {
    const dir = projectDir ?? '';
    const base = dir.replace(/\\/g, '/').split('/').pop() ?? 'Production';
    return base.replace(/\.dhee$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export default ProductionView;
