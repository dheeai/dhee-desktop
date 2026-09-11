/**
 * NewProjectScreen — the "Production Slate" fullscreen takeover that
 * replaces the old NewProjectDialog. The user picks a bundle, fills its
 * declared required inputs (story, duration, style, aspect), names the
 * project, and clicks ROLL. We then:
 *
 *   1. Create the project folder (project:create-folder IPC).
 *   2. Write project.json + inputs/story.md fully populated
 *      (project:initialize IPC → dhee-core/initializeProject).
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
import type { BackendLane } from '../../../../shared/settingsTypes';
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
import { markProjectForAutoStart } from '../../../utils/projectAutoStart';
import BundleConfigurator from '../../BundleConfigurator/BundleConfigurator';
import BundleInstall from '../../BundleConfigurator/BundleInstall';
import AttachmentChip from '../../chat/ChatInput/AttachmentChip';
import WorkflowImport from '../../BundleConfigurator/WorkflowImport';
import styles from './NewProjectScreen.module.scss';

interface BundleInputOption {
  value: string | number | boolean;
  label: string;
}

/** What a bundle may legally put in `options` — see normaliseBundleOptions. */
type RawBundleInputOption = BundleInputOption | string | number | boolean;

/**
 * Bundle `options` come in TWO shapes and dhee-core accepts both.
 *
 *   {value,label} objects   68 inputs across the bundle corpus
 *   bare scalars            11 inputs — ['480p','720p'], [true,false], [30,60,90]
 *                           including `narration` in every illustrated_story_* bundle
 *
 * This screen only ever handled the object form, so a bare-scalar list rendered
 * `<option value="undefined">{undefined}</option>` for every entry: a dropdown
 * with no visible text that collapses to content width. It also silently broke
 * three other things, because `o.value` was undefined everywhere — `isPreset`
 * never matched (so `allowCustom` fields jumped into custom mode on load),
 * `numericPresets` misdetected integer presets as non-numeric (so the custom
 * box returned a string), and the `pills` control rendered blank buttons.
 *
 * Normalising here fixes all of it at one point, and means a bundle authored
 * either way renders correctly — better than editing 11 bundles and hoping the
 * next author picks the right shape.
 */
function normaliseBundleOptions(raw: RawBundleInputOption[] | undefined): BundleInputOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((o) =>
    o !== null && typeof o === 'object' && 'value' in o
      ? { value: o.value, label: String(o.label ?? o.value) }
      : { value: o as string | number | boolean, label: String(o) },
  );
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
  options?: RawBundleInputOption[];
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

interface BundleRuntimeSupport {
  modes?: string[];
  providers?: string[];
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
  runtimeSupport?: BundleRuntimeSupport;
  pickerEligible?: boolean;
}

type RuntimeBadgeKind = 'local' | 'cloud' | 'provider';

interface RuntimeBadge {
  label: string;
  kind: RuntimeBadgeKind;
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
  /** Current ComfyUI routing lane. Cloud mode does not probe local endpoints. */
  comfyBackend?: BackendLane;
}

const STORY_INPUT_ID = 'story_input';
const WORDS_PER_SECOND_NARRATION = 2.5;

// Rotating noun in the hero question. Pure teasing copy — shows the
// breadth of what dhee can produce as bundles grow beyond narrative
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

const PROVIDER_LABELS: Record<string, string> = {
  comfy: 'Comfy',
  openrouter: 'OpenRouter',
  llm: 'LLM',
  ffmpeg: 'FFmpeg',
};

function runtimeSupportBadges(
  runtimeSupport?: BundleRuntimeSupport,
): RuntimeBadge[] {
  const modes = new Set(runtimeSupport?.modes ?? []);
  const providers = new Set(runtimeSupport?.providers ?? []);
  const badges: RuntimeBadge[] = [];

  if (modes.has('local')) badges.push({ label: 'Local', kind: 'local' });
  if (modes.has('dhee_cloud')) {
    badges.push({ label: 'Supported by Dhee Cloud', kind: 'cloud' });
  }

  Object.entries(PROVIDER_LABELS).forEach(([provider, label]) => {
    if (providers.has(provider)) badges.push({ label, kind: 'provider' });
  });

  return badges;
}

function runtimeBadgeClassName(kind: RuntimeBadgeKind): string {
  const classNames = [styles.runtimeBadge];
  if (kind === 'cloud') classNames.push(styles.runtimeBadgeCloud);
  if (kind === 'provider') classNames.push(styles.runtimeBadgeProvider);
  return classNames.join(' ');
}

function bundleSupportsDheeCloud(bundle: BundleSummary | null): boolean {
  return Boolean(bundle?.runtimeSupport?.modes?.includes('dhee_cloud'));
}

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
  comfyBackend = 'local',
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
  // Browse-published-bundles (npm registry search by `dhee-bundle` keyword).
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<
    Array<{
      name: string;
      displayName: string;
      version: string;
      description: string;
      spec: string;
    }>
  >([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Package names already installed (persisted) — so a published bundle that's
  // already installed shows in the "Installed" grid, not the "Available" one.
  const [installedPackageNames, setInstalledPackageNames] = useState<Set<string>>(
    () => {
      try {
        const raw = window.localStorage.getItem('dhee.installedBundlePackages');
        return new Set(raw ? (JSON.parse(raw) as string[]) : []);
      } catch {
        return new Set<string>();
      }
    },
  );
  const [setupReferenceAttachments, setSetupReferenceAttachments] = useState<
    Attachment[]
  >([]);
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
  // In Dhee Cloud mode, cloud fit is managed server-side, so the slate must not
  // probe or label the user's local ComfyUI endpoint.
  useEffect(() => {
    if (comfyBackend === 'cloud') {
      setResolvedIds(new Set());
      return undefined;
    }
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
  }, [isOpen, bundles, comfyBackend]);

  const selectedBundle = useMemo(
    () => bundles.find((b) => b.id === selectedBundleId) ?? null,
    [bundles, selectedBundleId],
  );

  // Type-to-filter the installed grid (the search box already promises
  // this — "Search bundles…"). Empty query shows everything; a query
  // matches displayName or summary. The same box's Enter/Search button
  // still triggers the npm registry search for published bundles.
  const visibleBundles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return bundles;
    return bundles.filter(
      (b) =>
        b.displayName.toLowerCase().includes(q) ||
        (b.summary ?? '').toLowerCase().includes(q),
    );
  }, [bundles, searchQuery]);

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
  const isComfyCloudMode = comfyBackend === 'cloud';
  const selectedSupportsCloud = bundleSupportsDheeCloud(selectedBundle);
  const bundleCompatibleWithBackend =
    !isComfyCloudMode || selectedSupportsCloud;

  const canRoll =
    !!selectedBundleId &&
    storyText.trim().length >= 8 &&
    title.trim().length > 0 &&
    workspacePath.trim().length > 0 &&
    backendReady &&
    bundleCompatibleWithBackend &&
    !isSubmitting;

  const handleSelectBundle = useCallback((id: string) => {
    setSelectedBundleId(id);
    setError(null);
  }, []);

  const handleInstallBundle = useCallback(async (specArg?: string) => {
    const packageSpec = (specArg ?? '').trim();
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
      if (result.packageName) {
        setInstalledPackageNames((prev) => {
          const next = new Set(prev);
          next.add(result.packageName);
          try {
            window.localStorage.setItem(
              'dhee.installedBundlePackages',
              JSON.stringify([...next]),
            );
          } catch {
            /* best-effort persistence */
          }
          return next;
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to install bundle package: ${message}`);
    } finally {
      setIsInstallingBundle(false);
    }
  }, [isInstallingBundle, loadBundles]);

  const handleSearchNpm = useCallback(async () => {
    setSearchError(null);
    setIsSearching(true);
    try {
      const res = await window.electron.project.searchNpmBundles({
        query: searchQuery.trim(),
      });
      if (res.ok) {
        setSearchHits(res.hits);
        if (res.hits.length === 0) setSearchError('No published bundles matched.');
      } else {
        setSearchHits([]);
        setSearchError(res.error);
      }
    } catch (err) {
      setSearchHits([]);
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  // Show published bundles by default — search npm once when the picker opens.
  useEffect(() => {
    void handleSearchNpm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      markProjectForAutoStart(result.projectDir);
      await openProject(result.projectDir);
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

        {/* Browse mode — no bundle chosen yet. Search/filter + a dense,
            scannable grid of compact cards. Details are intentionally
            omitted here; the picker is for choosing, not reading specs. */}
        {!selectedBundle ? (
          <>
            <div className={styles.bundleInstallRow}>
              <input
                type="text"
                aria-label="search bundles"
                placeholder="Search bundles, or paste an npm package name…"
                className={styles.bundleInstallInput}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSearchNpm();
                }}
              />
              <button
                type="button"
                className={styles.bundleInstallButton}
                disabled={isSearching}
                onClick={() => void handleSearchNpm()}
              >
                {isSearching ? 'Searching' : 'Search'}
              </button>
            </div>
            {searchError ? (
              <div className={styles.searchNote}>{searchError}</div>
            ) : null}

            <div className={styles.bundleGrid}>
              {/* Installed + built-in bundles — selectable. */}
              {visibleBundles.map((bundle) => {
                const selected = bundle.id === selectedBundleId;
                const ready = isComfyCloudMode
                  ? bundleSupportsDheeCloud(bundle)
                  : resolvedIds.has(bundle.id);
                const readyLabel = isComfyCloudMode
                  ? 'Ready on Dhee Cloud'
                  : 'Ready on this ComfyUI';
                return (
                  <button
                    key={bundle.id}
                    type="button"
                    onClick={() => handleSelectBundle(bundle.id)}
                    className={`${styles.bundleCard} ${selected ? styles.bundleCardSelected : ''}`}
                  >
                    {ready ? (
                      <span
                        className={styles.readyDot}
                        title={readyLabel}
                        aria-label={readyLabel}
                      />
                    ) : null}
                    <h2 className={styles.bundleName}>{bundle.displayName}</h2>
                    <p className={styles.bundleSummary}>{bundle.summary}</p>
                  </button>
                );
              })}

              {/* Published on npm, not yet installed — install pulls bundle + runners. */}
              {searchHits
                .filter((hit) => !installedPackageNames.has(hit.name))
                .map((hit) => (
                  <div
                    key={hit.name}
                    className={`${styles.bundleCard} ${styles.bundleCardAvailable}`}
                  >
                    <div className={styles.availableTag}>Available · npm</div>
                    <h2 className={styles.bundleName}>{hit.displayName}</h2>
                    <p className={styles.bundleSummary}>
                      {hit.description || '—'}
                    </p>
                    <button
                      type="button"
                      className={styles.bundleInstallButton}
                      style={{ marginTop: 'auto', alignSelf: 'flex-start' }}
                      disabled={isInstallingBundle}
                      onClick={() => void handleInstallBundle(hit.spec)}
                    >
                      {isInstallingBundle ? 'Installing…' : 'Install + runners'}
                    </button>
                  </div>
                ))}
            </div>

            <div className={styles.installToggleRow}>
              <button
                type="button"
                onClick={() => setShowInstall((v) => !v)}
                className={styles.linkButton}
              >
                {showInstall ? '× Cancel install' : '+ Install a community bundle'}
              </button>
              {showInstall && (
                <div style={{ marginTop: 10 }}>
                  <BundleInstall onInstalled={(id) => void refreshAndSelect(id)} />
                </div>
              )}
            </div>
          </>
        ) : (
          /* Configure mode — the grid has collapsed into a compact chosen
             bar so the form sits right under the choice. */
          <>
            <div className={styles.chosenBar}>
              <div className={styles.chosenMeta}>
                <div className={styles.chosenEyebrow}>Selected format</div>
                <h2 className={styles.chosenName}>
                  {selectedBundle.displayName}
                </h2>
                <p className={styles.chosenSummary}>{selectedBundle.summary}</p>
                {(() => {
                  const badges = runtimeSupportBadges(
                    selectedBundle.runtimeSupport,
                  );
                  return badges.length > 0 ? (
                    <div
                      className={styles.runtimeBadgeRow}
                      style={{ marginTop: 10, marginBottom: 0 }}
                    >
                      {badges.map((badge) => (
                        <span
                          key={`${selectedBundle.id}-${badge.label}`}
                          className={runtimeBadgeClassName(badge.kind)}
                        >
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
              {(
                isComfyCloudMode
                  ? bundleSupportsDheeCloud(selectedBundle)
                  : resolvedIds.has(selectedBundle.id)
              ) ? (
                <span className={styles.chosenReady}>
                  ✓ {isComfyCloudMode ? 'Ready on Dhee Cloud' : 'Ready'}
                </span>
              ) : null}
              <button
                type="button"
                className={styles.changeButton}
                onClick={() => setSelectedBundleId(null)}
              >
                ← Change
              </button>
            </div>

            <div className={styles.inputsBlock}>
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
              {isComfyCloudMode ? (
                <CloudCompatibilityPanel supported={selectedSupportsCloud} />
              ) : (
                <>
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
                </>
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
            </div>
          </>
          )}

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

function CloudCompatibilityPanel({ supported }: { supported: boolean }) {
  if (supported) {
    return (
      <div className={`${styles.cloudCompatibility} ${styles.cloudCompatibilityReady}`}>
        <div className={styles.cloudCompatibilityTitle}>Ready on Dhee Cloud</div>
        <p>
          This bundle is supported by Dhee Cloud. Workflow and model fit are
          managed by the cloud renderer.
        </p>
      </div>
    );
  }

  return (
    <div className={`${styles.cloudCompatibility} ${styles.cloudCompatibilityWarn}`}>
      <div className={styles.cloudCompatibilityTitle}>Not available on Dhee Cloud</div>
      <p>
        This bundle does not declare Dhee Cloud support. Switch ComfyUI back to
        local in Settings to use it.
      </p>
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
  const options = normaliseBundleOptions(decl.options);
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
        {control === 'pills' && options.length > 0 ? (
          <div className={styles.pillGroup}>
            {options.map((opt) => {
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
        ) : control === 'select' && options.length > 0 ? (
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
                const opt = options.find((o) => String(o.value) === raw);
                onChange(opt ? opt.value : raw);
              }}
            >
              {options.map((opt) => (
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
