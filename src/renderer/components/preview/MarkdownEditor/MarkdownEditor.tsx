import { useState, useCallback, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Edit, Eye } from 'lucide-react';
import styles from './MarkdownEditor.module.scss';

interface MarkdownEditorProps {
  content: string;
  fileName?: string;
  filePath?: string;
  onDirtyChange?: (isDirty: boolean) => void;
  /**
   * Hide the edit toggle and force preview-only mode. Used when the
   * rendered markdown is a *view* over a source file in a different
   * format (e.g. the breakdown JSONs are rendered as markdown for
   * readability; saving the rendered markdown back would corrupt the
   * source JSON).
   */
  readOnly?: boolean;
}

export default function MarkdownEditor({
  content,
  fileName,
  filePath,
  onDirtyChange,
  readOnly = false,
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<'edit' | 'preview'>('preview');
  const [currentContent, setCurrentContent] = useState<string>(content);
  const [isDirty, setIsDirty] = useState(false);
  const originalContentRef = useRef<string>(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Update content when prop changes
  useEffect(() => {
    originalContentRef.current = content;
    setCurrentContent(content);
    setIsDirty(false);
  }, [content]);

  // Handle mode toggle
  const toggleMode = useCallback(() => {
    setMode((prev) => (prev === 'edit' ? 'preview' : 'edit'));
  }, []);

  // Handle content changes (in edit mode)
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;
      setCurrentContent(newContent);
      const dirty = newContent !== originalContentRef.current;
      setIsDirty(dirty);
      onDirtyChange?.(dirty);
    },
    [onDirtyChange],
  );

  // Handle save (Cmd/Ctrl+S)
  const saveFile = useCallback(async () => {
    if (!filePath) return;
    try {
      await window.electron.project.writeFile(filePath, currentContent);
      originalContentRef.current = currentContent;
      setIsDirty(false);
      onDirtyChange?.(false);
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }, [filePath, currentContent, onDirtyChange]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (mode === 'edit') {
          saveFile();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveFile, mode]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          {fileName && <span className={styles.fileName}>{fileName}</span>}
          {isDirty && <span className={styles.dirtyIndicator}>●</span>}
        </div>
        {readOnly ? null : (
          <button
            type="button"
            className={styles.modeToggle}
            onClick={toggleMode}
            title={mode === 'edit' ? 'Switch to Preview' : 'Switch to Edit'}
          >
            {mode === 'edit' ? (
              <>
                <Eye size={14} />
                <span>Preview</span>
              </>
            ) : (
              <>
                <Edit size={14} />
                <span>Edit</span>
              </>
            )}
          </button>
        )}
      </div>
      <div className={styles.content}>
        {mode === 'edit' && !readOnly ? (
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={currentContent}
            onChange={handleChange}
            spellCheck={false}
            placeholder="Start editing markdown..."
          />
        ) : (
          <div className={styles.preview}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {currentContent || '*No content*'}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
