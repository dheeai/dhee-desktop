import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
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
import { analyzeVoice, voiceLimitsSchema } from './voiceQuality.js';
import { checkSpeech } from './speechCheck.js';
import { ffmpegBin } from './ffmpegBin.js';

const schema = z
  .object({
    audioInput: z.string().min(1),
    audioItemId: z.string().min(1).optional(),
    outputPath: z.string().regex(/\.json$/),
    expectedScript: z.string().trim().min(1).max(12000).optional(),
    intent: z.string().trim().min(1).max(2000),
    priorRejection: z.string().trim().min(1).max(2000).optional(),
    limits: voiceLimitsSchema.optional(),
  })
  .strict();
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function confined(root: string, path: string) {
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw Error('Voice check paths must stay inside project');
}
export const voiceQualityRunner: Runner = {
  describe: () => ({
    id: 'audio.check_voice',
    displayName: 'Check voice audition',
    description:
      'Read-only PCM16 audition report: script, pauses, levels, timing, and explicit unchecked performance quality. Never grants approval.',
    capabilities: ['voice_quality'],
    modalities: { input: ['audio'], output: ['text'] },
    costHint: 'free',
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['audioInput', 'outputPath', 'intent'],
      properties: {
        audioInput: { type: 'string' },
        audioItemId: {
          type: 'string',
          description: 'Optional exact item in an upstream audio collection',
        },
        outputPath: { type: 'string' },
        intent: { type: 'string' },
        expectedScript: { type: 'string' },
        priorRejection: { type: 'string' },
        limits: {
          type: 'object',
          additionalProperties: false,
          properties: {
            maxPauseSec: { type: 'number', minimum: 0.2, maximum: 10 },
            silenceThresholdDb: { type: 'number', minimum: -70, maximum: -30 },
            availableDurationSec: {
              type: 'number',
              exclusiveMinimum: 0,
              maximum: 120,
            },
          },
        },
      },
    },
  }),
  async run(ctx) {
    let scratch: string | undefined;
    try {
      ctx.signal?.throwIfAborted();
      const cfg = schema.parse(ctx.node.runner.config);
      const root = await realpath(ctx.projectDir);
      const upstream = ctx.inputs[cfg.audioInput];
      let input: unknown = upstream;
      if (cfg.audioItemId)
        input =
          upstream &&
          typeof upstream === 'object' &&
          Object.hasOwn(upstream, cfg.audioItemId)
            ? (upstream as Record<string, unknown>)[cfg.audioItemId]
            : undefined;
      if (typeof input !== 'string')
        throw Error('Select a declared audio file');
      const source = await realpath(resolve(root, input));
      confined(root, source);
      const info = await stat(source);
      if (!info.isFile() || info.size > 128 * 1024 * 1024)
        throw Error('Audio must be a regular file within 128 MiB');
      const bytes = await readFile(source);
      if (bytes.length > 128 * 1024 * 1024)
        throw Error('Audio size limit exceeded');
      const sourceSha256 = hash(bytes);
      const analysis = analyzeVoice(bytes, cfg.limits);
      if (isAbsolute(cfg.outputPath))
        throw Error('Report path must be relative');
      const output = resolve(root, cfg.outputPath);
      confined(root, output);
      const parent = await realpath(dirname(output));
      confined(root, join(parent, '__report__'));
      if (parent !== dirname(output))
        throw Error('Output parent must not be a symlink');
      if (output === source) throw Error('Cannot overwrite source');
      scratch = await mkdtemp(join(parent, '.voice-check-'));
      const snapshot = join(scratch, 'source.wav');
      await writeFile(snapshot, bytes, { flag: 'wx' });
      let pcm: Buffer | undefined;
      if (cfg.expectedScript)
        pcm = await new Promise<Buffer>((_resolve, reject) => {
          execFile(
            ffmpegBin(),
            [
              '-v',
              'error',
              '-i',
              snapshot,
              '-f',
              'f32le',
              '-ar',
              '16000',
              '-ac',
              '1',
              'pipe:1',
            ],
            {
              encoding: 'buffer',
              signal: ctx.signal,
              timeout: 60000,
              maxBuffer: 16 * 1024 * 1024,
            },
            (err, out) => (err ? reject(err) : _resolve(out)),
          );
        });
      const speech = await checkSpeech(pcm, cfg.expectedScript, ctx.signal);
      const transcript = 'transcript' in speech ? speech.transcript : undefined;
      const wpm =
        speech.finding.status === 'pass' && transcript
          ? ((transcript.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)
              ?.length ?? 0) *
              60) /
            analysis.durationSec
          : null;
      let paceStatus = 'unchecked';
      if (wpm !== null) paceStatus = wpm > 220 || wpm < 80 ? 'review' : 'pass';
      const pace = {
        id: 'pace',
        status: paceStatus,
        detail:
          wpm === null
            ? 'Pace not scored without a confident transcript match.'
            : `${wpm.toFixed(1)} words/minute including pauses; 80–220 is a broad review band, not an acting score.`,
      };
      const report = {
        schemaVersion: 1,
        checkedAt: new Date().toISOString(),
        source: { path: relative(root, source), sha256: sourceSha256 },
        intent: cfg.intent,
        priorRejection: cfg.priorRejection ?? null,
        ...analysis,
        speech,
        pace,
        status:
          analysis.findings.some((f) => f.status === 'fail') ||
          speech.finding.status === 'fail'
            ? 'fail'
            : 'review',
      };
      const fresh = await realpath(resolve(root, input));
      if (fresh !== source || hash(await readFile(fresh)) !== sourceSha256)
        throw Error('Voice source changed during check');
      ctx.signal?.throwIfAborted();
      const temp = join(scratch, 'report.json');
      await writeFile(temp, JSON.stringify(report, null, 2), { flag: 'wx' });
      await link(temp, output);
      return {
        ok: true,
        outputPath: cfg.outputPath,
        metadata: {
          sourceSha256,
          status: report.status,
          perceptualStatus: 'unchecked',
          creativeApproval: 'required',
          deliveryReady: false,
        },
      };
    } catch (e) {
      return {
        ok: false,
        error: `audio.check_voice: ${e instanceof Error ? e.message : String(e)}`,
      };
    } finally {
      if (scratch) await rm(scratch, { recursive: true, force: true });
    }
  },
};
