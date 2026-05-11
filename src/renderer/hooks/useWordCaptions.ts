import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import type { TextOverlayCue, WordTimestamp } from '../types/captions';
import { groupWordsIntoCues, sanitizeWordTimestamps } from '../utils/captionGrouping';

interface WordCaptionsState {
  words: WordTimestamp[];
  cues: TextOverlayCue[];
  isLoading: boolean;
  error: string | null;
}

interface PersistedWordCaptionsFile {
  words?: WordTimestamp[];
}

const WORD_CAPTIONS_RELATIVE_PATH = '.dhee/agent/content/word-captions.json';

function parseWordCaptions(content: string): WordTimestamp[] {
  const parsed = JSON.parse(content) as PersistedWordCaptionsFile | WordTimestamp[];

  if (Array.isArray(parsed)) {
    return sanitizeWordTimestamps(parsed);
  }

  if (parsed.words && Array.isArray(parsed.words)) {
    return sanitizeWordTimestamps(parsed.words);
  }

  return [];
}

export function useWordCaptions(): WordCaptionsState {
  const { projectDirectory } = useWorkspace();
  const [state, setState] = useState<WordCaptionsState>({
    words: [],
    cues: [],
    isLoading: true,
    error: null,
  });
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCaptions = useCallback(async () => {
    if (!projectDirectory) {
      setState({
        words: [],
        cues: [],
        isLoading: false,
        error: null,
      });
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const captionsPath = `${projectDirectory}/${WORD_CAPTIONS_RELATIVE_PATH}`;
      const content = await window.electron.project.readFile(captionsPath).catch(() => null);

      if (!content) {
        setState({
          words: [],
          cues: [],
          isLoading: false,
          error: null,
        });
        return;
      }

      const words = parseWordCaptions(content);
      const cues = groupWordsIntoCues(words);
      setState({
        words,
        cues,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load word captions';
      setState({
        words: [],
        cues: [],
        isLoading: false,
        error: message,
      });
    }
  }, [projectDirectory]);

  useEffect(() => {
    loadCaptions();
  }, [loadCaptions]);

  useEffect(() => {
    if (!projectDirectory) return undefined;

    const unsubscribe = window.electron.project.onFileChange((event) => {
      if (!event.path.includes('word-captions.json')) return;

      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = setTimeout(() => {
        loadCaptions();
      }, 300);
    });

    return () => {
      unsubscribe();
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [projectDirectory, loadCaptions]);

  return state;
}

