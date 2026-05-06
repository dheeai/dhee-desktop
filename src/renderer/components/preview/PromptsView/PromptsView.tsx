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
import { useCallback, useEffect, useMemo, useState } from 'react';
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

export default function PromptsView() {
  const { projectDirectory } = useWorkspace();
  const [shots, setShots] = useState<ShotEntry[]>([]);
  const [refMap, setRefMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);

  // Build refId → absolute path resolver from project.json's
  // executorState.nodes. Every node that's been generated has an
  // outputPath relative to the project dir.
  useEffect(() => {
    if (!projectDirectory) {
      setRefMap(new Map());
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
            nodes?: Record<string, { outputPath?: string }>;
          };
        };
        const nodes = project.executorState?.nodes ?? {};
        const map = new Map<string, string>();
        for (const [id, node] of Object.entries(nodes)) {
          if (node.outputPath) {
            map.set(id, `${projectDirectory}/${node.outputPath}`);
          }
        }
        if (!cancelled) setRefMap(map);
      } catch {
        if (!cancelled) setRefMap(new Map());
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

  return (
    <div className={styles.container}>
      <div className={styles.scenesList}>
        {scenes.map(([sceneNumber, sceneShots]) => (
          <div key={sceneNumber} className={styles.sceneSection}>
            <div className={styles.sceneHeader}>Scene {sceneNumber}</div>
            {sceneShots.map((entry) => {
              const ff = entry.prompts?.frames?.first_frame;
              const lf = entry.prompts?.frames?.last_frame;
              const md = entry.motion?.motionDirective;
              const neg = entry.prompts?.negativePrompt;
              return (
                <div
                  key={`${entry.scene}-${entry.shot}`}
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

                  <PromptBlock
                    label="First frame prompt"
                    text={ff?.imagePrompt}
                    references={ff?.references}
                    resolveRef={resolveRef}
                  />

                  <PromptBlock
                    label="Last frame prompt"
                    text={lf?.imagePrompt}
                    references={lf?.references}
                    resolveRef={resolveRef}
                  />

                  <PromptBlock
                    label="Motion directive"
                    text={md}
                    references={undefined}
                    resolveRef={resolveRef}
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
