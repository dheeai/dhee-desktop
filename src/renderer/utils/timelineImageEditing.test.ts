import { describe, expect, test } from '@jest/globals';
import {
  applyImageTimingOverridesToItems,
  applyVideoSplitOverridesToItems,
  applyRippleTimingFromImageDurationEdits,
  buildUpdatedImageOverride,
  buildUpdatedVideoSplitOverride,
  clampImageMove,
  clampImageResizeRight,
} from './timelineImageEditing';

describe('timelineImageEditing', () => {
  test('resizes image right edge in 1-second snapped steps (grow and shrink)', () => {
    const grown = clampImageResizeRight({
      startTime: 5,
      desiredEnd: 11.2,
      maxEnd: 40,
      minDuration: 1,
    });
    expect(grown.endTime).toBe(11);
    expect(grown.duration).toBe(6);

    const shrunk = clampImageResizeRight({
      startTime: 5,
      desiredEnd: 8.3,
      maxEnd: 40,
      minDuration: 1,
    });
    expect(shrunk.endTime).toBe(8);
    expect(shrunk.duration).toBe(3);
  });

  test('resize right edge clamps only to timeline max end', () => {
    const resizedClampedByTimelineEnd = clampImageResizeRight({
      startTime: 8,
      desiredEnd: 45,
      maxEnd: 40,
      minDuration: 1,
    });
    expect(resizedClampedByTimelineEnd.endTime).toBe(40);
  });

  test('enforces minimum 1-second duration when resizing', () => {
    const resized = clampImageResizeRight({
      startTime: 10,
      desiredEnd: 10.1,
      maxEnd: 30,
      minDuration: 1,
    });
    expect(resized.duration).toBe(1);
    expect(resized.endTime).toBe(11);
  });

  test('moves block timing with 1-second snap and timeline bounds', () => {
    const moved = clampImageMove({
      desiredStart: 5.6,
      duration: 3,
      minStart: 0,
      maxEnd: 12,
    });
    expect(moved.startTime).toBe(6);
    expect(moved.endTime).toBe(9);

    const clampedStart = clampImageMove({
      desiredStart: -2.4,
      duration: 3,
      minStart: 0,
      maxEnd: 12,
    });
    expect(clampedStart.startTime).toBe(0);
    expect(clampedStart.endTime).toBe(3);

    const clampedEnd = clampImageMove({
      desiredStart: 11.2,
      duration: 3,
      minStart: 0,
      maxEnd: 12,
    });
    expect(clampedEnd.startTime).toBe(9);
    expect(clampedEnd.endTime).toBe(12);
  });

  test('removes override when edited range matches source range', () => {
    const current = {
      '12': { start_time_seconds: 5, end_time_seconds: 9 },
      '13': { start_time_seconds: 9, end_time_seconds: 12 },
    };

    const next = buildUpdatedImageOverride(
      current,
      12,
      4,
      8,
      4,
      8,
    );

    expect(next['12']).toBeUndefined();
    expect(next['13']).toEqual({ start_time_seconds: 9, end_time_seconds: 12 });
  });

  test('applies image overrides and keeps non-image items unchanged', () => {
    const items = [
      {
        id: 'PLM-1',
        type: 'image',
        placementNumber: 1,
        startTime: 2,
        endTime: 6,
        duration: 4,
      },
      {
        id: 'vd-placement-2',
        type: 'video',
        placementNumber: 2,
        startTime: 6,
        endTime: 10,
        duration: 4,
      },
    ];

    const updated = applyImageTimingOverridesToItems(items, {
      '1': { start_time_seconds: 3, end_time_seconds: 8 },
    });

    expect(updated[0]).toMatchObject({
      startTime: 3,
      endTime: 8,
      duration: 5,
      sourceStartTime: 2,
      sourceEndTime: 6,
    });
    expect(updated[1]).toEqual(items[1]);
  });

  test('falls back to source timing for invalid override ranges', () => {
    const items = [
      {
        id: 'PLM-4',
        type: 'image',
        placementNumber: 4,
        startTime: 10,
        endTime: 14,
        duration: 4,
      },
    ];

    const updated = applyImageTimingOverridesToItems(items, {
      '4': { start_time_seconds: 15, end_time_seconds: 12 },
    });

    expect(updated[0]).toMatchObject({
      startTime: 10,
      endTime: 14,
      duration: 4,
    });
  });

  test('ripple shifts following video left when image is shortened by 1 second', () => {
    const sourceItems = [
      {
        id: 'PLM-1',
        type: 'image',
        placementNumber: 1,
        startTime: 0,
        endTime: 4,
        duration: 4,
        sourceStartTime: 0,
        sourceEndTime: 4,
      },
      {
        id: 'vd-placement-2',
        type: 'video',
        placementNumber: 2,
        startTime: 4,
        endTime: 8,
        duration: 4,
        sourceStartTime: 4,
        sourceEndTime: 8,
      },
    ];

    const withOverrides = applyImageTimingOverridesToItems(sourceItems, {
      '1': { start_time_seconds: 0, end_time_seconds: 3 },
    });
    const rippled = applyRippleTimingFromImageDurationEdits(withOverrides);

    expect(rippled[0]).toMatchObject({ startTime: 0, endTime: 3, duration: 3 });
    expect(rippled[1]).toMatchObject({ startTime: 3, endTime: 7, duration: 4 });
  });

  test('ripple shifts following video right when image is extended by 1 second', () => {
    const sourceItems = [
      {
        id: 'PLM-1',
        type: 'image',
        placementNumber: 1,
        startTime: 0,
        endTime: 4,
        duration: 4,
        sourceStartTime: 0,
        sourceEndTime: 4,
      },
      {
        id: 'vd-placement-2',
        type: 'video',
        placementNumber: 2,
        startTime: 4,
        endTime: 8,
        duration: 4,
        sourceStartTime: 4,
        sourceEndTime: 8,
      },
    ];

    const withOverrides = applyImageTimingOverridesToItems(sourceItems, {
      '1': { start_time_seconds: 0, end_time_seconds: 5 },
    });
    const rippled = applyRippleTimingFromImageDurationEdits(withOverrides);

    expect(rippled[0]).toMatchObject({ startTime: 0, endTime: 5, duration: 5 });
    expect(rippled[1]).toMatchObject({ startTime: 5, endTime: 9, duration: 4 });
  });

  test('ripple accumulates multiple image duration edits', () => {
    const sourceItems = [
      {
        id: 'PLM-1',
        type: 'image',
        placementNumber: 1,
        startTime: 0,
        endTime: 4,
        duration: 4,
        sourceStartTime: 0,
        sourceEndTime: 4,
      },
      {
        id: 'PLM-2',
        type: 'image',
        placementNumber: 2,
        startTime: 4,
        endTime: 8,
        duration: 4,
        sourceStartTime: 4,
        sourceEndTime: 8,
      },
      {
        id: 'vd-placement-3',
        type: 'video',
        placementNumber: 3,
        startTime: 8,
        endTime: 12,
        duration: 4,
        sourceStartTime: 8,
        sourceEndTime: 12,
      },
    ];

    const withOverrides = applyImageTimingOverridesToItems(sourceItems, {
      '1': { start_time_seconds: 0, end_time_seconds: 5 }, // +1
      '2': { start_time_seconds: 4, end_time_seconds: 7 }, // -1
    });
    const rippled = applyRippleTimingFromImageDurationEdits(withOverrides);

    expect(rippled[0]).toMatchObject({ startTime: 0, endTime: 5, duration: 5 });
    expect(rippled[1]).toMatchObject({ startTime: 5, endTime: 8, duration: 3 });
    expect(rippled[2]).toMatchObject({ startTime: 8, endTime: 12, duration: 4 });
  });

  test('source-authored gaps remain unchanged when ripple applies', () => {
    const sourceItems = [
      {
        id: 'PLM-1',
        type: 'image',
        placementNumber: 1,
        startTime: 0,
        endTime: 4,
        duration: 4,
        sourceStartTime: 0,
        sourceEndTime: 4,
      },
      {
        id: 'vd-placement-2',
        type: 'video',
        placementNumber: 2,
        startTime: 6,
        endTime: 10,
        duration: 4,
        sourceStartTime: 6,
        sourceEndTime: 10,
      },
    ];

    const withOverrides = applyImageTimingOverridesToItems(sourceItems, {
      '1': { start_time_seconds: 0, end_time_seconds: 5 },
    });
    const rippled = applyRippleTimingFromImageDurationEdits(withOverrides);

    const originalGap = sourceItems[1]!.startTime - sourceItems[0]!.endTime;
    const rippledGap = rippled[1]!.startTime - rippled[0]!.endTime;
    expect(originalGap).toBe(2);
    expect(rippledGap).toBe(2);
  });

  test('invalid image override does not ripple downstream items', () => {
    const sourceItems = [
      {
        id: 'PLM-1',
        type: 'image',
        placementNumber: 1,
        startTime: 0,
        endTime: 4,
        duration: 4,
        sourceStartTime: 0,
        sourceEndTime: 4,
      },
      {
        id: 'vd-placement-2',
        type: 'video',
        placementNumber: 2,
        startTime: 4,
        endTime: 8,
        duration: 4,
        sourceStartTime: 4,
        sourceEndTime: 8,
      },
    ];

    const withOverrides = applyImageTimingOverridesToItems(sourceItems, {
      '1': { start_time_seconds: 10, end_time_seconds: 5 },
    });
    const rippled = applyRippleTimingFromImageDurationEdits(withOverrides);

    expect(rippled[0]).toMatchObject({ startTime: 0, endTime: 4, duration: 4 });
    expect(rippled[1]).toMatchObject({ startTime: 4, endTime: 8, duration: 4 });
  });

  test('buildUpdatedVideoSplitOverride adds snapped split offset once', () => {
    const current = {
      '1': { split_offsets_seconds: [2] },
    };

    const next = buildUpdatedVideoSplitOverride(current, 1, 10, 5.4);
    expect(next['1']).toEqual({ split_offsets_seconds: [2, 5] });

    const unchanged = buildUpdatedVideoSplitOverride(next, 1, 10, 5.1);
    expect(unchanged).toBe(next);
  });

  test('applyVideoSplitOverridesToItems creates split segments with source offsets', () => {
    const items = [
      {
        id: 'vd-placement-1',
        type: 'video',
        placementNumber: 1,
        startTime: 0,
        endTime: 10,
        duration: 10,
        label: 'vd-placement-1',
        sourceStartTime: 0,
        sourceEndTime: 10,
      },
    ];

    const splitItems = applyVideoSplitOverridesToItems(items, {
      '1': { split_offsets_seconds: [4] },
    });

    expect(splitItems).toHaveLength(2);
    expect(splitItems[0]).toMatchObject({
      id: 'vd-placement-1-seg-1',
      startTime: 0,
      endTime: 4,
      duration: 4,
      sourceOffsetSeconds: 0,
      sourcePlacementNumber: 1,
      segmentIndex: 0,
    });
    expect(splitItems[1]).toMatchObject({
      id: 'vd-placement-1-seg-2',
      startTime: 4,
      endTime: 10,
      duration: 6,
      sourceOffsetSeconds: 4,
      sourcePlacementNumber: 1,
      segmentIndex: 1,
    });
  });
});
