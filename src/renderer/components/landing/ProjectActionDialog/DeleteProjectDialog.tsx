import { Trash2, X } from 'lucide-react';
import styles from './ProjectActionDialog.module.scss';

interface DeleteProjectDialogProps {
  isOpen: boolean;
  projectName: string;
  error: string | null;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}

export default function DeleteProjectDialog({
  isOpen,
  projectName,
  error,
  isSubmitting,
  onClose,
  onConfirm,
}: DeleteProjectDialogProps) {
  const handleConfirm = () => {
    onConfirm();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className={styles.overlay}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Remove project from workspace"
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Remove from Workspace</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close remove project dialog"
            disabled={isSubmitting}
          >
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.message}>
            Remove <span className={styles.projectName}>{projectName}</span>{' '}
            from this workspace?
          </p>
          <p className={styles.warning}>
            Files on disk are preserved. Re-open the folder anytime via
            “Open Workspace” to bring it back.
          </p>
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
            className={styles.dangerButton}
            onClick={handleConfirm}
            disabled={isSubmitting}
          >
            <Trash2 size={15} />
            {isSubmitting ? 'Removing…' : 'Remove from Workspace'}
          </button>
        </div>
      </div>
    </div>
  );
}
