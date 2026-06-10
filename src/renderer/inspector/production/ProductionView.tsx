/**
 * ProductionView — the cinematic canvas (default workspace view).
 *
 * A single SCROLLING DOCUMENT of per-stage sections, derived from the run
 * model (deriveRunModel) + section/pill derivation (productionSections) +
 * the per-shot join (shotSheets). Bundle-agnostic:
 *   · text/json single stages  → readable documents (ReadableArtifact)
 *   · non-shot visual stages    → reference boards
 *   · all shot-keyed stages     → ONE "Shots" section of per-shot shot sheets
 *                                 (image prompt + frame(s) + motion + clip)
 *   · terminal single visual    → the Film hero (finished cut)
 *
 * The sticky pill bar gives EVERY stage its own status pill: the running
 * stage radiates (indicate-only — it never moves the view), a teal "viewing"
 * dot tracks where the user is, and clicking a pill scrolls to its section.
 * No artifact is ever dumped as raw JSON — raw is always behind "Inspect".
 *
 * The chat panel is a SIBLING (WorkspaceLayout), not part of this view.
 * See the run-cockpit data layer in ../../lib/runCockpit/ and the memories
 * "Production View must be bundle-agnostic" + "Production View shot-sheets".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRunModel } from '../../hooks/useRunModel';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useProject } from '../../contexts/ProjectContext';
import { buildProductionLayout, type ProductionSection } from '../../lib/runCockpit/productionSections';
import { buildShotSheets } from '../../lib/runCockpit/shotSheets';
import type { RunModel, RunStageView, RunDeliverable } from '../../lib/runCockpit/deriveRunModel';
import type { InstanceGraphNode } from '../../../shared/dheeIpc';
import { toFileUrl } from '../../utils/pathResolver';
import { ReadableArtifact } from './ReadableArtifact';
import { ShotSheetCard } from './ShotSheetCard';
import { CardDetailModal } from '../CardDetailModal';
import type { CardAction } from '../cardDetailModel';
import styles from './ProductionView.module.scss';

const PLACEHOLDERS = [
  'linear-gradient(135deg,#7a5b3a,#3a2a1c)', 'linear-gradient(135deg,#8a6b42,#42301e)',
  'linear-gradient(135deg,#6e4f38,#2e2016)', 'linear-gradient(135deg,#9a7a4a,#4a3420)',
  'linear-gradient(135deg,#7d5d3e,#352318)', 'linear-gradient(135deg,#8e6840,#3e2a18)',
  'linear-gradient(160deg,#a07a46,#4a3018)', 'linear-gradient(160deg,#6a4e34,#2a1c12)',
];
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

  const layout = useMemo(() => buildProductionLayout(model.stages), [model.stages]);
  const headlineFields = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const n of bundle?.nodes ?? []) m.set(n.id, n.headlineField);
    return m;
  }, [bundle]);
  const shotSheets = useMemo(() => buildShotSheets(model.stages, headlineFields), [model.stages, headlineFields]);

  const stageById = useMemo(() => {
    const m = new Map<string, RunStageView>();
    for (const s of model.stages) m.set(s.id, s);
    return m;
  }, [model.stages]);

  // flat key → deliverable, for the detail modal (across all stages)
  const itemByKey = useMemo(() => {
    const m = new Map<string, RunDeliverable>();
    for (const s of model.stages) for (const it of s.items) m.set(it.key, it);
    return m;
  }, [model.stages]);

  const [openKey, setOpenKey] = useState<string | null>(null);
  // viewing-state: which section is on screen (teal dot), via IntersectionObserver.
  const [viewingId, setViewingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionEls = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return undefined;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (vis) setViewingId((vis.target as HTMLElement).dataset.sectionId ?? null);
      },
      { root, rootMargin: '-96px 0px -55% 0px', threshold: [0.05, 0.2, 0.5] },
    );
    for (const el of sectionEls.current.values()) obs.observe(el);
    return () => obs.disconnect();
  }, [layout.sections.length]);

  const scrollToSection = useCallback((id: string) => {
    sectionEls.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Inline Final Cut playback.
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  const [heroPlaying, setHeroPlaying] = useState(false);
  const playHero = useCallback(() => {
    const v = heroVideoRef.current;
    if (v) { v.muted = false; void v.play().catch(() => undefined); }
    setHeroPlaying(true);
  }, []);
  const fullscreenHero = useCallback(() => {
    const v = heroVideoRef.current;
    if (!v) return;
    v.muted = false;
    void v.play().catch(() => undefined);
    setHeroPlaying(true);
    void v.requestFullscreen?.().catch(() => undefined);
  }, []);

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
  const openHeadlineField = openInstance ? bundle?.nodes.find((n) => n.id === openInstance.nodeId)?.headlineField : undefined;

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

  const registerSection = (id: string) => (el: HTMLElement | null) => {
    if (el) sectionEls.current.set(id, el);
    else sectionEls.current.delete(id);
  };

  return (
    <div className={styles.root} ref={scrollRef}>
      {/* sticky per-stage pill bar — indicate-only live status + scroll nav */}
      <div className={styles.head}>
        <div className={styles.pillbar}>
          {layout.pills.map((p) => {
            const running = p.status === 'active';
            const done = p.status === 'done';
            const viewing = viewingId === p.sectionId;
            return (
              <button
                key={p.stageId}
                type="button"
                className={`${styles.pill} ${running ? styles.pillRunning : ''} ${done ? styles.pillDone : ''} ${viewing ? styles.pillViewing : ''}`}
                onClick={() => scrollToSection(p.sectionId)}
                title={`Go to ${p.label}`}
              >
                <span className={styles.pillDot} />
                <span className={styles.pillText}>
                  <span className={styles.pillName}>{p.label}</span>
                  <span className={styles.pillCount}>
                    <strong>{p.done}/{p.total}</strong>
                    <span>{running ? 'running' : done ? 'done' : 'queued'}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.bodyWrap}>
        {layout.sections.map((section, i) => (
          <section
            key={section.id}
            data-section-id={section.id}
            ref={registerSection(section.id)}
            className={styles.docSection}
          >
            {renderSection(section, i + 1)}
          </section>
        ))}
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

  function renderSection(section: ProductionSection, no: number) {
    if (section.kind === 'film') return renderFilm(stageById.get(section.stageIds[0]) ?? null, no);
    if (section.kind === 'shots') return renderShots(no);
    if (section.kind === 'board') return renderBoard(stageById.get(section.stageIds[0])!, no);
    return renderDoc(stageById.get(section.stageIds[0])!, no);
  }

  function renderDoc(stage: RunStageView, no: number) {
    const hf = headlineFields.get(stage.id);
    const items = stage.items;
    const multi = items.length > 1; // a text/json COLLECTION (e.g. per-character prompts)
    return (
      <div className={styles.scriptDoc}>
        {sec(no, stage.label, (stage.format ?? 'text').toUpperCase())}
        {items.length === 0 ? (
          <div className={styles.scriptDocBody}>
            <div className={styles.docLoading}>{stage.status === 'active' ? 'Writing…' : 'Not written yet.'}</div>
          </div>
        ) : (
          items.map((it) => (
            <div key={it.key} className={styles.scriptDocBody}>
              {multi ? <div className={styles.docItemLabel}>{it.label}</div> : null}
              {it.outputPath ? (
                <ReadableArtifact projectDir={projectDir} outputPath={it.outputPath} format={stage.format} headlineField={hf} />
              ) : (
                <div className={styles.docLoading}>{it.status === 'in_progress' ? 'Writing…' : 'Queued — not written yet.'}</div>
              )}
            </div>
          ))
        )}
        {stage.status === 'active' && items.length === 0 ? <div className={styles.writingLine}>Writing…</div> : null}
      </div>
    );
  }

  function renderShots(no: number) {
    if (shotSheets.length === 0) {
      return (
        <>
          {sec(no, 'Shots', 'shot sheets')}
          <div className={styles.emptyNote}>Shot sheets appear here as Dhee writes each shot’s prompt, then its frame, motion, and clip.</div>
        </>
      );
    }
    return (
      <>
        {sec(no, 'Shots', `${shotSheets.length} shots`)}
        <div className={styles.sheetIntro}>
          Each shot keeps its image prompt, frame(s), motion directive, and clip together — permanently. Open one to read everything about that shot.
        </div>
        <div className={styles.shotList}>
          {shotSheets.map((sheet, idx) => (
            <ShotSheetCard
              key={sheet.key}
              sheet={sheet}
              projectDir={projectDir!}
              defaultOpen={sheet.status === 'running' || idx < 2}
              onOpenEntry={setOpenKey}
            />
          ))}
        </div>
      </>
    );
  }

  function tile(it: RunDeliverable, opts: { portrait?: boolean; captionName?: boolean; chips?: number[] } = {}) {
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
        {it.format === 'video' && done ? <span className={styles.videoPin} /> : null}
        {rendering ? <span className={styles.badge2}>rendering</span> : !done ? <span className={styles.badge2}>queued</span> : null}
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

  function renderBoard(stage: RunStageView, no: number) {
    const portrait = stage.format === 'image' && /char|cast|person|actor/i.test(stage.id);
    return (
      <>
        {sec(no, stage.label, `${stage.total} references`)}
        <div className={`${styles.board} ${portrait ? styles.boardCast : styles.boardLocs}`}>
          {stage.items.map((it) => tile(it, { portrait, captionName: true }))}
        </div>
      </>
    );
  }

  function renderFilm(filmStage: RunStageView | null, no: number) {
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
      : phase === 'writing' ? 'Writing the screenplay — the storyboard fills in as the plan is ready.'
      : 'No footage yet — direct Dhee in chat and your cut assembles here.';
    return (
      <>
        {sec(no, filmStage?.label ?? 'Final Cut', phase)}
        <div className={`${styles.hero} ${heroPlaying ? styles.heroIsPlaying : ''}`}>
          {phase === 'finished' && final && final.outputPath ? (
            <video
              ref={heroVideoRef}
              className={styles.heroVideo}
              src={fileUrl(projectDir!, final.outputPath, final.ts)}
              muted={!heroPlaying}
              controls={heroPlaying}
              playsInline
              preload="metadata"
              onClick={!heroPlaying ? playHero : undefined}
            />
          ) : recent.length ? (
            <div className={styles.heroMontage}>{recent.map((i) => <span key={i.key} style={{ background: placeholderFor(i.key) }} />)}</div>
          ) : (
            <div className={`${styles.heroMontage} ${styles.heroLeader}`} />
          )}
          {!heroPlaying ? (
            <>
              {sprock(styles.heroSprockTop)}
              {sprock(styles.heroSprockBot)}
              <div className={styles.heroScrim} />
              <div className={styles.reeltag}>Reel 01{phase !== 'finished' && phase !== 'new' ? ` · ${phase}` : ''}</div>
              {phase === 'finished' && final ? (
                <>
                  <button type="button" className={styles.heroPlay} aria-label="Play final cut" onClick={playHero} />
                  <button type="button" className={styles.heroFs} aria-label="Play fullscreen" onClick={fullscreenHero}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
                    </svg>
                  </button>
                </>
              ) : null}
              <div className={styles.heroMeta}>
                <div className={styles.heroKicker}>{kicker}</div>
                <div className={styles.heroTtl}>{projectTitle()}</div>
                <div className={styles.heroSub}>{phase === 'finished' ? 'Finished — click to play, or ⛶ for fullscreen.' : sub}</div>
                {phase === 'assembling' ? <div className={styles.hbar}><i /></div> : null}
              </div>
            </>
          ) : null}
        </div>
      </>
    );
  }

  function projectTitle(): string {
    const dir = projectDir ?? '';
    const base = dir.replace(/\\/g, '/').split('/').pop() ?? 'Production';
    return base.replace(/\.dhee$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export default ProductionView;
