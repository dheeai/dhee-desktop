import { useState, useEffect, useCallback } from 'react';
import {
  Maximize2,
  RefreshCw,
  Image as ImageIcon,
  Edit2,
  Check,
  X,
  FileText,
} from 'lucide-react';
import type { StoryboardScene, Artifact } from '../../../types/projectState';
import { resolveAssetPathForDisplay } from '../../../utils/pathResolver';
import { imageToBase64, shouldUseBase64 } from '../../../utils/imageToBase64';
import { useProject } from '../../../contexts/ProjectContext';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import MarkdownPreview from '../MarkdownPreview';
import styles from './SceneCard.module.scss';

interface SceneCardProps {
  scene: StoryboardScene;
  artifact?: Artifact;
  projectDirectory: string;
  sceneFolder?: string; // Folder name like "scene-001"
  onExpand?: (scene: StoryboardScene) => void;
  onRegenerate?: (scene: StoryboardScene) => void;
  onNameChange?: (sceneNumber: number, name: string) => void;
}

export default function SceneCard({
  scene,
  artifact,
  projectDirectory,
  sceneFolder,
  onExpand,
  onRegenerate,
  onNameChange,
}: SceneCardProps) {
  const [imageError, setImageError] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(scene.name || '');
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [markdownContent, setMarkdownContent] = useState<string>('');
  const [isLoadingMarkdown, setIsLoadingMarkdown] = useState(false);
  const { projectDirectory: workspaceProjectDir } = useWorkspace();

  const effectiveProjectDir = projectDirectory || workspaceProjectDir || '';
  // Use provided folder or generate from scene number
  const folder =
    sceneFolder || `scene-${String(scene.scene_number).padStart(3, '0')}`;

  const sceneId = `SCN_${String(scene.scene_number).padStart(2, '0')}`;
  const hasImage = artifact && !imageError && imagePath;

  const displayName = scene.name || `Scene ${scene.scene_number}`;

  // Resolve image path asynchronously and convert to base64 if needed
  useEffect(() => {
    if (!artifact?.file_path) {
      setImagePath(null);
      return;
    }

    resolveAssetPathForDisplay(
      artifact.file_path,
      projectDirectory || null,
    ).then(async (resolved) => {
      // For test images, try to convert to base64
      if (shouldUseBase64(resolved)) {
        const base64 = await imageToBase64(resolved);
        if (base64) {
          setImagePath(base64);
          return;
        }
      }
      // Fallback to file:// path
      setImagePath(resolved);
    });
  }, [artifact?.file_path, projectDirectory]);

  // Default metadata tags
  const duration = scene.duration || 5;
  const shotType = scene.shot_type || 'Mid Shot';
  const lighting = scene.lighting || scene.mood || 'Natural';

  const status = artifact ? 'Generated' : 'Pending';

  const handleNameEdit = () => {
    setIsEditingName(true);
    setEditedName(scene.name || '');
  };

  const handleNameSave = () => {
    if (onNameChange) {
      onNameChange(scene.scene_number, editedName.trim());
    }
    setIsEditingName(false);
  };

  const handleNameCancel = () => {
    setEditedName(scene.name || '');
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleNameSave();
    } else if (e.key === 'Escape') {
      handleNameCancel();
    }
  };

  // Load markdown content when preview is opened
  const handleViewDetails = useCallback(async () => {
    setIsPreviewOpen(true);
    setIsLoadingMarkdown(true);

    const basePath = effectiveProjectDir || '/mock';
    const markdownPath = `${basePath}/.dhee/agent/scenes/${folder}/scene.md`;

    try {
      const content = await window.electron.project.readFile(markdownPath);
      if (content !== null) {
        setMarkdownContent(content);
      } else {
        setMarkdownContent(
          `# ${displayName}\n\n${scene.description || 'No details available.'}`,
        );
      }
    } catch (error) {
      console.error('Failed to load scene markdown:', error);
      setMarkdownContent(
        `# ${displayName}\n\n${scene.description || 'No details available.'}`,
      );
    } finally {
      setIsLoadingMarkdown(false);
    }
  }, [effectiveProjectDir, folder, displayName, scene.description]);

  const handleClosePreview = useCallback(() => {
    setIsPreviewOpen(false);
    setMarkdownContent('');
  }, []);

  return (
    <>
      <div className={styles.card}>
        <div className={styles.imageContainer}>
          <span className={styles.sceneId}>{sceneId}</span>

          {hasImage && imagePath ? (
            <img
              src={imagePath}
              alt={`Scene ${scene.scene_number}`}
              className={styles.image}
              onError={() => setImageError(true)}
            />
          ) : (
            <div className={styles.placeholder}>
              <ImageIcon size={32} className={styles.placeholderIcon} />
            </div>
          )}
        </div>

        <div className={styles.content}>
          <div className={styles.nameSection}>
            {isEditingName ? (
              <div className={styles.nameEdit}>
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  onKeyDown={handleNameKeyDown}
                  onBlur={handleNameSave}
                  className={styles.nameInput}
                  autoFocus
                  placeholder={`Scene ${scene.scene_number}`}
                />
                <button
                  type="button"
                  className={styles.nameButton}
                  onClick={handleNameSave}
                  title="Save"
                >
                  <Check size={12} />
                </button>
                <button
                  type="button"
                  className={styles.nameButton}
                  onClick={handleNameCancel}
                  title="Cancel"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className={styles.nameDisplay}>
                <h3 className={styles.sceneName}>{displayName}</h3>
                {onNameChange && (
                  <button
                    type="button"
                    className={styles.editNameButton}
                    onClick={handleNameEdit}
                    title="Edit name"
                  >
                    <Edit2 size={12} />
                  </button>
                )}
              </div>
            )}
          </div>
          <div className={styles.tags}>
            <span className={styles.tag}>{duration}s</span>
            <span className={styles.tag}>{shotType}</span>
            <span className={styles.tag}>{lighting}</span>
          </div>

          <p className={styles.description}>{scene.description}</p>

          <div className={styles.footer}>
            <button
              type="button"
              className={styles.viewDetailsButton}
              onClick={(e) => {
                e.stopPropagation();
                handleViewDetails();
              }}
              title="View details"
            >
              <FileText size={12} />
              View Details
            </button>

            <span
              className={`${styles.status} ${artifact ? styles.generated : styles.pending}`}
            >
              <span className={styles.statusDot} />
              {status}
            </span>

            <div className={styles.actions}>
              {onExpand && (
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => onExpand(scene)}
                  title="Expand"
                >
                  <Maximize2 size={14} />
                </button>
              )}
              {onRegenerate && (
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => onRegenerate(scene)}
                  title="Regenerate"
                >
                  <RefreshCw size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <MarkdownPreview
        isOpen={isPreviewOpen}
        title={displayName}
        content={
          isLoadingMarkdown ? 'Loading...' : markdownContent || 'Loading...'
        }
        onClose={handleClosePreview}
      />
    </>
  );
}
