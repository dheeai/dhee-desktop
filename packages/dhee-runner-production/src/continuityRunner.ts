import { createHash } from 'node:crypto';
import {
  readFile,
  realpath,
  stat,
  mkdtemp,
  writeFile,
  link,
  rm,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Runner } from '@dheeai/runner-sdk' with { 'resolution-mode': 'import' };
import {
  checkContinuity,
  continuitySchema,
  continuityDigest,
  type ContinuityInputs,
} from './continuityPreflight.js';

import {
  continuityGenerationSchema,
  prepareContinuityGeneration,
  type SelectedReference,
} from './continuityGeneration.js';

const configSchema = z
  .object({
    specInput: z.string().min(1),
    outputPath: z.string().min(1),
    generation: continuityGenerationSchema.optional(),
  })
  .strict();
function confined(root: string, path: string) {
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw Error('Path must stay inside project');
}
function snapshot(value: unknown) {
  if (value === undefined) throw Error('Missing input snapshot');
  const encoded = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > 1024 * 1024)
    throw Error('Text/JSON snapshots must be no larger than 1 MiB');
  return encoded;
}
/** Header recognition is a modality guard, not an image/audio quality check. */
function mediaKind(bytes: Buffer): 'image' | 'audio' {
  const head = bytes.toString('ascii', 0, 12);
  if (
    (bytes.length >= 8 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (head.startsWith('RIFF') && head.endsWith('WEBP'))
  )
    return 'image';
  if (
    (head.startsWith('RIFF') && head.endsWith('WAVE')) ||
    head.startsWith('fLaC') ||
    head.startsWith('ID3')
  )
    return 'audio';
  throw Error(
    'References must be PNG/JPEG/WebP images or WAV/FLAC/ID3 MP3 audio; unsupported media header',
  );
}
export const continuityPreflightRunner: Runner = {
  describe: () => ({
    id: 'production.continuity_preflight',
    displayName: 'Check continuity constraints',
    description:
      'Bind cast, voices, actions and prop states to current materials before generation; does not visually verify output.',
    capabilities: ['continuity_preflight'],
    costHint: 'free',
    modalities: { input: ['text', 'image', 'audio'], output: ['text'] },
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['specInput', 'outputPath'],
      properties: {
        specInput: {
          type: 'string',
          description: 'Upstream parsed continuity JSON input key',
        },
        generation: {
          type: 'object',
          description:
            'Optional exact scene/workflow/target binding; emits a Core gpu.prepare request without submitting a job. See production extension README.',
        },
        outputPath: {
          type: 'string',
          description: 'New project-relative .json artifact; parent must exist',
        },
      },
    },
  }),
  async run(ctx) {
    let scratch: string | undefined;
    try {
      ctx.signal?.throwIfAborted();
      const cfg = configSchema.parse(ctx.node.runner.config);
      const originalSpec = snapshot(ctx.inputs[cfg.specInput]);
      const spec = continuitySchema.parse(JSON.parse(originalSpec));
      const root = await realpath(ctx.projectDir);
      const readSelected = async () => {
        const identities: ContinuityInputs = Object.create(null);
        const paths: Record<string, string> = Object.create(null);
        const files: Record<string, SelectedReference> = Object.create(null);
        const story = ctx.inputs[spec.storyboard.inputKey];
        if (
          Object.prototype.hasOwnProperty.call(
            ctx.inputs,
            spec.storyboard.inputKey,
          ) &&
          story !== undefined
        )
          identities[spec.storyboard.inputKey] = {
            kind: 'text',
            sha256: continuityDigest(snapshot(story)),
          };
        let total = 0;
        // Sequential reads bound memory and stop as soon as the aggregate limit is exceeded.
        /* eslint-disable no-await-in-loop, no-continue */
        for (const asset of spec.assets) {
          if (!Object.prototype.hasOwnProperty.call(ctx.inputs, asset.inputKey))
            continue;
          if (Object.prototype.hasOwnProperty.call(paths, asset.inputKey))
            continue;
          const value = ctx.inputs[asset.inputKey];
          if (typeof value !== 'string')
            throw Error(
              `Asset ${asset.inputKey} requires an upstream media file`,
            );
          const path = await realpath(resolve(root, value));
          confined(root, path);
          const info = await stat(path);
          if (!info.isFile() || info.size > 64 * 1024 * 1024)
            throw Error(
              'Each reference must be a regular file no larger than 64 MiB',
            );
          total += info.size;
          if (total > 128 * 1024 * 1024)
            throw Error('References exceed 128 MiB total');
          const bytes = await readFile(path);
          if (bytes.length !== info.size)
            throw Error('Reference size changed during preflight');
          ctx.signal?.throwIfAborted();
          identities[asset.inputKey] = {
            kind: mediaKind(bytes),
            sha256: createHash('sha256').update(bytes).digest('hex'),
          };
          paths[asset.inputKey] = path;
          files[asset.inputKey] = {
            localPath: relative(root, path),
            sha256: identities[asset.inputKey].sha256,
            bytes: bytes.length,
          };
        }
        /* eslint-enable no-await-in-loop, no-continue */
        return { identities, paths, files };
      };
      const selected = await readSelected();
      const report = checkContinuity(spec, selected.identities);
      if (report.status === 'blocked')
        throw Error(
          `Blocked: ${report.issues
            .slice(0, 20)
            .map(
              (i) =>
                `${i.code}${i.sceneId ? ` [${i.sceneId}]` : ''}: ${i.detail}`,
            )
            .join(
              '; ',
            )}${report.issues.length > 20 ? `; ${report.issues.length - 20} additional issues` : ''}`,
        );
      if (isAbsolute(cfg.outputPath) || !cfg.outputPath.endsWith('.json'))
        throw Error('outputPath must be a project-relative .json path');
      const output = resolve(root, cfg.outputPath);
      confined(root, output);
      const parent = await realpath(dirname(output));
      confined(root, join(parent, '__output__'));
      if (parent !== dirname(output))
        throw Error('Output parent must not be a symlink');
      if (Object.values(selected.paths).includes(output))
        throw Error('Output must not replace a source reference');
      const serialized = JSON.stringify(
        {
          ...report,
          ...(cfg.generation
            ? {
                generationRequest: prepareContinuityGeneration(
                  report,
                  cfg.generation,
                  root,
                  selected.files,
                ),
              }
            : {}),
          specSha256: continuityDigest(originalSpec),
          inputIdentities: selected.identities,
        },
        null,
        2,
      );
      if (Buffer.byteLength(serialized) > 4 * 1024 * 1024)
        throw Error(
          'Preflight artifact exceeds 4 MiB; split this production into smaller scene groups',
        );
      scratch = await mkdtemp(join(parent, '.continuity-'));
      const temp = join(scratch, 'report.json');
      await writeFile(temp, serialized, { flag: 'wx' });
      const fresh = await readSelected();
      if (
        snapshot(ctx.inputs[cfg.specInput]) !== originalSpec ||
        JSON.stringify(fresh) !== JSON.stringify(selected)
      )
        throw Error(
          'Continuity specification or source selection changed during preflight; rerun with current inputs',
        );
      ctx.signal?.throwIfAborted();
      await link(temp, output);
      return {
        ok: true,
        outputPath: cfg.outputPath,
        metadata: {
          fingerprint: report.fingerprint,
          sceneCount: report.scenes.length,
          semanticVerification: 'unchecked',
          creativeApproval: 'required',
          deliveryReady: false,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: `production.continuity_preflight: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      if (scratch) await rm(scratch, { recursive: true, force: true });
    }
  },
};
