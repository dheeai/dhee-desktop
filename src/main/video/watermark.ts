/**
 * Mandatory video watermark.
 *
 * Policy (user, 2026-05-28): "There will be no export without
 * watermark." This module owns the watermark filter + the FFmpeg
 * invocation that applies it. Every video-export IPC handler in
 * main.ts MUST route through `burnWatermarkIntoVideo` before
 * returning a file path to the renderer. The static-source guard
 * test in `watermarkGuard.test.ts` enforces this at CI time.
 *
 * Filter shape (drawtext primitive):
 *   - text:       'dhee'
 *   - fontsize:   54 px
 *   - fontcolor:  white @ alpha 0.4
 *   - shadow:     black @ alpha 0.6, 3px offset
 *   - position:   bottom-right with 48x / 28y margin
 *   - fontfile:   system font when discoverable, default otherwise
 *
 * The filter is built as a pure function so the unit tests can pin
 * the shape without invoking FFmpeg.
 */
import ffmpeg from '@ts-ffmpeg/fluent-ffmpeg';

export const WATERMARK_TEXT = 'dhee';
export const WATERMARK_FONT_SIZE = 54;
export const WATERMARK_MARGIN_X = 48;
export const WATERMARK_MARGIN_Y = 28;
const WATERMARK_ALPHA = 0.4;

export function escapeDrawtextValue(input: string): string {
  return input
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/[\r\n]+/g, ' ');
}

export interface WatermarkFilterOpts {
  /** Absolute path to a TTF/OTF font, or null to let FFmpeg pick a default. */
  fontPath: string | null;
}

/**
 * Build the FFmpeg `drawtext=...` filter string for the mandatory
 * watermark. Pure function — no IO, no FFmpeg invocation. Unit
 * tests pin every parameter.
 */
export function buildWatermarkFilter({ fontPath }: WatermarkFilterOpts): string {
  const parts = [
    `text='${escapeDrawtextValue(WATERMARK_TEXT)}'`,
    `fontsize=${WATERMARK_FONT_SIZE}`,
    `fontcolor=white@${WATERMARK_ALPHA}`,
    'shadowcolor=black@0.6',
    'shadowx=3',
    'shadowy=3',
    `x=w-tw-${WATERMARK_MARGIN_X}`,
    `y=h-th-${WATERMARK_MARGIN_Y}`,
  ];
  if (fontPath) {
    parts.unshift(`fontfile='${escapeDrawtextValue(fontPath)}'`);
  }
  return `drawtext=${parts.join(':')}`;
}

/**
 * Apply the mandatory watermark to a video. Always called by export
 * pipelines; never optional.
 *
 * @param inputVideoPath  path to the input mp4
 * @param outputVideoPath path where the watermarked mp4 is written
 * @param findFont        injected so tests / packagers can override
 */
export async function burnWatermarkIntoVideo(
  inputVideoPath: string,
  outputVideoPath: string,
  findFont: () => Promise<string | null>,
  logger: { info: (m: string) => void; warn: (m: string) => void } = console,
): Promise<void> {
  const fontPath = await findFont();
  if (!fontPath) {
    logger.warn(
      '[VideoComposition] No system font found for watermark, relying on FFmpeg defaults.',
    );
  }
  const filter = buildWatermarkFilter({ fontPath });

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(inputVideoPath)
      .videoFilters(filter)
      .outputOptions([
        '-map 0:v:0',
        '-map 0:a?',
        '-c:v libx264',
        '-crf 18',
        '-preset medium',
        '-c:a copy',
        '-pix_fmt yuv420p',
      ])
      .output(outputVideoPath)
      .on('start', (cmd) =>
        logger.info(`[VideoComposition] Watermark FFmpeg command: ${cmd}`),
      )
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}
