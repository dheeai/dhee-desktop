/**
 * shotSheets — TDD coverage.
 *
 * Failure modes guarded:
 *   1. all of a shot's artifacts (prompt, frame, last-frame prompt+frame,
 *      motion, clip) join under one sheet keyed by the shared item id.
 *   2. entries are in pipeline (stage) order.
 *   3. status rolls up: any in_progress → running; all completed → done;
 *      otherwise queued (partial).
 *   4. ABSENCE of a last frame is catered for — a single-frame shot simply
 *      has no last-frame entries (no crash, no placeholder leak).
 *   5. headlineField + frameRole propagate so the renderer can project text
 *      and label first/last media.
 */
import { describe, it, expect } from '@jest/globals';
import { deriveRunModel } from './deriveRunModel';
import { buildShotSheets } from './shotSheets';
import type { InstanceGraphNode } from '../../../shared/dheeIpc';

const NOW = 1_700_000_000_000;
const inst = (nodeId: string, status: InstanceGraphNode['status'], extra: Partial<InstanceGraphNode> = {}): InstanceGraphNode => ({ nodeId, status, ...extra });

const BUNDLE = [
  { id: 'shot_image_prompt', kind: 'collection', outputs: { format: 'json' }, displayName: 'Shot Prompts' },
  { id: 'shot_image', kind: 'collection', outputs: { format: 'image' }, displayName: 'Shots' },
  { id: 'shot_image_last_frame_prompt', kind: 'collection', outputs: { format: 'json' }, displayName: 'Last-frame Prompts' },
  { id: 'shot_image_last_frame', kind: 'collection', outputs: { format: 'image' }, displayName: 'Last Frames' },
  { id: 'shot_motion_directive', kind: 'collection', outputs: { format: 'json' }, displayName: 'Motion Directives' },
  { id: 'shot_video', kind: 'collection', outputs: { format: 'video' }, displayName: 'Clips' },
];

const HEADLINES = new Map<string, string | undefined>([
  ['shot_image_prompt', 'imagePrompt'],
  ['shot_image_last_frame_prompt', 'imagePrompt'],
  ['shot_motion_directive', 'description'],
]);

// shot_1 is FLFV + fully rendered; shot_2 is single-frame + still rendering.
const INSTANCES: InstanceGraphNode[] = [
  inst('shot_image_prompt', 'completed', { itemId: 'scene_1_shot_1', outputPath: 'p/scene_1_shot_1.json' }),
  inst('shot_image_prompt', 'completed', { itemId: 'scene_1_shot_2', outputPath: 'p/scene_1_shot_2.json' }),
  inst('shot_image', 'completed', { itemId: 'scene_1_shot_1', outputPath: 'img/scene_1_shot_1_first.png' }),
  inst('shot_image', 'completed', { itemId: 'scene_1_shot_2', outputPath: 'img/scene_1_shot_2_first.png' }),
  inst('shot_image_last_frame_prompt', 'completed', { itemId: 'scene_1_shot_1', outputPath: 'p/scene_1_shot_1_last.json' }),
  inst('shot_image_last_frame', 'completed', { itemId: 'scene_1_shot_1', outputPath: 'img/scene_1_shot_1_last.png' }),
  inst('shot_motion_directive', 'completed', { itemId: 'scene_1_shot_1', outputPath: 'm/scene_1_shot_1.json' }),
  inst('shot_motion_directive', 'in_progress', { itemId: 'scene_1_shot_2' }),
  inst('shot_video', 'completed', { itemId: 'scene_1_shot_1', outputPath: 'v/scene_1_shot_1.mp4' }),
  inst('shot_video', 'pending', { itemId: 'scene_1_shot_2' }),
];

function sheets(instances: InstanceGraphNode[] = INSTANCES) {
  const model = deriveRunModel({ instances, edges: [], bundleNodes: BUNDLE, runnerActive: true, cancelling: false, agentBusy: false, now: NOW });
  return buildShotSheets(model.stages, HEADLINES);
}

describe('buildShotSheets', () => {
  it('joins every artifact for a shot under one sheet keyed by item id', () => {
    const s = sheets();
    expect(s.map((x) => x.itemId)).toEqual(['scene_1_shot_1', 'scene_1_shot_2']);
    const shot1 = s[0];
    expect(shot1.sceneNo).toBe(1);
    expect(shot1.shotNo).toBe(1);
    expect(shot1.label).toBe('Scene 1 · Shot 1');
    expect(shot1.entries.map((e) => e.stageId)).toEqual([
      'shot_image_prompt', 'shot_image', 'shot_image_last_frame_prompt', 'shot_image_last_frame', 'shot_motion_directive', 'shot_video',
    ]);
  });

  it('caters for the ABSENCE of a last frame on single-frame shots', () => {
    const shot2 = sheets()[1];
    const stageIds = shot2.entries.map((e) => e.stageId);
    expect(stageIds).not.toContain('shot_image_last_frame');
    expect(stageIds).not.toContain('shot_image_last_frame_prompt');
    expect(stageIds).toEqual(['shot_image_prompt', 'shot_image', 'shot_motion_directive', 'shot_video']);
  });

  it('rolls up status: all completed → done, any in_progress → running', () => {
    const s = sheets();
    expect(s[0].status).toBe('done'); // shot_1 fully rendered
    expect(s[1].status).toBe('running'); // shot_2 motion in_progress
  });

  it('propagates headlineField + isText + frameRole for the renderer', () => {
    const shot1 = sheets()[0];
    const byStage = Object.fromEntries(shot1.entries.map((e) => [e.stageId, e]));
    expect(byStage.shot_image_prompt.headlineField).toBe('imagePrompt');
    expect(byStage.shot_image_prompt.isText).toBe(true);
    expect(byStage.shot_motion_directive.isText).toBe(true);
    expect(byStage.shot_image.isText).toBe(false);
    expect(byStage.shot_image.frameRole).toBe('first');
    expect(byStage.shot_image_last_frame.frameRole).toBe('last');
    expect(byStage.shot_image_last_frame_prompt.frameRole).toBe('last'); // json, but 'last' in id
    expect(byStage.shot_video.frameRole).toBeNull();
  });
});
