import { describe, it, expect } from '@jest/globals';
import {
  buildCompletedNudge,
  buildFailedNudge,
  buildGatedNudge,
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
    expect(isTransientFailure('schema validation failed: characters[0].mood not in enum')).toBe(false);
    expect(isTransientFailure(undefined)).toBe(false);
  });
  it('flags an empty LLM response as transient (model hiccup, retryable)', () => {
    expect(
      isTransientFailure('llm.generate: all 3 attempts failed. Last error: LLM returned empty response (no content).'),
    ).toBe(true);
    expect(isTransientFailure('LLM returned empty response')).toBe(true);
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

describe('buildGatedNudge', () => {
  it('frames the pause as the by-design gate, names the collection, and is a [system] message', () => {
    const n = buildGatedNudge({ gatedAfter: 'shot_image_prompt' });
    expect(n).toMatch(/^\[system\]/);
    expect(n).toMatch(/paused/i);
    expect(n).toContain('shot_image_prompt');
    expect(n).toMatch(/gateAfterCollections|stop after each collection/i);
    expect(n).toMatch(/by[- ]design|intentional/i);
  });

  it('explicitly steers away from the ComfyUI-misconfig confabulation and toward resume (issue #133)', () => {
    const n = buildGatedNudge({
      gatedAfter: 'shot_image_prompt',
      pendingAfterGate: ['shot_image', 'final_video'],
    });
    expect(n).toMatch(/not a failure/i);
    expect(n).toMatch(/ComfyUI/);
    expect(n).toMatch(/resume/i);
    // Lists what's still pending so the agent doesn't have to guess.
    expect(n).toContain('shot_image');
    expect(n).toContain('final_video');
  });

  it('tolerates a missing gatedAfter / pending list', () => {
    const n = buildGatedNudge({});
    expect(n).toMatch(/^\[system\]/);
    expect(n).toMatch(/paused/i);
    expect(n).not.toMatch(/Stages still pending/i);
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
    const n = buildFailedNudge({ error: 'schema validation failed: characters[0].mood not in enum', nodeId: 'characters_plan' });
    expect(n).toMatch(/structural/i);
    expect(n).toMatch(/dhee_critique_node|dhee_write_node_content/);
    expect(n).toContain('characters_plan');
  });
  it('empty LLM response → transient framing (retry, not fix-node)', () => {
    const n = buildFailedNudge({
      error: 'llm.generate: all 3 attempts failed. Last error: LLM returned empty response (no content).',
      nodeId: 'shot_image_prompt:scene_3_shot_18',
    });
    expect(n).toMatch(/transient|recovered|flaky/i);
    expect(n).toMatch(/retry/i);
    expect(n).not.toMatch(/structural/i);
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
