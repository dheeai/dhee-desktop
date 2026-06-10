/**
 * ProductionView — the cinematic canvas (default workspace view).
 *
 * DUMB renderer. ALL shape/grouping/pairing/classification is decided ONCE by
 * the pure buildProductionDoc(model) (../../lib/runCockpit/productionModel) —
 * this component just loops over doc.sections and renders each by kind, with
 * no logic and nothing to recompute per render. That keeps it cheap and
 * predictable (the earlier render-storm came from doing grouping in render).
 *
 *   · 'doc'    → ReadableArtifact(s); breakdowns collapsed
 *   · 'board'  → media tiles
 *   · 'sheets' → ShotSheetCard per entity (frame+prompt / clip+directive paired)
 *   · 'film'   → the finished-cut hero
 *
 * The sticky pill bar gives EVERY stage its own live-status pill (running
 * radiates — indicate-only; it never moves the view); clicking scrolls. The
 * chat panel is a WorkspaceLayout sibling, not part of this view.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRunModel } from '../../hooks/useRunModel';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useProject } from '../../contexts/ProjectContext';
import { buildProductionDoc, type Section, type ArtifactRef } from '../../lib/runCockpit/productionModel';
import type { RunDeliverable } from '../../lib/runCockpit/deriveRunModel';
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

export function ProductionView() {
  const { model } = useRunModel();
  const { projectDirectory } = useWorkspace();
  const { bundle } = useProject();
  const projectDir = projectDirectory ?? null;

  const headlineFields = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const n of bundle?.nodes ?? []) m.set(n.id, n.headlineField);
    return m;
  }, [bundle]);

  // THE shape — computed once per model change. The render below is dumb.
  const doc = useMemo(() => buildProductionDoc(model, headlineFields), [model, headlineFields]);

  // flat key → deliverable, for the detail modal (across all stages)
  const itemByKey = useMemo(() => {
    const m = new Map<string, RunDeliverable>();
    for (const s of model.stages) for (const it of s.items) m.set(it.key, it);
    return m;
  }, [model.stages]);

  const [openKey, setOpenKey] = useState<string | null>(null);
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
  }, [doc.sections.length]);

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
  const dir = projectDir;

  const registerSection = (id: string) => (el: HTMLElement | null) => {
    if (el) sectionEls.current.set(id, el);
    else sectionEls.current.delete(id);
  };

  return (
    <div className={styles.root} ref={scrollRef}>
      <div className={styles.head}>
        <div className={styles.pillbar}>
          {doc.pills.map((p) => {
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
        {doc.sections.map((section, i) => (
          <section key={section.id} data-section-id={section.id} ref={registerSection(section.id)} className={styles.docSection}>
            {renderSection(section, i + 1)}
          </section>
        ))}
      </div>

      <CardDetailModal
        instance={openInstance}
        projectDir={dir}
        headlineField={openHeadlineField}
        onClose={() => setOpenKey(null)}
        onAction={onModalAction}
      />
    </div>
  );

  // ---- dumb section dispatch ----

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

  function renderSection(section: Section, no: number) {
    switch (section.kind) {
      case 'film': return renderFilm(section, no);
      case 'sheets': return renderSheets(section, no);
      case 'board': return renderBoard(section, no);
      case 'doc': return renderDoc(section, no);
      default: return null;
    }
  }

  function renderDoc(section: Extract<Section, { kind: 'doc' }>, no: number) {
    const multi = section.items.length > 1;
    const body = section.items.length === 0 ? (
      <div className={styles.scriptDocBody}>
        <div className={styles.docLoading}>{section.writing ? 'Writing…' : 'Not written yet.'}</div>
      </div>
    ) : (
      section.items.map((it) => (
        <div key={it.key} className={styles.scriptDocBody}>
          {multi ? <div className={styles.docItemLabel}>{it.label}</div> : null}
          {it.outputPath ? (
            <ReadableArtifact projectDir={dir} outputPath={it.outputPath} format={it.format} headlineField={it.headlineField} />
          ) : (
            <div className={styles.docLoading}>{it.status === 'in_progress' ? 'Writing…' : 'Queued — not written yet.'}</div>
          )}
        </div>
      ))
    );
    return (
      <div className={styles.scriptDoc}>
        {sec(no, section.label, (section.format ?? 'text').toUpperCase())}
        {section.collapsed ? (
          <details className={styles.blueprint}>
            <summary>Show {section.label}</summary>
            <div className={styles.blueprintBody}>{body}</div>
          </details>
        ) : body}
        {section.writing && section.items.length === 0 ? <div className={styles.writingLine}>Writing…</div> : null}
      </div>
    );
  }

  function renderSheets(section: Extract<Section, { kind: 'sheets' }>, no: number) {
    if (section.entities.length === 0) {
      return (
        <>
          {sec(no, section.label, 'sheets')}
          <div className={styles.emptyNote}>{section.label} appear here as Dhee writes each one’s prompt, then its media.</div>
        </>
      );
    }
    return (
      <>
        {sec(no, section.label, `${section.entities.length} ${section.label.toLowerCase()}`)}
        <div className={styles.sheetIntro}>
          Each keeps its prompt and generated media together — permanently. Open one to read everything about it.
        </div>
        <div className={styles.shotList}>
          {section.entities.map((entity, idx) => (
            <ShotSheetCard
              key={entity.key}
              entity={entity}
              projectDir={dir}
              defaultOpen={entity.status === 'running' || idx < 2}
              onOpenEntry={setOpenKey}
            />
          ))}
        </div>
      </>
    );
  }

  function tile(ref: ArtifactRef, portrait: boolean) {
    const done = ref.status === 'completed' && !!ref.outputPath;
    const rendering = ref.status === 'in_progress';
    const cls = `${styles.tile} ${portrait ? styles.portrait : ''} ${done ? '' : rendering ? styles.tRendering : styles.tQueued}`;
    const hideOnError = (e: { currentTarget: HTMLElement }) => { e.currentTarget.style.display = 'none'; };
    const media = done && ref.outputPath
      ? ref.format === 'video'
        ? <video className={styles.thumb} src={fileUrl(dir, ref.outputPath, ref.ts)} muted preload="metadata" onError={hideOnError} />
        : ref.format === 'image'
          ? <img className={styles.thumb} src={fileUrl(dir, ref.outputPath, ref.ts)} alt={ref.label} onError={hideOnError} />
          : null
      : null;
    return (
      <div key={ref.key} className={cls} onClick={() => setOpenKey(ref.key)} role="button" tabIndex={0}>
        <span className={styles.thumbFill} style={{ background: placeholderFor(ref.key) }} />
        {media}
        {ref.format === 'video' && done ? <span className={styles.videoPin} /> : null}
        {rendering ? <span className={styles.badge2}>rendering</span> : !done ? <span className={styles.badge2}>queued</span> : null}
        <span className={`${styles.cap} ${styles.capName}`}>{ref.label}</span>
      </div>
    );
  }

  function renderBoard(section: Extract<Section, { kind: 'board' }>, no: number) {
    return (
      <>
        {sec(no, section.label, `${section.tiles.length} references`)}
        <div className={`${styles.board} ${section.portrait ? styles.boardCast : styles.boardLocs}`}>
          {section.tiles.map((t) => tile(t, section.portrait))}
        </div>
      </>
    );
  }

  function renderFilm(section: Extract<Section, { kind: 'film' }>, no: number) {
    const { phase, final, recent } = section;
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
        {sec(no, section.label, phase)}
        <div className={`${styles.hero} ${heroPlaying ? styles.heroIsPlaying : ''}`}>
          {phase === 'finished' && final?.outputPath ? (
            <video
              ref={heroVideoRef}
              className={styles.heroVideo}
              src={fileUrl(dir, final.outputPath, final.ts)}
              muted={!heroPlaying}
              controls={heroPlaying}
              playsInline
              preload="metadata"
              onClick={!heroPlaying ? playHero : undefined}
            />
          ) : recent.length ? (
            <div className={styles.heroMontage}>{recent.map((r) => <span key={r.key} style={{ background: placeholderFor(r.key) }} />)}</div>
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
    const base = dir.replace(/\\/g, '/').split('/').pop() ?? 'Production';
    return base.replace(/\.dhee$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export default ProductionView;
