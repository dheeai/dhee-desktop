/* eslint-disable no-await-in-loop -- Bound subprocess and snapshot memory by processing inputs sequentially. */
/** Read-only assembly audit. A completed report is not a passed film or approval. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdtemp,
  readFile,
  realpath,
  stat,
  rm,
  writeFile,
  link,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Runner } from '@dheeai/runner-sdk' with { 'resolution-mode': 'import' };
import { reviewFrames, type ReviewFrame } from './visualReview.js';
import { checkSpeech } from './speechCheck.js';
import { ffmpegBin, ffprobeBin } from './ffmpegBin.js';

const configSchema = z
  .object({
    videoInput: z.string().min(1),
    outputPath: z.string().regex(/\.json$/),
    expectedScript: z.string().trim().min(1).max(12000).optional(),
    segments: z
      .array(
        z
          .object({
            visualRequirements: z
              .array(z.string().trim().min(1).max(500))
              .min(1)
              .max(10)
              .optional(),
            videoInput: z.string().min(1),
            durationSec: z.number().finite().positive().max(120),
            audioInput: z.string().min(1).optional(),
            audioOffsetSec: z.number().finite().nonnegative().default(0),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
function confined(root: string, path: string) {
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error('Verification paths must stay inside the project');
}
const digest = async (p: string) =>
  createHash('sha256')
    .update(await readFile(p))
    .digest('hex');
function execute(
  bin: string,
  args: string[],
  signal?: AbortSignal,
): Promise<Buffer> {
  return new Promise((_resolve, reject) => {
    execFile(
      bin,
      args,
      {
        encoding: 'buffer',
        signal,
        timeout: 120000,
        killSignal: 'SIGKILL',
        maxBuffer: 32 * 1024 * 1024,
      },
      (error, stdout, stderr) =>
        error
          ? reject(
              new Error(`${error.message}: ${stderr.toString().slice(-800)}`),
            )
          : _resolve(stdout),
    );
  });
}
type Finding = {
  id: string;
  status: 'pass' | 'fail' | 'unchecked';
  detail: string;
  measured?: number;
  expected?: number;
  atSec?: number;
};
export const verifyAssemblyRunner: Runner = {
  describe: () => ({
    id: 'media.verify_assembly',
    displayName: 'Check assembled picture and narration',
    description:
      'Compare a hard-cut final against ordered source pictures and selected narration; save hash-bound findings. Does not certify script or scene meaning.',
    capabilities: ['assembly_verification'],
    modalities: { input: ['video', 'audio'], output: ['text'] },
    costHint: 'free',
    configSchema: {
      type: 'object',
      required: ['videoInput', 'outputPath', 'segments'],
      properties: {
        videoInput: { type: 'string' },
        outputPath: { type: 'string' },
        expectedScript: {
          type: 'string',
          description:
            'Expected English narration; compared using configured offline ASR.',
        },
        segments: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            required: ['videoInput', 'durationSec'],
            properties: {
              visualRequirements: {
                type: 'array',
                minItems: 1,
                maxItems: 10,
                items: { type: 'string', minLength: 1, maxLength: 500 },
              },
              videoInput: { type: 'string' },
              durationSec: {
                type: 'number',
                exclusiveMinimum: 0,
                maximum: 120,
              },
              audioInput: { type: 'string' },
              audioOffsetSec: { type: 'number', minimum: 0 },
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
      const cfg = configSchema.parse(ctx.node.runner.config);
      const reviewEnv = { ...process.env };
      // Shared report contract with Core; never persist endpoint credentials.
      const visualReviewConfigSha256 = createHash('sha256')
        .update(
          JSON.stringify([
            reviewEnv.DHEE_REVIEW_VLM_BASE_URL?.trim().replace(/\/$/, '') ?? '',
            reviewEnv.DHEE_REVIEW_VLM_MODEL?.trim() ?? '',
          ]),
        )
        .digest('hex');
      const duration = cfg.segments.reduce((sum, s) => sum + s.durationSec, 0);
      if (duration > 120)
        throw new Error(
          'This verification supports at most 120 seconds per cut',
        );
      const root = await realpath(ctx.projectDir);
      if (isAbsolute(cfg.outputPath))
        throw new Error('Report output must be project-relative');
      const output = resolve(root, cfg.outputPath);
      confined(root, output);
      confined(
        root,
        join(await realpath(dirname(output)), '.verification-path'),
      );
      scratch = await mkdtemp(join(root, '.assembly-verification-'));
      const inputs: Record<string, { path: string; sha256: string }> =
        Object.create(null);
      const snapshots: Record<string, string> = Object.create(null);
      let totalBytes = 0;
      for (const key of new Set([
        cfg.videoInput,
        ...cfg.segments.flatMap((s) => [
          s.videoInput,
          ...(s.audioInput ? [s.audioInput] : []),
        ]),
      ])) {
        if (typeof ctx.inputs[key] !== 'string')
          throw new Error(`Missing declared input: ${key}`);
        const original = await realpath(
          resolve(root, ctx.inputs[key] as string),
        );
        confined(root, original);
        const info = await stat(original);
        totalBytes += info.size;
        if (!info.isFile() || totalBytes > 512 * 1024 * 1024)
          throw new Error(
            'Verification inputs must be regular files totalling at most 512 MiB',
          );
        const before = await digest(original);
        const snapshot = join(scratch, `${Object.keys(inputs).length}.media`);
        await copyFile(original, snapshot);
        if (
          (await digest(snapshot)) !== before ||
          (await digest(original)) !== before
        )
          throw new Error('Input changed during snapshot');
        inputs[key] = { path: relative(root, original), sha256: before };
        snapshots[key] = snapshot;
      }
      const final = snapshots[cfg.videoInput];
      const probe = JSON.parse(
        (
          await execute(
            ffprobeBin(),
            ['-v', 'error', '-show_streams', '-of', 'json', final],
            ctx.signal,
          )
        ).toString(),
      ) as {
        streams: Array<{
          codec_type: string;
          duration?: string;
          width?: number;
          height?: number;
          avg_frame_rate?: string;
        }>;
      };
      const videos = probe.streams.filter((s) => s.codec_type === 'video');
      if (videos.length !== 1)
        throw new Error('Expected exactly one final video stream');
      const checks: Finding[] = [];
      const measured = Number(videos[0].duration);
      checks.push({
        id: 'duration',
        status:
          Number.isFinite(measured) && Math.abs(measured - duration) <= 0.05
            ? 'pass'
            : 'fail',
        detail:
          'Final video duration matches the planned hard-cut timeline (50 ms tolerance)',
        measured: Number.isFinite(measured) ? measured : undefined,
        expected: duration,
      });
      await execute(
        ffmpegBin(),
        ['-v', 'error', '-xerror', '-i', final, '-f', 'null', '-'],
        ctx.signal,
      );
      checks.push({
        id: 'decode',
        status: 'pass',
        detail: 'Complete final file decoded without an FFmpeg error',
      });
      const audio = async (path: string) =>
        execute(
          ffmpegBin(),
          [
            '-v',
            'error',
            '-i',
            path,
            '-map',
            '0:a:0',
            '-ac',
            '1',
            '-ar',
            '16000',
            '-f',
            'f32le',
            'pipe:1',
          ],
          ctx.signal,
        );
      const finalAudio = probe.streams.some((s) => s.codec_type === 'audio')
        ? await audio(final)
        : undefined;
      const pictures = async (path: string, start: number, length: number) =>
        execute(
          ffmpegBin(),
          [
            '-v',
            'error',
            '-i',
            path,
            '-an',
            '-vf',
            `trim=start=${start}:duration=${length},setpts=PTS-STARTPTS,fps=8,scale=64:36,format=gray`,
            '-f',
            'rawvideo',
            'pipe:1',
          ],
          ctx.signal,
        );
      let offset = 0;
      for (const [index, segment] of cfg.segments.entries()) {
        ctx.signal?.throwIfAborted();
        const reference = await pictures(
          snapshots[segment.videoInput],
          0,
          segment.durationSec,
        );
        const rendered = await pictures(final, offset, segment.durationSec);
        let worst = 0;
        const frameBytes = 64 * 36;
        for (
          let base = 0;
          base < Math.min(reference.length, rendered.length);
          base += frameBytes
        ) {
          let diff = 0;
          for (
            let p = base;
            p < Math.min(base + frameBytes, reference.length, rendered.length);
            p += 1
          )
            diff += Math.abs(reference[p] - rendered[p]);
          worst = Math.max(worst, diff / (frameBytes * 255));
        }
        checks.push({
          id: `picture:${index}`,
          status:
            reference.length > 0 &&
            reference.length ===
              Math.round(segment.durationSec * 8) * frameBytes &&
            reference.length === rendered.length &&
            worst <= 0.025
              ? 'pass'
              : 'fail',
          detail:
            'Ordered source picture comparison at 8 frames/second; worst frame mean absolute luma difference ≤ 2.5%. Not semantic action recognition.',
          measured: worst,
          atSec: offset,
        });
        if (!segment.audioInput)
          checks.push({
            id: `voice:${index}`,
            status: 'unchecked',
            detail: 'No approved narration source declared',
            atSec: offset,
          });
        else {
          const voice = await audio(snapshots[segment.audioInput]);
          const samples = voice.length / 4;
          const start = Math.round((offset + segment.audioOffsetSec) * 16000);
          let aa = 0;
          let bb = 0;
          let ab = 0;
          const fits =
            !!finalAudio &&
            (start + samples) * 4 <= finalAudio.length &&
            segment.audioOffsetSec + samples / 16000 <=
              segment.durationSec + 0.001;
          if (fits && finalAudio)
            for (let p = 0; p < samples; p += 1) {
              const a = voice.readFloatLE(p * 4);
              const b = finalAudio.readFloatLE((start + p) * 4);
              aa += a * a;
              bb += b * b;
              ab += a * b;
            }
          const correlation = aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
          const gain = aa > 0 ? Math.sqrt(bb / aa) : 0;
          checks.push({
            id: `voice:${index}`,
            status:
              fits && correlation >= 0.995 && gain >= 0.8 && gain <= 1.2
                ? 'pass'
                : 'fail',
            detail: `Selected narration at scheduled offset; correlation ≥ .995 and RMS gain 0.8–1.2. Measured gain ${gain.toFixed(5)}. Does not identify an unreferenced speaker.`,
            measured: correlation,
            atSec: offset + segment.audioOffsetSec,
          });
        }
        offset += segment.durationSec;
      }
      const visualReviews: Array<{
        segmentIndex: number;
        result: Awaited<ReturnType<typeof reviewFrames>>;
      }> = [];
      let visualOffset = 0;
      for (const [segmentIndex, segment] of cfg.segments.entries()) {
        if (segment.visualRequirements) {
          const frames: ReviewFrame[] = [];
          let extractionFailed = false;
          if (
            reviewEnv.DHEE_REVIEW_VLM_BASE_URL &&
            reviewEnv.DHEE_REVIEW_VLM_MODEL
          ) {
            try {
              for (const fraction of [0.1, 0.5, 0.9]) {
                const atSec = visualOffset + segment.durationSec * fraction;
                const jpeg = await execute(
                  ffmpegBin(),
                  [
                    '-v',
                    'error',
                    '-ss',
                    String(atSec),
                    '-i',
                    final,
                    '-map',
                    '0:v:0',
                    '-frames:v',
                    '1',
                    '-vf',
                    'scale=640:640:force_original_aspect_ratio=decrease',
                    '-f',
                    'image2pipe',
                    '-c:v',
                    'mjpeg',
                    'pipe:1',
                  ],
                  ctx.signal,
                );
                frames.push({ atSec, jpeg });
              }
            } catch {
              ctx.signal?.throwIfAborted();
              extractionFailed = true;
            }
          }
          const result = extractionFailed
            ? {
                finding: {
                  id: 'scene-meaning' as const,
                  status: 'unchecked' as const,
                  detail:
                    'Could not extract the requested visual samples; semantic review remains unchecked.',
                },
              }
            : await reviewFrames(
                segment.visualRequirements,
                frames,
                ctx.signal,
                reviewEnv,
              );
          visualReviews.push({ segmentIndex, result });
        }
        visualOffset += segment.durationSec;
      }
      const speech = await checkSpeech(
        finalAudio,
        cfg.expectedScript,
        ctx.signal,
      );
      checks.push(
        speech.finding,
        {
          id: 'scene-meaning',
          status: visualReviews.some((v) => v.result.finding.status === 'fail')
            ? 'fail'
            : 'unchecked',
          detail: visualReviews.length
            ? `${visualReviews
                .map(
                  (v) =>
                    `Scene ${v.segmentIndex + 1}: ${v.result.finding.detail}`,
                )
                .join(
                  '\n',
                )}\nOnly configured scene requirements were reviewed; other scenes remain unchecked.`
            : 'No visual requirements configured; scene meaning remains unchecked.',
        },
        {
          id: 'creative-approval',
          status: 'unchecked',
          detail:
            'This automated report does not record a human creative decision.',
        },
      );
      for (const [key, input] of Object.entries(inputs)) {
        const current = await realpath(
          resolve(root, ctx.inputs[key] as string),
        );
        if (
          current !== resolve(root, input.path) ||
          (await digest(current)) !== input.sha256
        )
          throw new Error('Input changed during verification; rerun');
      }
      const status = checks.some((c) => c.status === 'fail')
        ? 'fail'
        : 'review';
      const report = {
        analyzerVersion: 3,
        visualReviewConfigSha256,
        createdAt: new Date().toISOString(),
        status,
        deliveryReady: false,
        inputs,
        criteria: cfg,
        checks,
        speech,
        visualReviews,
      };
      const reportPath = join(scratch, 'report.json');
      const serializedReport = JSON.stringify(report, null, 2);
      if (Buffer.byteLength(serializedReport) > 8 * 1024 * 1024)
        throw new Error(
          'Verification report exceeds 8 MiB; split the review into smaller cuts',
        );
      await writeFile(reportPath, serializedReport);
      // No overwrite of media or an existing report. Reruns need a fresh artifact path.
      await link(reportPath, output);
      return {
        ok: true,
        outputPath: cfg.outputPath,
        metadata: {
          verificationStatus: status,
          deliveryReady: false,
          checks: checks.length,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (scratch) await rm(scratch, { recursive: true, force: true });
    }
  },
};
