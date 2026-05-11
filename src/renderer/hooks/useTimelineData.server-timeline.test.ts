import { describe, expect, it } from '@jest/globals';
import {
  buildNormalizedServerTimelineData,
  buildServerTimelineItems,
  getTimelineFileState,
} from './useTimelineData';
import { DEFAULT_TIMELINE_STATE } from '../types/dhee';

describe('useTimelineData server timeline helpers', () => {
  it('returns none state when timeline.json is missing', () => {
    const result = getTimelineFileState(null);

    expect(result.source).toBe('none');
    expect(result.timeline).toBeNull();
    expect(result.error).toBeNull();
  });

  it('returns none state when timeline.json is invalid JSON', () => {
    const result = getTimelineFileState('{nope');

    expect(result.source).toBe('none');
    expect(result.timeline).toBeNull();
    expect(result.error).toContain('invalid');
  });

  it('normalizes a filled segment through manifest artifact lookup', () => {
    const items = buildServerTimelineItems({
      timeline: {
        version: '1.0',
        totalDuration: 8,
        segments: [
          {
            id: 'segment_1',
            label: 'Intro',
            startTime: 0,
            endTime: 8,
            fillStatus: 'filled',
            layers: [
              {
                type: 'visual',
                artifactId: 'img_1',
              },
            ],
          },
        ],
      },
      assets: [
        {
          id: 'img_1',
          type: 'scene_image',
          path: 'assets/images/intro.png',
          version: 1,
          created_at: 1,
        },
      ],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'segment_1',
        segmentId: 'segment_1',
        sourceType: 'server_timeline',
        type: 'image',
        imagePath: 'assets/images/intro.png',
        startTime: 0,
        endTime: 8,
      }),
    ]);
  });

  it('normalizes a filled segment through direct filePath video resolution', () => {
    const items = buildServerTimelineItems({
      timeline: {
        version: '1.0',
        totalDuration: 4,
        segments: [
          {
            id: 'segment_2',
            label: 'Clip',
            startTime: 1,
            endTime: 4,
            fillStatus: 'filled',
            layers: [
              {
                type: 'visual',
                filePath: 'assets/videos/clip.mp4',
              },
            ],
          },
        ],
      },
      assets: [],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'segment_2',
        type: 'video',
        videoPath: 'assets/videos/clip.mp4',
        startTime: 1,
        endTime: 4,
      }),
    ]);
  });

  it('renders planned or unresolved segments as placeholders', () => {
    const items = buildServerTimelineItems({
      timeline: {
        version: '1.0',
        totalDuration: 10,
        segments: [
          {
            id: 'segment_planned',
            label: 'Planned',
            startTime: 0,
            endTime: 5,
            fillStatus: 'planned',
            layers: [],
          },
          {
            id: 'segment_unresolved',
            label: 'Broken',
            startTime: 5,
            endTime: 10,
            fillStatus: 'filled',
            layers: [
              {
                type: 'visual',
                artifactId: 'missing',
              },
            ],
          },
        ],
      },
      assets: [],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'segment_planned',
        type: 'placeholder',
        label: 'Planned',
      }),
      expect.objectContaining({
        id: 'segment_unresolved',
        type: 'placeholder',
        label: 'Broken',
      }),
    ]);
  });

  it('applies segment timing overrides to server timeline visuals', () => {
    const items = buildServerTimelineItems({
      timeline: {
        version: '1.0',
        totalDuration: 8,
        segments: [
          {
            id: 'segment_3',
            label: 'Adjusted',
            startTime: 0,
            endTime: 4,
            fillStatus: 'filled',
            layers: [
              {
                type: 'visual',
                filePath: 'assets/images/adjusted.png',
              },
            ],
          },
        ],
      },
      assets: [],
      segmentOverrides: {
        segment_3: {
          start_time_seconds: 2,
          end_time_seconds: 6,
        },
      },
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'segment_3',
        startTime: 2,
        endTime: 6,
        duration: 4,
        sourceStartTime: 0,
        sourceEndTime: 4,
      }),
    ]);
  });

  it('derives a scene label for shot segments', () => {
    const items = buildServerTimelineItems({
      timeline: {
        version: '1.0',
        totalDuration: 6,
        segments: [
          {
            id: 'segment_0_shot_2',
            label: 'Shot 2: medium_wide',
            startTime: 0,
            endTime: 6,
            fillStatus: 'filled',
            layers: [
              {
                type: 'visual',
                filePath: 'assets/videos/scene-1-shot-2.mp4',
              },
            ],
          },
        ],
      },
      assets: [],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'segment_0_shot_2',
        label: 'Shot 2: medium_wide',
        sceneLabel: 'Scene 1',
      }),
    ]);
  });

  it('extracts shot metadata and prompt text for server timeline shot items', () => {
    const items = buildServerTimelineItems({
      timeline: {
        version: '1.0',
        totalDuration: 6,
        segments: [
          {
            id: 'segment_2_shot_1',
            label: 'Shot 1: close_up',
            startTime: 0,
            endTime: 6,
            fillStatus: 'filled',
            layers: [
              {
                type: 'visual',
                artifactId: 'img_scene_3_shot_1',
                metadata: {
                  prompt:
                    'A tight close-up with dramatic rim light and shallow depth of field.',
                },
              },
            ],
          },
        ],
      },
      assets: [
        {
          id: 'img_scene_3_shot_1',
          type: 'scene_image',
          path: 'assets/images/scene-3-shot-1.png',
          scene_number: 3,
          version: 1,
          created_at: 1,
          metadata: {
            shot_number: 1,
          },
        },
      ],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'segment_2_shot_1',
        segmentId: 'segment_2_shot_1',
        sceneNumber: 3,
        shotNumber: 1,
        prompt:
          'A tight close-up with dramatic rim light and shallow depth of field.',
        mediaTypeContext: 'image',
        mediaPathContext: 'assets/images/scene-3-shot-1.png',
      }),
    ]);
  });

  it('preserves shot identity when prompt metadata is missing', () => {
    const items = buildServerTimelineItems({
      timeline: {
        version: '1.0',
        totalDuration: 4,
        segments: [
          {
            id: 'segment_1_shot_4',
            label: 'Shot 4: insert',
            startTime: 0,
            endTime: 4,
            fillStatus: 'filled',
            layers: [
              {
                type: 'visual',
                filePath: 'assets/videos/scene-2-shot-4.mp4',
              },
            ],
          },
        ],
      },
      assets: [],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'segment_1_shot_4',
        sceneNumber: 2,
        shotNumber: 4,
        prompt: undefined,
        mediaTypeContext: 'video',
        mediaPathContext: 'assets/videos/scene-2-shot-4.mp4',
      }),
    ]);
  });

  it('includes segment timing overrides in the default timeline state', () => {
    expect(DEFAULT_TIMELINE_STATE.segment_timing_overrides).toEqual({});
  });

  it('repairs a mismatched active video path from the manifest asset in memory', () => {
    const result = buildNormalizedServerTimelineData({
      timeline: {
        version: '1.1',
        totalDuration: 4,
        segments: [
          {
            id: 'segment_0_shot_3',
            label: 'Scene 1 Shot 3: Medium wide pan to diner',
            startTime: 0,
            endTime: 4,
            fillStatus: 'filled',
            layers: [
              {
                type: 'visual',
                artifactId: 'vid_scene_1_shot_3',
                filePath: 'assets/videos/Scene2_shot1_video_wrong.mp4',
              },
            ],
          },
        ],
      },
      assets: [
        {
          id: 'vid_scene_1_shot_3',
          type: 'scene_video',
          path: 'assets/videos/Scene1_shot3_video_correct.mp4',
          scene_number: 1,
          version: 1,
          created_at: 1,
          metadata: {
            shot_number: 3,
          },
        },
      ],
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        type: 'video',
        videoPath: 'assets/videos/Scene1_shot3_video_correct.mp4',
      }),
    ]);
    expect(result.isNormalizedFromCorruption).toBe(true);
    expect(result.normalizationSummary).toEqual({
      repairedCount: 1,
      droppedCount: 0,
    });
    expect(result.validationIssues).toEqual([
      expect.objectContaining({
        segmentId: 'segment_0_shot_3',
        code: 'recovered_from_manifest',
      }),
    ]);
  });

  it('renders image-only artifact segments as images and drops invalid cross-shot videos', () => {
    const result = buildNormalizedServerTimelineData({
      timeline: {
        version: '1.1',
        totalDuration: 8,
        segments: [
          {
            id: 'segment_1_shot_2',
            label: 'Scene 2 Shot 2: Close-up',
            startTime: 0,
            endTime: 4,
            fillStatus: 'filled',
            layers: [
              {
                type: 'visual',
                artifactId: 'img_scene_2_shot_2',
              },
            ],
          },
          {
            id: 'segment_1_shot_3',
            label: 'Scene 2 Shot 3: Booth',
            startTime: 4,
            endTime: 8,
            fillStatus: 'filled',
            layers: [
              {
                type: 'visual',
                filePath: 'assets/videos/Scene4_shot1_video_wrong.mp4',
              },
            ],
          },
        ],
      },
      assets: [
        {
          id: 'img_scene_2_shot_2',
          type: 'scene_image',
          path: 'assets/images/scene-2-shot-2.png',
          scene_number: 2,
          version: 1,
          created_at: 1,
          metadata: {
            shot_number: 2,
          },
        },
      ],
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'segment_1_shot_2',
        type: 'image',
        imagePath: 'assets/images/scene-2-shot-2.png',
      }),
      expect.objectContaining({
        id: 'segment_1_shot_3',
        type: 'placeholder',
      }),
    ]);
    expect(result.normalizationSummary).toEqual({
      repairedCount: 0,
      droppedCount: 1,
    });
    expect(result.validationIssues).toEqual([
      expect.objectContaining({
        segmentId: 'segment_1_shot_3',
        code: 'dropped_invalid_visual',
      }),
    ]);
  });

  it('prefers a matching manifest video over a stale image-backed active layer', () => {
    const result = buildNormalizedServerTimelineData({
      timeline: {
        version: '1.1',
        totalDuration: 8,
        segments: [
          {
            id: 'segment_0_shot_1',
            label: 'Scene 1 Shot 1: Exterior to interior establishing',
            startTime: 0,
            endTime: 4,
            fillStatus: 'filled',
            layers: [
              {
                type: 'visual',
                artifactId: 'img_scene_1_shot_1',
                filePath: 'assets/images/Scene1_shot1_stale.png',
              },
            ],
          },
        ],
      },
      assets: [
        {
          id: 'img_scene_1_shot_1',
          type: 'scene_image',
          path: 'assets/images/Scene1_shot1_stale.png',
          scene_number: 1,
          version: 3,
          created_at: 3,
          metadata: {
            shot_number: 1,
          },
        },
        {
          id: 'vid_scene_1_shot_1',
          type: 'scene_video',
          path: 'assets/videos/Scene1_shot1_video.mp4',
          scene_number: 1,
          version: 2,
          created_at: 2,
          metadata: {
            shot_number: 1,
          },
        },
      ],
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'segment_0_shot_1',
        type: 'video',
        videoPath: 'assets/videos/Scene1_shot1_video.mp4',
      }),
    ]);
    expect(result.normalizationSummary).toEqual({
      repairedCount: 1,
      droppedCount: 0,
    });
    expect(result.validationIssues).toEqual([
      expect.objectContaining({
        segmentId: 'segment_0_shot_1',
        code: 'video_preferred_over_image',
      }),
    ]);
  });
});
