import type { ContinuityReport } from './continuityPreflight.js';

/** H3 ref2va positional labels; input is a freshly validated continuity scene. */
export function buildH3Prompt(
  scene: ContinuityReport['scenes'][number],
  bindings: Record<string, string | string[]>,
  labels: Record<string, string[]>,
): string {
  if (
    !Number.isInteger(scene.durationSec) ||
    scene.durationSec < 1 ||
    scene.durationSec > 15
  )
    throw Error('H3 duration must be an integer from 1 to 15 seconds');
  const tokens = new Map<string, string>();
  const referenceLines: string[] = [];
  for (const [slot, ids] of Object.entries(bindings)) {
    if (!['refs', 'audio_refs'].includes(slot) || !Array.isArray(ids))
      throw Error('H3 references require ordered refs/audio_refs lists');
    const image = slot === 'refs';
    if (ids.length > (image ? 9 : 3))
      throw Error('H3 reference count exceeds provider limit');
    if (labels[slot] && labels[slot].length !== ids.length)
      throw Error('H3 label count mismatch');
    ids.forEach((id, index) => {
      const token = `<${image ? 'Picture' : 'Audio'} ${index + 1}>`;
      if (labels[slot] && labels[slot][index] !== token)
        throw Error('H3 labels must match actual reference order');
      const asset = scene.assets.find((a) => a.id === id);
      if (!asset || asset.kind !== (image ? 'image' : 'audio'))
        throw Error(`Wrong H3 reference modality for ${id}`);
      if (tokens.has(id)) throw Error('Duplicate H3 reference');
      tokens.set(id, token);
      const owners = scene.referenceBindings
        .filter((b) => b.referenceIds.includes(id))
        .map((b) => b.entityId);
      referenceLines.push(
        `${token}: ${id}${owners.length ? `; entities: ${owners.join(', ')}` : ''}.`,
      );
    });
  }
  for (const slot of Object.keys(labels))
    if (!Object.prototype.hasOwnProperty.call(bindings, slot))
      throw Error('Unknown H3 reference label slot');
  const visible = scene.dialogue.filter((d) => d.mode === 'on-screen');
  for (const turn of visible)
    if (!tokens.get(turn.voiceId)?.startsWith('<Audio '))
      throw Error('On-screen speech needs its mapped audio reference');
  return [
    '1. SCENE AND INTENT',
    `One ${scene.durationSec}-second shot at ${scene.locationId}. Follow the declared action and continuity below.`,
    '',
    '2. REFERENCES AND IDENTITY',
    ...referenceLines,
    'Preserve each assigned identity, wardrobe, object shape and location layout. Do not swap characters or reference ownership.',
    '',
    '3. ACTION',
    ...scene.actors.map(
      (a) =>
        `${a.characterId}: ${a.movement}. ${a.action}${a.mustRemainStationary ? ' Must remain stationary throughout.' : ''}`,
    ),
    ...scene.states.map(
      (s) =>
        `${s.entityId}.${s.property}: start '${s.start}', end '${s.end}'.${s.changeReason ? ` Action: ${s.changeReason}.` : ' Keep unchanged.'}${s.entryReason ? ` Entry context: ${s.entryReason}.` : ''}`,
    ),
    '',
    '4. CAMERA',
    scene.camera,
    ...scene.framing,
    '',
    '5. LIGHTING AND FINISH',
    'Match the assigned scene references for lighting, color and finish. Keep geometry and object contact stable; avoid flicker and unintended identity changes. Do not add unrequested lettering, subtitles or logos.',
    '',
    '6. AUDIO',
    ...(visible.length
      ? visible.map(
          (d) =>
            `${d.speakerId} alone speaks ${d.startSec}–${d.endSec}s using ${tokens.get(d.voiceId)}: ${JSON.stringify(d.text)}. Synchronize that character’s mouth to this line. Listeners do not speak.`,
        )
      : ['No generated speech.']),
    'Do not synthesize narration, off-screen, phone or radio voice tracks. Preserve their approved recordings separately for assembly. Do not invent dialogue or music.',
  ].join('\n');
}
