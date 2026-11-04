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
import { mixSoundtrack } from './soundtrackMix.js';

const configSchema = z
  .object({
    dialogueInput: z.string().min(1),
    bedInput: z.string().min(1),
    planInput: z.string().min(1),
    outputPath: z.string().min(1),
  })
  .strict();
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
function confined(root: string, path: string) {
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw Error('Path must stay inside project');
}
export const mixSoundtrackRunner: Runner = {
  describe: () => ({
    id: 'audio.mix_soundtrack',
    displayName: 'Mix soundtrack with approved dialogue',
    description:
      'Mix a hash-bound PCM16 bed under unity-gain dialogue; check speech coverage, margin and clipping before publication.',
    capabilities: ['soundtrack_mixing'],
    modalities: { input: ['audio', 'text'], output: ['audio'] },
    costHint: 'free',
    configSchema: {
      type: 'object',
      required: ['dialogueInput', 'bedInput', 'planInput', 'outputPath'],
      additionalProperties: false,
      properties: {
        dialogueInput: {
          type: 'string',
          description: 'Upstream full-timeline PCM16 dialogue WAV key',
        },
        bedInput: {
          type: 'string',
          description: 'Upstream PCM16 bed WAV key with matching rate/channels',
        },
        planInput: {
          type: 'string',
          description:
            'Upstream JSON mix-plan key, bound to dialogueSha256 and bedSha256',
        },
        outputPath: {
          type: 'string',
          description: 'New project-relative .wav path; parent must exist',
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
      const audio = await readInput(cfg.dialogueInput, 128 * 1024 * 1024);
      const bed = await readInput(cfg.bedInput, 128 * 1024 * 1024);
      const readPlan = async () => {
        const value = ctx.inputs[cfg.planInput];
        // Core resolves JSON stages to parsed snapshots, not filesystem paths.
        // Direct runner callers may also supply a confined plan file.
        if (value && typeof value === 'object') {
          const bytes = Buffer.from(JSON.stringify(value), 'utf8');
          if (bytes.length > 65536)
            throw Error('Mix plan exceeds the 64 KiB limit');
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
      const parentIdentity = await stat(parent);
      confined(root, join(parent, '__output__'));
      if (parent !== dirname(output))
        throw Error('Output parent must not be a symlink');
      if (output === audio.path || output === bed.path || output === plan.path)
        throw Error('Output must not overwrite an input');
      ctx.signal?.throwIfAborted();
      const prepared = mixSoundtrack(
        audio.bytes,
        bed.bytes,
        JSON.parse(plan.bytes.toString('utf8')),
      );
      scratch = await mkdtemp(join(parent, '.mix-soundtrack-'));
      const temp = join(scratch, 'soundtrack.wav');
      await writeFile(temp, prepared.wav, { flag: 'wx' });
      // Re-resolve original input keys as well as hashes to catch replaced symlinks.
      const freshAudio = await readInput(cfg.dialogueInput, 128 * 1024 * 1024);
      const freshPlan = await readPlan();
      const freshBed = await readInput(cfg.bedInput, 128 * 1024 * 1024);
      if (
        freshBed.path !== bed.path ||
        freshBed.sha256 !== bed.sha256 ||
        freshAudio.path !== audio.path ||
        freshPlan.path !== plan.path ||
        freshAudio.sha256 !== audio.sha256 ||
        freshPlan.sha256 !== plan.sha256
      )
        throw Error(
          'Soundtrack source or plan changed during mixing; retry with current inputs',
        );
      ctx.signal?.throwIfAborted();
      const currentParent = await realpath(dirname(output));
      const currentIdentity = await stat(currentParent);
      if (
        currentParent !== parent ||
        currentIdentity.dev !== parentIdentity.dev ||
        currentIdentity.ino !== parentIdentity.ino
      )
        throw Error('Output directory changed during mixing');
      await link(temp, output);
      return {
        ok: true,
        outputPath: cfg.outputPath,
        metadata: {
          ...prepared.metadata,
          mixPlanSha256: plan.sha256,
          mixPlanSource: plan.path ? 'file' : 'core-json-snapshot',
          creativeApproval: 'required',
          audioEncoding: 'lossless-pcm',
          note: 'Mixing retains unity dialogue gain, not sample identity of the combined mix. Review the changed soundtrack before approval.',
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: `audio.mix_soundtrack: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      if (scratch) await rm(scratch, { recursive: true, force: true });
    }
  },
};
