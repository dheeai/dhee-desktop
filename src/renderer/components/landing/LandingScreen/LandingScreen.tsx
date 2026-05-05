import { useCallback, useEffect, useMemo, useState, type FC, type SVGProps } from 'react';
import {
  FolderOpen as _FolderOpen,
  Plus as _Plus,
  Play as _Play,
  Settings as _Settings,
  Sparkles as _Sparkles,
} from 'lucide-react';

type LucideFC = FC<SVGProps<SVGSVGElement> & { size?: number | string }>;

const FolderOpen = _FolderOpen as unknown as LucideFC;
const Plus = _Plus as unknown as LucideFC;
const Play = _Play as unknown as LucideFC;
const Settings = _Settings as unknown as LucideFC;
const Sparkles = _Sparkles as unknown as LucideFC;
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

const THUMBNAIL_CANDIDATES = [
  '.kshana/ui/thumbnail.jpg',
  '.kshana/ui/thumbnail.png',
  '.kshana/ui/thumbnail.webp',
  'thumbnail.jpg',
  'thumbnail.png',
  'thumbnail.webp',
];
const FALLBACK_APP_VERSION = 'v?.?.?';
type LandingView = 'projects' | 'settings';

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

function joinPath(basePath: string, segment: string): string {
  const normalizedBase = basePath.replace(/\/+$/, '');
  const normalizedSegment = segment.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedSegment}`;
}

async function findThumbnailPath(
  projectPath: string,
): Promise<string | null> {
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

  return (
    <div className={styles.container}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <Play size={20} className={styles.playIcon} />
          </div>
          <h1 className={styles.brandTitle}>Kshana Desktop</h1>
          <div className={styles.modeBadge}>
            {settings?.backendMode === 'cloud' ? 'Cloud Mode' : 'Local Mode'}
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
                <p className={styles.heroSubtitle}>
                  Create and manage your projects with a clean visual dashboard.
                </p>
              </div>
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
