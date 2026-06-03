export interface ImageTimingOverride {
  start_time_seconds: number;
  end_time_seconds: number;
}

export interface VideoSplitOverride {
  split_offsets_seconds: number[];
}

export interface SegmentTimingOverride {
  start_time_seconds: number;
  end_time_seconds: number;
}

export interface ImageTimelineItemLike {
  id: string;
  type: string;
  startTime: number;
  endTime: number;
  duration: number;
  segmentId?: string;
  sourceType?: string;
  placementNumber?: number;
  sourceStartTime?: number;
  sourceEndTime?: number;
  sourceOffsetSeconds?: number;
  sourcePlacementNumber?: number;
  sourcePlacementDurationSeconds?: number;
  segmentIndex?: number;
  label?: string;
}

interface TimingRange {
  startTime: number;
  endTime: number;
  duration: number;
}

interface ClampImageMoveOptions {
  desiredStart: number;
  duration: number;
  minStart?: number;
  maxEnd: number;
  previousEnd?: number | null;
  nextStart?: number | null;
}

interface ClampImageResizeRightOptions {
  startTime: number;
  desiredEnd: number;
  maxEnd: number;
  minDuration?: number;
}

const EPSILON = 0.0001;

export function snapToSecond(value: number): number {
  return Math.round(value);
}

export function isValidTimingRange(
  startTime: number,
  endTime: number,
): boolean {
  return (
    Number.isFinite(startTime) &&
    Number.isFinite(endTime) &&
    endTime > startTime
  );
}

export function resolveImageTimingRange(
  sourceStartTime: number,
  sourceEndTime: number,
  override?: ImageTimingOverride | null,
): TimingRange {
  if (!isValidTimingRange(sourceStartTime, sourceEndTime)) {
    return {
      startTime: 0,
      endTime: 1,
      duration: 1,
    };
  }

  if (
    !override ||
    !isValidTimingRange(override.start_time_seconds, override.end_time_seconds)
  ) {
    return {
      startTime: sourceStartTime,
      endTime: sourceEndTime,
      duration: sourceEndTime - sourceStartTime,
    };
  }

  return {
    startTime: override.start_time_seconds,
    endTime: override.end_time_seconds,
    duration: override.end_time_seconds - override.start_time_seconds,
  };
}

export function clampImageMove({
  desiredStart,
  duration,
  minStart = 0,
  maxEnd,
  previousEnd = null,
  nextStart = null,
}: ClampImageMoveOptions): TimingRange {
  const snappedStart = snapToSecond(desiredStart);
  const boundedDuration = Math.max(duration, 1);

  const lowerBound = Math.max(minStart, previousEnd ?? minStart);
  const upperBoundFromEnd = maxEnd - boundedDuration;
  const upperBoundFromNext =
    nextStart === null ? upperBoundFromEnd : nextStart - boundedDuration;
  const upperBound = Math.min(upperBoundFromEnd, upperBoundFromNext);

  const resolvedStart =
    upperBound < lowerBound
      ? lowerBound
      : Math.min(Math.max(snappedStart, lowerBound), upperBound);
  const resolvedEnd = resolvedStart + boundedDuration;

  return {
    startTime: resolvedStart,
    endTime: resolvedEnd,
    duration: boundedDuration,
  };
}

export function clampImageResizeRight({
  startTime,
  desiredEnd,
  maxEnd,
  minDuration = 1,
}: ClampImageResizeRightOptions): TimingRange {
  const snappedEnd = snapToSecond(desiredEnd);
  const lowerBound = startTime + minDuration;
  const upperBound = maxEnd;

  const resolvedEnd =
    upperBound < lowerBound
      ? lowerBound
      : Math.min(Math.max(snappedEnd, lowerBound), upperBound);

  return {
    startTime,
    endTime: resolvedEnd,
    duration: resolvedEnd - startTime,
  };
}

export function buildUpdatedImageOverride(
  currentOverrides: Record<string, ImageTimingOverride>,
  placementNumber: number,
  sourceStartTime: number,
  sourceEndTime: number,
  editedStartTime: number,
  editedEndTime: number,
): Record<string, ImageTimingOverride> {
  if (!Number.isFinite(placementNumber)) {
    return currentOverrides;
  }

  if (!isValidTimingRange(editedStartTime, editedEndTime)) {
    return currentOverrides;
  }

  const key = String(placementNumber);
  const isSameAsSource =
    Math.abs(editedStartTime - sourceStartTime) < EPSILON &&
    Math.abs(editedEndTime - sourceEndTime) < EPSILON;

  if (isSameAsSource) {
    if (!(key in currentOverrides)) {
      return currentOverrides;
    }
    const nextOverrides = { ...currentOverrides };
    delete nextOverrides[key];
    return nextOverrides;
  }

  const existing = currentOverrides[key];
  if (
    existing &&
    Math.abs(existing.start_time_seconds - editedStartTime) < EPSILON &&
    Math.abs(existing.end_time_seconds - editedEndTime) < EPSILON
  ) {
    return currentOverrides;
  }

  return {
    ...currentOverrides,
    [key]: {
      start_time_seconds: editedStartTime,
      end_time_seconds: editedEndTime,
    },
  };
}

export function buildUpdatedSegmentTimingOverride(
  currentOverrides: Record<string, SegmentTimingOverride>,
  segmentId: string | undefined,
  sourceStartTime: number,
  sourceEndTime: number,
  editedStartTime: number,
  editedEndTime: number,
): Record<string, SegmentTimingOverride> {
  if (!segmentId) {
    return currentOverrides;
  }

  if (!isValidTimingRange(editedStartTime, editedEndTime)) {
    return currentOverrides;
  }

  const isSameAsSource =
    Math.abs(editedStartTime - sourceStartTime) < EPSILON &&
    Math.abs(editedEndTime - sourceEndTime) < EPSILON;

  if (isSameAsSource) {
    if (!(segmentId in currentOverrides)) {
      return currentOverrides;
    }
    const nextOverrides = { ...currentOverrides };
    delete nextOverrides[segmentId];
    return nextOverrides;
  }

  const existing = currentOverrides[segmentId];
  if (
    existing &&
    Math.abs(existing.start_time_seconds - editedStartTime) < EPSILON &&
    Math.abs(existing.end_time_seconds - editedEndTime) < EPSILON
  ) {
    return currentOverrides;
  }

  return {
    ...currentOverrides,
    [segmentId]: {
      start_time_seconds: editedStartTime,
      end_time_seconds: editedEndTime,
    },
  };
}

export function applyImageTimingOverridesToItems<
  T extends ImageTimelineItemLike,
>(items: T[], overrides: Record<string, ImageTimingOverride>): T[] {
  return items.map((item) => {
    if (item.type !== 'image' || item.placementNumber === undefined) {
      return item;
    }

    const sourceStartTime = item.sourceStartTime ?? item.startTime;
    const sourceEndTime = item.sourceEndTime ?? item.endTime;
    const override = overrides[String(item.placementNumber)];
    const resolved = resolveImageTimingRange(
      sourceStartTime,
      sourceEndTime,
      override,
    );

    return {
      ...item,
      sourceStartTime,
      sourceEndTime,
      startTime: resolved.startTime,
      endTime: resolved.endTime,
      duration: resolved.duration,
    };
  });
}

export function applySegmentTimingOverridesToItems<
  T extends ImageTimelineItemLike,
>(items: T[], overrides: Record<string, SegmentTimingOverride>): T[] {
  return items.map((item) => {
    if (
      item.sourceType !== 'server_timeline' ||
      (item.type !== 'image' && item.type !== 'video') ||
      !item.segmentId
    ) {
      return item;
    }

    const sourceStartTime = item.sourceStartTime ?? item.startTime;
    const sourceEndTime = item.sourceEndTime ?? item.endTime;
    const override = overrides[item.segmentId];
    const resolved = resolveImageTimingRange(
      sourceStartTime,
      sourceEndTime,
      override,
    );

    return {
      ...item,
      sourceStartTime,
      sourceEndTime,
      startTime: resolved.startTime,
      endTime: resolved.endTime,
      duration: resolved.duration,
    };
  });
}

function normalizeSplitOffsets(
  offsets: number[],
  sourceDurationSeconds: number,
): number[] {
  if (!Number.isFinite(sourceDurationSeconds) || sourceDurationSeconds <= 1) {
    return [];
  }

  const seen = new Set<number>();
  offsets.forEach((offset) => {
    if (!Number.isFinite(offset)) return;
    const snapped = snapToSecond(offset);
    if (snapped <= 0 || snapped >= sourceDurationSeconds) return;
    seen.add(snapped);
  });

  return Array.from(seen).sort((a, b) => a - b);
}

export function buildUpdatedVideoSplitOverride(
  currentOverrides: Record<string, VideoSplitOverride>,
  placementNumber: number,
  sourceDurationSeconds: number,
  splitOffsetSeconds: number,
): Record<string, VideoSplitOverride> {
  if (
    !Number.isFinite(placementNumber) ||
    !Number.isFinite(sourceDurationSeconds) ||
    sourceDurationSeconds <= 1
  ) {
    return currentOverrides;
  }

  const snappedOffset = snapToSecond(splitOffsetSeconds);
  if (snappedOffset <= 0 || snappedOffset >= sourceDurationSeconds) {
    return currentOverrides;
  }

  const key = String(placementNumber);
  const current = currentOverrides[key];
  const existingOffsets = normalizeSplitOffsets(
    current?.split_offsets_seconds ?? [],
    sourceDurationSeconds,
  );

  if (existingOffsets.includes(snappedOffset)) {
    return currentOverrides;
  }

  const nextOffsets = [...existingOffsets, snappedOffset].sort((a, b) => a - b);
  return {
    ...currentOverrides,
    [key]: {
      split_offsets_seconds: nextOffsets,
    },
  };
}

export function applyVideoSplitOverridesToItems<
  T extends ImageTimelineItemLike,
>(items: T[], overrides: Record<string, VideoSplitOverride>): T[] {
  const expanded: T[] = [];

  items.forEach((item) => {
    if (item.type !== 'video' || item.placementNumber === undefined) {
      expanded.push(item);
      return;
    }

    const sourceStartTime = item.sourceStartTime ?? item.startTime;
    const sourceEndTime = item.sourceEndTime ?? item.endTime;
    const sourceDurationSeconds = Math.max(1, sourceEndTime - sourceStartTime);
    const key = String(item.placementNumber);
    const splitOffsets = normalizeSplitOffsets(
      overrides[key]?.split_offsets_seconds ?? [],
      sourceDurationSeconds,
    );

    if (splitOffsets.length === 0) {
      expanded.push({
        ...item,
        sourceStartTime,
        sourceEndTime,
        sourceOffsetSeconds: 0,
        sourcePlacementNumber: item.placementNumber,
        sourcePlacementDurationSeconds: sourceDurationSeconds,
        segmentIndex: 0,
      });
      return;
    }

    const boundaries = [0, ...splitOffsets, sourceDurationSeconds];
    for (let idx = 0; idx < boundaries.length - 1; idx += 1) {
      const segmentStartOffset = boundaries[idx]!;
      const segmentEndOffset = boundaries[idx + 1]!;
      const segmentStart = sourceStartTime + segmentStartOffset;
      const segmentEnd = sourceStartTime + segmentEndOffset;
      expanded.push({
        ...item,
        id: `${item.id}-seg-${idx + 1}`,
        label: `${item.label || item.id} (Part ${idx + 1})`,
        startTime: segmentStart,
        endTime: segmentEnd,
        duration: segmentEnd - segmentStart,
        sourceStartTime: segmentStart,
        sourceEndTime: segmentEnd,
        sourceOffsetSeconds: segmentStartOffset,
        sourcePlacementNumber: item.placementNumber,
        sourcePlacementDurationSeconds: sourceDurationSeconds,
        segmentIndex: idx,
      });
    }
  });

  return expanded;
}

export function applyRippleTimingFromImageDurationEdits<
  T extends ImageTimelineItemLike,
>(items: T[]): T[] {
  const sortedVisualItems = items
    .filter((item) => item.type === 'image' || item.type === 'video')
    .sort((left, right) => {
      const leftStart = left.sourceStartTime ?? left.startTime;
      const rightStart = right.sourceStartTime ?? right.startTime;
      if (leftStart !== rightStart) return leftStart - rightStart;

      const leftEnd = left.sourceEndTime ?? left.endTime;
      const rightEnd = right.sourceEndTime ?? right.endTime;
      return leftEnd - rightEnd;
    });

  const rangesById = new Map<string, TimingRange>();
  let cumulativeShift = 0;

  sortedVisualItems.forEach((item) => {
    const sourceStartTime = item.sourceStartTime ?? item.startTime;
    const sourceEndTime = item.sourceEndTime ?? item.endTime;
    const sourceDuration = Math.max(1, sourceEndTime - sourceStartTime);
    const startTime = sourceStartTime + cumulativeShift;

    if (item.type === 'image') {
      const editedDuration = Math.max(1, item.duration);
      const endTime = startTime + editedDuration;
      rangesById.set(item.id, {
        startTime,
        endTime,
        duration: editedDuration,
      });
      cumulativeShift += editedDuration - sourceDuration;
      return;
    }

    const endTime = sourceEndTime + cumulativeShift;
    rangesById.set(item.id, {
      startTime,
      endTime,
      duration: endTime - startTime,
    });
  });

  return items.map((item) => {
    const nextRange = rangesById.get(item.id);
    if (!nextRange) return item;

    return {
      ...item,
      sourceStartTime: item.sourceStartTime ?? item.startTime,
      sourceEndTime: item.sourceEndTime ?? item.endTime,
      startTime: nextRange.startTime,
      endTime: nextRange.endTime,
      duration: nextRange.duration,
    };
  });
}
