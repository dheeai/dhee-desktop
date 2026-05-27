import { FormEvent, useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Send, Square, Paperclip } from 'lucide-react';
import type {
  Attachment,
  AttachmentKind,
  ReferenceImageRole,
} from '../../../../shared/attachmentTypes';
import {
  attachmentsFromSelectResponse,
  isReferenceImageLikeAttachment,
  withReferenceImageRole,
} from '../../../../shared/attachmentTypes';
import AttachmentChip from './AttachmentChip';
import styles from './ChatInput.module.scss';

interface ChatInputProps {
  disabled?: boolean;
  isRunning?: boolean;
  isStopping?: boolean;
  placeholder?: string;
  hintText?: string;
  questionMode?: boolean;
  onQuestionInteraction?: () => void;
  onSend: (message: string, attachments: Attachment[]) => void;
  onStop?: () => void;
  /**
   * Which attachment kinds the user can attach. Default is just
   * ComfyUI workflows. Future surface area: pass `['comfy_workflow',
   * 'image']` etc. as more kinds become supported.
   */
  acceptedAttachmentKinds?: AttachmentKind[];
}

const MIN_ROWS = 1;
const MAX_ROWS = 6;
const LINE_HEIGHT = 24; // Approximate line height in pixels

function mergePickedAttachment(
  existing: Attachment[],
  attachment: Attachment,
): Attachment[] {
  if (isReferenceImageLikeAttachment(attachment)) {
    if (existing.some((item) => item.path === attachment.path)) return existing;
    return [...existing, attachment];
  }
  if (attachment.kind === 'comfy_workflow') {
    return [
      ...existing.filter((item) => item.kind !== 'comfy_workflow'),
      attachment,
    ];
  }
  return [...existing, attachment];
}

export default function ChatInput({
  disabled = false,
  isRunning = false,
  isStopping = false,
  placeholder = 'Describe your story, ask for a storyboard, or request assets…',
  hintText,
  questionMode = false,
  onQuestionInteraction,
  onSend,
  onStop,
  acceptedAttachmentKinds = ['comfy_workflow'],
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isPickingAttachment, setIsPickingAttachment] = useState(false);
  const [rows, setRows] = useState(MIN_ROWS);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const notifyQuestionInteraction = () => {
    if (questionMode) {
      onQuestionInteraction?.();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      // Reset height to calculate scroll height
      textareaRef.current.style.height = 'auto';
      const { scrollHeight } = textareaRef.current;
      const newRows = Math.min(
        Math.max(MIN_ROWS, Math.ceil(scrollHeight / LINE_HEIGHT)),
        MAX_ROWS,
      );
      setRows(newRows);
      // Set height based on scroll height, but cap at max height
      const maxHeight = MAX_ROWS * LINE_HEIGHT;
      textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    }
  }, [value]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    // A message must have either text or at least one attachment.
    if (isRunning || (!value.trim() && attachments.length === 0)) {
      return;
    }
    onSend(value.trim(), attachments);
    setValue('');
    setAttachments([]);
    setAttachmentError(null);
    setRows(MIN_ROWS);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    notifyQuestionInteraction();

    if (event.key === 'Enter') {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isModifierPressed = isMac ? event.metaKey : event.ctrlKey;

      if (event.shiftKey || isModifierPressed) {
        // Shift+Enter or Cmd/Ctrl+Enter = send
        event.preventDefault();
        handleSubmit(event as unknown as FormEvent);
      }
      // Enter alone = new line (default behavior)
    } else if (
      event.key === 'Escape' &&
      document.activeElement === textareaRef.current
    ) {
      // Esc = clear input
      setValue('');
      setRows(MIN_ROWS);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleAttach = async () => {
    setAttachmentError(null);
    notifyQuestionInteraction();
    setIsPickingAttachment(true);
    try {
      const result = await window.electron.project.selectAttachment({
        kinds: acceptedAttachmentKinds,
        multiple: acceptedAttachmentKinds.some(
          (kind) => kind === 'character_ref' || kind === 'reference_image',
        ),
        title:
          acceptedAttachmentKinds.length === 1 &&
          acceptedAttachmentKinds[0] === 'comfy_workflow'
            ? 'Select a ComfyUI Workflow'
            : acceptedAttachmentKinds.length === 1 &&
                (acceptedAttachmentKinds[0] === 'character_ref' ||
                  acceptedAttachmentKinds[0] === 'reference_image')
              ? 'Select Reference Images'
              : 'Select an attachment',
      });
      if (!result.ok) {
        if (result.error) setAttachmentError(result.error);
        return;
      }
      const pickedAttachments = attachmentsFromSelectResponse(result);
      if (pickedAttachments.length > 0) {
        setAttachments((prev) =>
          pickedAttachments.reduce(mergePickedAttachment, prev),
        );
      }
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsPickingAttachment(false);
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleReferenceRoleChange = (id: string, role: ReferenceImageRole) => {
    setAttachments((prev) =>
      prev.map((attachment) =>
        attachment.id === id
          ? withReferenceImageRole(attachment, role)
          : attachment,
      ),
    );
  };

  const hasContent = value.trim().length > 0 || attachments.length > 0;
  const canSend = hasContent && !disabled && !isPickingAttachment;
  const canStop = !disabled && isRunning && !isStopping;
  const canAttach = !disabled && !isRunning && !isPickingAttachment;

  return (
    <form
      className={`${styles.container} ${questionMode ? styles.questionMode : ''}`}
      onSubmit={handleSubmit}
    >
      {attachments.length > 0 && (
        <div className={styles.attachmentRow}>
          {attachments.map(att => (
            <AttachmentChip
              key={att.id}
              attachment={att}
              onRemove={handleRemoveAttachment}
              onReferenceRoleChange={handleReferenceRoleChange}
              disabled={isRunning}
            />
          ))}
        </div>
      )}
      {attachmentError && (
        <div className={styles.attachmentError}>{attachmentError}</div>
      )}
      <div
        className={`${styles.inputWrapper} ${questionMode ? styles.inputWrapperQuestionMode : ''}`}
      >
        <button
          type="button"
          onClick={handleAttach}
          disabled={!canAttach}
          className={styles.attachButton}
          aria-label="Attach file"
          title={
            acceptedAttachmentKinds.length === 1 &&
            acceptedAttachmentKinds[0] === 'comfy_workflow'
              ? 'Attach a ComfyUI workflow JSON'
              : 'Attach a reference image'
          }
        >
          <Paperclip size={16} />
        </button>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            notifyQuestionInteraction();
            setValue(event.target.value);
          }}
          onFocus={notifyQuestionInteraction}
          onClick={notifyQuestionInteraction}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className={styles.textarea}
          aria-label="Chat input"
        />
        <button
          type={isRunning ? 'button' : 'submit'}
          disabled={isRunning ? !canStop : !canSend}
          className={`${styles.sendButton} ${isRunning ? styles.stopButton : ''}`}
          aria-label={isRunning ? 'Stop agent' : 'Send message'}
          title={
            isRunning
              ? isStopping
                ? 'Stopping task...'
                : 'Stop current task'
              : 'Send message (Shift+Enter or Cmd/Ctrl+Enter)'
          }
          onClick={isRunning ? onStop : undefined}
        >
          {isRunning ? <Square size={14} /> : <Send size={16} />}
        </button>
      </div>
      <div className={styles.hint}>
        {isRunning ? (
          isStopping ? (
            <>Stopping task...</>
          ) : (
            <>Agent is running. Use Stop to cancel this run.</>
          )
        ) : hintText ? (
          <>{hintText}</>
        ) : (
          <>
            Press <kbd>Enter</kbd> for new line, <kbd>Shift+Enter</kbd> or{' '}
            <kbd>Cmd+Enter</kbd> to send
          </>
        )}
      </div>
    </form>
  );
}
