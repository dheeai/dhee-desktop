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
import { z } from 'zod';
import type { Runner } from '@dheeai/runner-sdk' with { 'resolution-mode': 'import' };
import { ffmpegBin, ffprobeBin } from './ffmpegBin.js';

const config = z.object({
  videoInput: z.string().min(1),
  outputPath: z.string().endsWith('.mp4'),
  durationSec: z.number().positive().max(300),
  width: z.number().int().min(2).max(4096).multipleOf(2),
  height: z.number().int().min(2).max(4096).multipleOf(2),
  fps: z.number().int().min(1).max(60),
  durationPolicy: z.enum(['trim', 'pad', 'reject']),
  framing: z.enum(['crop', 'fit']),
  audio: z.enum(['drop', 'preserve']),
});
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
          ? reject(new Error(`${error.message}: ${stderr.slice(-600)}`))
          : _resolve(stdout),
    );
  });
}
function inside(root: string, path: string) {
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error('Media path must remain inside project');
}
const hash = async (p: string) =>
  createHash('sha256')
    .update(await readFile(p))
    .digest('hex');
export const ffmpegNormalizeRunner: Runner = {
  describe: () => ({
    id: 'ffmpeg.normalize',
    displayName: 'Normalize clip',
    description:
      'Explicit duration, frame rate, framing and audio policy. Records source hash and edits; never grants creative approval.',
    capabilities: ['video_normalization'],
    modalities: { input: ['video'], output: ['video'] },
    costHint: 'free',
    configSchema: {
      type: 'object',
      required: [
        'videoInput',
        'outputPath',
        'durationSec',
        'width',
        'height',
        'fps',
        'durationPolicy',
        'framing',
        'audio',
      ],
      properties: {
        videoInput: { type: 'string' },
        outputPath: { type: 'string' },
        durationSec: { type: 'number', minimum: 0, maximum: 300 },
        width: { type: 'integer' },
        height: { type: 'integer' },
        fps: { type: 'integer' },
        durationPolicy: { enum: ['trim', 'pad', 'reject'] },
        framing: { enum: ['crop', 'fit'] },
        audio: { enum: ['drop', 'preserve'] },
      },
    },
  }),
  async run(ctx) {
    let scratch: string | undefined;
    try {
      ctx.signal?.throwIfAborted();
      const cfg = config.parse(ctx.node.runner.config);
      const frames = cfg.durationSec * cfg.fps;
      if (Math.abs(frames - Math.round(frames)) > 1e-6)
        throw new Error('Requested duration must be an exact number of frames');
      const root = await realpath(ctx.projectDir);
      const input = ctx.inputs[cfg.videoInput];
      if (typeof input !== 'string')
        throw new Error('Select an upstream video input');
      const source = await realpath(resolve(root, input));
      inside(root, source);
      const info = await stat(source);
      if (!info.isFile() || info.size > 512 * 1024 * 1024)
        throw new Error(
          'Source must be a regular project file no larger than 512 MiB',
        );
      if (isAbsolute(cfg.outputPath))
        throw new Error('Output must be project relative');
      const output = resolve(root, cfg.outputPath);
      inside(root, output);
      if (output === source) throw new Error('Output must not replace source');
      const parent = await realpath(dirname(output));
      if (parent !== dirname(output))
        throw new Error('Output parent must not be a symlink');
      scratch = await mkdtemp(join(parent, '.normalize-'));
      const snapshot = join(scratch, 'source');
      await copyFile(source, snapshot);
      const sourceSha256 = await hash(snapshot);
      const probe = JSON.parse(
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
            snapshot,
          ],
          ctx.signal,
        ),
      ) as {
        streams: Array<{
          codec_type: string;
          duration?: string;
          start_time?: string;
          sample_aspect_ratio?: string;
        }>;
      };
      const videos = probe.streams.filter((s) => s.codec_type === 'video');
      const audios = probe.streams.filter((s) => s.codec_type === 'audio');
      if (videos.length !== 1)
        throw new Error('Select a source with exactly one video stream');
      const sar = videos[0]?.sample_aspect_ratio;
      if (sar && sar !== '1:1' && sar !== 'N/A')
        throw new Error(
          'Non-square pixel aspect ratio is unsupported; convert the display aspect explicitly first',
        );
      const duration = Number(videos[0]?.duration);
      if (!Number.isFinite(duration) || duration <= 0)
        throw new Error('Video duration unavailable');
      if (
        cfg.audio === 'preserve' &&
        (audios.length !== 1 ||
          Number(audios[0]?.start_time ?? 0) !==
            Number(videos[0]?.start_time ?? 0))
      )
        throw new Error(
          'Preserve audio requires one audio stream aligned with the video start',
        );
      const delta = cfg.durationSec - duration;
      if (delta > 1e-6 && cfg.durationPolicy !== 'pad')
        throw new Error(
          'Source is shorter than target; explicitly select pad to extend with a frozen final frame',
        );
      if (delta < -1e-6 && cfg.durationPolicy !== 'trim')
        throw new Error(
          'Source is longer than target; explicitly select trim to remove its tail',
        );
      const spatial =
        cfg.framing === 'crop'
          ? `scale=${cfg.width}:${cfg.height}:force_original_aspect_ratio=increase,crop=${cfg.width}:${cfg.height}`
          : `scale=${cfg.width}:${cfg.height}:force_original_aspect_ratio=decrease,pad=${cfg.width}:${cfg.height}:(ow-iw)/2:(oh-ih)/2:color=black`;
      const filter = `setpts=PTS-STARTPTS,${spatial},setsar=1,fps=${cfg.fps},tpad=stop_mode=clone:stop_duration=${Math.max(0, delta)},trim=duration=${cfg.durationSec}`;
      const temp = join(scratch, 'result.mp4');
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
          snapshot,
          '-map',
          '0:v:0',
          ...(cfg.audio === 'drop'
            ? ['-an']
            : [
                '-map',
                '0:a:0',
                '-af',
                `asetpts=PTS-STARTPTS,apad,atrim=duration=${cfg.durationSec}`,
                '-c:a',
                'aac',
                '-b:a',
                '192k',
              ]),
          '-vf',
          filter,
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '18',
          '-pix_fmt',
          'yuv420p',
          '-map_metadata',
          '-1',
          '-movflags',
          '+faststart',
          temp,
        ],
        ctx.signal,
      );
      ctx.signal?.throwIfAborted();
      if ((await hash(source)) !== sourceSha256)
        throw new Error('Source changed during normalization');
      await link(temp, output);
      return {
        ok: true,
        outputPath: cfg.outputPath,
        metadata: {
          sourceSha256,
          sourceDurationSec: duration,
          ...cfg,
          timestampsReset: true,
          padSec: Math.max(0, delta),
          trimSec: Math.max(0, -delta),
          creativeApproval: 'required',
          deliveryReady: false,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: `ffmpeg.normalize: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      if (scratch) await rm(scratch, { recursive: true, force: true });
    }
  },
};
