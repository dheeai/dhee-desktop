import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import log from 'electron-log';

export interface AudioWaveformOptions {
  sampleCount?: number;
}

export interface AudioWaveformResult {
  peaks: number[];
  duration: number;
}

const DEFAULT_AUDIO_WAVEFORM_SAMPLES = 1024;
const MIN_AUDIO_WAVEFORM_SAMPLES = 64;
const MAX_AUDIO_WAVEFORM_SAMPLES = 4096;
const AUDIO_WAVEFORM_SAMPLE_RATE = 8000;
const AUDIO_WAVEFORM_TIMEOUT_MS = 20000;

let configuredFfmpegPath: string | null = null;

const audioWaveformCache = new Map<string, AudioWaveformResult>();
const pendingAudioWaveformRequests = new Map<
  string,
  Promise<AudioWaveformResult>
>();

export function configureAudioWaveformExtractor(ffmpegPath: string): void {
  configuredFfmpegPath = ffmpegPath;
}

export function clampAudioWaveformSampleCount(sampleCount?: number): number {
  if (!Number.isFinite(sampleCount)) {
    return DEFAULT_AUDIO_WAVEFORM_SAMPLES;
  }

  return Math.min(
    MAX_AUDIO_WAVEFORM_SAMPLES,
    Math.max(MIN_AUDIO_WAVEFORM_SAMPLES, Math.round(sampleCount as number)),
  );
}

export function buildAudioWaveformPeaksFromPcm(
  pcmData: Buffer,
  sampleCount: number,
): number[] {
  const normalizedSampleCount = clampAudioWaveformSampleCount(sampleCount);
  const totalSamples = Math.floor(pcmData.length / 2);

  if (totalSamples <= 0) {
    return [];
  }

  const peaks = new Array<number>(normalizedSampleCount).fill(0);

  for (let index = 0; index < normalizedSampleCount; index += 1) {
    const startSample = Math.floor((index * totalSamples) / normalizedSampleCount);
    const endSample = Math.max(
      startSample + 1,
      Math.floor(((index + 1) * totalSamples) / normalizedSampleCount),
    );

    let peak = 0;
    for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex += 1) {
      const amplitude = Math.abs(pcmData.readInt16LE(sampleIndex * 2)) / 32768;
      if (amplitude > peak) {
        peak = amplitude;
      }
    }

    peaks[index] = peak;
  }

  const maxPeak = Math.max(...peaks);
  if (maxPeak <= 0) {
    return peaks;
  }

  const normalizedPeaks = peaks.map((peak) => peak / maxPeak);

  return normalizedPeaks.map((peak, index) => {
    const previousPeak = normalizedPeaks[index - 1] ?? peak;
    const nextPeak = normalizedPeaks[index + 1] ?? peak;
    return Math.min(1, Math.max(0, (previousPeak + peak * 2 + nextPeak) / 4));
  });
}

function buildWaveformCacheKey({
  audioPath,
  sampleCount,
  size,
  mtimeMs,
}: {
  audioPath: string;
  sampleCount: number;
  size: number;
  mtimeMs: number;
}): string {
  return `${audioPath}|${sampleCount}|${size}|${Math.round(mtimeMs)}`;
}

async function extractAudioWaveformPeaks(
  audioPath: string,
  sampleCount: number,
): Promise<number[]> {
  if (!configuredFfmpegPath) {
    throw new Error('FFmpeg path is not configured for audio waveform extraction.');
  }
  // Capture into a const so the `Promise` callback closure keeps the
  // narrowed `string` type — the module-level `configuredFfmpegPath`
  // (string | null) widens back to nullable across the closure boundary.
  const ffmpegPath = configuredFfmpegPath;

  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: string[] = [];

    const ffmpegProcess = spawn(
      ffmpegPath,
      [
        '-v',
        'error',
        '-i',
        audioPath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(AUDIO_WAVEFORM_SAMPLE_RATE),
        '-f',
        's16le',
        '-acodec',
        'pcm_s16le',
        'pipe:1',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'] as const,
      },
    );

    const timeoutId = setTimeout(() => {
      ffmpegProcess.kill('SIGKILL');
      reject(
        new Error(
          `Timed out extracting waveform after ${AUDIO_WAVEFORM_TIMEOUT_MS}ms.`,
        ),
      );
    }, AUDIO_WAVEFORM_TIMEOUT_MS);

    ffmpegProcess.stdout.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    ffmpegProcess.stderr.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(chunk.toString());
    });

    ffmpegProcess.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    ffmpegProcess.on('close', (code) => {
      clearTimeout(timeoutId);

      if (code !== 0) {
        reject(
          new Error(
            stderrChunks.join('').trim() ||
              `FFmpeg exited with status ${code ?? 'unknown'}.`,
          ),
        );
        return;
      }

      try {
        const pcmData = Buffer.concat(stdoutChunks);
        resolve(buildAudioWaveformPeaksFromPcm(pcmData, sampleCount));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function getAudioWaveform(
  audioPath: string,
  getAudioDuration: (audioPath: string) => Promise<number>,
  options: AudioWaveformOptions = {},
): Promise<AudioWaveformResult> {
  const resolvedAudioPath = path.resolve(audioPath);
  const sampleCount = clampAudioWaveformSampleCount(options.sampleCount);

  let statSignature = { size: 0, mtimeMs: 0 };
  try {
    const audioStat = await fs.stat(resolvedAudioPath);
    statSignature = {
      size: audioStat.size,
      mtimeMs: audioStat.mtimeMs,
    };
  } catch (error) {
    log.warn('[Audio Waveform] Failed to stat audio file:', {
      audioPath: resolvedAudioPath,
      error,
    });
  }

  const cacheKey = buildWaveformCacheKey({
    audioPath: resolvedAudioPath,
    sampleCount,
    ...statSignature,
  });

  const cachedWaveform = audioWaveformCache.get(cacheKey);
  if (cachedWaveform) {
    return cachedWaveform;
  }

  const pendingWaveform = pendingAudioWaveformRequests.get(cacheKey);
  if (pendingWaveform) {
    return pendingWaveform;
  }

  const loadPromise = (async () => {
    const [duration, peaks] = await Promise.all([
      getAudioDuration(resolvedAudioPath),
      extractAudioWaveformPeaks(resolvedAudioPath, sampleCount).catch((error) => {
        log.warn('[Audio Waveform] Failed to extract peaks:', {
          audioPath: resolvedAudioPath,
          error,
        });
        return [];
      }),
    ]);

    const result = {
      peaks,
      duration,
    };

    audioWaveformCache.set(cacheKey, result);
    return result;
  })();

  pendingAudioWaveformRequests.set(cacheKey, loadPromise);

  try {
    return await loadPromise;
  } finally {
    pendingAudioWaveformRequests.delete(cacheKey);
  }
}
