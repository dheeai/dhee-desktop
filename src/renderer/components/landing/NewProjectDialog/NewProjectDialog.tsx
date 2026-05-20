import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Plus, X } from 'lucide-react';
import { useProject } from '../../../contexts/ProjectContext';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import { useOptionalKshanaSession } from '../../../hooks/useDheeSession';
import {
  buildDefaultWorkspaceFolder,
  readPersistedWorkspacePath,
  resolveDefaultWorkspacePath,
  writePersistedWorkspacePath,
} from '../../../utils/workspacePathDefaults';
import { shouldResetChatOnProjectChange } from '../../../utils/chatResetOnProjectChange';
import styles from './NewProjectDialog.module.scss';

const PROJECT_SETUP_STORAGE_KEY = 'dhee.pendingProjectSetup';

interface NewProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function normalizePathValue(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function joinPath(basePath: string, segment: string): string {
  const normalizedBase = normalizePathValue(basePath);
  const normalizedSegment = segment.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedSegment}`;
}

async function isExistingProjectDirectory(directory: string): Promise<boolean> {
  const normalizedDirectory = normalizePathValue(directory);
  const hasRootProjectFile = await window.electron.project.checkFileExists(
    joinPath(normalizedDirectory, 'project.json'),
  );
  const hasLegacyProjectFile = await window.electron.project.checkFileExists(
    joinPath(normalizedDirectory, '.dhee/agent/project.json'),
  );

  return hasRootProjectFile || hasLegacyProjectFile;
}

export default function NewProjectDialog({
  isOpen,
  onClose,
}: NewProjectDialogProps) {
  const {
    createProject,
    closeProject,
    error: projectError,
  } = useProject();
  const { openProject, projectDirectory: previousProjectDirectory } =
    useWorkspace();
  // Optional — the dialog mounts outside a session provider in some
  // test fixtures. When null, the chat-reset side effect is skipped;
  // production always provides a session.
  const session = useOptionalKshanaSession();

  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setProjectName('');
      setDescription('');
      setWorkspacePath('');
      setError(null);
      setIsSubmitting(false);
      return;
    }
    // Populate the Location field on open so the user doesn't have to
    // click "Choose Folder" every single time. Order of preference:
    //   1. Last folder the user picked in a prior session (localStorage)
    //   2. `<home>/dhee-studios` (resolved by main via IPC)
    // The lookup is async because we ping main for the home dir; if
    // anything fails (storage disabled, IPC unavailable) the helper
    // returns sensible fallbacks rather than throwing.
    let cancelled = false;
    (async () => {
      let homeDefault = '';
      try {
        homeDefault = await window.electron.project.getDefaultWorkspacePath();
      } catch {
        // Main process not reachable — fall back to a bare folder name.
      }
      if (cancelled) return;
      const stored = readPersistedWorkspacePath(window.localStorage);
      const fallback = homeDefault || buildDefaultWorkspaceFolder(null);
      const resolved = resolveDefaultWorkspacePath({
        storedPath: stored,
        fallbackDefault: fallback,
      });
      setWorkspacePath(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handlePickWorkspace = useCallback(async () => {
    setError(null);
    try {
      const selectedPath = await window.electron.project.selectDirectory();
      if (selectedPath) {
        setWorkspacePath(selectedPath);
      }
    } catch (err) {
      setError(`Failed to select folder: ${(err as Error).message}`);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    const trimmedName = projectName.trim();
    const trimmedDescription = description.trim();
    const normalizedWorkspacePath = normalizePathValue(workspacePath);

    if (!trimmedName) {
      setError('Project name is required.');
      return;
    }
    if (!normalizedWorkspacePath) {
      setError('Please select a workspace folder.');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    let didCreateProject = false;
    try {
      let projectDirectory = joinPath(normalizedWorkspacePath, trimmedName);

      if (await isExistingProjectDirectory(normalizedWorkspacePath)) {
        throw new Error(
          'Selected location is already a Dhee project. Choose a parent folder instead.',
        );
      }

      if (await isExistingProjectDirectory(projectDirectory)) {
        throw new Error(
          `A project named "${trimmedName}" already exists in the selected location.`,
        );
      }

      const createdDirectory = await window.electron.project.createFolder(
        normalizedWorkspacePath,
        trimmedName,
        { source: 'renderer', intent: 'new_project_parent' },
      );

      if (!createdDirectory) {
        throw new Error(
          'Could not create project folder in selected workspace.',
        );
      }

      projectDirectory = normalizePathValue(createdDirectory);

      const created = await createProject(
        projectDirectory,
        trimmedName,
        trimmedDescription || undefined,
      );
      if (!created) {
        throw new Error(projectError || 'Project creation failed.');
      }
      didCreateProject = true;

      try {
        window.localStorage.setItem(
          PROJECT_SETUP_STORAGE_KEY,
          projectDirectory,
        );
      } catch {
        // Ignore localStorage availability issues.
      }

      // Remember the workspace PARENT (not the project itself) so the
      // next "Create New Project" defaults to the same folder. The
      // helper no-ops if localStorage is dead, so this never blocks
      // the create flow.
      writePersistedWorkspacePath(window.localStorage, normalizedWorkspacePath);

      // A NEW project demands a fresh chat session — otherwise pi-agent
      // treats the first prompt as a continuation of the previous
      // project's conversation, leaking that project's bubbles + LLM
      // context into the new one (the 2026-05-19 Village → Soft Seinen
      // bug). Decision is centralized in `shouldResetChatOnProjectChange`
      // so the rule for switching/re-open can be tuned in one place.
      // Failure is non-fatal: if clearChatHistory rejects (backend
      // down, etc.), the project still opens — the user can clear
      // chat manually via the "New chat" menu.
      const shouldReset = shouldResetChatOnProjectChange({
        intent: 'create',
        previousProjectDirectory,
        nextProjectDirectory: projectDirectory,
      });
      if (shouldReset && session) {
        try {
          await session.clearChatHistory();
        } catch {
          // Swallow — chat reset is a polish step, not a blocker.
        }
      }

      await openProject(projectDirectory);
      onClose();
    } catch (err) {
      if (didCreateProject) {
        closeProject();
      }
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    createProject,
    closeProject,
    description,
    onClose,
    openProject,
    previousProjectDirectory,
    projectError,
    projectName,
    session,
    workspacePath,
  ]);

  const formLocked = isSubmitting;
  let createButtonLabel = 'Create Project';
  if (isSubmitting) {
    createButtonLabel = 'Creating...';
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className={styles.overlay}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Create new project"
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Create New Project</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close create project dialog"
            disabled={isSubmitting}
          >
            <X size={16} />
          </button>
        </div>

        <div className={styles.form}>
          <span className={styles.label}>Project Name</span>
          <input
            id="new-project-name"
            className={styles.input}
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="My Agentic Video Project"
            disabled={formLocked}
            aria-label="Project name"
          />

          <span className={styles.label}>Description (optional)</span>
          <textarea
            id="new-project-description"
            className={styles.textarea}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this project is about..."
            rows={3}
            disabled={formLocked}
            aria-label="Project description"
          />

          <div className={styles.locationRow}>
            <div className={styles.locationInfo}>
              <span className={styles.locationLabel}>Location</span>
              <span className={styles.locationPath}>
                {workspacePath || 'No folder selected'}
              </span>
            </div>
            <button
              type="button"
              className={styles.pickButton}
              onClick={handlePickWorkspace}
              disabled={formLocked}
            >
              <FolderOpen size={15} />
              Choose Folder
            </button>
          </div>

          {error && <p className={styles.error}>{error}</p>}
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.createButton}
            onClick={handleCreate}
            disabled={formLocked}
          >
            <Plus size={15} />
            {createButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
