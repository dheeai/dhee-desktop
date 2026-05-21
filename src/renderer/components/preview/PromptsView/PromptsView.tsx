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
import { FileText, Pencil } from 'lucide-react';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import { useAgent } from '../../../contexts/AgentContext';
import { useDheeSession } from '../../../hooks/useDheeSession';
import { savePromptEdit, type PromptKind } from './savePromptEdit';
import AssetRegenerateButton, {
  type AssetRegenerateFrame,
  type AssetRegenerateScope,
} from '../../preview/TimelinePanel/AssetRegenerateButton';
import styles from './PromptsView.module.scss';

/**
 * Describes the surgical-regen target for one prompt block. When set,
 * the block renders an AssetRegenerateButton next to the pencil that
 * fires `redoNode(nodeId, { frame?, scope? })` directly via IPC
 * (no LLM in the loop). Choice of nodeId depends on what's in the
 * graph:
 *   - last_frame with hasLastFrameNode → 'shot_image_last_frame:…'
 *   - last_frame without split node     → 'shot_image:…' with scope/frame
 *   - first_frame                       → 'shot_image:…' with scope/frame
 *   - video                             → 'shot_video:…' (default cascade)
 */
interface RegenTarget {
  nodeId: string;
  frame?: AssetRegenerateFrame;
  scope?: AssetRegenerateScope;
  /** Tooltip + aria label. */
  label: string;
  /** Short human description for chat receipts, e.g. "last frame of S1 Shot 2". */
  whatLabel: string;
}

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
  /** Absolute path to the shot prompt JSON we read; reused on save. */
  promptPath: string | null;
  /** Absolute path to the motion JSON we read (if any). */
  motionPath: string | null;
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

/**
 * Editing state propagated from the top-level PromptsView. When
 * `editId` matches a block's identity, that block flips into edit
 * mode and shows a textarea + Save/Cancel. The buffer + error live
 * at the parent so a click on the pencil only mounts one editor at
 * a time across the whole tab.
 */
interface EditCoordinator {
  editId: { scene: number; shot: number; kind: PromptKind } | null;
  buffer: string;
  error: string | null;
  isSaving: boolean;
  onStartEdit(scene: number, shot: number, kind: PromptKind, text: string): void;
  onChangeBuffer(text: string): void;
  onSave(): void;
  onCancel(): void;
}

function PromptBlock({
  label,
  text,
  references,
  resolveRef,
  editable,
  editor,
  regen,
  notify,
}: {
  label: string;
  text: string | undefined;
  references: PromptReference[] | undefined;
  resolveRef: (refId: string) => string | null;
  /**
   * When supplied, the block grows a pencil affordance and can flip
   * into edit mode. Omitted when the prompt isn't backed by a JSON
   * file we can rewrite (defensive — shouldn't happen at runtime).
   */
  editable?: { scene: number; shot: number; kind: PromptKind };
  editor?: EditCoordinator;
  /** When supplied, renders a surgical-regen button next to the pencil. */
  regen?: RegenTarget;
  /** Routes button start/result messages into the chat panel. */
  notify?: (text: string) => void;
}) {
  if (!text) return null;
  const isActive =
    !!editable &&
    !!editor?.editId &&
    editor.editId.scene === editable.scene &&
    editor.editId.shot === editable.shot &&
    editor.editId.kind === editable.kind;

  return (
    <div className={styles.promptBlock}>
      <div className={styles.promptLabelRow}>
        <div className={styles.promptLabel}>{label}</div>
        {regen && !isActive && (
          <AssetRegenerateButton
            nodeId={regen.nodeId}
            label={regen.label}
            {...(regen.frame ? { frame: regen.frame } : {})}
            {...(regen.scope ? { scope: regen.scope } : {})}
            {...(notify
              ? {
                  onActionStart: () =>
                    notify(`⟳ Regenerating ${regen.whatLabel}…`),
                  onActionResult: (ok: boolean, error?: string) => {
                    if (ok) {
                      notify(
                        `✅ ${regen.whatLabel} regenerated. Downstream assets that consumed it are rebuilding now.`,
                      );
                    } else {
                      notify(
                        `❌ Regenerate ${regen.whatLabel} failed: ${error ?? 'unknown error'}`,
                      );
                    }
                  },
                }
              : {})}
          />
        )}
        {editable && editor && !isActive && (
          <button
            type="button"
            className={styles.editButton}
            aria-label={`Edit ${label}`}
            title={`Edit ${label}`}
            onClick={() =>
              editor.onStartEdit(
                editable.scene,
                editable.shot,
                editable.kind,
                text,
              )
            }
            disabled={editor.editId !== null}
          >
            <Pencil size={14} />
          </button>
        )}
      </div>
      {isActive && editor ? (
        <PromptEditForm editor={editor} />
      ) : (
        <PromptText
          text={text}
          references={references}
          resolveRef={resolveRef}
        />
      )}
    </div>
  );
}

function PromptEditForm({ editor }: { editor: EditCoordinator }) {
  return (
    <div className={styles.editForm}>
      <textarea
        className={styles.editTextarea}
        value={editor.buffer}
        onChange={(e) => editor.onChangeBuffer(e.target.value)}
        rows={Math.min(20, Math.max(4, editor.buffer.split('\n').length))}
        autoFocus
        disabled={editor.isSaving}
        spellCheck={false}
      />
      {editor.error && <div className={styles.editError}>{editor.error}</div>}
      <div className={styles.editActions}>
        <button
          type="button"
          className={styles.editButtonGhost}
          onClick={editor.onCancel}
          disabled={editor.isSaving}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.editButtonPrimary}
          onClick={editor.onSave}
          disabled={editor.isSaving}
        >
          {editor.isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
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
  editable,
  editor,
  regen,
  notify,
}: {
  label: string;
  mediaPath: string | undefined;
  mediaKind: 'image' | 'video';
  text: string | undefined;
  references: PromptReference[] | undefined;
  resolveRef: (refId: string) => string | null;
  projectDirectory: string;
  editable?: { scene: number; shot: number; kind: PromptKind };
  editor?: EditCoordinator;
  regen?: RegenTarget;
  notify?: (text: string) => void;
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
        editable={editable}
        editor={editor}
        regen={regen}
        notify={notify}
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
            editable={editable}
            editor={editor}
            regen={regen}
            notify={notify}
          />
        ) : (
          <div className={styles.promptBlock}>
            <div className={styles.promptLabelRow}>
              <div className={styles.promptLabel}>{label}</div>
              {regen && (
                <AssetRegenerateButton
                  nodeId={regen.nodeId}
                  label={regen.label}
                  {...(regen.frame ? { frame: regen.frame } : {})}
                  {...(regen.scope ? { scope: regen.scope } : {})}
                  {...(notify
                    ? {
                        onActionStart: () =>
                          notify(`⟳ Regenerating ${regen.whatLabel}…`),
                        onActionResult: (ok: boolean, error?: string) => {
                          if (ok) {
                            notify(
                              `✅ ${regen.whatLabel} regenerated. Downstream assets that consumed it are rebuilding now.`,
                            );
                          } else {
                            notify(
                              `❌ Regenerate ${regen.whatLabel} failed: ${error ?? 'unknown error'}`,
                            );
                          }
                        },
                      }
                    : {})}
                />
              )}
            </div>
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
  /**
   * True when `shot_image_last_frame:scene_N_shot_M` exists as its own
   * node (Pattern-B split). Used by save-edit logic to pick the right
   * invalidation target — without the split, last-frame edits fall
   * back to the combined `shot_image:` node.
   */
  hasLastFrameNode?: boolean;
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
      existing.hasLastFrameNode = true;
    } else {
      // shot_video
      if (node.outputPath) existing.video = node.outputPath;
    }
    assets.set(key, existing);
  }
  return assets;
}

export default function PromptsView() {
  const { projectName, projectDirectory } = useWorkspace();
  const agent = useAgent();
  const session = useDheeSession();

  // Surgical-regen IPC (window.dhee.redoNode → ConversationManager.redoNode)
  // requires session.agent to be configured on the kshana-core side. That
  // configuration happens via focusProject(name, dir). ChatPanelEmbedded
  // calls it when chat mounts, but a user who jumps straight to the Prompts
  // tab without opening chat would otherwise hit
  //   "Session agent not configured. Select a project first."
  // when clicking a regenerate button. Idempotent: re-focusing the same
  // project is a no-op.
  useEffect(() => {
    if (!session.sessionId || !projectName) return;
    session
      .focusProject(projectName, projectDirectory ?? undefined)
      .catch(() => {
        /* swallow — the regen button will surface the error if it matters */
      });
  }, [session.sessionId, projectName, projectDirectory, session.focusProject]);
  const [shots, setShots] = useState<ShotEntry[]>([]);
  const [refMap, setRefMap] = useState<Map<string, string>>(new Map());
  const [shotAssets, setShotAssets] = useState<Map<string, ShotAssets>>(
    new Map(),
  );
  // Editing state at the panel level: at most one editor open across
  // all shots. Tracks {target, original text, current buffer, error,
  // saving} so the matching block can render its own form via the
  // editor coordinator passed down through MediaPromptRow / PromptBlock.
  const [editTarget, setEditTarget] = useState<{
    scene: number;
    shot: number;
    kind: PromptKind;
  } | null>(null);
  const [editOriginal, setEditOriginal] = useState('');
  const [editBuffer, setEditBuffer] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditSaving, setIsEditSaving] = useState(false);
  // Per-shot status flag: true when shot_image_prompt:scene_N_shot_M is
  // `completed` in executorState. After an invalidate/reset the JSON file
  // stays on disk (the resetter preserves outputs by design) but the
  // executor node goes back to `pending` — without this filter the panel
  // would keep showing the stale prompt text from a prior generation.
  const [completedShots, setCompletedShots] = useState<Set<string>>(new Set());
  // Same flag for shot_motion_directive:scene_N_shot_M. When the image
  // prompt for a shot has been freshly regenerated but the motion
  // directive node is still `pending`, the on-disk motion JSON is from
  // a prior run — stale. Without this filter the panel would show the
  // fresh image prompt next to the stale motion directive, which reads
  // to the user as if the motion directive is being generated twice
  // (once during shot_image_prompt's run, once when the motion node
  // itself runs). No tokens are wasted, but the UX is misleading.
  const [completedMotion, setCompletedMotion] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Live-refresh tick. Bumped whenever the executor writes a new prompt /
  // image / motion file or updates project.json. Without this the panel
  // would only refetch on mount or when the user click-away-and-back-in,
  // so newly-generated shots wouldn't appear during a live run.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    if (!projectDirectory) return undefined;
    const dirPrefix = projectDirectory.replace(/\\/g, '/');
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (pending) return;
      pending = true;
      // Debounce: writes come in clusters during a node's completion
      // (prompt JSON + project.json + asset). Coalesce into one refresh.
      timer = setTimeout(() => {
        pending = false;
        timer = null;
        setRefreshTick((t) => t + 1);
      }, 300);
    };

    const unsubscribe = window.electron.project.onFileChange((event) => {
      const p = event.path.replace(/\\/g, '/');
      if (!p.startsWith(dirPrefix)) return;
      // Only refresh on the file types this panel actually renders.
      const interesting =
        p.includes('/prompts/images/shots/') ||
        p.includes('/prompts/motion/') ||
        p.includes('/assets/images/') ||
        p.includes('/assets/videos/') ||
        p.endsWith('/project.json');
      if (interesting) schedule();
    });

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [projectDirectory]);

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
              {
                outputPath?: string;
                outputPaths?: Record<string, string>;
                status?: string;
              }
            >;
          };
        };
        const nodes = project.executorState?.nodes ?? {};
        const map = new Map<string, string>();
        const completed = new Set<string>();
        const motionCompleted = new Set<string>();
        for (const [id, node] of Object.entries(nodes)) {
          if (node.outputPath) {
            map.set(id, `${projectDirectory}/${node.outputPath}`);
          }
          // Track shot_image_prompt nodes whose status is still `completed`.
          // Pending/failed/invalidated shots get filtered out of the panel so
          // a reset visually clears stale entries.
          const m = id.match(/^shot_image_prompt:(scene_\d+_shot_\d+)$/);
          if (m && node.status === 'completed') {
            completed.add(m[1]!);
          }
          // Parallel set for shot_motion_directive — gated separately so
          // a freshly-rendered image prompt doesn't get co-displayed with
          // a stale motion directive when the motion node is still pending.
          const md = id.match(/^shot_motion_directive:(scene_\d+_shot_\d+)$/);
          if (md && node.status === 'completed') {
            motionCompleted.add(md[1]!);
          }
        }
        const assets = extractShotAssets(nodes);
        if (!cancelled) {
          setRefMap(map);
          setShotAssets(assets);
          setCompletedShots(completed);
          setCompletedMotion(motionCompleted);
        }
      } catch {
        if (!cancelled) {
          setRefMap(new Map());
          setShotAssets(new Map());
          setCompletedShots(new Set());
          setCompletedMotion(new Set());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectDirectory, refreshTick]);

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
          // Skip shots whose shot_image_prompt node isn't currently
          // `completed`. After a reset/invalidate the JSON file is still
          // on disk (resetter preserves outputs) but the node is pending,
          // and showing the stale prompt would mislead the user.
          const itemId = `scene_${scene}_shot_${shot}`;
          if (!completedShots.has(itemId)) continue;
          const promptPath = `${shotsDir}/${file}`;
          const motionPath = `${projectDirectory}/prompts/motion/scene_${scene}_shot_${shot}.json`;
          // Same staleness check as the image prompt above, but for the
          // motion directive. When the motion node is still pending, the
          // file on disk is from a prior run — don't fetch or display it.
          const shouldReadMotion = completedMotion.has(itemId);
          const [pRaw, mRaw] = await Promise.all([
            window.electron.project.readFile(promptPath).catch(() => null),
            shouldReadMotion
              ? window.electron.project.readFile(motionPath).catch(() => null)
              : Promise.resolve(null),
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
            entries.push({
              scene,
              shot,
              prompts,
              motion,
              promptPath: prompts ? promptPath : null,
              motionPath: motion ? motionPath : null,
            });
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
  }, [projectDirectory, refreshTick, completedShots, completedMotion]);

  const resolveRef = useCallback(
    (refId: string): string | null => refMap.get(refId) ?? null,
    [refMap],
  );

  // ── Edit handlers ────────────────────────────────────────────────
  // The pencil click on a prompt block lands here. The block's full
  // identity (scene, shot, kind) plus its current text seed the panel-
  // level editor. Only one block can be in edit mode at a time.
  const handleStartEdit = useCallback(
    (scene: number, shot: number, kind: PromptKind, currentText: string) => {
      setEditTarget({ scene, shot, kind });
      setEditOriginal(currentText);
      setEditBuffer(currentText);
      setEditError(null);
    },
    [],
  );

  const handleCancelEdit = useCallback(() => {
    setEditTarget(null);
    setEditOriginal('');
    setEditBuffer('');
    setEditError(null);
  }, []);

  // Locate the entry for the current edit so save can compute the
  // file path + invalidation target. Re-computed each render — cheap
  // (we only have one editTarget at a time and `shots` is small).
  const findEntry = useCallback(
    (scene: number, shot: number): ShotEntry | undefined =>
      shots.find((s) => s.scene === scene && s.shot === shot),
    [shots],
  );

  const handleSaveEdit = useCallback(async () => {
    if (!editTarget) return;
    // Empty save (no actual change) is treated as cancel: no file
    // write, no invalidation, no chat receipt.
    if (editBuffer === editOriginal) {
      handleCancelEdit();
      return;
    }
    const entry = findEntry(editTarget.scene, editTarget.shot);
    if (!entry) {
      setEditError('Could not locate the shot to save.');
      return;
    }
    const filePath =
      editTarget.kind === 'motion' ? entry.motionPath : entry.promptPath;
    if (!filePath) {
      setEditError('No backing prompt file for this shot.');
      return;
    }
    const assets = shotAssets.get(`${editTarget.scene}-${editTarget.shot}`);
    const hasLastFrameNode = !!assets?.hasLastFrameNode;

    setIsEditSaving(true);
    setEditError(null);
    const result = await savePromptEdit({
      kind: editTarget.kind,
      scene: editTarget.scene,
      shot: editTarget.shot,
      newText: editBuffer,
      filePath,
      hasLastFrameNode,
      fs: {
        readFile: (p) => window.electron.project.readFile(p),
        writeFile: (p, content) =>
          window.electron.project.writeFile(p, content),
      },
      invalidateNodes: agent
        ? agent.invalidateNodes
        : async () => ({
            ok: false,
            error: 'Agent context unavailable',
          }),
    });
    setIsEditSaving(false);

    if (!result.ok) {
      setEditError(result.error ?? 'Save failed.');
      return;
    }

    // Build the user-visible chat receipt. UI-only — the agent reads
    // the rewritten file and the freshly-pending node directly off
    // disk on its next turn, no preface needed.
    const kindLabel: Record<PromptKind, string> = {
      first_frame: 'first-frame prompt',
      last_frame: 'last-frame prompt',
      motion: 'motion directive',
      negative: 'negative prompt',
    };
    agent?.notifyChatReceipt(
      `📝 You edited and invalidated the ${kindLabel[editTarget.kind]} for Scene ${editTarget.scene}, Shot ${editTarget.shot}. It will regenerate on the next run.`,
    );

    // Bump refresh so the panel re-reads the updated JSON and shows
    // the new text without a manual refetch.
    setRefreshTick((t) => t + 1);
    handleCancelEdit();
  }, [
    agent,
    editBuffer,
    editOriginal,
    editTarget,
    findEntry,
    handleCancelEdit,
    shotAssets,
  ]);

  const editor: EditCoordinator = useMemo(
    () => ({
      editId: editTarget,
      buffer: editBuffer,
      error: editError,
      isSaving: isEditSaving,
      onStartEdit: handleStartEdit,
      onChangeBuffer: setEditBuffer,
      onSave: handleSaveEdit,
      onCancel: handleCancelEdit,
    }),
    [
      editTarget,
      editBuffer,
      editError,
      isEditSaving,
      handleStartEdit,
      handleSaveEdit,
      handleCancelEdit,
    ],
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
              const itemId = `scene_${entry.scene}_shot_${entry.shot}`;
              // Surgical regen targets per row. The redoNode contract
              // (see kshana-core/src/core/planner/ExecutorAgent.ts:1041)
              // owns cascading: image_only regens dirty completed
              // downstream video; the bare shot_video / shot_image_last_frame
              // call cascades to final_video. So one click = one surgical
              // refresh of just that asset (plus everything it invalidates
              // downstream by definition).
              const shotLabel = `Scene ${entry.scene} Shot ${entry.shot}`;
              const firstFrameRegen: RegenTarget = {
                nodeId: `shot_image:${itemId}`,
                scope: 'image_only',
                frame: 'first_frame',
                label: 'Regenerate first frame (also re-renders shot video)',
                whatLabel: `first frame of ${shotLabel}`,
              };
              const lastFrameRegen: RegenTarget = assets?.hasLastFrameNode
                ? {
                    nodeId: `shot_image_last_frame:${itemId}`,
                    label: 'Regenerate last frame (also re-renders shot video)',
                    whatLabel: `last frame of ${shotLabel}`,
                  }
                : {
                    nodeId: `shot_image:${itemId}`,
                    scope: 'image_only',
                    frame: 'last_frame',
                    label: 'Regenerate last frame (also re-renders shot video)',
                    whatLabel: `last frame of ${shotLabel}`,
                  };
              const videoRegen: RegenTarget = {
                nodeId: `shot_video:${itemId}`,
                label: 'Regenerate shot video (re-renders final video too)',
                whatLabel: `video for ${shotLabel}`,
              };
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
                    editable={
                      entry.promptPath
                        ? {
                            scene: entry.scene,
                            shot: entry.shot,
                            kind: 'first_frame',
                          }
                        : undefined
                    }
                    editor={editor}
                    regen={firstFrameRegen}
                    notify={agent?.notifyChatReceipt}
                  />

                  <MediaPromptRow
                    label="Last frame prompt"
                    mediaPath={assets?.lastFrame}
                    mediaKind="image"
                    text={lf?.imagePrompt}
                    references={lf?.references}
                    resolveRef={resolveRef}
                    projectDirectory={projectDirectory}
                    editable={
                      entry.promptPath
                        ? {
                            scene: entry.scene,
                            shot: entry.shot,
                            kind: 'last_frame',
                          }
                        : undefined
                    }
                    editor={editor}
                    regen={lastFrameRegen}
                    notify={agent?.notifyChatReceipt}
                  />

                  <MediaPromptRow
                    label="Motion directive"
                    mediaPath={assets?.video}
                    mediaKind="video"
                    text={md}
                    references={undefined}
                    resolveRef={resolveRef}
                    projectDirectory={projectDirectory}
                    editable={
                      entry.motionPath
                        ? {
                            scene: entry.scene,
                            shot: entry.shot,
                            kind: 'motion',
                          }
                        : undefined
                    }
                    editor={editor}
                    regen={videoRegen}
                    notify={agent?.notifyChatReceipt}
                  />

                  {neg && (
                    <div className={styles.negativeBlock}>
                      <details>
                        <summary>Negative prompt</summary>
                        <PromptBlock
                          label="Negative prompt"
                          text={neg}
                          references={undefined}
                          resolveRef={resolveRef}
                          editable={
                            entry.promptPath
                              ? {
                                  scene: entry.scene,
                                  shot: entry.shot,
                                  kind: 'negative',
                                }
                              : undefined
                          }
                          editor={editor}
                        />
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
