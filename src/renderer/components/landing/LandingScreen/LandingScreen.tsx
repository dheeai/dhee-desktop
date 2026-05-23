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
import NewProjectDialog from '../NewProjectDialog/NewProjectDialog';
import ProjectCard from '../ProjectCard/ProjectCard';
import DeleteProjectDialog from '../ProjectActionDialog/DeleteProjectDialog';
import RenameProjectDialog from '../ProjectActionDialog/RenameProjectDialog';
import { getProjectNameFromPath, sortRecentProjects } from '../projectDisplay';
import styles from './LandingScreen.module.scss';
import type { BackendProjectFile } from '../../../services/project/backendProjectAdapter';
import {
  collectMeetCharacterShots,
  extractSceneImages,
  selectSmartThumbnail,
  sumScenesAndShots,
  type SVPShape,
} from './projectMetadataHelpers';
import { getBackendConfigStatus } from './backendConfigStatus';
import BackendNotReadyDialog from './BackendNotReadyDialog';
import type { RecentProject } from '../../../../shared/fileSystemTypes';
import type { AccountInfo } from '../../../../shared/settingsTypes';

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

interface LaneBadge {
  /** Short label rendered in the pill — keep ≤6 chars to fit the sidebar. */
  label: string;
  /** Class name for the pill. */
  className: string;
}

function getLaneBadges(
  llmBackend: string | undefined,
  comfyBackend: string | undefined,
  vlmBackend: string | undefined,
  account: AccountInfo | null,
  classes: Record<string, string>,
): { llm: LaneBadge; comfy: LaneBadge; vlm: LaneBadge } {
  // Cloud only counts as cloud when the user is signed in. A persisted
  // 'cloud' value with no account is effectively local at runtime.
  const llmIsCloud = llmBackend === 'cloud' && !!account;
  const comfyIsCloud = comfyBackend === 'cloud' && !!account;
  const vlmIsCloud = vlmBackend === 'cloud' && !!account;
  return {
    llm: {
      label: llmIsCloud ? 'LLM ☁' : 'LLM 🖥',
      className: llmIsCloud ? classes.modeBadgeCloud : classes.modeBadgeLocal,
    },
    comfy: {
      label: comfyIsCloud ? 'Comfy ☁' : 'Comfy 🖥',
      className: comfyIsCloud ? classes.modeBadgeCloud : classes.modeBadgeLocal,
    },
    vlm: {
      label: vlmIsCloud ? 'VLM ☁' : 'VLM 🖥',
      className: vlmIsCloud ? classes.modeBadgeCloud : classes.modeBadgeLocal,
    },
  };
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
  const [projectContent, fileThumbnailPath, manifestContent] =
    await Promise.all([
      window.electron.project
        .readFile(joinPath(projectPath, 'project.json'))
        .catch(() => null),
      findThumbnailPath(projectPath),
      window.electron.project
        .readFile(joinPath(projectPath, 'assets/manifest.json'))
        .catch(() => null),
    ]);

  if (projectContent) {
    try {
      const project = safeJsonParse<BackendProjectFile>(projectContent);
      metadata.manifestName = project.title;
      metadata.description = project.description ?? null;
    } catch {
      // Ignore malformed or missing project metadata.
    }
  }

  // Counts come from the planner's per-scene `scene_video_prompt`
  // files, NOT the asset manifest. The manifest stores asset versions
  // (regenerating shot 1 eleven times produces 11 manifest entries all
  // tagged `(scene=1, shot=1)`) so counting unique-pairs from there
  // undercounts the actual shot count of the project. The planner files
  // are the authoritative project shape: one file per scene,
  // file.shots[].length = shot count for that scene.
  //
  // We also need the SVP parses for the thumbnail's meet_character
  // matching below, so combine both passes here.
  let sceneImages: ReturnType<typeof extractSceneImages> = [];
  if (manifestContent) {
    try {
      const manifest = safeJsonParse<{ assets: Array<unknown> }>(
        manifestContent,
      );
      sceneImages = extractSceneImages(manifest);
    } catch {
      /* malformed manifest — fall through with empty list */
    }
  }

  // Discover which scenes the planner has produced by enumerating
  // `prompts/videos/scenes/scene_<N>.json`. We don't know up-front how
  // many scenes there are, so try a reasonable upper bound (32) in
  // parallel. Missing files just return null and contribute zero.
  const MAX_SCENES_TO_PROBE = 32;
  const svps: Record<number, SVPShape | null> = {};
  await Promise.all(
    Array.from({ length: MAX_SCENES_TO_PROBE }, (_, i) => i + 1).map(
      async (n) => {
        const content = await window.electron.project
          .readFile(
            joinPath(projectPath, `prompts/videos/scenes/scene_${n}.json`),
          )
          .catch(() => null);
        if (!content) return;
        try {
          svps[n] = safeJsonParse<SVPShape>(content);
        } catch {
          svps[n] = null;
        }
      },
    ),
  );

  const { scenes, shots } = sumScenesAndShots(svps);
  metadata.sceneCount = scenes;
  metadata.shotCount = shots;

  // Thumbnail: prefer the persisted file written by
  // ensureProjectThumbnailFromManifest at project-open time; otherwise
  // synthesize a smart pick from the manifest, preferring shots tagged
  // `meet_character` in their scene_video_prompt (hero introductions
  // make the most identifiable thumbnails). Falls back to a random
  // scene_image if no meet_character shots exist.
  if (fileThumbnailPath) {
    metadata.thumbnailPath = fileThumbnailPath;
  } else if (sceneImages.length > 0) {
    const meetCharSet = collectMeetCharacterShots(svps);
    const pick = selectSmartThumbnail(sceneImages, meetCharSet);
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
  const [settingsInitialTab, setSettingsInitialTab] =
    useState<SettingsTabTarget>('appearance');
  const [appVersion, setAppVersion] = useState<string>(FALLBACK_APP_VERSION);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [authStatus, setAuthStatus] = useState<AccountAuthStatus>('idle');
  const [metadataByPath, setMetadataByPath] = useState<
    Record<string, ProjectMetadata>
  >({});
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false);
  const [showBackendNotReady, setShowBackendNotReady] = useState(false);
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
    // Gate creation on at least one working LLM + Comfy. Without
    // either, the agent literally can't run anything — better to
    // tell the user up front than let them spin up a project that
    // dies on the first tool call.
    const status = getBackendConfigStatus(settings, account);
    if (!status.allConfigured && !firstRunTour.isActive) {
      setShowBackendNotReady(true);
      return;
    }
    setIsNewProjectDialogOpen(true);
  }, [account, firstRunTour, settings]);

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
  const laneBadges = getLaneBadges(
    settings?.llmBackend,
    settings?.comfyBackend,
    settings?.vlmBackend,
    account,
    styles,
  );
  const backendStatus = getBackendConfigStatus(settings, account);

  return (
    <div className={styles.container}>
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
                className={`${styles.statusDot} ${
                  backendStatus.llm.configured
                    ? laneBadges.llm.className
                    : styles.statusDotError
                }`}
              />
              <span className={styles.statusLaneLabel}>LLM</span>
              <span className={styles.statusSep}>·</span>
              <span
                className={`${styles.statusDot} ${
                  backendStatus.comfy.configured
                    ? laneBadges.comfy.className
                    : styles.statusDotError
                }`}
              />
              <span className={styles.statusLaneLabel}>Comfy</span>
              <span className={styles.statusSep}>·</span>
              <span
                className={`${styles.statusDot} ${
                  backendStatus.vlm.configured
                    ? laneBadges.vlm.className
                    : styles.statusDotError
                }`}
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

            <section className={styles.projectsSection}>
              <div className={styles.projectsHeader}>
                <h2 className={styles.projectsTitle}>
                  Projects
                  {projectCards.length > 0 ? (
                    <span className={styles.projectsCount}>
                      {projectCards.length}
                    </span>
                  ) : null}
                </h2>
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
              initialTab={settingsInitialTab}
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

      <BackendNotReadyDialog
        isOpen={showBackendNotReady}
        unconfiguredLanes={backendStatus.unconfiguredLanes}
        canSignIn={!account}
        onClose={() => setShowBackendNotReady(false)}
        onOpenSettings={() => {
          setShowBackendNotReady(false);
          openSettingsTab('connection');
        }}
        onSignIn={() => {
          setShowBackendNotReady(false);
          handleAccountSignIn().catch(() => undefined);
        }}
      />

      <NewProjectDialog
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
