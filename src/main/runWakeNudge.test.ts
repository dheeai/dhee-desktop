import { describe, it, expect } from '@jest/globals';
import {
  buildCompletedNudge,
  buildFailedNudge,
  isTransientFailure,
  extractNodeId,
} from './runWakeNudge';

describe('isTransientFailure', () => {
  it('flags the transientRetry exhaustion marker', () => {
    expect(isTransientFailure('comfy.image: transient upstream error after 3 attempts — 502')).toBe(true);
  });
  it('flags raw gateway/socket errors', () => {
    expect(isTransientFailure('Failed to upload image: Gateway Time-out')).toBe(true);
    expect(isTransientFailure('ECONNRESET')).toBe(true);
    expect(isTransientFailure('fetch failed')).toBe(true);
  });
  it('does NOT flag structural errors', () => {
    expect(isTransientFailure('node 999 not found in workflow')).toBe(false);
    expect(isTransientFailure('LLM returned empty response')).toBe(false);
    expect(isTransientFailure(undefined)).toBe(false);
  });
});

describe('buildCompletedNudge', () => {
  it('mentions the video path when present + tells agent not to auto-start', () => {
    const n = buildCompletedNudge({ videoPath: 'assets/videos/final/final_video.mp4' });
    expect(n).toContain('final_video.mp4');
    expect(n).toMatch(/do not start another run/i);
    expect(n).toMatch(/^\[system\]/);
  });
  it('works without a video path', () => {
    expect(buildCompletedNudge({})).toMatch(/completed/i);
  });
});

describe('buildFailedNudge', () => {
  it('transient failure → frames as flaky + offer retry', () => {
    const n = buildFailedNudge({ error: 'transient upstream error after 3 attempts — Comfy 502', nodeId: 'shot_image:scene_1_shot_5' });
    expect(n).toMatch(/transient|flaky|recovered/i);
    expect(n).toMatch(/retry/i);
    expect(n).toContain('shot_image:scene_1_shot_5');
  });
  it('structural failure → frames as fix-the-upstream-node', () => {
    const n = buildFailedNudge({ error: 'LLM returned empty response', nodeId: 'story' });
    expect(n).toMatch(/structural/i);
    expect(n).toMatch(/dhee_critique_node|dhee_write_node_content/);
    expect(n).toContain('story');
  });
  it('tolerates missing error + nodeId', () => {
    expect(buildFailedNudge({})).toMatch(/^\[system\].*failed/i);
  });
});

describe('extractNodeId', () => {
  it('pulls a node:item token', () => {
    expect(extractNodeId('comfy.image: upload failed for shot_image:scene_1_shot_3')).toBe('shot_image:scene_1_shot_3');
  });
  it('pulls a scene_N_shot_M token', () => {
    expect(extractNodeId('render of scene_2_shot_4 failed')).toBe('scene_2_shot_4');
  });
  it('returns undefined when nothing matches', () => {
    expect(extractNodeId('something generic broke')).toBeUndefined();
    expect(extractNodeId(undefined)).toBeUndefined();
  });
});
