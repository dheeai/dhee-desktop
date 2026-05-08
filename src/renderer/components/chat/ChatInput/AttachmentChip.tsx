import { Paperclip, X } from 'lucide-react';
import type { Attachment, AttachmentKind } from '../../../../shared/attachmentTypes';
import styles from './AttachmentChip.module.scss';

interface AttachmentChipProps {
  attachment: Attachment;
  onRemove: (id: string) => void;
  disabled?: boolean;
}

const KIND_BADGE: Record<AttachmentKind, string> = {
  comfy_workflow: 'workflow',
  text: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
};

export default function AttachmentChip({
  attachment,
  onRemove,
  disabled,
}: AttachmentChipProps) {
  return (
    <div className={styles.chip} title={attachment.path}>
      <Paperclip size={12} className={styles.icon} />
      <span className={styles.name}>{attachment.name}</span>
      <span className={styles.badge}>{KIND_BADGE[attachment.kind]}</span>
      <button
        type="button"
        onClick={() => onRemove(attachment.id)}
        disabled={disabled}
        className={styles.removeButton}
        aria-label={`Remove attachment ${attachment.name}`}
      >
        <X size={12} />
      </button>
    </div>
  );
}
