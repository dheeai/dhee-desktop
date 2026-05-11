import { useState, useEffect } from 'react';
import { FolderOpen, Trash2 } from 'lucide-react';
import type { AgentProjectFile } from '../../../types/dhee';
import { safeJsonParse } from '../../../utils/safeJsonParse';
import styles from './ProjectSelectionDialog.module.scss';

interface ProjectSelectionDialogProps {
  projectDirectory: string;
  onContinue: () => void;
  onStartNew: () => void;
}

interface ProjectStatus {
  exists: boolean;
  project?: AgentProjectFile;
}

export default function ProjectSelectionDialog({
  projectDirectory,
  onContinue,
  onStartNew,
}: ProjectSelectionDialogProps) {
  const [loading, setLoading] = useState(true);
  const [projectStatus, setProjectStatus] = useState<ProjectStatus | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const checkProject = async () => {
      setLoading(true);
      try {
        const projectFilePath = `${projectDirectory}/.dhee/agent/project.json`;
        const content = await window.electron.project.readFile(projectFilePath);
        if (!content) {
          setProjectStatus({ exists: false });
          setLoading(false);
          return;
        }
        const project = safeJsonParse<AgentProjectFile>(content);
        setProjectStatus({ exists: true, project });
      } catch (error) {
        console.error(
          '[ProjectSelectionDialog] Error checking project:',
          error,
        );
        setProjectStatus({ exists: false });
      } finally {
        setLoading(false);
      }
    };

    checkProject();
  }, [projectDirectory]);

  const handleStartNew = async () => {
    setDeleting(true);
    try {
      const dheeDir = `${projectDirectory}/.dhee`;
      await window.electron.project.delete(dheeDir);
      onStartNew();
    } catch (error) {
      console.error('[ProjectSelectionDialog] Error deleting project:', error);
      alert(
        `Failed to delete project: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.overlay}>
        <div className={styles.dialog}>
          <div className={styles.loading}>Checking for existing project...</div>
        </div>
      </div>
    );
  }

  // No project exists - don't show dialog, allow normal flow
  if (!projectStatus?.exists || !projectStatus.project) {
    return null;
  }

  const { project } = projectStatus;
  const currentPhase = project.current_phase || 'unknown';
  const phaseDisplayName = currentPhase
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h2 className={styles.title}>Existing Project Found!</h2>
        </div>

        <div className={styles.projectInfo}>
          <div className={styles.projectTitle}>
            <FolderOpen size={20} />
            <span>{project.title || 'Untitled Project'}</span>
          </div>
          <div className={styles.projectDetails}>
            <div className={styles.detail}>
              <span className={styles.label}>ID:</span>
              <span className={styles.value}>{project.id}</span>
            </div>
            <div className={styles.detail}>
              <span className={styles.label}>Phase:</span>
              <span className={styles.value}>{phaseDisplayName}</span>
            </div>
            {project.characters && project.characters.length > 0 && (
              <div className={styles.detail}>
                <span className={styles.label}>Characters:</span>
                <span className={styles.value}>
                  {project.characters.length}
                </span>
              </div>
            )}
            {project.scenes && project.scenes.length > 0 && (
              <div className={styles.detail}>
                <span className={styles.label}>Scenes:</span>
                <span className={styles.value}>{project.scenes.length}</span>
              </div>
            )}
          </div>
        </div>

        <div className={styles.actions}>
          <p className={styles.prompt}>What would you like to do?</p>
          <div className={styles.buttons}>
            <button
              type="button"
              className={styles.continueButton}
              onClick={onContinue}
              disabled={deleting}
            >
              <FolderOpen size={16} />
              Continue Existing Project
            </button>
            <button
              type="button"
              className={styles.startNewButton}
              onClick={handleStartNew}
              disabled={deleting}
            >
              <Trash2 size={16} />
              {deleting ? 'Deleting...' : 'Start New Project'}
              <span className={styles.warning}>
                (will delete current project)
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
