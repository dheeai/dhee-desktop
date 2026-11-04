/** Validate declared continuity before generation; never infer visual correctness. */
import { createHash } from 'node:crypto';
import { z } from 'zod';

const id = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
  .max(100);
const text = z.string().trim().min(1).max(2000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const references = z.array(id).max(16);
export const continuitySchema = z
  .object({
    schemaVersion: z.literal(1),
    storyboard: z.object({ inputKey: id, sha256: hash }).strict(),
    assets: z
      .array(
        z
          .object({
            id,
            inputKey: id,
            kind: z.enum(['image', 'audio']),
            sha256: hash,
          })
          .strict(),
      )
      .min(1)
      .max(100),
    characters: z
      .array(
        z
          .object({
            id,
            kind: z.enum(['character', 'narrator']).default('character'),
            referenceIds: references,
            voiceId: id.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    locations: z
      .array(z.object({ id, referenceIds: references.min(1) }).strict())
      .min(1)
      .max(50),
    props: z
      .array(z.object({ id, referenceIds: references }).strict())
      .max(100)
      .default([]),
    scenes: z
      .array(
        z
          .object({
            id,
            durationSec: z.number().finite().positive().max(300),
            locationId: id,
            camera: text,
            framing: z.array(text).min(1).max(20),
            actors: z
              .array(
                z
                  .object({
                    characterId: id,
                    movement: z.enum(['stationary', 'enter', 'exit', 'move']),
                    mustRemainStationary: z.boolean().default(false),
                    action: text,
                  })
                  .strict(),
              )
              .max(30),
            dialogue: z
              .array(
                z
                  .object({
                    speakerId: id,
                    voiceId: id,
                    mode: z.enum([
                      'on-screen',
                      'off-screen',
                      'phone',
                      'radio',
                      'narration',
                    ]),
                    startSec: z.number().finite().nonnegative(),
                    endSec: z.number().finite().positive(),
                    text,
                  })
                  .strict(),
              )
              .max(100)
              .default([]),
            states: z
              .array(
                z
                  .object({
                    entityId: id,
                    property: id,
                    start: text,
                    end: text,
                    changeReason: text.optional(),
                    entryReason: text.optional(),
                  })
                  .strict(),
              )
              .max(100)
              .default([]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
const identitiesSchema = z.record(
  z.string(),
  z.object({ sha256: hash, kind: z.enum(['text', 'image', 'audio']) }).strict(),
);
export type ContinuitySpec = z.infer<typeof continuitySchema>;
export type ContinuityInputs = z.infer<typeof identitiesSchema>;
export interface ContinuityIssue {
  code: string;
  detail: string;
  sceneId?: string;
}
export interface ContinuityReport {
  status: 'constraints-valid' | 'blocked';
  fingerprint: string;
  semanticVerification: 'unchecked';
  creativeApproval: 'required';
  deliveryReady: false;
  issues: ContinuityIssue[];
  scenes: Array<{
    id: string;
    durationSec: number;
    locationId: string;
    camera: string;
    framing: string[];
    prompt: string;
    visualRequirements: string[];
    assets: Array<{
      id: string;
      inputKey: string;
      kind: 'image' | 'audio';
      sha256: string;
    }>;
    referenceBindings: Array<{ entityId: string; referenceIds: string[] }>;
    states: ContinuitySpec['scenes'][number]['states'];
    actors: ContinuitySpec['scenes'][number]['actors'];
    dialogue: Array<
      ContinuitySpec['scenes'][number]['dialogue'][number] & {
        lipSyncRequired: boolean;
      }
    >;
  }>;
}
export function continuityDigest(value: unknown): string {
  return createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : (JSON.stringify(value) ?? 'undefined'),
    )
    .digest('hex');
}
export function checkContinuity(
  rawSpec: unknown,
  rawInputs: unknown,
): ContinuityReport {
  const spec = continuitySchema.parse(rawSpec);
  const inputs = identitiesSchema.parse(rawInputs);
  const issues: ContinuityIssue[] = [];
  const issue = (code: string, detail: string, sceneId?: string) => {
    issues.push({ code, detail, ...(sceneId ? { sceneId } : {}) });
  };
  const unique = (
    values: string[],
    code: string,
    detail: string,
    sceneId?: string,
  ) => {
    if (new Set(values).size !== values.length) issue(code, detail, sceneId);
  };
  unique(
    spec.assets.map((a) => a.id),
    'duplicate-asset',
    'Asset IDs must be unique',
  );
  unique(
    [...spec.characters, ...spec.locations, ...spec.props].map((e) => e.id),
    'duplicate-entity',
    'Character, location and prop IDs must be distinct',
  );
  unique(
    spec.scenes.map((s) => s.id),
    'duplicate-scene',
    'Scene IDs must be unique',
  );
  const assets = new Map(spec.assets.map((a) => [a.id, a]));
  const characters = new Map(spec.characters.map((c) => [c.id, c]));
  const locations = new Map(spec.locations.map((l) => [l.id, l]));
  const entities = new Set([
    ...characters.keys(),
    ...locations.keys(),
    ...spec.props.map((p) => p.id),
  ]);
  const material = (
    inputKey: string,
    sha256: string,
    kind: 'text' | 'image' | 'audio',
  ) => {
    const actual = Object.prototype.hasOwnProperty.call(inputs, inputKey)
      ? inputs[inputKey]
      : undefined;
    if (!actual)
      issue('missing-input', `Missing declared ${kind} input: ${inputKey}`);
    else {
      if (actual.sha256 !== sha256)
        issue(
          'stale-input',
          `Selected ${inputKey} bytes differ from the continuity specification`,
        );
      if (actual.kind !== kind)
        issue(
          'input-kind',
          `${inputKey} must be ${kind}, received ${actual.kind}`,
        );
    }
  };
  material(spec.storyboard.inputKey, spec.storyboard.sha256, 'text');
  for (const asset of spec.assets)
    material(asset.inputKey, asset.sha256, asset.kind);
  const reference = (
    referenceId: string,
    kind: 'image' | 'audio',
    owner: string,
  ) => {
    const asset = assets.get(referenceId);
    if (!asset)
      issue(
        'unknown-reference',
        `${owner} names unknown reference ${referenceId}`,
      );
    else if (asset.kind !== kind)
      issue(
        'reference-kind',
        `${owner} requires an ${kind} reference, not ${referenceId} (${asset.kind})`,
      );
  };
  const voices = new Map<string, string>();
  for (const character of spec.characters) {
    if (character.kind === 'character' && !character.referenceIds.length)
      issue(
        'missing-identity',
        `${character.id} needs a canonical identity image`,
      );
    unique(
      character.referenceIds,
      'duplicate-reference',
      `${character.id} repeats a reference`,
    );
    for (const ref of character.referenceIds)
      reference(ref, 'image', character.id);
    if (character.voiceId) {
      reference(character.voiceId, 'audio', character.id);
      const voiceIdentity =
        assets.get(character.voiceId)?.sha256 ?? character.voiceId;
      if (voices.has(voiceIdentity))
        issue(
          'shared-voice',
          `${character.id} and ${voices.get(voiceIdentity)} share a voice assignment; use distinct declared speaker references`,
        );
      voices.set(voiceIdentity, character.id);
    }
  }
  for (const entity of [...spec.locations, ...spec.props]) {
    unique(
      entity.referenceIds,
      'duplicate-reference',
      `${entity.id} repeats a reference`,
    );
    for (const ref of entity.referenceIds) reference(ref, 'image', entity.id);
  }
  const stateHistory = new Map<string, { value: string; sceneId: string }>();
  const scenes = spec.scenes.map((scene) => {
    if (!locations.has(scene.locationId))
      issue(
        'unknown-location',
        `Unknown location ${scene.locationId}`,
        scene.id,
      );
    unique(
      scene.actors.map((a) => a.characterId),
      'duplicate-actor',
      'Actor appears twice in one shot',
      scene.id,
    );
    unique(
      scene.states.map((s) => `${s.entityId}:${s.property}`),
      'duplicate-state',
      'Property is declared twice in one shot',
      scene.id,
    );
    const present = new Set(scene.actors.map((a) => a.characterId));
    // Known properties follow returning entities; absent entities do not enter the shot.
    const visibleEntities = new Set([
      scene.locationId,
      ...present,
      ...scene.states.map((s) => s.entityId),
    ]);
    const sceneStates = [...scene.states];
    const declaredStates = new Set(
      scene.states.map((s) => `${s.entityId}:${s.property}`),
    );
    for (const [key, prior] of stateHistory) {
      const [entityId, property] = key.split(':');
      if (visibleEntities.has(entityId) && !declaredStates.has(key))
        sceneStates.push({
          entityId,
          property,
          start: prior.value,
          end: prior.value,
        });
    }
    for (const actor of scene.actors) {
      const character = characters.get(actor.characterId);
      if (!character || character.kind !== 'character')
        issue(
          'unknown-character',
          `On-screen actor ${actor.characterId} must name a character`,
          scene.id,
        );
      if (actor.mustRemainStationary && actor.movement !== 'stationary')
        issue(
          'stationary-conflict',
          `${actor.characterId} must remain stationary but is assigned ${actor.movement}`,
          scene.id,
        );
    }
    const sorted = [...scene.dialogue].sort((a, b) => a.startSec - b.startSec);
    let latestEnd = 0;
    for (const turn of sorted) {
      const speaker = characters.get(turn.speakerId);
      if (!speaker)
        issue('unknown-speaker', `Unknown speaker ${turn.speakerId}`, scene.id);
      if (!speaker?.voiceId || speaker.voiceId !== turn.voiceId)
        issue(
          'voice-mismatch',
          `${turn.speakerId} must use its canonical voice, not ${turn.voiceId}`,
          scene.id,
        );
      reference(turn.voiceId, 'audio', turn.speakerId);
      if (turn.mode === 'on-screen' && !present.has(turn.speakerId))
        issue(
          'speaker-not-visible',
          `${turn.speakerId} is assigned on-screen speech but is not in this shot`,
          scene.id,
        );
      if ((turn.mode === 'narration') !== (speaker?.kind === 'narrator'))
        issue(
          'narrator-mismatch',
          `Narration must use a narrator; character dialogue must declare on/off-screen, phone or radio mode`,
          scene.id,
        );
      if (turn.endSec <= turn.startSec || turn.endSec > scene.durationSec)
        issue(
          'dialogue-timing',
          `${turn.speakerId} speech interval does not fit scene duration`,
          scene.id,
        );
      if (turn.startSec < latestEnd)
        issue(
          'dialogue-overlap',
          'Speech intervals overlap; revise timing rather than mixing unintended dialogue',
          scene.id,
        );
      latestEnd = Math.max(latestEnd, turn.endSec);
    }
    for (const state of sceneStates) {
      if (!entities.has(state.entityId))
        issue(
          'unknown-entity',
          `Unknown state entity ${state.entityId}`,
          scene.id,
        );
      const key = `${state.entityId}:${state.property}`;
      const prior = stateHistory.get(key);
      if (prior && prior.value !== state.start && !state.entryReason)
        issue(
          'state-discontinuity',
          `${state.entityId}.${state.property}: ${prior.sceneId} ended '${prior.value}', ${scene.id} starts '${state.start}' without an entry explanation`,
          scene.id,
        );
      if (state.start !== state.end && !state.changeReason)
        issue(
          'unexplained-state-change',
          `${state.entityId}.${state.property} changes without an action explanation`,
          scene.id,
        );
      stateHistory.set(key, { value: state.end, sceneId: scene.id });
    }
    const requiredRefs = new Set<string>(
      locations.get(scene.locationId)?.referenceIds ?? [],
    );
    for (const actor of scene.actors)
      for (const ref of characters.get(actor.characterId)?.referenceIds ?? [])
        requiredRefs.add(ref);
    for (const turn of scene.dialogue) requiredRefs.add(turn.voiceId);
    for (const state of sceneStates) {
      const entity = [
        ...spec.characters,
        ...spec.locations,
        ...spec.props,
      ].find((e) => e.id === state.entityId);
      for (const ref of entity?.referenceIds ?? []) requiredRefs.add(ref);
    }
    const boundEntities = new Set([
      ...visibleEntities,
      ...scene.dialogue.map((d) => d.speakerId),
    ]);
    const referenceBindings = [
      ...spec.characters,
      ...spec.locations,
      ...spec.props,
    ]
      .filter((entity) => boundEntities.has(entity.id))
      .map((entity) => ({
        entityId: entity.id,
        referenceIds: entity.referenceIds,
      }));
    for (const binding of referenceBindings)
      for (const ref of binding.referenceIds) requiredRefs.add(ref);
    const sceneAssets = [...requiredRefs].flatMap((ref) =>
      assets.has(ref) ? [assets.get(ref)!] : [],
    );
    const visualRequirements = [
      ...scene.actors.map(
        (a) =>
          `${a.characterId}: ${a.movement}. ${a.action}${a.mustRemainStationary ? ' Must remain stationary throughout.' : ''} Preserve its canonical identity and wardrobe references.`,
      ),
      `Location: ${scene.locationId}. Preserve the referenced layout.`,
      `Camera: ${scene.camera}`,
      ...scene.framing,
      ...sceneStates.map(
        (s) =>
          `${s.entityId}.${s.property}: start '${s.start}', end '${s.end}'.${s.changeReason ? ` Action: ${s.changeReason}.` : ' Keep unchanged.'}${s.entryReason ? ` Entry context: ${s.entryReason}.` : ''}`,
      ),
      ...scene.dialogue
        .filter((d) => d.mode === 'on-screen')
        .map(
          (d) =>
            `${d.speakerId} visibly speaks from ${d.startSec}s to ${d.endSec}s; synchronize mouth/body with its approved voice. Listeners do not speak this line.`,
        ),
    ];
    const prompt = [
      `Scene ${scene.id} — ${scene.durationSec} seconds.`,
      'CONTINUITY AND ACTION CONSTRAINTS',
      ...visualRequirements,
      'ENTITY TO IMAGE REFERENCE BINDINGS',
      ...referenceBindings.map(
        (b) =>
          `${b.entityId} → ${b.referenceIds.join(', ') || '(no image reference)'}`,
      ),
      'LOCKED SOURCE REFERENCES',
      ...sceneAssets.map(
        (a) => `${a.id}: ${a.inputKey} (${a.kind}, SHA-256 ${a.sha256})`,
      ),
      'SPEECH PLAN (use only the spoken text for synthesis; keep approved audio unchanged)',
      ...scene.dialogue.map(
        (d) =>
          `${d.startSec}–${d.endSec}s | ${d.speakerId} | ${d.mode} | voice ${d.voiceId}: ${d.text}`,
      ),
      'These are generation constraints, not evidence of correct output. Inspect the rendered action, identities and edit boundaries before final approval.',
    ].join('\n');
    return {
      id: scene.id,
      durationSec: scene.durationSec,
      locationId: scene.locationId,
      camera: scene.camera,
      framing: scene.framing,
      prompt,
      visualRequirements,
      assets: sceneAssets,
      referenceBindings,
      states: sceneStates,
      actors: scene.actors,
      dialogue: scene.dialogue.map((d) => ({
        ...d,
        lipSyncRequired: d.mode === 'on-screen',
      })),
    };
  });
  return {
    status: issues.length ? 'blocked' : 'constraints-valid',
    fingerprint: continuityDigest({
      spec,
      inputs: Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)),
    }),
    semanticVerification: 'unchecked',
    creativeApproval: 'required',
    deliveryReady: false,
    issues,
    scenes,
  };
}
