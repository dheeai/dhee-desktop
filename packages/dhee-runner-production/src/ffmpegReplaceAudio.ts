/** Deterministic narration composition: lossless PCM MOV or explicitly lossy AAC MP4. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdtemp,
  readFile,
  realpath,
  link,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Runner } from '@dheeai/runner-sdk' with { 'resolution-mode': 'import' };
import { ffmpegBin, ffprobeBin } from './ffmpegBin.js';

function execute(
  bin: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((_resolve, reject) => {
    execFile(
      bin,
      args,
      {
        signal,
        timeout: 120000,
        killSignal: 'SIGKILL',
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) =>
        error
          ? reject(new Error(`${error.message}: ${stderr.slice(-800)}`))
          : _resolve(stdout),
    );
  });
}
function confined(root: string, path: string) {
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error('Path must stay inside project');
}
const hash = async (p: string) =>
  createHash('sha256')
    .update(await readFile(p))
    .digest('hex');
export const ffmpegReplaceAudioRunner: Runner = {
  describe: () => ({
    id: 'ffmpeg.replace_audio',
    displayName: 'Preserve selected narration',
    description:
      'Replace all generated audio with selected narration in a MOV (lossless PCM) or MP4 (AAC). Rejects narration truncation.',
    capabilities: ['audio_replacement'],
    modalities: { input: ['video', 'audio'], output: ['video'] },
    costHint: 'free',
    configSchema: {
      type: 'object',
      required: ['videoInput', 'audioInput', 'outputPath'],
      properties: {
        videoInput: { type: 'string' },
        audioInput: { type: 'string' },
        outputPath: {
          type: 'string',
          description:
            'Project-relative .mov (lossless) or .mp4 (AAC) output; parent directory must exist',
        },
        offsetSec: { type: 'number', minimum: 0 },
      },
    },
  }),
  async run(ctx) {
    let scratch: string | undefined;
    try {
      if (ctx.signal?.aborted) throw new Error('Aborted');
      const cfg = ctx.node.runner.config;
      const root = await realpath(ctx.projectDir);
      const offset = cfg.offsetSec ?? 0;
      if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0)
        throw new Error('offsetSec must be a finite nonnegative number');
      const source = async (key: unknown) => {
        if (typeof key !== 'string' || typeof ctx.inputs[key] !== 'string')
          throw new Error('Select an upstream input key');
        const p = await realpath(resolve(root, ctx.inputs[key]));
        confined(root, p);
        const info = await stat(p);
        if (!info.isFile() || info.size > 512 * 1024 * 1024)
          throw new Error(
            'Input must be a regular file no larger than 512 MiB',
          );
        return p;
      };
      const video = await source(cfg.videoInput);
      const audio = await source(cfg.audioInput);
      if (
        typeof cfg.outputPath !== 'string' ||
        isAbsolute(cfg.outputPath) ||
        !/\.(mov|mp4)$/.test(cfg.outputPath)
      )
        throw new Error(
          'outputPath must be a project-relative .mov or .mp4 path',
        );
      const output = resolve(root, cfg.outputPath);
      confined(root, output);
      const parent = await realpath(dirname(output));
      confined(root, join(parent, '__output__'));
      if (parent !== dirname(output))
        throw new Error('Output parent must not be a symlink');
      if (output === video || output === audio)
        throw new Error('Output must not overwrite an input');
      scratch = await mkdtemp(join(parent, '.replace-audio-'));
      const v = join(scratch, 'video');
      const a = join(scratch, 'audio');
      await copyFile(video, v);
      await copyFile(audio, a);
      const videoHash = await hash(v);
      const audioHash = await hash(a);
      const probe = async (p: string) =>
        JSON.parse(
          await execute(
            ffprobeBin(),
            [
              '-v',
              'error',
              '-protocol_whitelist',
              'file',
              '-show_streams',
              '-of',
              'json',
              p,
            ],
            ctx.signal,
          ),
        ) as {
          streams: Array<{
            codec_type: string;
            codec_name?: string;
            duration?: string;
            start_time?: string;
            sample_rate?: string;
            channels?: number;
          }>;
        };
      const vs = (await probe(v)).streams.filter(
        (s) => s.codec_type === 'video',
      );
      const as = (await probe(a)).streams.filter(
        (s) => s.codec_type === 'audio',
      );
      if (vs.length !== 1 || as.length !== 1)
        throw new Error(
          'Select inputs with exactly one video and one narration stream',
        );
      if (as[0]?.codec_name !== 'pcm_s16le')
        throw new Error(
          'Lossless narration preservation currently requires PCM 16-bit WAV input',
        );
      const duration = Number(vs[0]?.duration);
      const audioDuration = Number(as[0]?.duration);
      const rate = Number(as[0]?.sample_rate);
      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !Number.isFinite(audioDuration) ||
        audioDuration <= 0 ||
        !Number.isInteger(rate) ||
        rate <= 0
      )
        throw new Error('Input stream duration/sample rate unavailable');
      if (
        Number(vs[0]?.start_time) !== 0 ||
        Number(as[0]?.start_time ?? 0) !== 0
      )
        throw new Error(
          'Input timeline must start at zero; normalize timestamps explicitly before composing narration',
        );
      const offsetSamples = Math.round(offset * rate);
      if (
        offsetSamples + Math.round(audioDuration * rate) >
        Math.round(duration * rate)
      )
        throw new Error(
          'Narration placement would exceed the video duration and truncate approved audio',
        );
      const mp4 = cfg.outputPath.endsWith('.mp4');
      const audioCodec = mp4 ? 'aac' : 'pcm_s16le';
      const temp = join(scratch, mp4 ? 'result.mp4' : 'result.mov');
      await execute(
        ffmpegBin(),
        [
          '-v',
          'error',
          '-nostdin',
          '-y',
          '-protocol_whitelist',
          'file',
          '-i',
          v,
          '-protocol_whitelist',
          'file',
          '-i',
          a,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-map_metadata',
          '-1',
          '-c:v',
          'copy',
          '-af',
          `adelay=${offsetSamples}S:all=1,apad,atrim=end_sample=${Math.round(duration * rate)}`,
          '-c:a',
          audioCodec,
          ...(mp4 ? ['-b:a', '192k', '-movflags', '+faststart'] : []),
          '-f',
          mp4 ? 'mp4' : 'mov',
          temp,
        ],
        ctx.signal,
      );
      if (ctx.signal?.aborted) throw new Error('Aborted');
      if (
        (await hash(video)) !== videoHash ||
        (await hash(audio)) !== audioHash
      )
        throw new Error(
          'Source changed during composition; retry with current selection',
        );
      await link(temp, output);
      return {
        ok: true,
        outputPath: cfg.outputPath,
        metadata: {
          generatedAudioRemoved: true,
          videoSha256: videoHash,
          audioSha256: audioHash,
          videoInput: cfg.videoInput,
          audioInput: cfg.audioInput,
          offsetSec: offsetSamples / rate,
          offsetSamples,
          audioCodec,
          audioEncoding: mp4 ? 'lossy-aac' : 'lossless-pcm',
          sampleRate: rate,
          durationSec: duration,
          creativeApproval: 'required',
          deliveryReady: false,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: `ffmpeg.replace_audio: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      if (scratch) await rm(scratch, { recursive: true, force: true });
    }
  },
};
