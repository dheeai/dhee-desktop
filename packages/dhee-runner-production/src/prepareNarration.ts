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
import { prepareNarration } from './narrationTiming.js';

const configSchema = z
  .object({
    audioInput: z.string().min(1),
    planInput: z.string().min(1),
    outputPath: z.string().min(1),
    sceneId: z.string().min(1).optional(),
  })
  .strict();
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
function confined(root: string, path: string) {
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw Error('Path must stay inside project');
}
export const prepareNarrationRunner: Runner = {
  describe: () => ({
    id: 'audio.prepare_narration',
    displayName: 'Prepare approved narration',
    description:
      'Split PCM16 narration at measured pauses and insert silence for scene timing. Preserves every source sample; ambiguous cuts and overflow require revised timing.',
    capabilities: ['narration_timing'],
    modalities: { input: ['audio', 'text'], output: ['audio'] },
    costHint: 'free',
    configSchema: {
      type: 'object',
      required: ['audioInput', 'planInput', 'outputPath'],
      additionalProperties: false,
      properties: {
        audioInput: { type: 'string', description: 'Upstream PCM16 WAV key' },
        planInput: {
          type: 'string',
          description: 'Upstream JSON timing-plan key, bound to sourceSha256',
        },
        outputPath: {
          type: 'string',
          description: 'New project-relative .wav path; parent must exist',
        },
        sceneId: {
          type: 'string',
          description:
            'Optional exact scene ID; omit for the full timed narration',
        },
      },
    },
  }),
  async run(ctx) {
    let scratch: string | undefined;
    try {
      ctx.signal?.throwIfAborted();
      const cfg = configSchema.parse(ctx.node.runner.config);
      const root = await realpath(ctx.projectDir);
      const readInput = async (key: string, limit: number) => {
        const input = ctx.inputs[key];
        if (typeof input !== 'string')
          throw Error(`Select an upstream file for ${key}`);
        const path = await realpath(resolve(root, input));
        confined(root, path);
        const info = await stat(path);
        if (!info.isFile() || info.size > limit)
          throw Error(
            `${key} must be a regular file within the ${limit}-byte limit`,
          );
        const bytes = await readFile(path);
        if (bytes.length > limit)
          throw Error(`${key} exceeded the input size limit`);
        return { path, bytes, sha256: digest(bytes) };
      };
      const audio = await readInput(cfg.audioInput, 128 * 1024 * 1024);
      const readPlan = async () => {
        const value = ctx.inputs[cfg.planInput];
        // Core resolves JSON stages to parsed snapshots, not filesystem paths.
        // Direct runner callers may also supply a confined plan file.
        if (value && typeof value === 'object') {
          const bytes = Buffer.from(JSON.stringify(value), 'utf8');
          if (bytes.length > 65536)
            throw Error('Timing plan exceeds the 64 KiB limit');
          return { path: undefined, bytes, sha256: digest(bytes) };
        }
        return readInput(cfg.planInput, 65536);
      };
      const plan = await readPlan();
      if (isAbsolute(cfg.outputPath) || !cfg.outputPath.endsWith('.wav'))
        throw Error('outputPath must be a project-relative .wav path');
      const output = resolve(root, cfg.outputPath);
      confined(root, output);
      const parent = await realpath(dirname(output));
      confined(root, join(parent, '__output__'));
      if (parent !== dirname(output))
        throw Error('Output parent must not be a symlink');
      if (output === audio.path || output === plan.path)
        throw Error('Output must not overwrite an input');
      ctx.signal?.throwIfAborted();
      const prepared = prepareNarration(
        audio.bytes,
        JSON.parse(plan.bytes.toString('utf8')),
        cfg.sceneId,
      );
      scratch = await mkdtemp(join(parent, '.prepare-narration-'));
      const temp = join(scratch, 'narration.wav');
      await writeFile(temp, prepared.wav, { flag: 'wx' });
      // Re-resolve original input keys as well as hashes to catch replaced symlinks.
      const freshAudio = await readInput(cfg.audioInput, 128 * 1024 * 1024);
      const freshPlan = await readPlan();
      if (
        freshAudio.path !== audio.path ||
        freshPlan.path !== plan.path ||
        freshAudio.sha256 !== audio.sha256 ||
        freshPlan.sha256 !== plan.sha256
      )
        throw Error(
          'Narration source or timing plan changed during preparation; retry with current inputs',
        );
      ctx.signal?.throwIfAborted();
      await link(temp, output);
      return {
        ok: true,
        outputPath: cfg.outputPath,
        metadata: {
          ...prepared.metadata,
          timingPlanSha256: plan.sha256,
          timingPlanSource: plan.path ? 'file' : 'core-json-snapshot',
          creativeApproval: 'required',
          audioEncoding: 'lossless-pcm',
          note: 'Pause detection does not verify sentence identity. Review scene timing and run transcript checks before final approval.',
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: `audio.prepare_narration: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      if (scratch) await rm(scratch, { recursive: true, force: true });
    }
  },
};
