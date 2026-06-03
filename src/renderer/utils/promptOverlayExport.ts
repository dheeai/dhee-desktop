import type { PromptOverlayCue } from '../types/captions';

export interface PromptCueTimelineItem {
  id: string;
  type: string;
  startTime: number;
  endTime: number;
  expandedPrompt?: string;
  prompt?: string;
  hasRenderableMedia?: boolean;
}

export interface TimelineExportSourceItem {
  type: string;
  duration: number;
  startTime: number;
  endTime: number;
  sourceOffsetSeconds?: number;
  label?: string;
}

export interface TimelineExportItem {
  type: 'video' | 'image' | 'placeholder';
  path: string;
  duration: number;
  startTime: number;
  endTime: number;
  sourceOffsetSeconds: number;
  label?: string;
}

export function sanitizePromptOverlayText(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim();
}

export function buildPromptOverlayCues(
  items: PromptCueTimelineItem[],
): PromptOverlayCue[] {
  return items
    .filter(
      (item) =>
        (item.type === 'image' || item.type === 'video') &&
        !item.hasRenderableMedia,
    )
    .map((item) => {
      const text = sanitizePromptOverlayText(
        item.expandedPrompt ?? item.prompt ?? '',
      );
      if (!text) return null;
      return {
        id: `prompt-overlay-${item.id}`,
        startTime: item.startTime,
        endTime: item.endTime,
        text,
      };
    })
    .filter((cue): cue is PromptOverlayCue => cue !== null);
}

export function mapTimelineTypeForExport(
  type: string,
): 'video' | 'image' | 'placeholder' {
  if (type === 'image' || type === 'video' || type === 'placeholder') {
    return type;
  }
  return 'placeholder';
}

export function buildTimelineExportItem(
  item: TimelineExportSourceItem,
  resolvedPath: string,
  fallbackPath: string,
): TimelineExportItem & { usedPlaceholderForMissingMedia: boolean } {
  const exportType = mapTimelineTypeForExport(item.type);
  const finalPath = (resolvedPath || fallbackPath).trim();
  const isMissingMediaPath =
    (exportType === 'video' || exportType === 'image') &&
    finalPath.length === 0;

  return {
    type: isMissingMediaPath ? 'placeholder' : exportType,
    path: isMissingMediaPath ? '' : finalPath,
    duration: item.duration,
    startTime: item.startTime,
    endTime: item.endTime,
    sourceOffsetSeconds:
      !isMissingMediaPath && exportType === 'video'
        ? item.sourceOffsetSeconds ?? 0
        : 0,
    label: item.label,
    usedPlaceholderForMissingMedia: isMissingMediaPath,
  };
}
