/**
 * Prompts tab — read-only inspection of every shot's image + motion
 * prompts, structured (no JSON), with color-coded "image N"
 * references that resolve to the actual reference image on hover.
 *
 * Reads from disk (renderer's `window.electron.project.readFile` /
 * `listDirectory`) so the data stays in sync with whatever's on
 * disk without needing project.json to be the source of truth for
 * prompt text. The refId → file path map IS pulled from
 * project.json's executorState.nodes (every node carries an
 * outputPath), since that's the canonical place per-node generated
 * artifacts live.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import styles from './PromptsView.module.scss';

interface PromptReference {
  imageNumber: number;
  type: string;
  refId: string;
}

interface FrameData {
  imagePrompt?: string;
  generationMode?: string;
  references?: PromptReference[];
}

interface ShotPromptFile {
  shotNumber: number;
  generationStrategy?: string;
  frames?: {
    first_frame?: FrameData;
    last_frame?: FrameData;
    mid_frame?: FrameData;
  };
  negativePrompt?: string;
  aspectRatio?: string;
}

interface MotionFile {
  motionDirective?: string;
}

interface ShotEntry {
  scene: number;
  shot: number;
  prompts: ShotPromptFile | null;
  motion: MotionFile | null;
}

/**
 * Color palette for image-number refs. Deterministic so a given
 * imageNumber always renders in the same color across the prompt
 * (and across the first/last/motion blocks of the same shot) —
 * the user can scan visually and recognize "the green one is
 * always image 4 (officer)" inside one shot.
 */
const REF_COLORS = [
  '#5cba6a', // 1 — green
  '#3a7aa1', // 2 — blue
  '#d4a72c', // 3 — amber
  '#a85cba', // 4 — purple
  '#d05a5a', // 5 — red
  '#5cbab8', // 6 — teal
  '#ba7e5c', // 7 — brown
  '#bab85c', // 8 — olive
  '#5c7eba', // 9 — indigo
  '#ba5c8e', // 10 — pink
];
function colorFor(imageNumber: number): string {
  if (!Number.isFinite(imageNumber) || imageNumber < 1) return '#7a8190';
  return REF_COLORS[(imageNumber - 1) % REF_COLORS.length] ?? '#7a8190';
}

/**
 * Split a prompt string into text + ref tokens. Matches "image N"
 * (case-insensitive, with word boundaries) and returns each match
 * as a separate `ref` token so the renderer can color it.
 */
type Token =
  | { type: 'text'; content: string }
  | { type: 'ref'; content: string; imageNumber: number };

function tokenize(text: string): Token[] {
  const re = /\bimage\s+(\d+)\b/gi;
  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      out.push({ type: 'text', content: text.slice(last, m.index) });
    }
    const num = parseInt(m[1] ?? '0', 10);
    out.push({ type: 'ref', content: m[0], imageNumber: num });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', content: text.slice(last) });
  return out;
}

function PromptText({
  text,
  references,
  resolveRef,
}: {
  text: string;
  references: PromptReference[] | undefined;
  resolveRef: (refId: string) => string | null;
}) {
  const tokens = useMemo(() => tokenize(text), [text]);
  const refByNumber = useMemo(() => {
    const map = new Map<number, PromptReference>();
    for (const r of references ?? []) map.set(r.imageNumber, r);
    return map;
  }, [references]);

  return (
    <span className={styles.promptText}>
      {tokens.map((t, i) => {
        if (t.type === 'text') return <span key={i}>{t.content}</span>;
        const ref = refByNumber.get(t.imageNumber);
        const color = colorFor(t.imageNumber);
        const path = ref ? resolveRef(ref.refId) : null;
        return (
          <span
            key={i}
            className={styles.refMention}
            style={{ color }}
            title={ref?.refId ?? `image ${t.imageNumber} (no reference declared in this prompt)`}
          >
            {t.content}
            {(ref || path) && (
              <span className={styles.refPreview}>
                {path ? (
                  <img src={`file://${path}`} alt={ref?.refId ?? ''} />
                ) : (
                  <span className={styles.refMissing}>
                    not yet generated
                  </span>
                )}
                {ref && <span className={styles.refLabel}>{ref.refId}</span>}
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

function PromptBlock({
  label,
  text,
  references,
  resolveRef,
}: {
  label: string;
  text: string | undefined;
  references: PromptReference[] | undefined;
  resolveRef: (refId: string) => string | null;
}) {
  if (!text) return null;
  return (
    <div className={styles.promptBlock}>
      <div className={styles.promptLabel}>{label}</div>
      <PromptText text={text} references={references} resolveRef={resolveRef} />
    </div>
  );
}

/**
 * One row: media on the left (when generated), prompt on the right.
 * Falls back to a single-column prompt block when no media is on
 * disk yet — mid-pipeline the user still wants to read the prompt
 * even before the asset lands.
 */
function MediaPromptRow({
  label,
  mediaPath,
  mediaKind,
  text,
  references,
  resolveRef,
  projectDirectory,
}: {
  label: string;
  mediaPath: string | undefined;
  mediaKind: 'image' | 'video';
  text: string | undefined;
  references: PromptReference[] | undefined;
  resolveRef: (refId: string) => string | null;
  projectDirectory: string;
}) {
  if (!text && !mediaPath) return null;
  if (!mediaPath) {
    // Prompt-only path: single column, full width.
    return (
      <PromptBlock
        label={label}
        text={text}
        references={references}
        resolveRef={resolveRef}
      />
    );
  }
  const src = `file://${projectDirectory}/${mediaPath}`;
  return (
    <div className={styles.mediaPromptRow}>
      <div className={styles.mediaCell}>
        {mediaKind === 'image' ? (
          <img src={src} alt={label} className={styles.mediaImage} />
        ) : (
          <video
            src={src}
            controls
            preload="metadata"
            className={styles.mediaVideo}
          />
        )}
      </div>
      <div className={styles.promptCell}>
        {text ? (
          <PromptBlock
            label={label}
            text={text}
            references={references}
            resolveRef={resolveRef}
          />
        ) : (
          <div className={styles.promptBlock}>
            <div className={styles.promptLabel}>{label}</div>
            <span className={styles.promptText} style={{ opacity: 0.6 }}>
              (no prompt recorded)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

interface ShotAssets {
  firstFrame?: string;
  lastFrame?: string;
  video?: string;
}

/**
 * Walk `executorState.nodes` to extract per-shot first frame /
 * last frame / video paths. Two-level fallback because the
 * graph evolved over time:
 *
 *   - Legacy combined node `shot_image:scene_N_shot_M` carries
 *     both frames in `.outputPaths.first_frame` and
 *     `.outputPaths.last_frame`.
 *   - Pattern-B split (recent) introduced
 *     `shot_image_last_frame:scene_N_shot_M.outputPath` for the
 *     last frame; `shot_image:…` keeps `outputPaths.first_frame`.
 *
 * Prefer the newer split when both are present; fall back
 * otherwise. Video lives on `shot_video:scene_N_shot_M.outputPath`
 * regardless of the topology.
 *
 * Note: `project.scenes[].shots[]` would be a cleaner source, but
 * desktop-created projects don't populate that tree — they live
 * entirely in `executorState`. Reading from nodes works for both.
 */
function extractShotAssets(
  nodes: Record<string, { outputPath?: string; outputPaths?: Record<string, string> }>,
): Map<string, ShotAssets> {
  const assets = new Map<string, ShotAssets>();
  const idRe = /^(shot_image|shot_image_last_frame|shot_video):scene_(\d+)_shot_(\d+)$/;
  for (const [id, node] of Object.entries(nodes)) {
    const m = idRe.exec(id);
    if (!m) continue;
    const kind = m[1] as 'shot_image' | 'shot_image_last_frame' | 'shot_video';
    const scene = parseInt(m[2] ?? '0', 10);
    const shot = parseInt(m[3] ?? '0', 10);
    const key = `${scene}-${shot}`;
    const existing = assets.get(key) ?? {};
    if (kind === 'shot_image') {
      const ff =
        node.outputPaths?.['first_frame'] ?? node.outputPath;
      const lf = node.outputPaths?.['last_frame'];
      if (ff) existing.firstFrame = existing.firstFrame ?? ff;
      if (lf) existing.lastFrame = existing.lastFrame ?? lf;
    } else if (kind === 'shot_image_last_frame') {
      // Pattern-B split: last frame lives here. Prefer over the
      // legacy combined node's outputPaths.last_frame.
      if (node.outputPath) existing.lastFrame = node.outputPath;
    } else {
      // shot_video
      if (node.outputPath) existing.video = node.outputPath;
    }
    assets.set(key, existing);
  }
  return assets;
}

export default function PromptsView() {
  const { projectDirectory } = useWorkspace();
  const [shots, setShots] = useState<ShotEntry[]>([]);
  const [refMap, setRefMap] = useState<Map<string, string>>(new Map());
  const [shotAssets, setShotAssets] = useState<Map<string, ShotAssets>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build refId → absolute path resolver AND per-shot asset map from
  // project.json. Both come from a single read — refMap from
  // executorState.nodes (for "image N" hover-resolution); shotAssets
  // from project.scenes[].shots[] (canonical place for first frame /
  // last frame / video paths).
  useEffect(() => {
    if (!projectDirectory) {
      setRefMap(new Map());
      setShotAssets(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const raw = await window.electron.project.readFile(
          `${projectDirectory}/project.json`,
        );
        if (cancelled || !raw) return;
        const project = JSON.parse(raw) as {
          executorState?: {
            nodes?: Record<
              string,
              { outputPath?: string; outputPaths?: Record<string, string> }
            >;
          };
        };
        const nodes = project.executorState?.nodes ?? {};
        const map = new Map<string, string>();
        for (const [id, node] of Object.entries(nodes)) {
          if (node.outputPath) {
            map.set(id, `${projectDirectory}/${node.outputPath}`);
          }
        }
        const assets = extractShotAssets(nodes);
        if (!cancelled) {
          setRefMap(map);
          setShotAssets(assets);
        }
      } catch {
        if (!cancelled) {
          setRefMap(new Map());
          setShotAssets(new Map());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectDirectory]);

  // Enumerate every prompt JSON on disk, then load each one + its
  // sibling motion file. Sorted scene-then-shot. Robust to gaps
  // (a missing motion file for a shot still shows the image
  // prompts).
  useEffect(() => {
    if (!projectDirectory) {
      setShots([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const shotsDir = `${projectDirectory}/prompts/images/shots`;
        const files = await window.electron.project
          .listDirectory(shotsDir)
          .catch(() => [] as string[]);
        // Filenames look like `scene-N-shot-M.json` (or `scene_N_shot_M.json`).
        const ids: Array<{ scene: number; shot: number; file: string }> = [];
        for (const f of files) {
          const match = f.match(/scene[-_](\d+)[-_]shot[-_](\d+)\.json$/i);
          if (!match) continue;
          ids.push({
            scene: parseInt(match[1] ?? '0', 10),
            shot: parseInt(match[2] ?? '0', 10),
            file: f,
          });
        }
        ids.sort((a, b) => a.scene - b.scene || a.shot - b.shot);

        const entries: ShotEntry[] = [];
        for (const { scene, shot, file } of ids) {
          if (cancelled) return;
          const promptPath = `${shotsDir}/${file}`;
          const motionPath = `${projectDirectory}/prompts/motion/scene_${scene}_shot_${shot}.json`;
          const [pRaw, mRaw] = await Promise.all([
            window.electron.project.readFile(promptPath).catch(() => null),
            window.electron.project.readFile(motionPath).catch(() => null),
          ]);
          let prompts: ShotPromptFile | null = null;
          let motion: MotionFile | null = null;
          try {
            if (pRaw) prompts = JSON.parse(pRaw) as ShotPromptFile;
          } catch {
            /* malformed — skip */
          }
          try {
            if (mRaw) motion = JSON.parse(mRaw) as MotionFile;
          } catch {
            /* malformed — skip */
          }
          if (prompts || motion) {
            entries.push({ scene, shot, prompts, motion });
          }
        }
        if (!cancelled) setShots(entries);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectDirectory]);

  const resolveRef = useCallback(
    (refId: string): string | null => refMap.get(refId) ?? null,
    [refMap],
  );

  // Group shots by scene for display.
  const scenes = useMemo(() => {
    const bySceneN = new Map<number, ShotEntry[]>();
    for (const s of shots) {
      const arr = bySceneN.get(s.scene) ?? [];
      arr.push(s);
      bySceneN.set(s.scene, arr);
    }
    return [...bySceneN.entries()].sort(([a], [b]) => a - b);
  }, [shots]);

  if (!projectDirectory) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <FileText size={48} className={styles.emptyIcon} />
          <h3>No Project Open</h3>
          <p>Open a project to inspect its prompts</p>
        </div>
      </div>
    );
  }

  if (loading && shots.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading prompts…</div>
      </div>
    );
  }

  if (shots.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <FileText size={48} className={styles.emptyIcon} />
          <h3>No prompts yet</h3>
          <p>Run the pipeline to generate per-shot prompts.</p>
        </div>
      </div>
    );
  }

  // Jump-to-shot dropdown: change handler scrolls the matching card
  // into view. Card ids are deterministic (`shot-S-N`) so we don't
  // need a ref-per-shot map.
  const handleJumpTo = (value: string) => {
    if (!value || !containerRef.current) return;
    const el = containerRef.current.querySelector<HTMLElement>(`#${value}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarLabel}>Jump to:</span>
        <select
          className={styles.shotPicker}
          defaultValue=""
          onChange={(e) => {
            handleJumpTo(e.target.value);
            // Reset so the same option can be picked again to re-scroll.
            e.target.value = '';
          }}
        >
          <option value="" disabled>
            Pick a shot…
          </option>
          {scenes.map(([sceneNumber, sceneShots]) => (
            <optgroup key={sceneNumber} label={`Scene ${sceneNumber}`}>
              {sceneShots.map((entry) => (
                <option
                  key={`${entry.scene}-${entry.shot}`}
                  value={`shot-${entry.scene}-${entry.shot}`}
                >
                  Scene {entry.scene} · Shot {entry.shot}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className={styles.scenesList}>
        {scenes.map(([sceneNumber, sceneShots]) => (
          <div key={sceneNumber} className={styles.sceneSection}>
            <div className={styles.sceneHeader}>Scene {sceneNumber}</div>
            {sceneShots.map((entry) => {
              const ff = entry.prompts?.frames?.first_frame;
              const lf = entry.prompts?.frames?.last_frame;
              const md = entry.motion?.motionDirective;
              const neg = entry.prompts?.negativePrompt;
              const assets = shotAssets.get(`${entry.scene}-${entry.shot}`);
              return (
                <div
                  key={`${entry.scene}-${entry.shot}`}
                  id={`shot-${entry.scene}-${entry.shot}`}
                  className={styles.shotCard}
                >
                  <div className={styles.shotHeader}>
                    Shot {entry.shot}
                    {entry.prompts?.generationStrategy && (
                      <span className={styles.shotMeta}>
                        · {entry.prompts.generationStrategy}
                      </span>
                    )}
                  </div>

                  <MediaPromptRow
                    label="First frame prompt"
                    mediaPath={assets?.firstFrame}
                    mediaKind="image"
                    text={ff?.imagePrompt}
                    references={ff?.references}
                    resolveRef={resolveRef}
                    projectDirectory={projectDirectory}
                  />

                  <MediaPromptRow
                    label="Last frame prompt"
                    mediaPath={assets?.lastFrame}
                    mediaKind="image"
                    text={lf?.imagePrompt}
                    references={lf?.references}
                    resolveRef={resolveRef}
                    projectDirectory={projectDirectory}
                  />

                  <MediaPromptRow
                    label="Motion directive"
                    mediaPath={assets?.video}
                    mediaKind="video"
                    text={md}
                    references={undefined}
                    resolveRef={resolveRef}
                    projectDirectory={projectDirectory}
                  />

                  {neg && (
                    <div className={styles.negativeBlock}>
                      <details>
                        <summary>Negative prompt</summary>
                        <span className={styles.promptText}>{neg}</span>
                      </details>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
