import { Paperclip, X } from 'lucide-react';
import type {
  Attachment,
  AttachmentKind,
  ReferenceImageReplacementTarget,
  ReferenceImageRole,
} from '../../../../shared/attachmentTypes';
import {
  getReferenceImageReplacementTarget,
  getReferenceImageRole,
  isReferenceImageLikeAttachment,
} from '../../../../shared/attachmentTypes';
import { toFileUrl } from '../../../utils/pathResolver';
import styles from './AttachmentChip.module.scss';

interface AttachmentChipProps {
  attachment: Attachment;
  onRemove: (id: string) => void;
  onReferenceRoleChange?: (id: string, role: ReferenceImageRole) => void;
  replacementCharacters?: ReferenceImageReplacementTarget[];
  onReplacementCharacterChange?: (
    id: string,
    target: ReferenceImageReplacementTarget | null,
  ) => void;
  disabled?: boolean;
}

const KIND_BADGE: Record<AttachmentKind, string> = {
  comfy_workflow: 'workflow',
  reference_image: 'reference',
  character_ref: 'character',
  text: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
};

export default function AttachmentChip({
  attachment,
  onRemove,
  onReferenceRoleChange,
  replacementCharacters = [],
  onReplacementCharacterChange,
  disabled,
}: AttachmentChipProps) {
  const isReferenceImage = isReferenceImageLikeAttachment(attachment);
  const referenceRole = getReferenceImageRole(attachment);
  const replacementTarget = getReferenceImageReplacementTarget(attachment);
  const showReplacementTarget =
    isReferenceImage &&
    referenceRole === 'character' &&
    replacementCharacters.length > 0 &&
    Boolean(onReplacementCharacterChange);

  return (
    <div className={styles.chip} title={attachment.path}>
      {isReferenceImage ? (
        <img
          src={toFileUrl(attachment.path)}
          alt=""
          className={styles.thumbnail}
        />
      ) : (
        <Paperclip size={12} className={styles.icon} />
      )}
      <span className={styles.name}>{attachment.name}</span>
      {isReferenceImage && onReferenceRoleChange ? (
        <span className={styles.controls}>
          <select
            className={styles.roleSelect}
            value={referenceRole}
            disabled={disabled}
            aria-label={`Reference role for ${attachment.name}`}
            onChange={(event) =>
              onReferenceRoleChange(
                attachment.id,
                event.target.value as ReferenceImageRole,
              )
            }
          >
            <option value="auto">Auto</option>
            <option value="character">Character</option>
            <option value="setting">Setting</option>
          </select>
          {showReplacementTarget && (
            <select
              className={styles.targetSelect}
              value={replacementTarget?.id ?? ''}
              disabled={disabled}
              aria-label={`Replacement target for ${attachment.name}`}
              onChange={(event) => {
                const target =
                  replacementCharacters.find(
                    (character) => character.id === event.target.value,
                  ) ?? null;
                onReplacementCharacterChange?.(attachment.id, target);
              }}
            >
              <option value="">Use in prompt</option>
              {replacementCharacters.map((character) => (
                <option key={character.id} value={character.id}>
                  Replace {character.name}
                </option>
              ))}
            </select>
          )}
        </span>
      ) : (
        <span className={styles.badge}>
          {isReferenceImage ? referenceRole : KIND_BADGE[attachment.kind]}
        </span>
      )}
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
