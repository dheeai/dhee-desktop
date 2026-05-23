import { useMemo, useState } from 'react';
import { FolderOpen, Pencil, Trash2 } from 'lucide-react';
import { formatRelativeTime, shortenPath, toFileUrl } from '../projectDisplay';
import styles from './ProjectCard.module.scss';

export interface LandingProjectCard {
  path: string;
  name: string;
  lastOpened: number;
  description?: string | null;
  thumbnailPath?: string | null;
  sceneCount?: number | null;
  shotCount?: number | null;
}

interface ProjectCardProps {
  project: LandingProjectCard;
  onOpen: (path: string) => void;
  onRename: (project: LandingProjectCard) => void;
  onDelete: (project: LandingProjectCard) => void;
}

export default function ProjectCard({
  project,
  onOpen,
  onRename,
  onDelete,
}: ProjectCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const thumbnailUrl = useMemo(() => {
    if (!project.thumbnailPath || imageFailed) {
      return null;
    }
    return toFileUrl(project.thumbnailPath);
  }, [imageFailed, project.thumbnailPath]);

  const stats = useMemo(() => {
    const values: string[] = [];
    if (typeof project.sceneCount === 'number') {
      values.push(
        `${project.sceneCount} ${project.sceneCount === 1 ? 'scene' : 'scenes'}`,
      );
    }
    if (typeof project.shotCount === 'number') {
      values.push(
        `${project.shotCount} ${project.shotCount === 1 ? 'shot' : 'shots'}`,
      );
    }
    return values.join(' · ');
  }, [project.sceneCount, project.shotCount]);

  return (
    <div className={styles.card} title={project.path}>
      <div className={styles.media}>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.actionButton}
            aria-label={`Rename ${project.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onRename(project);
            }}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.dangerAction}`}
            aria-label={`Delete ${project.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(project);
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={`${project.name} preview`}
            className={styles.thumbnail}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className={styles.placeholder}>
            <FolderOpen size={22} />
            <span>Agentic Workspace</span>
          </div>
        )}
        <button
          type="button"
          className={styles.openButton}
          aria-label={`Open ${project.name}`}
          onClick={() => onOpen(project.path)}
        >
          <div className={styles.overlay}>
            <h3 className={styles.title}>{project.name}</h3>
            {project.description && (
              <p className={styles.description}>{project.description}</p>
            )}
            {stats && <p className={styles.stats}>{stats}</p>}
            <p className={styles.meta}>
              {shortenPath(project.path)} ·{' '}
              {formatRelativeTime(project.lastOpened)}
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}
