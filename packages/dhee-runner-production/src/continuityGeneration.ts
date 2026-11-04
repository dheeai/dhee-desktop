import { z } from 'zod';
import { buildH3Prompt } from './h3Prompt.js';
import type { ContinuityReport } from './continuityPreflight.js';
import { sceneInputDigest, sceneIntentSchema } from './sceneIntent.js';

const key = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
  .max(100)
  .refine((v) => !['constructor', 'prototype', '__proto__'].includes(v));
export const continuityGenerationSchema = z
  .object({
    promptProfile: z.enum(['generic', 'h3-six-section']).default('generic'),
    endpoint: z.string().url().optional(),
    sceneId: key,
    nodeId: key,
    itemId: key.optional(),
    branchId: key.default('main'),
    requestId: z.string().min(8).max(128),
    expectedSelectionId: z.string().min(1).nullable(),
    workflow: z.string().min(1).max(200),
    workflowVersion: z.string().min(1).max(200),
    promptInput: key,
    durationInput: key.optional(),
    referenceInputs: z.record(key, z.union([key, z.array(key).min(1).max(16)])),
    referenceLabels: z
      .record(key, z.array(z.string().trim().min(1).max(100)).min(1).max(16))
      .default({}),
    parameters: z
      .record(
        key,
        z.union([z.string().max(2000), z.number().finite(), z.boolean()]),
      )
      .default({}),
    primaryOutput: z.number().int().nonnegative().default(0),
  })
  .strict();
export interface SelectedReference {
  localPath: string;
  sha256: string;
  bytes: number;
}
/** Internal compiler: caller must supply a freshly checked report and file snapshots. */
export function prepareContinuityGeneration(
  report: ContinuityReport,
  raw: unknown,
  projectDir: string,
  files: Record<string, SelectedReference>,
) {
  const cfg = continuityGenerationSchema.parse(raw);
  if (report.status !== 'constraints-valid' || report.issues.length)
    throw Error('Continuity must pass before generation preparation');
  const scene = report.scenes.find((s) => s.id === cfg.sceneId);
  if (!scene) throw Error('Unknown continuity scene');
  const slots = [
    cfg.promptInput,
    ...Object.keys(cfg.referenceInputs),
    ...Object.keys(cfg.parameters),
    ...(cfg.durationInput ? [cfg.durationInput] : []),
  ];
  if (new Set(slots).size !== slots.length)
    throw Error(
      'Generation input slots collide; prompt, duration and references cannot be overridden',
    );
  if (slots.length > 32)
    throw Error('At most 32 generation inputs are supported');
  const inputs: Record<string, unknown> = {
    ...cfg.parameters,
    [cfg.promptInput]: scene.prompt,
  };
  const identities: Record<string, unknown> = { ...inputs };
  const used = new Set<string>();
  const routing: string[] = [];
  const labels = Object.values(cfg.referenceLabels).flat();
  if (new Set(labels).size !== labels.length)
    throw Error('Reference labels must be unique');
  for (const slot of Object.keys(cfg.referenceLabels))
    if (!Object.prototype.hasOwnProperty.call(cfg.referenceInputs, slot))
      throw Error('Reference label names an unmapped slot');
  for (const [slot, binding] of Object.entries(cfg.referenceInputs)) {
    const ids = Array.isArray(binding) ? binding : [binding];
    if (
      cfg.referenceLabels[slot] &&
      cfg.referenceLabels[slot].length !== ids.length
    )
      throw Error('Reference label count must match mapped references');
    const selected = ids.map((id, index) => {
      const label =
        cfg.referenceLabels[slot]?.[index] ??
        (Array.isArray(binding) ? `${slot}[${index + 1}]` : slot);
      const owners = scene.referenceBindings
        .filter((b) => b.referenceIds.includes(id))
        .map((b) => b.entityId);
      routing.push(
        `${label} = ${id}; workflow input ${slot}${Array.isArray(binding) ? ` position ${index + 1}` : ''}${owners.length ? `; entities: ${owners.join(', ')}` : ''}.`,
      );
      if (used.has(id)) throw Error(`Duplicate reference binding: ${id}`);
      used.add(id);
      const asset = scene.assets.find((a) => a.id === id);
      if (!asset)
        throw Error(`Reference ${id} does not belong to scene ${scene.id}`);
      const file = Object.prototype.hasOwnProperty.call(files, asset.inputKey)
        ? files[asset.inputKey]
        : undefined;
      if (!file || file.sha256 !== asset.sha256)
        throw Error(`Reference ${id} is missing or changed`);
      return file;
    });
    inputs[slot] = Array.isArray(binding)
      ? selected.map((f) => f.localPath)
      : selected[0].localPath;
    identities[slot] = Array.isArray(binding) ? selected : selected[0];
  }
  for (const asset of scene.assets) {
    const needsAudio = scene.dialogue.some(
      (d) =>
        d.voiceId === asset.id &&
        (cfg.promptProfile === 'h3-six-section'
          ? ['on-screen']
          : ['on-screen', 'phone', 'radio']
        ).includes(d.mode),
    );
    if ((asset.kind === 'image' || needsAudio) && !used.has(asset.id))
      throw Error(`Required scene reference ${asset.id} is not mapped`);
  }
  const assemblyVoices = scene.dialogue
    .filter((d) => !used.has(d.voiceId))
    .map((d) => d.voiceId);
  inputs[cfg.promptInput] = [
    scene.prompt,
    'WORKFLOW REFERENCE BINDINGS (ordered; use these labels)',
    ...routing,
    ...(assemblyVoices.length
      ? [
          `Do not synthesize the narration/off-screen voice tracks ${[...new Set(assemblyVoices)].join(', ')}. Their approved recordings will be preserved during assembly.`,
        ]
      : []),
  ].join('\n');
  if (cfg.promptProfile === 'h3-six-section') {
    if (
      cfg.workflow !== 'h3_video_final' ||
      cfg.promptInput !== 'prompt' ||
      cfg.durationInput !== 'duration' ||
      Object.keys(cfg.parameters).some((k) => k !== 'seed')
    )
      throw Error(
        'H3 profile requires h3_video_final, prompt/duration inputs and only optional seed parameters',
      );
    inputs[cfg.promptInput] = buildH3Prompt(
      scene,
      cfg.referenceInputs,
      cfg.referenceLabels,
    );
  }
  identities[cfg.promptInput] = inputs[cfg.promptInput];
  if (cfg.durationInput) {
    inputs[cfg.durationInput] = scene.durationSec;
    identities[cfg.durationInput] = scene.durationSec;
  }
  // Facts describe the declared request, never observations of a rendered image or clip.
  const sources = Object.entries(identities).map(
    ([inputKey, value], index) => ({
      id: `source-${index}`,
      inputKey,
      sha256: sceneInputDigest(value),
      evidence:
        'Source identity for declared generation input; no visual or voice correctness inferred.',
      facts: { [`binding-${index}`]: sceneInputDigest(value) },
    }),
  );
  const requirements = sources.map((source, index) => ({
    id: `binding-${index}`,
    description: `Preserve declared input ${source.inputKey}`,
    expected: source.sha256,
    sources: [source.id],
  }));
  const sceneIntent = sceneIntentSchema.parse({ sources, requirements });
  return {
    action: 'gpu.prepare' as const,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    projectDir,
    branchId: cfg.branchId,
    nodeId: cfg.nodeId,
    ...(cfg.itemId ? { itemId: cfg.itemId } : {}),
    requestId: cfg.requestId,
    expectedSelectionId: cfg.expectedSelectionId,
    workflow: cfg.workflow,
    workflowVersion: cfg.workflowVersion,
    inputs,
    primaryOutput: cfg.primaryOutput,
    sceneIntent,
  };
}
