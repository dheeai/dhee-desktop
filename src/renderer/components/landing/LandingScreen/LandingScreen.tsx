import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FC,
  type SVGProps,
} from 'react';
import {
  ChevronLeft as _ChevronLeft,
  ChevronRight as _ChevronRight,
  FolderOpen as _FolderOpen,
  Plus as _Plus,
  Play as _Play,
  Settings as _Settings,
  Sparkles as _Sparkles,
} from 'lucide-react';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import { safeJsonParse } from '../../../utils/safeJsonParse';
import { useProject } from '../../../contexts/ProjectContext';
import { useAppSettings } from '../../../contexts/AppSettingsContext';
import SettingsPanel from '../../SettingsPanel';
import type { LandingProjectCard } from '../ProjectCard/ProjectCard';
import NewProjectDialog from '../NewProjectDialog/NewProjectDialog';
import ProjectCard from '../ProjectCard/ProjectCard';
import DeleteProjectDialog from '../ProjectActionDialog/DeleteProjectDialog';
import RenameProjectDialog from '../ProjectActionDialog/RenameProjectDialog';
import RecentProjectsList from '../RecentProjectsList/RecentProjectsList';
import { getProjectNameFromPath, sortRecentProjects } from '../projectDisplay';
import styles from './LandingScreen.module.scss';
import type { BackendProjectFile } from '../../../services/project/backendProjectAdapter';
import type { RecentProject } from '../../../../shared/fileSystemTypes';
import type { AccountInfo } from '../../../../shared/settingsTypes';

type LucideFC = FC<SVGProps<SVGSVGElement> & { size?: number | string }>;

const FolderOpen = _FolderOpen as unknown as LucideFC;
const ChevronLeft = _ChevronLeft as unknown as LucideFC;
const ChevronRight = _ChevronRight as unknown as LucideFC;
const Plus = _Plus as unknown as LucideFC;
const Play = _Play as unknown as LucideFC;
const Settings = _Settings as unknown as LucideFC;
const Sparkles = _Sparkles as unknown as LucideFC;

const THUMBNAIL_CANDIDATES = [
  '.kshana/ui/thumbnail.jpg',
  '.kshana/ui/thumbnail.png',
  '.kshana/ui/thumbnail.webp',
  'thumbnail.jpg',
  'thumbnail.png',
  'thumbnail.webp',
];
const FALLBACK_APP_VERSION = 'v?.?.?';
const PROJECTS_PER_PAGE = 9;
type LandingView = 'projects' | 'settings';
type AccountAuthStatus = 'idle' | 'waiting' | 'expired' | 'error';

interface ProjectMetadata {
  manifestName?: string;
  description?: string | null;
  sceneCount?: number | null;
  characterCount?: number | null;
  thumbnailPath?: string | null;
}

interface PendingProjectAction {
  path: string;
  name: string;
}

function getProjectPaginationItems(
  currentPage: number,
  totalPages: number,
): Array<number | 'ellipsis-start' | 'ellipsis-end'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index);
  }

  const pages = new Set([
    0,
    totalPages - 1,
    currentPage - 1,
    currentPage,
    currentPage + 1,
  ]);
  const visiblePages = [...pages]
    .filter((page) => page >= 0 && page < totalPages)
    .sort((a, b) => a - b);
  const items: Array<number | 'ellipsis-start' | 'ellipsis-end'> = [];

  visiblePages.forEach((page, index) => {
    const previousPage = visiblePages[index - 1];
    if (index > 0 && page - previousPage > 1) {
      items.push(page < currentPage ? 'ellipsis-start' : 'ellipsis-end');
    }
    items.push(page);
  });

  return items;
}

function getConnectionLabel(
  authStatus: AccountAuthStatus,
  backendMode: string | undefined,
  account: AccountInfo | null,
): string {
  if (authStatus === 'waiting') return 'Connecting';
  if (authStatus === 'expired') return 'Session expired';
  if (backendMode === 'cloud' && account) return 'Cloud';
  return 'Local';
}

function getHeroSubtitle(
  account: AccountInfo | null,
  authStatus: AccountAuthStatus,
): string {
  if (account) {
    return `Signed in as ${account.email}. Create and manage projects from this desktop.`;
  }
  if (authStatus === 'waiting') {
    return 'Finish sign-in in your browser, then choose Open Kshana Desktop when prompted.';
  }
  if (authStatus === 'expired') {
    return 'Your cloud session expired. Local projects are still available.';
  }
  return 'Create locally, or sign in to use Kshana Cloud credits.';
}

function getConnectionClass(
  authStatus: AccountAuthStatus,
  backendMode: string | undefined,
  account: AccountInfo | null,
) {
  if (authStatus === 'expired') return styles.modeBadgeWarning;
  if (authStatus === 'waiting') return styles.modeBadgeConnecting;
  if (backendMode === 'cloud' && account) return styles.modeBadgeCloud;
  return styles.modeBadgeLocal;
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
  const [projectContent, thumbnailPath] = await Promise.all([
    window.electron.project
      .readFile(joinPath(projectPath, 'project.json'))
      .catch(() => null),
    findThumbnailPath(projectPath),
  ]);

  if (projectContent) {
    try {
      const project = safeJsonParse<BackendProjectFile>(projectContent);
      metadata.manifestName = project.title;
      metadata.description = project.description ?? null;
      metadata.sceneCount = project.scenes.length;
      metadata.characterCount = project.characters.length;
    } catch {
      // Ignore malformed or missing project metadata.
    }
  }

  metadata.thumbnailPath = thumbnailPath;
  return metadata;
}

export default function LandingScreen() {
  const { recentProjects, openProject, isLoading, refreshRecentProjects } =
    useWorkspace();
  const { isLoading: isProjectLoading } = useProject();
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
  const [projectPage, setProjectPage] = useState(0);

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
      .then(setAccount)
      .catch(() => setAccount(null));
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
          characterCount: metadata?.characterCount ?? null,
          thumbnailPath: metadata?.thumbnailPath || null,
        };
      }),
    [metadataByPath, recentProjects],
  );
  const totalProjectPages = Math.max(
    1,
    Math.ceil(projectCards.length / PROJECTS_PER_PAGE),
  );
  const visibleProjectCards = useMemo(() => {
    const pageStart = projectPage * PROJECTS_PER_PAGE;
    return projectCards.slice(pageStart, pageStart + PROJECTS_PER_PAGE);
  }, [projectCards, projectPage]);
  const projectPaginationItems = useMemo(
    () => getProjectPaginationItems(projectPage, totalProjectPages),
    [projectPage, totalProjectPages],
  );
  const projectRangeStart =
    projectCards.length === 0 ? 0 : projectPage * PROJECTS_PER_PAGE + 1;
  const projectRangeEnd = Math.min(
    projectCards.length,
    (projectPage + 1) * PROJECTS_PER_PAGE,
  );

  useEffect(() => {
    setProjectPage((currentPage) =>
      Math.min(currentPage, totalProjectPages - 1),
    );
  }, [totalProjectPages]);

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
    setIsNewProjectDialogOpen(true);
  }, []);

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
      await window.electron.project.deleteProject(deleteTarget.path);
      await refreshRecentProjects();
      setDeleteTarget(null);
    } catch (err) {
      setProjectActionError((err as Error).message);
    } finally {
      setIsProjectActionPending(false);
    }
  }, [deleteTarget, refreshRecentProjects]);

  const connectionLabel = getConnectionLabel(
    authStatus,
    settings?.backendMode,
    account,
  );
  const connectionClass = getConnectionClass(
    authStatus,
    settings?.backendMode,
    account,
  );
  const heroSubtitle = getHeroSubtitle(account, authStatus);

  return (
    <div className={styles.container}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <Play size={20} className={styles.playIcon} />
          </div>
          <h1 className={styles.brandTitle}>Kshana Desktop</h1>
          <div className={`${styles.modeBadge} ${connectionClass}`}>
            <span className={styles.modeDot} />
            {connectionLabel}
          </div>
        </div>

        <div className={styles.sidebarSection}>
          <p className={styles.sectionLabel}>Quick Actions</p>
          <button
            type="button"
            className={styles.newProjectButton}
            onClick={handleCreateNewProject}
          >
            <Plus size={16} />
            New Project
          </button>
          <button
            type="button"
            className={styles.openWorkspaceButton}
            onClick={handleOpenDirectory}
            disabled={isLoading || isProjectLoading}
          >
            <FolderOpen size={16} />
            {isLoading ? 'Opening...' : 'Open Workspace'}
          </button>
        </div>

        <div className={styles.sidebarSection}>
          <p className={styles.sectionLabel}>Recent Projects</p>
          <RecentProjectsList
            projects={recentProjects}
            onSelect={handleSelectRecent}
          />
        </div>

        <div className={styles.sidebarFooter}>
          <button
            type="button"
            className={`${styles.settingsAction} ${activeView === 'settings' ? styles.footerActionActive : ''}`}
            onClick={() => {
              clearError();
              setActiveView('settings');
            }}
            aria-pressed={activeView === 'settings'}
          >
            <Settings size={16} />
            <span>Settings</span>
          </button>
          <div className={styles.footerMetaRow}>
            <button type="button" className={styles.footerLink}>
              Help
            </button>
            <span className={styles.footerVersionTag}>{appVersion}</span>
          </div>
        </div>
      </aside>

      <main
        className={`${styles.main} ${themeId === 'paper-light' ? styles.mainLight : ''} ${activeView === 'settings' ? styles.mainSettings : ''}`}
      >
        {activeView === 'projects' ? (
          <>
            <section className={styles.hero}>
              <Sparkles size={16} />
              <div>
                <h2 className={styles.heroTitle}>Agentic Video Workspace</h2>
                <p className={styles.heroSubtitle}>{heroSubtitle}</p>
              </div>
              {!account ? (
                <button
                  type="button"
                  className={styles.heroAccountButton}
                  onClick={handleAccountSignIn}
                >
                  {authStatus === 'waiting' ? 'Open Browser Again' : 'Sign In'}
                </button>
              ) : null}
            </section>

            {error && <p className={styles.error}>{error}</p>}

            <section className={styles.projectsSection}>
              <div className={styles.projectsHeader}>
                <h3 className={styles.projectsTitle}>Projects</h3>
              </div>

              {projectCards.length === 0 ? (
                <div className={styles.emptyState}>
                  <p>
                    No projects yet. Create your first project to get started.
                  </p>
                  <button
                    type="button"
                    className={styles.newProjectButton}
                    onClick={handleCreateNewProject}
                  >
                    <Plus size={16} />
                    Create Project
                  </button>
                </div>
              ) : (
                <div className={styles.projectsGrid}>
                  {visibleProjectCards.map((project) => (
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
              {totalProjectPages > 1 ? (
                <div
                  className={styles.projectsPagination}
                  aria-label="Projects pagination"
                >
                  <span className={styles.projectsPageCount}>
                    {projectRangeStart}-{projectRangeEnd} of{' '}
                    {projectCards.length}
                  </span>
                  <div className={styles.paginationControls}>
                    <button
                      type="button"
                      className={styles.paginationArrow}
                      aria-label="Previous projects page"
                      onClick={() =>
                        setProjectPage((currentPage) =>
                          Math.max(0, currentPage - 1),
                        )
                      }
                      disabled={projectPage === 0}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className={styles.paginationPages}>
                      {projectPaginationItems.map((item) =>
                        typeof item === 'number' ? (
                          <button
                            key={item}
                            type="button"
                            className={`${styles.paginationPage} ${
                              item === projectPage
                                ? styles.paginationPageActive
                                : ''
                            }`}
                            aria-label={`Go to projects page ${item + 1}`}
                            aria-current={
                              item === projectPage ? 'page' : undefined
                            }
                            onClick={() => setProjectPage(item)}
                          >
                            {item + 1}
                          </button>
                        ) : (
                          <span
                            key={item}
                            className={styles.paginationEllipsis}
                            aria-hidden="true"
                          >
                            ...
                          </span>
                        ),
                      )}
                    </div>
                    <button
                      type="button"
                      className={styles.paginationArrow}
                      aria-label="Next projects page"
                      onClick={() =>
                        setProjectPage((currentPage) =>
                          Math.min(totalProjectPages - 1, currentPage + 1),
                        )
                      }
                      disabled={projectPage >= totalProjectPages - 1}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              ) : null}
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
