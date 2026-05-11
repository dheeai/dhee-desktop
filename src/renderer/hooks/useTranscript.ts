/**
 * Hook to read and parse transcript markdown file
 * Watches for changes to transcript.md
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';

export interface TranscriptEntry {
  index: number;
  startTime: number; // seconds
  endTime: number; // seconds
  text: string;
}

interface TranscriptState {
  entries: TranscriptEntry[];
  totalDuration: number;
  isLoading: boolean;
  error: string | null;
}

/**
 * Parse transcript markdown file
 * Format: - N [HH:MM:SS,mmm --> HH:MM:SS,mmm] text
 */
function parseTranscript(content: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith('-')) {
      continue;
    }

    // Match format: - N [HH:MM:SS,mmm --> HH:MM:SS,mmm] text
    // Example: - 1 [00:00:08,000 --> 00:00:24,000] The river Ganga...
    const match = trimmedLine.match(
      /^-\s+(\d+)\s+\[(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}),(\d{3})\]\s+(.+)$/,
    );

    if (match) {
      const index = parseInt(match[1] ?? '0', 10);
      const startHours = parseInt(match[2] ?? '0', 10);
      const startMinutes = parseInt(match[3] ?? '0', 10);
      const startSeconds = parseInt(match[4] ?? '0', 10);
      const startMs = parseInt(match[5] ?? '0', 10);
      const endHours = parseInt(match[6] ?? '0', 10);
      const endMinutes = parseInt(match[7] ?? '0', 10);
      const endSeconds = parseInt(match[8] ?? '0', 10);
      const endMs = parseInt(match[9] ?? '0', 10);
      const text = match[10] ?? '';

      const startTime =
        startHours * 3600 + startMinutes * 60 + startSeconds + startMs / 1000;
      const endTime =
        endHours * 3600 + endMinutes * 60 + endSeconds + endMs / 1000;

      entries.push({
        index,
        startTime,
        endTime,
        text,
      });
    }
  }

  // Sort by index
  entries.sort((a, b) => a.index - b.index);

  return entries;
}

/**
 * Hook to read and parse transcript markdown file
 * Automatically reloads when file changes (debounced)
 */
export function useTranscript(): TranscriptState {
  const { projectDirectory } = useWorkspace();
  const [state, setState] = useState<TranscriptState>({
    entries: [],
    totalDuration: 0,
    isLoading: true,
    error: null,
  });

  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadTranscript = useCallback(async () => {
    if (!projectDirectory) {
      setState({
        entries: [],
        totalDuration: 0,
        isLoading: false,
        error: null,
      });
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const transcriptPath = `${projectDirectory}/.dhee/agent/content/transcript.md`;
      const content = await window.electron.project
        .readFile(transcriptPath)
        .catch(() => null);

      if (!content) {
        setState({
          entries: [],
          totalDuration: 0,
          isLoading: false,
          error: null,
        });
        return;
      }

      const entries = parseTranscript(content);
      const totalDuration =
        entries.length > 0 ? entries[entries.length - 1]!.endTime : 0;

      setState({
        entries,
        totalDuration,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      console.error('[useTranscript] Failed to load transcript:', error);
      setState({
        entries: [],
        totalDuration: 0,
        isLoading: false,
        error:
          error instanceof Error ? error.message : 'Failed to load transcript',
      });
    }
  }, [projectDirectory]);

  // Initial load
  useEffect(() => {
    loadTranscript();
  }, [loadTranscript]);

  // Watch for file changes
  useEffect(() => {
    if (!projectDirectory) return;

    const unsubscribe = window.electron.project.onFileChange((event) => {
      const filePath = event.path;

      // Check if transcript file changed
      if (filePath.includes('transcript.md')) {
        // Clear existing timeout
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current);
        }

        // Debounce rapid file changes (300ms)
        debounceTimeoutRef.current = setTimeout(() => {
          loadTranscript();
        }, 300);
      }
    });

    return () => {
      unsubscribe();
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [projectDirectory, loadTranscript]);

  return state;
}
