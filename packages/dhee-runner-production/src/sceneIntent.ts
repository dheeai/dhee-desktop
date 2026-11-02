import { createHash } from 'node:crypto';
import { z } from 'zod';

const label = z.string().trim().min(1).max(1000);
const key = z
  .string()
  .regex(/^[\w.-]+$/)
  .max(100);
export const sceneIntentSchema = z
  .object({
    requirements: z
      .array(
        z
          .object({
            id: key,
            description: label,
            expected: label,
            sources: z.array(key).min(1).max(32),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    sources: z
      .array(
        z
          .object({
            id: key,
            inputKey: key,
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            evidence: label,
            facts: z
              .record(z.string(), label)
              .refine((v) => Object.keys(v).length <= 100),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict();
export function sceneInputDigest(value: unknown): string {
  // File identities are generated from the frozen upload bytes by gpu.queue.
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'sha256' in value &&
    typeof value.sha256 === 'string'
  )
    return value.sha256;
  return createHash('sha256')
    .update(JSON.stringify(value) ?? 'undefined')
    .digest('hex');
}
export function checkSceneIntent(input: unknown) {
  const intent = sceneIntentSchema.parse(input);
  for (const entries of [intent.requirements, intent.sources])
    if (new Set(entries.map((e) => e.id)).size !== entries.length)
      throw new Error('Duplicate scene requirement or source ID');
  const issues: Array<{
    requirementId: string;
    sourceId: string;
    status: 'conflict' | 'unknown';
    expected: string;
    observed?: string;
    evidence?: string;
  }> = [];
  for (const requirement of intent.requirements)
    for (const sourceId of requirement.sources) {
      const source = intent.sources.find((s) => s.id === sourceId);
      const observed = source?.facts[requirement.id];
      if (observed !== requirement.expected)
        issues.push({
          requirementId: requirement.id,
          sourceId,
          status: observed === undefined ? 'unknown' : 'conflict',
          expected: requirement.expected,
          observed,
          evidence: source?.evidence,
        });
    }
  return {
    status: issues.length ? ('blocked' as const) : ('consistent' as const),
    basis: 'recorded-observations' as const,
    creativeApproval: 'required' as const,
    issues,
    requirements: intent.requirements,
  };
}
export function assertSceneIntent(
  input: unknown,
  sourceInputs: Record<string, unknown>,
) {
  const intent = sceneIntentSchema.parse(input);
  const report = checkSceneIntent(intent);
  if (report.status !== 'consistent')
    throw new Error(
      `Scene intent blocked: ${report.issues.map((i) => `${i.requirementId}/${i.sourceId}: ${i.status}, expected ${i.expected}, observed ${i.observed ?? 'unknown'}`).join('; ')}`,
    );
  for (const source of intent.sources) {
    if (
      !(source.inputKey in sourceInputs) ||
      sceneInputDigest(sourceInputs[source.inputKey]) !== source.sha256
    )
      throw new Error(
        `Scene evidence is stale for ${source.id}; inspect the current ${source.inputKey} input before preparing or submitting.`,
      );
  }
  return report;
}
