/**
 * Scale probe — is the render-storm in the MODEL or in RENDER?
 * Feed buildProductionDoc a realistic large narrative_prompt_relay model
 * (50 shots × 6 shot stages + 6 chars + 6 settings + 11 scenes) and check it
 * (a) completes fast and (b) produces a SANE shape (no entity with a runaway
 * pair count). If this passes, the storm is render-side, not the pure model.
 */
import { describe, it, expect } from '@jest/globals';
import { deriveRunModel } from './deriveRunModel';
import { buildProductionDoc, type Section } from './productionModel';
import type { InstanceGraphNode } from '../../../shared/dheeIpc';

const NOW = 1_700_000_000_000;

const BUNDLE = [
  { id: 'story', kind: 'stage', outputs: { format: 'md' } },
  { id: 'story_essence', kind: 'stage', outputs: { format: 'json' } },
  { id: 'world_style', kind: 'stage', outputs: { format: 'md' } },
  { id: 'characters_plan', kind: 'stage', outputs: { format: 'json' } },
  { id: 'character_image_prompt', kind: 'node', outputs: { format: 'json' }, displayName: 'Character Prompts' },
  { id: 'character_image', kind: 'node', outputs: { format: 'image' }, displayName: 'Cast' },
  { id: 'settings_plan', kind: 'stage', outputs: { format: 'json' } },
  { id: 'setting_image_prompt', kind: 'node', outputs: { format: 'json' }, displayName: 'Setting Prompts' },
  { id: 'setting_image', kind: 'node', outputs: { format: 'image' }, displayName: 'Settings' },
  { id: 'scenes_plan', kind: 'stage', outputs: { format: 'json' } },
  { id: 'shot_image_prompt', kind: 'node', outputs: { format: 'json' }, displayName: 'Shot Prompts' },
  { id: 'shot_image', kind: 'node', outputs: { format: 'image' }, displayName: 'Shots' },
  { id: 'shot_image_last_frame_prompt', kind: 'node', outputs: { format: 'json' }, displayName: 'Last-frame Prompts' },
  { id: 'shot_image_last_frame', kind: 'node', outputs: { format: 'image' }, displayName: 'Last Frames' },
  { id: 'shot_motion_directive', kind: 'node', outputs: { format: 'json' }, displayName: 'Motion Directives' },
  { id: 'scene_video_prompt', kind: 'node', outputs: { format: 'json' }, displayName: 'Clip Prompts' },
  { id: 'scene_clip', kind: 'node', outputs: { format: 'video' }, displayName: 'Clips' },
  { id: 'final_video', kind: 'stage', outputs: { format: 'video' } },
];

function bigInstances(): InstanceGraphNode[] {
  const out: InstanceGraphNode[] = [];
  const push = (nodeId: string, status: InstanceGraphNode['status'], itemId?: string, ext?: string) =>
    out.push({ nodeId, status, ...(itemId ? { itemId } : {}), ...(ext ? { outputPath: `${nodeId}/${itemId ?? nodeId}.${ext}` } : {}) });
  push('story', 'completed', undefined, 'md');
  push('story_essence', 'completed', undefined, 'json');
  push('world_style', 'completed', undefined, 'md');
  push('characters_plan', 'completed', undefined, 'json');
  push('settings_plan', 'completed', undefined, 'json');
  push('scenes_plan', 'completed', undefined, 'json');
  for (let c = 1; c <= 6; c += 1) { push('character_image_prompt', 'completed', `char_${c}`, 'json'); push('character_image', 'completed', `char_${c}`, 'png'); }
  for (let s = 1; s <= 6; s += 1) { push('setting_image_prompt', 'completed', `set_${s}`, 'json'); push('setting_image', 'completed', `set_${s}`, 'png'); }
  // 11 scenes, 50 shots spread across them
  for (let sc = 1; sc <= 11; sc += 1) {
    push('scene_video_prompt', 'completed', `scene_${sc}`, 'json');
    push('scene_clip', sc <= 4 ? 'completed' : sc === 5 ? 'in_progress' : 'pending', `scene_${sc}`, sc <= 4 ? 'mp4' : undefined);
  }
  let shot = 0;
  for (let sc = 1; sc <= 11 && shot < 50; sc += 1) {
    for (let sh = 1; sh <= 5 && shot < 50; sh += 1) {
      shot += 1;
      const id = `scene_${sc}_shot_${sh}`;
      push('shot_image_prompt', 'completed', id, 'json');
      push('shot_image', 'completed', id, 'png');
      push('shot_image_last_frame_prompt', 'completed', id, 'json');
      push('shot_image_last_frame', 'completed', id, 'png');
      push('shot_motion_directive', 'completed', id, 'json');
    }
  }
  push('final_video', 'pending');
  return out;
}

describe('buildProductionDoc — scale', () => {
  it('is fast and produces a sane shape on a 50-shot project', () => {
    const model = deriveRunModel({ instances: bigInstances(), edges: [], bundleNodes: BUNDLE, runnerActive: true, cancelling: false, agentBusy: false, now: NOW });
    const t0 = Date.now();
    const doc = buildProductionDoc(model, new Map([['shot_image_prompt', 'imagePrompt'], ['shot_motion_directive', 'description']]));
    const ms = Date.now() - t0;

    const sheets = doc.sections.filter((s): s is Extract<Section, { kind: 'sheets' }> => s.kind === 'sheets');
    const entityCounts = Object.fromEntries(sheets.map((s) => [s.id, s.entities.length]));
    const maxPairs = Math.max(0, ...sheets.flatMap((s) => s.entities.map((e) => e.pairs.length)));

    expect(ms).toBeLessThan(200); // pure shape build must be cheap
    // Grouping must work via ITEM IDs even though the bundle never sets
    // kind:'collection' (collection flag is false in production — this mirrors it).
    expect(entityCounts.shot).toBe(50);
    expect(entityCounts.character).toBe(6);
    expect(entityCounts.setting).toBe(6);
    expect(entityCounts.scene).toBe(11);
    expect(maxPairs).toBeLessThan(10); // no runaway pair explosion

    // REGRESSION GUARD for the render-storm: a visual artifact (image/video)
    // must NEVER land in a text 'doc' section — that path reads it as text.
    const docs = doc.sections.filter((s): s is Extract<Section, { kind: 'doc' }> => s.kind === 'doc');
    const leakedVisual = docs.flatMap((d) => d.items).filter((it) => it.format === 'image' || it.format === 'video');
    expect(leakedVisual).toEqual([]);
  });
});
