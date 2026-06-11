/**
 * NewProjectScreen — the "Production Slate" fullscreen takeover that
 * replaces the old NewProjectDialog. The user picks a bundle, fills its
 * declared required inputs (story, duration, style, aspect), names the
 * project, and clicks ROLL. We then:
 *
 *   1. Create the project folder (project:create-folder IPC).
 *   2. Write project.json + inputs/story.md fully populated
 *      (project:initialize IPC → kshana-core/initializeProject).
 *   3. Open the project (workspace context).
 *
 * The agent enters the chat with a project that's already initialized
 * — no setup grind in chat.
 *
 * Visual language: warm-black canvas, Fraunces display + JetBrains Mono
 * labels, single amber accent. Subtle film grain + vignette overlays.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import type {
  Attachment,
  ReferenceImagePayload,
  ReferenceImageRole,
} from '../../../../shared/attachmentTypes';
import {
  attachmentsFromSelectResponse,
  isReferenceImageLikeAttachment,
  referenceImagesFromAttachments,
  withReferenceImageRole,
} from '../../../../shared/attachmentTypes';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import {
  buildDefaultWorkspaceFolder,
  readPersistedWorkspacePath,
  resolveDefaultWorkspacePath,
  writePersistedWorkspacePath,
} from '../../../utils/workspacePathDefaults';
import BundleConfigurator from '../../BundleConfigurator/BundleConfigurator';
import BundleInstall from '../../BundleConfigurator/BundleInstall';
import AttachmentChip from '../../chat/ChatInput/AttachmentChip';
import WorkflowImport from '../../BundleConfigurator/WorkflowImport';
import styles from './NewProjectScreen.module.scss';

interface BundleInputOption {
  value: string | number | boolean;
  label: string;
}

interface BundleInputDecl {
  id: string;
  kind: 'file' | 'project';
  path?: string;
  field?: string;
  required?: boolean;
  default?: unknown;
  label?: string;
  placeholder?: string;
  multiline?: boolean;
  control?: 'textarea' | 'text' | 'pills' | 'select' | 'number';
  options?: BundleInputOption[];
  /**
   * Mirror of dhee-core's BundleInputDecl.allowCustom. When true, FormRow
   * renders an "Other…" affordance beside the presets so the user can
   * enter a value outside `options` (free-form style → world_style, an
   * arbitrary duration, a non-listed resolution). The custom value is
   * sent to project.<field> verbatim.
   */
  allowCustom?: boolean;
  unit?: string;
}

interface BundleSummary {
  id: string;
  version: string;
  bundleSource?: string;
  sourceScheme?: 'built-in' | 'user';
  displayName: string;
  summary: string;
  techLine?: string;
  description?: string;
  inputs?: BundleInputDecl[];
  pickerEligible?: boolean;
}

interface NewProjectScreenProps {
  isOpen: boolean;
  onClose: () => void;
  /** When false, Roll is gated — a required lane isn't configured. Defaults to ready. */
  backendReady?: boolean;
  /** Lanes still needing setup, shown in the gate notice. */
  unconfiguredLanes?: Array<{ lane: string; reason: string }>;
  /** Open Settings to connect lanes (from the gate notice). */
  onConnectBackends?: () => void;
}

const STORY_INPUT_ID = 'story_input';
const WORDS_PER_SECOND_NARRATION = 2.5;

// Rotating noun in the hero question. Pure teasing copy — shows the
// breadth of what kshana can produce as bundles grow beyond narrative
// film. Mix of pro work (trailer, ad), narrative formats (anime, short,
// documentary), abstract/artistic (visualizer, art film, title
// sequence), and personal (bedtime story, love letter). The rotation
// doesn't gate or filter bundle selection — it's atmosphere.
const ROTATING_NOUNS = [
  'film',
  'short',
  'ad',
  'trailer',
  'anime',
  'music video',
  'graphic novel',
  'documentary',
  'video essay',
  'title sequence',
  'visualizer',
  'explainer',
  'bedtime story',
  'love letter',
  'character study',
  'pitch video',
  'fashion film',
  'art film',
];
const NOUN_ROTATE_MS = 1900;

function safeFolderName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function deriveTitleFromStory(story: string): string {
  const firstLine = story.split('\n').find((line) => line.trim().length > 0);
  if (!firstLine) return '';
  // Take first sentence or first ~6 words.
  const dotIdx = firstLine.indexOf('.');
  const slice = dotIdx > 0 ? firstLine.slice(0, dotIdx) : firstLine;
  const words = slice.trim().split(/\s+/).slice(0, 6).join(' ');
  return words;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function estimateReadSeconds(wordCount: number): number {
  return Math.round(wordCount / WORDS_PER_SECOND_NARRATION);
}

function formatSeconds(s: number): string {
  if (s < 60) return `0:${String(s).padStart(2, '0')}`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function mergeSetupReferenceAttachments(
  current: Attachment[],
  picked: Attachment[],
): Attachment[] {
  const next = [...current];
  for (const rawAttachment of picked) {
    if (!isReferenceImageLikeAttachment(rawAttachment)) continue;
    const attachment = withReferenceImageRole(rawAttachment, 'character');
    const existingIndex = next.findIndex((item) => item.path === attachment.path);
    if (existingIndex >= 0) {
      next[existingIndex] = attachment;
    } else {
      next.push(attachment);
    }
  }
  return next;
}

export default function NewProjectScreen({
  isOpen,
  onClose,
  backendReady = true,
  unconfiguredLanes = [],
  onConnectBackends,
}: NewProjectScreenProps) {
  const { openProject } = useWorkspace();

  const [bundles, setBundles] = useState<BundleSummary[]>([]);
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  // Bundle ids previously verified "ready" on the user's ComfyUI (cached
  // by bundle:check). Drives the picker's "✓ Ready on this ComfyUI" badge.
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [showInstall, setShowInstall] = useState(false);
  const [showByo, setShowByo] = useState(false);

  // Re-read the bundle list (after a community install) and select the
  // new one so the existing Compatibility section configures it.
  const refreshAndSelect = useCallback(async (newBundleId: string) => {
    try {
      const list = (await window.electron.project.listBundles()) as BundleSummary[];
      const eligible = list.filter((b) => b.pickerEligible);
      setBundles(eligible.length > 0 ? eligible : list);
    } catch {
      /* keep current list */
    }
    setSelectedBundleId(newBundleId);
    setShowInstall(false);
  }, []);
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [workspacePath, setWorkspacePath] = useState<string>('');
  const [productionNumber, setProductionNumber] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInstallingBundle, setIsInstallingBundle] = useState(false);
  const [setupReferenceAttachments, setSetupReferenceAttachments] = useState<
    Attachment[]
  >([]);
  const [npmBundleSpec, setNpmBundleSpec] = useState(
    '@dhee_ai/youtube-short-bundle',
  );
  const [error, setError] = useState<string | null>(null);
  const [nounIndex, setNounIndex] = useState(0);

  // Rotate the hero question's noun every few seconds while the user
  // hasn't picked a bundle yet. Once they pick, freeze the noun so it
  // doesn't distract during form filling.
  useEffect(() => {
    if (!isOpen) return undefined;
    if (selectedBundleId) return undefined;
    const t = setInterval(() => {
      setNounIndex((i) => (i + 1) % ROTATING_NOUNS.length);
    }, NOUN_ROTATE_MS);
    return () => clearInterval(t);
  }, [isOpen, selectedBundleId]);

  const loadBundles = useCallback(async () => {
    const list =
      (await window.electron.project.listBundles()) as BundleSummary[];
    // Picker-eligible bundles only: bundle.json must explicitly
    // declare BOTH displayName AND summary. Falls back to the full
    // list if nothing matches (dev environment with no curated
    // bundles yet).
    const eligible = list.filter((b) => b.pickerEligible);
    setBundles(eligible.length > 0 ? eligible : list);
  }, []);

  // Load bundles + initial workspace path on open.
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    (async () => {
      try {
        await loadBundles();
        if (cancelled) return;
      } catch {
        if (!cancelled) setBundles([]);
      }

      try {
        let homeDefault = '';
        try {
          homeDefault = await window.electron.project.getDefaultWorkspacePath();
        } catch {
          // best-effort
        }
        if (cancelled) return;
        const stored = readPersistedWorkspacePath(window.localStorage);
        const fallback = homeDefault || buildDefaultWorkspaceFolder(null);
        const resolved = resolveDefaultWorkspacePath({
          storedPath: stored,
          fallbackDefault: fallback,
        });
        if (!cancelled) setWorkspacePath(resolved);
      } catch {
        // best-effort
      }

      try {
        const recent = await window.electron.project.getRecent();
        if (!cancelled) {
          setProductionNumber((recent?.length ?? 0) + 1);
        }
      } catch {
        // best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, loadBundles]);

  // ESC closes.
  useEffect(() => {
    if (!isOpen) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [isOpen, isSubmitting, onClose]);

  // Badge bundles already verified ready on this ComfyUI (cheap cache read).
  useEffect(() => {
    if (!isOpen || bundles.length === 0) return;
    let cancelled = false;
    (async () => {
      let endpoint = 'http://127.0.0.1:8188';
      try {
        const s = await window.electron.settings.get();
        if (s.comfyuiMode === 'custom' && s.comfyuiUrl) endpoint = s.comfyuiUrl;
      } catch {
        /* default endpoint */
      }
      const ready = new Set<string>();
      await Promise.all(
        bundles.map(async (b) => {
          try {
            const r = await window.electron.bundleConfig.resolution(b.id, endpoint);
            if (r && r.status === 'ready' && r.bundleVersion === b.version) ready.add(b.id);
          } catch {
            /* no stamp */
          }
        }),
      );
      if (!cancelled) setResolvedIds(ready);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, bundles]);

  const selectedBundle = useMemo(
    () => bundles.find((b) => b.id === selectedBundleId) ?? null,
    [bundles, selectedBundleId],
  );

  // Apply bundle defaults the moment a bundle is selected (so the form
  // is sensibly populated even before the user touches anything).
  useEffect(() => {
    if (!selectedBundle) return undefined;
    setInputValues((prev) => {
      const next: Record<string, unknown> = { ...prev };
      (selectedBundle.inputs ?? []).forEach((decl) => {
        if (
          decl.kind === 'project' &&
          next[decl.id] === undefined &&
          decl.default !== undefined
        ) {
          next[decl.id] = decl.default;
        }
      });
      return next;
    });
    return undefined;
  }, [selectedBundle]);

  const storyText = String(inputValues[STORY_INPUT_ID] ?? '');
  const wordCount = countWords(storyText);
  const readSeconds = estimateReadSeconds(wordCount);

  // Auto-derive title from story unless the user has manually edited
  // it. titleOverride === null means "follow the story".
  const derivedTitle = deriveTitleFromStory(storyText);
  const title = titleOverride !== null ? titleOverride : derivedTitle;

  const canRoll =
    !!selectedBundleId &&
    storyText.trim().length >= 8 &&
    title.trim().length > 0 &&
    workspacePath.trim().length > 0 &&
    backendReady &&
    !isSubmitting;

  const handleSelectBundle = useCallback((id: string) => {
    setSelectedBundleId(id);
    setError(null);
  }, []);

  const handleInstallBundle = useCallback(async () => {
    const packageSpec = npmBundleSpec.trim();
    if (!packageSpec || isInstallingBundle) return;
    setError(null);
    setIsInstallingBundle(true);
    try {
      const result = await window.electron.project.installBundlePackage({
        packageSpec,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await loadBundles();
      setSelectedBundleId(result.bundleId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to install bundle package: ${message}`);
    } finally {
      setIsInstallingBundle(false);
    }
  }, [isInstallingBundle, loadBundles, npmBundleSpec]);

  const queueInstallBundle = useCallback(() => {
    handleInstallBundle().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to install bundle package: ${message}`);
    });
  }, [handleInstallBundle]);

  const handleInputChange = useCallback((id: string, value: unknown) => {
    setInputValues((prev) => ({ ...prev, [id]: value }));
  }, []);

  const handleTitleChange = useCallback((next: string) => {
    setTitleOverride(next);
  }, []);

  const handleBrowseWorkspace = useCallback(async () => {
    try {
      const chosen = await window.electron.project.selectDirectory();
      if (chosen) {
        setWorkspacePath(chosen);
        writePersistedWorkspacePath(window.localStorage, chosen);
      }
    } catch {
      // best-effort
    }
  }, []);

  const handleSelectReferenceImages = useCallback(async () => {
    setError(null);
    try {
      const result = await window.electron.project.selectAttachment({
        kinds: ['reference_image'],
        title: 'Add character reference images',
        multiple: true,
      });
      if (!result.ok) {
        if (result.error) setError(result.error);
        return;
      }
      const picked = attachmentsFromSelectResponse(result);
      if (picked.length > 0) {
        setSetupReferenceAttachments((prev) =>
          mergeSetupReferenceAttachments(prev, picked),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to add character images: ${message}`);
    }
  }, []);

  const handleRemoveSetupReference = useCallback((id: string) => {
    setSetupReferenceAttachments((prev) =>
      prev.filter((attachment) => attachment.id !== id),
    );
  }, []);

  const handleSetupReferenceRoleChange = useCallback(
    (id: string, role: ReferenceImageRole) => {
      setSetupReferenceAttachments((prev) =>
        prev.map((attachment) =>
          attachment.id === id
            ? withReferenceImageRole(attachment, role)
            : attachment,
        ),
      );
    },
    [],
  );

  const handleRoll = useCallback(async () => {
    if (!canRoll || !selectedBundleId || !selectedBundle) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const folderName =
        safeFolderName(title) || `production-${productionNumber}`;
      // 1. Make sure parent workspace folder exists, then create the project folder.
      const created = await window.electron.project.createFolder(
        workspacePath,
        folderName,
        { source: 'renderer', intent: 'new_project_parent' } as never,
      );
      if (!created) {
        setError(
          'Could not create the project folder. Check the workspace path and try again.',
        );
        setIsSubmitting(false);
        return;
      }

      let referenceImages: ReferenceImagePayload[] = [];
      if (setupReferenceAttachments.length > 0) {
        const imported = await window.electron.project.importReferenceImages({
          projectDir: created,
          attachments: setupReferenceAttachments,
        });
        if (!imported.ok) {
          setError(imported.error ?? 'Failed to import character images.');
          setIsSubmitting(false);
          return;
        }
        referenceImages = referenceImagesFromAttachments(
          imported.attachments ?? setupReferenceAttachments,
        );
      }

      // 2. Populate project.json + bundle inputs.
      const result = await window.electron.project.initialize({
        projectDir: created,
        name: title.trim(),
        bundleId: selectedBundleId,
        bundleSource:
          selectedBundle.bundleSource ?? `built-in:${selectedBundleId}`,
        inputs: inputValues,
        ...(referenceImages.length > 0 ? { referenceImages } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        setIsSubmitting(false);
        return;
      }

      // 3. Open the project. The workspace context flips routing to the
      //    workspace layout; the agent enters a fully-configured project.
      await openProject(created);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to create project: ${message}`);
      setIsSubmitting(false);
    }
  }, [
    canRoll,
    selectedBundleId,
    selectedBundle,
    title,
    workspacePath,
    productionNumber,
    inputValues,
    setupReferenceAttachments,
    openProject,
    onClose,
  ]);

  if (!isOpen) return null;

  return (
    <div className={styles.screen}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <button
            type="button"
            className={styles.headerEsc}
            onClick={onClose}
            aria-label="Close"
          >
            ESC
          </button>
          <div className={styles.headerCenter}>
            <span className={styles.headerRule} aria-hidden="true" />
            <span>N E W &nbsp; P R O D U C T I O N</span>
            <span className={styles.headerRule} aria-hidden="true" />
          </div>
          <div className={styles.headerNumber}>
            No. {String(productionNumber).padStart(3, '0')}
          </div>
        </header>

        <h1 className={styles.question}>
          What kind of{' '}
          <span key={nounIndex} className={styles.rotatingNoun}>
            {ROTATING_NOUNS[nounIndex]}
          </span>
          {' ?'}
        </h1>

        <div className={styles.bundleInstallRow}>
          <input
            type="text"
            aria-label="npm bundle package"
            className={styles.bundleInstallInput}
            value={npmBundleSpec}
            onChange={(e) => setNpmBundleSpec(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                queueInstallBundle();
              }
            }}
          />
          <button
            type="button"
            className={styles.bundleInstallButton}
            disabled={isInstallingBundle || npmBundleSpec.trim().length === 0}
            onClick={queueInstallBundle}
          >
            {isInstallingBundle ? 'Installing' : 'Install bundle'}
          </button>
        </div>

        <div className={styles.bundleGrid}>
          {bundles.map((bundle) => {
            const selected = bundle.id === selectedBundleId;
            return (
              <button
                key={bundle.id}
                type="button"
                onClick={() => handleSelectBundle(bundle.id)}
                className={`${styles.bundleCard} ${selected ? styles.bundleCardSelected : ''}`}
              >
                <h2 className={styles.bundleName}>{bundle.displayName}</h2>
                <p className={styles.bundleSummary}>{bundle.summary}</p>
                {bundle.techLine ? (
                  <div className={styles.bundleSpec}>{bundle.techLine}</div>
                ) : null}
                {resolvedIds.has(bundle.id) ? (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--color-success)',
                    }}
                  >
                    ✓ Ready on this ComfyUI
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() => setShowInstall((v) => !v)}
            style={{
              font: 'inherit',
              fontSize: 12.5,
              cursor: 'pointer',
              color: 'var(--color-accent-primary)',
              background: 'transparent',
              border: 0,
              padding: 0,
            }}
          >
            {showInstall ? '× Cancel install' : '+ Install a community bundle'}
          </button>
          {showInstall && (
            <div style={{ marginTop: 10 }}>
              <BundleInstall onInstalled={(id) => void refreshAndSelect(id)} />
            </div>
          )}
        </div>

        <div
          className={`${styles.inputsBlock} ${!selectedBundle ? styles.inputsBlockDisabled : ''}`}
        >
          {/* The Story */}
          {selectedBundle ? (
            <>
              <hr className={styles.divider} />
              <h3 className={styles.sectionLabel}>The Story</h3>
              <div className={styles.storyTextareaWrap}>
                <textarea
                  className={styles.storyTextarea}
                  placeholder={
                    selectedBundle.inputs?.find((i) => i.id === STORY_INPUT_ID)
                      ?.placeholder ?? 'Type your story here...'
                  }
                  value={storyText}
                  onChange={(e) =>
                    handleInputChange(STORY_INPUT_ID, e.target.value)
                  }
                />
              </div>
              <div className={styles.storyMeta}>
                {wordCount} words · {formatSeconds(readSeconds)} read
              </div>

              <div className={styles.referenceSection}>
                <div className={styles.referenceHeader}>
                  <span className={styles.rowLabel}>Characters</span>
                  <button
                    type="button"
                    className={styles.referenceAttachButton}
                    onClick={handleSelectReferenceImages}
                    disabled={isSubmitting}
                    aria-label="Add character reference images"
                  >
                    <ImagePlus size={14} />
                    <span>Add images</span>
                  </button>
                </div>
                {setupReferenceAttachments.length > 0 ? (
                  <div className={styles.referenceChipRow}>
                    {setupReferenceAttachments.map((attachment) => (
                      <AttachmentChip
                        key={attachment.id}
                        attachment={attachment}
                        onRemove={handleRemoveSetupReference}
                        onReferenceRoleChange={handleSetupReferenceRoleChange}
                        disabled={isSubmitting}
                      />
                    ))}
                  </div>
                ) : null}
              </div>

              <hr className={styles.divider} style={{ marginTop: '40px' }} />
              <h3 className={styles.sectionLabel}>Production</h3>

              {(selectedBundle.inputs ?? [])
                .filter((decl) => decl.kind === 'project')
                .map((decl) => (
                  <FormRow
                    key={decl.id}
                    decl={decl}
                    value={inputValues[decl.id]}
                    onChange={(v) => handleInputChange(decl.id, v)}
                  />
                ))}

              {/* Non-story file inputs (e.g. an optional style-guide that
                  becomes plans/world_style.md verbatim) render as their own
                  multiline textareas — the desktop otherwise only renders
                  project-kind FormRows + the special story textarea. */}
              {(selectedBundle.inputs ?? [])
                .filter((decl) => decl.kind === 'file' && decl.id !== STORY_INPUT_ID)
                .map((decl) => (
                  <div key={decl.id} style={{ marginTop: 20 }}>
                    <span className={styles.rowLabel}>
                      {(decl.label ?? decl.id).toString()}
                    </span>
                    <textarea
                      className={styles.storyTextarea}
                      style={{ minHeight: 110, marginTop: 6 }}
                      placeholder={decl.placeholder ?? ''}
                      value={
                        typeof inputValues[decl.id] === 'string'
                          ? (inputValues[decl.id] as string)
                          : ''
                      }
                      onChange={(e) => handleInputChange(decl.id, e.target.value)}
                    />
                  </div>
                ))}

              <hr className={styles.divider} style={{ marginTop: '40px' }} />
              <h3 className={styles.sectionLabel}>Compatibility</h3>
              <BundleConfigurator bundleId={selectedBundle.id} />
              <button
                type="button"
                onClick={() => setShowByo((v) => !v)}
                style={{
                  marginTop: 12,
                  font: 'inherit',
                  fontSize: 12.5,
                  cursor: 'pointer',
                  color: 'var(--color-accent-primary)',
                  background: 'transparent',
                  border: 0,
                  padding: 0,
                }}
              >
                {showByo ? '× Hide custom workflow' : '+ Bring your own workflow'}
              </button>
              {showByo && (
                <div style={{ marginTop: 10 }}>
                  <WorkflowImport />
                </div>
              )}

              <hr className={styles.divider} style={{ marginTop: '40px' }} />

              <div className={styles.row}>
                <span className={styles.rowLabel}>Title</span>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="name your production"
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                />
              </div>

              <div className={styles.row}>
                <span className={styles.rowLabel}>Workspace</span>
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'center',
                    flex: 1,
                  }}
                >
                  <input
                    type="text"
                    className={styles.textInput}
                    value={workspacePath}
                    onChange={(e) => setWorkspacePath(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={handleBrowseWorkspace}
                    className={styles.headerEsc}
                  >
                    BROWSE
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className={styles.footer}>
          <div className={styles.error}>{error}</div>
          {!backendReady ? (
            <button type="button" className={styles.gate} onClick={onConnectBackends}>
              <span className={styles.gateDot} />
              <span>
                Connect{' '}
                {unconfiguredLanes.length
                  ? unconfiguredLanes.map((l) => l.lane.toUpperCase()).join(' · ')
                  : 'your engine'}{' '}
                to roll
              </span>
              <span className={styles.gateConnect}>Connect →</span>
            </button>
          ) : null}
          <button
            type="button"
            className={`${styles.rollButton} ${canRoll ? styles.rollButtonReady : ''} ${isSubmitting ? styles.rollButtonLoading : ''}`}
            disabled={!canRoll}
            onClick={handleRoll}
          >
            <span
              className={`${styles.recDot} ${canRoll ? styles.recDotReady : ''}`}
            />
            <span>{isSubmitting ? 'Rolling…' : 'Roll'}</span>
            <span className={styles.arrow}>→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── FormRow: renders the right control for a BundleInputDecl ─── */

const CUSTOM_SENTINEL = '__custom__';

export function FormRow({
  decl,
  value,
  onChange,
}: {
  decl: BundleInputDecl;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const control = decl.control ?? (decl.options ? 'select' : 'text');
  const label = (decl.label ?? decl.id).toString();
  const options = decl.options ?? [];
  // Numeric presets (duration/resolution) → the custom input is a number.
  const numericPresets = options.length > 0 && options.every((o) => typeof o.value === 'number');
  const isPreset = options.some((o) => o.value === value);
  const hasValue = value !== undefined && value !== null && value !== '';
  const [customMode, setCustomMode] = useState(false);
  // Show the custom box when the user opted in, OR the current value
  // isn't one of the presets (e.g. a loaded custom value from project.json).
  const showCustom = Boolean(decl.allowCustom) && (customMode || (hasValue && !isPreset));
  const parseCustom = (raw: string): unknown => {
    if (!(numericPresets || control === 'number')) return raw;
    return raw === '' ? '' : Number(raw);
  };

  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <div>
        {control === 'pills' && decl.options ? (
          <div className={styles.pillGroup}>
            {decl.options.map((opt) => {
              const selected = !showCustom && value === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => {
                    setCustomMode(false);
                    onChange(opt.value);
                  }}
                  className={`${styles.pill} ${selected ? styles.pillSelected : ''}`}
                >
                  {opt.label}
                </button>
              );
            })}
            {decl.allowCustom && (
              <button
                type="button"
                onClick={() => setCustomMode(true)}
                className={`${styles.pill} ${showCustom ? styles.pillSelected : ''}`}
              >
                Other…
              </button>
            )}
            {showCustom && (
              <input
                type={numericPresets ? 'number' : 'text'}
                className={styles.textInput}
                style={{ maxWidth: 120, marginLeft: 8 }}
                placeholder={decl.unit ?? 'custom'}
                value={hasValue ? String(value) : ''}
                onChange={(e) => onChange(parseCustom(e.target.value))}
              />
            )}
          </div>
        ) : control === 'select' && decl.options ? (
          <>
            <select
              className={styles.select}
              value={showCustom ? CUSTOM_SENTINEL : String(value ?? '')}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === CUSTOM_SENTINEL) {
                  setCustomMode(true);
                  onChange('');
                  return;
                }
                setCustomMode(false);
                const opt = decl.options!.find((o) => String(o.value) === raw);
                onChange(opt ? opt.value : raw);
              }}
            >
              {decl.options.map((opt) => (
                <option key={String(opt.value)} value={String(opt.value)}>
                  {opt.label}
                </option>
              ))}
              {decl.allowCustom && <option value={CUSTOM_SENTINEL}>Other…</option>}
            </select>
            {showCustom && (
              <input
                type="text"
                className={styles.textInput}
                style={{ marginTop: 6, width: '100%' }}
                placeholder={decl.placeholder ?? 'Describe your own style…'}
                value={hasValue ? String(value) : ''}
                onChange={(e) => onChange(e.target.value)}
              />
            )}
          </>
        ) : control === 'number' ? (
          <input
            type="number"
            className={styles.textInput}
            style={{ maxWidth: 160 }}
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        ) : (
          <input
            type="text"
            className={styles.textInput}
            placeholder={decl.placeholder ?? ''}
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
    </div>
  );
}
