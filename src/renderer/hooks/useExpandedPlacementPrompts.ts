import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import type {
  ExpandedPlacementPromptEntry,
  ExpandedPlacementPromptsFile,
} from '../types/captions';

interface ExpandedPlacementPromptsState {
  image: ExpandedPlacementPromptEntry[];
  video: ExpandedPlacementPromptEntry[];
  isLoading: boolean;
  error: string | null;
}

const EXPANDED_PROMPTS_RELATIVE_PATH =
  '.dhee/agent/content/expanded-placement-prompts.json';

function createEmptyState(
  isLoading: boolean,
  error: string | null = null,
): ExpandedPlacementPromptsState {
  return {
    image: [],
    video: [],
    isLoading,
    error,
  };
}

function sanitizeEntry(value: unknown): ExpandedPlacementPromptEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const placementNumber = raw.placementNumber;
  const startTime = raw.startTime;
  const endTime = raw.endTime;
  const originalPrompt = raw.originalPrompt;
  const expandedPrompt = raw.expandedPrompt;
  const isExpanded = raw.isExpanded;
  const negativePrompt = raw.negativePrompt;

  if (
    typeof placementNumber !== 'number' ||
    !Number.isFinite(placementNumber) ||
    placementNumber < 1
  ) {
    return null;
  }
  if (
    typeof startTime !== 'string' ||
    typeof endTime !== 'string' ||
    typeof originalPrompt !== 'string' ||
    typeof expandedPrompt !== 'string' ||
    typeof isExpanded !== 'boolean'
  ) {
    return null;
  }

  const entry: ExpandedPlacementPromptEntry = {
    placementNumber,
    startTime,
    endTime,
    originalPrompt,
    expandedPrompt,
    isExpanded,
  };

  if (typeof negativePrompt === 'string' && negativePrompt.trim()) {
    entry.negativePrompt = negativePrompt;
  }

  return entry;
}

export function parseExpandedPlacementPrompts(
  content: string,
): ExpandedPlacementPromptsFile {
  const parsed = JSON.parse(content) as Partial<ExpandedPlacementPromptsFile>;
  const image = Array.isArray(parsed.image)
    ? parsed.image
        .map((entry) => sanitizeEntry(entry))
        .filter(
          (entry): entry is ExpandedPlacementPromptEntry => entry !== null,
        )
    : [];
  const video = Array.isArray(parsed.video)
    ? parsed.video
        .map((entry) => sanitizeEntry(entry))
        .filter(
          (entry): entry is ExpandedPlacementPromptEntry => entry !== null,
        )
    : [];

  return {
    schemaVersion: 1,
    updatedAt:
      typeof parsed.updatedAt === 'string'
        ? parsed.updatedAt
        : new Date().toISOString(),
    image,
    video,
  };
}

export function useExpandedPlacementPrompts(): ExpandedPlacementPromptsState {
  const { projectDirectory } = useWorkspace();
  const [state, setState] = useState<ExpandedPlacementPromptsState>(
    createEmptyState(true),
  );
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadExpandedPrompts = useCallback(async () => {
    if (!projectDirectory) {
      setState(createEmptyState(false));
      return;
    }

    setState((previous) => ({ ...previous, isLoading: true, error: null }));

    try {
      const filePath = `${projectDirectory}/${EXPANDED_PROMPTS_RELATIVE_PATH}`;
      const content = await window.electron.project.readFile(filePath).catch(() => null);

      if (!content) {
        setState(createEmptyState(false));
        return;
      }

      const parsed = parseExpandedPlacementPrompts(content);
      setState({
        image: parsed.image,
        video: parsed.video,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to load expanded placement prompts';
      setState(createEmptyState(false, message));
    }
  }, [projectDirectory]);

  useEffect(() => {
    loadExpandedPrompts();
  }, [loadExpandedPrompts]);

  useEffect(() => {
    if (!projectDirectory) return undefined;

    const unsubscribe = window.electron.project.onFileChange((event) => {
      if (!event.path.includes('expanded-placement-prompts.json')) return;

      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = setTimeout(() => {
        loadExpandedPrompts();
      }, 300);
    });

    return () => {
      unsubscribe();
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [projectDirectory, loadExpandedPrompts]);

  return state;
}
