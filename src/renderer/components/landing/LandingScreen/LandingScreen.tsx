import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FC,
  type SVGProps,
} from 'react';
import {
  FolderOpen as _FolderOpen,
  Plus as _Plus,
  Settings as _Settings,
} from 'lucide-react';
import dheeLogoUrl from '../../../../../assets/icon.svg';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import { safeJsonParse } from '../../../utils/safeJsonParse';
import { useProject } from '../../../contexts/ProjectContext';
import { useAppSettings } from '../../../contexts/AppSettingsContext';
import {
  FIRST_RUN_TOUR_LANDING_ACTION_EVENT,
  useOptionalFirstRunTour,
  type FirstRunTourLandingAction,
} from '../../../contexts/FirstRunTourContext';
import SettingsPanel from '../../SettingsPanel';
import type { LandingProjectCard } from '../ProjectCard/ProjectCard';
import NewProjectScreen from '../NewProjectScreen/NewProjectScreen';
import ProjectCard from '../ProjectCard/ProjectCard';
import DeleteProjectDialog from '../ProjectActionDialog/DeleteProjectDialog';
import RenameProjectDialog from '../ProjectActionDialog/RenameProjectDialog';
import { getProjectNameFromPath, sortRecentProjects, toFileUrl } from '../projectDisplay';
import styles from './LandingScreen.module.scss';
import type { BackendProjectFile } from '../../../services/project/backendProjectAdapter';
import {
  collectMeetCharacterShots,
  extractSceneImages,
  selectSmartThumbnail,
  sumScenesAndShots,
  type SVPShape,
} from './projectMetadataHelpers';
import { resolveTileDisplay } from '../../../lib/bundleDisplay';
import { projectStateFromEventsJsonl } from '../../../lib/projectStateFromEvents';
import { getBackendConfigStatus } from './backendConfigStatus';
import { BackendNotReadyBanner } from './BackendNotReadyBanner';
import type { RecentProject } from '../../../../shared/fileSystemTypes';
import type { AccountInfo } from '../../../../shared/settingsTypes';
import type { ProviderDiagnosticsSnapshot } from '../../../../shared/providerDiagnosticsTypes';

type LucideFC = FC<SVGProps<SVGSVGElement> & { size?: number | string }>;

const FolderOpen = _FolderOpen as unknown as LucideFC;
const Plus = _Plus as unknown as LucideFC;
const Settings = _Settings as unknown as LucideFC;

const THUMBNAIL_CANDIDATES = [
  '.dhee/ui/thumbnail.jpg',
  '.dhee/ui/thumbnail.png',
  '.dhee/ui/thumbnail.webp',
  'thumbnail.jpg',
  'thumbnail.png',
  'thumbnail.webp',
];
const FALLBACK_APP_VERSION = 'v?.?.?';
type LandingView = 'projects' | 'settings';
type AccountAuthStatus = 'idle' | 'waiting' | 'expired' | 'error';
type SettingsTabTarget =
  | 'account'
  | 'appearance'
  | 'connection'
  | 'workflows'
  | 'diagnostics';

interface ProjectMetadata {
  manifestName?: string;
  description?: string | null;
  sceneCount?: number | null;
  shotCount?: number | null;
  thumbnailPath?: string | null;
  /**
   * Bundle-declared tile stats — opaque list of {label, value} pairs.
   * For narrative bundles these duplicate sceneCount/shotCount (kept
   * for back-compat); for non-narrative bundles (music, 3D, etc.)
   * these are the only meaningful numbers to render. Empty for
   * legacy executor projects.
   */
  tileStats?: Array<{ label: string; value: number }>;
}

interface PendingProjectAction {
  path: string;
  name: string;
}

interface AmbientStatus {
  /** Single-pill status that overrides the per-lane breakdown. */
  label: string;
  /** Class name for the single pill. */
  className: string;
}

/**
 * Auth-flow / connection-error states render as one banner-style pill
 * (Connecting / Session expired). When neither, we drop into the
 * per-lane breakdown.
 */
function getAmbientStatus(
  authStatus: AccountAuthStatus,
  classes: Record<string, string>,
): AmbientStatus | null {
  if (authStatus === 'waiting') {
    return { label: 'Connecting', className: classes.modeBadgeConnecting };
  }
  if (authStatus === 'expired') {
    return { label: 'Session expired', className: classes.modeBadgeWarning };
  }
  return null;
}

// Live reachability of a lane, derived from the provider-diagnostics
// poll. `checking` = no result yet; `off` = lane intentionally disabled
// (e.g. VLM judge turned off) → calm grey, not an alarming red.
type LaneHealth = 'reachable' | 'unreachable' | 'off' | 'checking';

function laneHealth(
  diag: ProviderDiagnosticsSnapshot | null,
  id: 'llm' | 'comfyui' | 'vlm',
): LaneHealth {
  if (!diag) return 'checking';
  const item = diag.items.find((i) => i.id === id);
  if (!item) return 'checking';
  if (item.status === 'ready') return 'reachable';
  if (item.status === 'unknown') return 'off';
  // 'warning' (configured but unverified / needs sign-in) and 'error'
  // both mean "not currently reachable" → blinking red.
  return 'unreachable';
}

function laneHealthDotClass(
  health: LaneHealth,
  classes: Record<string, string>,
): string {
  switch (health) {
    case 'reachable':
      return classes.statusDotReachable;
    case 'unreachable':
      return classes.statusDotUnreachable;
    case 'off':
      return classes.statusDotLocal;
    case 'checking':
    default:
      return classes.statusDotChecking;
  }
}

function joinPath(basePath: string, segment: string): string {
  const normalizedBase = basePath.replace(/\/+$/, '');
  const normalizedSegment = segment.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedSegment}`;
}

async function findThumbnailPath(projectPath: string): Promise<string | null> {
  const checks = await Promise.allSettled(
    THUMBNAIL_CANDIDATES.map(async (candidate) => {
      const fullPath = joinPath(projectPath, candidate);
      const exists = await window.electron.project.checkFileExists(fullPath);
      return exists ? fullPath : null;
    }),
  );

  for (const result of checks) {
    if (result.status === 'fulfilled' && result.value) {
      return result.value;
    }
  }

  return null;
}

async function loadSingleProjectMetadata(
  projectPath: string,
): Promise<ProjectMetadata> {
  const metadata: ProjectMetadata = {};
  const [projectContent, fileThumbnailPath] = await Promise.all([
    window.electron.project
      .readFile(joinPath(projectPath, 'project.json'))
      .catch(() => null),
    findThumbnailPath(projectPath),
  ]);

  // Parse project.json — title, description, bundleSource, walkState.
  type ProjectFileShape = BackendProjectFile & {
    bundleSource?: string;
    walkState?: { nodes?: Record<string, { status?: string; outputPath?: string }> };
    executorState?: { nodes?: Record<string, { status?: string; outputPath?: string }> };
  };
  let parsedProject: ProjectFileShape | null = null;
  if (projectContent) {
    try {
      parsedProject = safeJsonParse(projectContent);
      metadata.manifestName = parsedProject?.title;
      metadata.description = parsedProject?.description ?? null;
    } catch {
      /* malformed — fall through with null parsedProject */
    }
  }

  // Bundle-arch path: ask kshana-core for the bundle definition, then
  // let the bundle's display block drive thumbnail + stats. Bundle-
  // specific knowledge (which capability holds the thumbnail, what
  // labels to show) lives ENTIRELY in bundle.json. The desktop is
  // generic.
  let bundleStats: Array<{ label: string; value: number }> = [];
  let bundleThumbRel: string | null = null;
  if (parsedProject?.bundleSource) {
    try {
      const resp = await window.dhee.resolveBundle({ bundleSource: parsedProject.bundleSource });
      if (resp.ok && resp.bundle) {
        // Walker writes walkState to project.json only when invoked
        // with `bundleSource`. Headless callers (smoke scripts, future
        // CLI flows) may skip that path — state then lives solely in
        // `.dhee/events.jsonl`. Project events → minimal walkState so
        // the tile resolver finds the right completed instances.
        // Without this fallback the landing tile is thumbnail-blank
        // for any event-only project.
        let walkStateForTile = parsedProject.walkState;
        if (!walkStateForTile || !walkStateForTile.nodes) {
          const eventsRaw = await window.electron.project
            .readFile(joinPath(projectPath, '.dhee/events.jsonl'))
            .catch(() => null);
          if (eventsRaw) {
            walkStateForTile = projectStateFromEventsJsonl(eventsRaw);
          }
        }
        const display = await resolveTileDisplay(
          resp.bundle,
          { walkState: walkStateForTile, executorState: parsedProject.executorState },
          (relPath) =>
            window.electron.project
              .readFile(joinPath(projectPath, relPath))
              .catch(() => null),
          Math.random,
          // Existence probe: skip thumbnail candidates whose artifact
          // was orphaned (canonical moved aside by a failed re-render)
          // and fall through to the next completed instance with a
          // real file on disk.
          (relPath) =>
            window.electron.project
              .checkFileExists(joinPath(projectPath, relPath))
              .catch(() => false),
        );
        bundleStats = display.stats;
        bundleThumbRel = display.thumbnailPath;
      }
    } catch {
      /* bundle resolution failure — fall through to legacy logic */
    }
  }

  // Legacy fallback for pre-bundle (executor-shaped) projects.
  // Computes scene/shot count from prompts/videos/scenes/scene_N.json
  // and thumbnail from assets/manifest.json. Bundle projects skip this
  // entirely — bundleStats / bundleThumbRel already filled.
  let svps: Record<number, SVPShape | null> = {};
  let legacySceneImages: ReturnType<typeof extractSceneImages> = [];
  if (bundleStats.length === 0 && !bundleThumbRel) {
    const [manifestContent] = await Promise.all([
      window.electron.project
        .readFile(joinPath(projectPath, 'assets/manifest.json'))
        .catch(() => null),
    ]);
    if (manifestContent) {
      try {
        const manifest = safeJsonParse<{ assets: Array<unknown> }>(manifestContent);
        legacySceneImages = extractSceneImages(manifest);
      } catch {
        /* malformed */
      }
    }
    const MAX_SCENES_TO_PROBE = 32;
    await Promise.all(
      Array.from({ length: MAX_SCENES_TO_PROBE }, (_, i) => i + 1).map(async (n) => {
        const content = await window.electron.project
          .readFile(joinPath(projectPath, `prompts/videos/scenes/scene_${n}.json`))
          .catch(() => null);
        if (!content) return;
        try {
          svps[n] = safeJsonParse<SVPShape>(content);
        } catch {
          svps[n] = null;
        }
      }),
    );
    const legacyCounts = sumScenesAndShots(svps);
    if (legacyCounts.scenes > 0 || legacyCounts.shots > 0) {
      bundleStats = [
        { label: 'scenes', value: legacyCounts.scenes },
        { label: 'shots', value: legacyCounts.shots },
      ];
    }
  }

  // Surface the first two computed stats as sceneCount / shotCount on
  // ProjectMetadata so the existing tile renderer (which renders
  // "N scenes · M shots") doesn't have to change. Bundles whose
  // stats use different labels show up via the labels eventually —
  // for now we keep the legacy two-slot API; tile redesign is a
  // separate task.
  if (bundleStats.length > 0) {
    metadata.sceneCount = bundleStats[0]?.value;
    metadata.shotCount = bundleStats[1]?.value;
  }
  // Expose the labeled stats array so renderers that want richer
  // display (e.g. "12 tracks · 47 min") can opt in.
  metadata.tileStats = bundleStats;

  // Thumbnail selection precedence:
  // 1. Persisted file (.dhee/ui/thumbnail.png).
  // 2. Bundle-display-driven thumbnail (capability lookup).
  // 3. Legacy manifest scene_image picker.
  // 4. null → folder icon placeholder.
  if (fileThumbnailPath) {
    metadata.thumbnailPath = fileThumbnailPath;
  } else if (bundleThumbRel) {
    metadata.thumbnailPath = joinPath(projectPath, bundleThumbRel);
  } else if (legacySceneImages.length > 0) {
    const meetCharSet = collectMeetCharacterShots(svps);
    const pick = selectSmartThumbnail(legacySceneImages, meetCharSet);
    metadata.thumbnailPath = pick ? joinPath(projectPath, pick.path) : null;
  } else {
    metadata.thumbnailPath = null;
  }

  return metadata;
}

export default function LandingScreen() {
  const { recentProjects, openProject, isLoading, refreshRecentProjects } =
    useWorkspace();
  const { isLoading: isProjectLoading } = useProject();
  const firstRunTour = useOptionalFirstRunTour();
  const {
    themeId,
    settings,
    updateTheme,
    saveConnectionSettings,
    isSavingConnection,
    error: settingsError,
    clearError,
  } = useAppSettings();
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<LandingView>('projects');
  // First-run tour can ask LandingScreen to switch into the settings
  // view targeting a specific tab. Our SettingsPanel (branch-of-truth)
  // doesn't accept an initialTab prop, so the tab hint is recorded
  // here and consumed when SettingsPanel adds that surface back.
  const [, setSettingsInitialTab] = useState<SettingsTabTarget>('appearance');
  const [appVersion, setAppVersion] = useState<string>(FALLBACK_APP_VERSION);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [authStatus, setAuthStatus] = useState<AccountAuthStatus>('idle');
  const [metadataByPath, setMetadataByPath] = useState<
    Record<string, ProjectMetadata>
  >({});
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<PendingProjectAction | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<PendingProjectAction | null>(
    null,
  );
  const [projectActionError, setProjectActionError] = useState<string | null>(
    null,
  );
  const [isProjectActionPending, setIsProjectActionPending] = useState(false);
  const [diag, setDiag] = useState<ProviderDiagnosticsSnapshot | null>(null);

  // Live reachability: probe LLM / ComfyUI / VLM on load and every 60s so
  // the header dots reflect actual connectivity — steady green when
  // reachable, blinking red when not. Re-probes immediately on sign-in
  // (account change); config edits surface on the next minute tick.
  useEffect(() => {
    let active = true;
    const probe = () => {
      const pending = window.electron.providerDiagnostics?.run?.();
      if (!pending) return;
      void pending
        .then((snap) => {
          if (active) setDiag(snap);
        })
        .catch(() => {
          if (active) setDiag(null);
        });
    };
    probe();
    const timer = setInterval(probe, 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [account]);

  useEffect(() => {
    let isActive = true;

    const loadMetadata = async () => {
      const entries = await Promise.all(
        recentProjects.map(async (project) => {
          const metadata = await loadSingleProjectMetadata(project.path);
          return [project.path, metadata] as const;
        }),
      );

      if (!isActive) return;
      setMetadataByPath(Object.fromEntries(entries));
    };

    loadMetadata();

    return () => {
      isActive = false;
    };
  }, [recentProjects]);

  useEffect(() => {
    let isMounted = true;
    const getVersion = window.electron?.app?.getVersion;
    if (!getVersion) {
      return () => {
        isMounted = false;
      };
    }

    getVersion()
      .then((version) => {
        if (isMounted) {
          setAppVersion(version ? `v${version}` : FALLBACK_APP_VERSION);
        }
        return undefined;
      })
      .catch(() => {
        if (isMounted) {
          setAppVersion(FALLBACK_APP_VERSION);
        }
        return undefined;
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const accountBridge = window.electron.account;
    if (!accountBridge) {
      setAccount(null);
      setAuthStatus('idle');
      return undefined;
    }
    accountBridge
      .get()
      .then((nextAccount) => {
        setAccount(nextAccount);
        return undefined;
      })
      .catch(() => {
        setAccount(null);
      });
    accountBridge
      .getAuthStatus()
      .then(setAuthStatus)
      .catch(() => setAuthStatus('idle'));
    const unsubscribeAccount = accountBridge.onChange(setAccount);
    const unsubscribeStatus = accountBridge.onAuthStatusChange(setAuthStatus);
    return () => {
      unsubscribeAccount();
      unsubscribeStatus();
    };
  }, []);

  const projectCards = useMemo<LandingProjectCard[]>(
    () =>
      sortRecentProjects(recentProjects).map((project) => {
        const metadata = metadataByPath[project.path];
        return {
          path: project.path,
          name:
            getProjectNameFromPath(project.path) ||
            project.name ||
            metadata?.manifestName ||
            project.path,
          lastOpened: project.lastOpened,
          description: metadata?.description || null,
          sceneCount: metadata?.sceneCount ?? null,
          shotCount: metadata?.shotCount ?? null,
          thumbnailPath: metadata?.thumbnailPath || null,
        };
      }),
    [metadataByPath, recentProjects],
  );
  // Featured "Continue" banner: the ACTUAL most-recent production (what
  // you were last working on — the practical one to resume), thumbnail or
  // not. When it has no still we drop the scrim and show the warm on-theme
  // base so it still reads as a designed banner.
  const featuredProject = useMemo(() => projectCards[0] ?? null, [projectCards]);
  // Pagination removed (UX-10): the responsive .projectsGrid + scroll
  // already handles any number of project cards. 9-per-page was a
  // hostile cap for users with many projects.

  const openSettingsTab = useCallback(
    (tab: SettingsTabTarget) => {
      clearError();
      setSettingsInitialTab(tab);
      setActiveView('settings');
    },
    [clearError],
  );

  useEffect(() => {
    const handleTourLandingAction = (event: Event) => {
      const { detail } = event as CustomEvent<FirstRunTourLandingAction>;
      if (detail?.action === 'open-settings') {
        openSettingsTab(detail.tab);
        return;
      }
      if (detail?.action === 'show-projects') {
        setActiveView('projects');
      }
    };

    window.addEventListener(
      FIRST_RUN_TOUR_LANDING_ACTION_EVENT,
      handleTourLandingAction,
    );
    return () => {
      window.removeEventListener(
        FIRST_RUN_TOUR_LANDING_ACTION_EVENT,
        handleTourLandingAction,
      );
    };
  }, [openSettingsTab]);

  const handleOpenDirectory = useCallback(async () => {
    setError(null);
    try {
      const selectedPath = await window.electron.project.selectDirectory();
      if (selectedPath) {
        await openProject(selectedPath);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [openProject]);

  const handleCreateNewProject = useCallback(() => {
    setError(null);
    firstRunTour.notifyTourEvent('new_project_clicked');
    // Config status is surfaced inline via BackendNotReadyBanner at
    // the top of the screen — no more modal gate here. The user can
    // still try to create; if backends aren't configured, the agent
    // surfaces the failure in chat.
    setIsNewProjectDialogOpen(true);
  }, [firstRunTour]);

  const handleAccountSignIn = useCallback(async () => {
    setAuthStatus('waiting');
    await window.electron.account?.signIn();
  }, []);

  const handleSelectRecent = useCallback(
    async (path: string) => {
      setError(null);
      try {
        await openProject(path);
      } catch (err) {
        setError(`Failed to open project: ${(err as Error).message}`);
      }
    },
    [openProject],
  );

  const handleRenameRequest = useCallback(
    (project: LandingProjectCard | RecentProject) => {
      setError(null);
      setProjectActionError(null);
      setDeleteTarget(null);
      setRenameTarget({
        path: project.path,
        name: project.name || getProjectNameFromPath(project.path),
      });
    },
    [],
  );

  const handleDeleteRequest = useCallback(
    (project: LandingProjectCard | RecentProject) => {
      setError(null);
      setProjectActionError(null);
      setRenameTarget(null);
      setDeleteTarget({
        path: project.path,
        name: project.name || getProjectNameFromPath(project.path),
      });
    },
    [],
  );

  const closeProjectActionDialogs = useCallback(() => {
    if (isProjectActionPending) {
      return;
    }
    setRenameTarget(null);
    setDeleteTarget(null);
    setProjectActionError(null);
  }, [isProjectActionPending]);

  const handleConfirmRename = useCallback(
    async (nextName: string) => {
      if (!renameTarget) {
        return;
      }
      const trimmedName = nextName.trim();
      if (!trimmedName) {
        setProjectActionError('Project name is required.');
        return;
      }

      setProjectActionError(null);
      setIsProjectActionPending(true);
      try {
        await window.electron.project.renameProject(
          renameTarget.path,
          trimmedName,
        );
        await refreshRecentProjects();
        setRenameTarget(null);
      } catch (err) {
        setProjectActionError((err as Error).message);
      } finally {
        setIsProjectActionPending(false);
      }
    },
    [refreshRecentProjects, renameTarget],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) {
      return;
    }

    setProjectActionError(null);
    setIsProjectActionPending(true);
    try {
      // Soft-remove: drop from the recents list only. Files on disk
      // are preserved so the user can re-open the folder later via
      // "Open Workspace" and the project will reappear. The full
      // `deleteProject` IPC (which removes the folder from disk) is
      // not used here — the UI never destroys user content.
      await window.electron.project.removeRecent(deleteTarget.path);
      await refreshRecentProjects();
      setDeleteTarget(null);
    } catch (err) {
      setProjectActionError((err as Error).message);
    } finally {
      setIsProjectActionPending(false);
    }
  }, [deleteTarget, refreshRecentProjects]);

  const ambientStatus = getAmbientStatus(authStatus, styles);
  const backendStatus = getBackendConfigStatus(settings, account);

  return (
    <div className={styles.container}>
      <div className={styles.grain} aria-hidden="true" />
      <div className={styles.vignette} aria-hidden="true" />
      <header className={styles.topBar}>
        <div className={styles.topBarBrand}>
          <img
            src={dheeLogoUrl}
            alt="Dhee Studio"
            className={styles.brandLogo}
            draggable={false}
          />
          <h1 className={styles.brandTitle}>Dhee Studio</h1>
        </div>

        <div className={styles.topBarStatus}>
          {ambientStatus ? (
            <span
              className={`${styles.statusPill} ${ambientStatus.className}`}
              title={ambientStatus.label}
              data-tour-id="landing-provider-status"
            >
              <span className={styles.statusDot} />
              {ambientStatus.label}
            </span>
          ) : (
            <span
              className={`${styles.statusPill} ${backendStatus.allConfigured ? '' : styles.statusPillWarn}`}
              data-tour-id="landing-provider-status"
              title={
                backendStatus.allConfigured
                  ? `LLM: ${settings?.llmBackend === 'cloud' && account ? 'Dhee Cloud' : 'Local'} · ComfyUI: ${settings?.comfyBackend === 'cloud' && account ? 'Dhee Cloud' : 'Local'} · VLM: ${settings?.vlmBackend === 'cloud' && account ? 'Dhee Cloud' : 'Local'}`
                  : backendStatus.unconfiguredLanes
                      .map((l) => `${l.lane.toUpperCase()}: ${l.reason}`)
                      .join(' · ')
              }
            >
              <span
                className={`${styles.statusDot} ${laneHealthDotClass(laneHealth(diag, 'llm'), styles)}`}
              />
              <span className={styles.statusLaneLabel}>LLM</span>
              <span className={styles.statusSep}>·</span>
              <span
                className={`${styles.statusDot} ${laneHealthDotClass(laneHealth(diag, 'comfyui'), styles)}`}
              />
              <span className={styles.statusLaneLabel}>Comfy</span>
              <span className={styles.statusSep}>·</span>
              <span
                className={`${styles.statusDot} ${laneHealthDotClass(laneHealth(diag, 'vlm'), styles)}`}
              />
              <span className={styles.statusLaneLabel}>VLM</span>
            </span>
          )}
        </div>

        <div className={styles.topBarActions}>
          <button
            type="button"
            className={styles.topBarPrimary}
            onClick={handleCreateNewProject}
            data-tour-id="landing-new-project"
          >
            <Plus size={14} />
            <span className={styles.topBarActionLabel}>New Project</span>
          </button>
          <button
            type="button"
            className={styles.topBarSecondary}
            onClick={handleOpenDirectory}
            disabled={isLoading || isProjectLoading}
            data-tour-id="landing-open-workspace"
          >
            <FolderOpen size={14} />
            <span className={styles.topBarActionLabel}>
              {isLoading ? 'Opening…' : 'Open'}
            </span>
          </button>
          <button
            type="button"
            className={`${styles.topBarIconButton} ${activeView === 'settings' ? styles.topBarIconActive : ''}`}
            onClick={() => {
              if (activeView === 'settings') {
                setActiveView('projects');
                return;
              }
              openSettingsTab('appearance');
            }}
            aria-pressed={activeView === 'settings'}
            aria-label="Settings"
            title="Settings"
          >
            <Settings size={16} />
          </button>
          {!account ? (
            <button
              type="button"
              className={styles.topBarCta}
              onClick={handleAccountSignIn}
              data-tour-id="landing-sign-in"
            >
              {authStatus === 'waiting' ? 'Open Browser Again' : 'Sign In'}
            </button>
          ) : null}
        </div>
      </header>

      <main
        className={`${styles.main} ${themeId === 'paper-light' ? styles.mainLight : ''} ${activeView === 'settings' ? styles.mainSettings : ''}`}
      >
        {activeView === 'projects' ? (
          <>
            {error && <p className={styles.error}>{error}</p>}

            <BackendNotReadyBanner
              unconfiguredLanes={backendStatus.unconfiguredLanes}
              canSignIn={!account}
              onOpenSettings={() => {
                clearError();
                setActiveView('settings');
              }}
              onSignIn={() => {
                void handleAccountSignIn();
              }}
            />

            <section className={styles.projectsSection}>
              {featuredProject ? (
                <button
                  type="button"
                  className={styles.featured}
                  onClick={() => handleSelectRecent(featuredProject.path)}
                  aria-label={`Resume ${featuredProject.name}`}
                >
                  <span
                    className={styles.featuredBg}
                    style={
                      featuredProject.thumbnailPath
                        ? { backgroundImage: `url("${toFileUrl(featuredProject.thumbnailPath)}")` }
                        : undefined
                    }
                  />
                  {featuredProject.thumbnailPath ? (
                    <span className={styles.featuredScrim} />
                  ) : null}
                  <span className={styles.featuredMeta}>
                    <span className={styles.featuredKick}>Continue · last production</span>
                    <span className={styles.featuredTitle}>{featuredProject.name}</span>
                    <span className={styles.featuredPlay}>
                      <span className={styles.featuredTri} />
                      Resume
                    </span>
                  </span>
                </button>
              ) : null}
              <div className={styles.projectsHeader}>
                <span className={styles.projectsKicker}>Productions</span>
                <h2 className={styles.projectsTitle}>Your Studio</h2>
                <span className={styles.projectsRule} />
                {projectCards.length > 0 ? (
                  <span className={styles.projectsCount}>{projectCards.length}</span>
                ) : null}
              </div>

              {projectCards.length === 0 ? (
                <div className={styles.emptyState}>
                  <img
                    src={dheeLogoUrl}
                    alt=""
                    aria-hidden="true"
                    className={styles.emptyStateLogo}
                    draggable={false}
                  />
                  <h3 className={styles.emptyStateTitle}>
                    Start your first project
                  </h3>
                  <p className={styles.emptyStateMessage}>
                    Drop a story, an idea, or a script. Dhee will break it into
                    scenes, generate the visuals, and stitch the video.
                  </p>
                  <div className={styles.emptyStateActions}>
                    <button
                      type="button"
                      className={styles.emptyStatePrimary}
                      onClick={handleCreateNewProject}
                    >
                      <Plus size={16} />
                      New Project
                    </button>
                    <button
                      type="button"
                      className={styles.emptyStateSecondary}
                      onClick={handleOpenDirectory}
                      disabled={isLoading || isProjectLoading}
                    >
                      <FolderOpen size={16} />
                      {isLoading ? 'Opening…' : 'Open Existing Folder'}
                    </button>
                  </div>
                </div>
              ) : (
                // Render every project card. Pagination was removed —
                // the responsive grid + scroll handles however many
                // cards exist. "Stop on a number" caps were wasting
                // space the user explicitly noticed (1-9 of 15 with
                // empty rows below).
                <div className={styles.projectsGrid}>
                  {projectCards.map((project) => (
                    <ProjectCard
                      key={project.path}
                      project={project}
                      onOpen={handleSelectRecent}
                      onRename={handleRenameRequest}
                      onDelete={handleDeleteRequest}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <section className={styles.settingsSection}>
            <SettingsPanel
              isOpen
              variant="embedded"
              settings={settings}
              onClose={() => setActiveView('projects')}
              onThemeChange={updateTheme}
              onSaveConnection={saveConnectionSettings}
              isSavingConnection={isSavingConnection}
              error={settingsError}
            />
          </section>
        )}
      </main>

      <footer className={styles.bottomBar}>
        <button
          type="button"
          className={styles.bottomBarLink}
          onClick={() => firstRunTour.startTour({ source: 'help' })}
        >
          Help
        </button>
        <span className={styles.bottomBarVersion}>{appVersion}</span>
      </footer>

      <NewProjectScreen
        isOpen={isNewProjectDialogOpen}
        onClose={() => setIsNewProjectDialogOpen(false)}
      />
      <RenameProjectDialog
        isOpen={renameTarget !== null}
        projectName={renameTarget?.name || ''}
        error={projectActionError}
        isSubmitting={isProjectActionPending}
        onClose={closeProjectActionDialogs}
        onConfirm={handleConfirmRename}
      />
      <DeleteProjectDialog
        isOpen={deleteTarget !== null}
        projectName={deleteTarget?.name || ''}
        error={projectActionError}
        isSubmitting={isProjectActionPending}
        onClose={closeProjectActionDialogs}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
