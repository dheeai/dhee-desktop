import path from 'path';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import { app } from 'electron';
import ffmpeg from '@ts-ffmpeg/fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import type {
  downloadWhisperModel as downloadWhisperModelType,
  installWhisperCpp as installWhisperCppType,
} from '@remotion/install-whisper-cpp';

export interface WordTimestamp {
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
}

export interface GenerateWordCaptionsResult {
  success: boolean;
  outputPath?: string;
  words?: WordTimestamp[];
  error?: string;
}

interface TranscriptionTokenLike {
  text?: string;
  timestamps?: {
    from?: number | string;
    to?: number | string;
  };
  offsets?: {
    from?: number | string;
    to?: number | string;
  };
  t_dtw?: number;
}

interface TranscriptionItemLike {
  text?: string;
  tokens?: TranscriptionTokenLike[];
  timestamps?: {
    from?: number | string;
    to?: number | string;
  };
  offsets?: {
    from?: number | string;
    to?: number | string;
  };
}

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'];
const DEFAULT_MODEL = 'tiny.en';
const DEFAULT_WHISPER_CPP_VERSION = '1.5.5';
const WORD_CAPTIONS_PATH = '.dhee/agent/content/word-captions.json';
const DEFAULT_MODEL_FILENAME = `ggml-${DEFAULT_MODEL}.bin`;
const BUNDLED_MODEL_DIR = 'whisper-models';
const BUNDLED_RUNTIME_DIR = 'whisper-runtime';

// In packaged builds, binaries are in app.asar.unpacked (not inside the read-only app.asar)
let ffmpegBinaryPath = ffmpegInstaller.path;
let ffprobeBinaryPath = ffprobeInstaller.path;
if (app.isPackaged) {
  ffmpegBinaryPath = ffmpegBinaryPath.replace('app.asar', 'app.asar.unpacked');
  ffprobeBinaryPath = ffprobeBinaryPath.replace(
    'app.asar',
    'app.asar.unpacked',
  );
}
ffmpeg.setFfmpegPath(ffmpegBinaryPath);
ffmpeg.setFfprobePath(ffprobeBinaryPath);

interface WhisperInstallerModule {
  installWhisperCpp: typeof installWhisperCppType;
  downloadWhisperModel: typeof downloadWhisperModelType;
}

interface WhisperTranscriptionJson {
  transcription?: TranscriptionItemLike[];
}

interface WhisperTempLocation {
  directoryPath: string;
  outputBasePath: string;
}

const dynamicImport = new Function(
  'modulePath',
  'return import(modulePath);',
) as (modulePath: string) => Promise<unknown>;

async function loadWhisperInstallerModule(): Promise<WhisperInstallerModule> {
  const modulePath = '@remotion/install-whisper-cpp';
  const loaded = (await dynamicImport(
    modulePath,
  )) as Partial<WhisperInstallerModule>;
  if (!loaded.installWhisperCpp || !loaded.downloadWhisperModel) {
    throw new Error(
      'Whisper installer module is missing required exports. Reinstall dependencies and retry.',
    );
  }
  return loaded as WhisperInstallerModule;
}

function isLikelyBrokenWhisperInstallError(
  error: unknown,
  whisperPath: string,
): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  const normalizedPath = whisperPath.toLowerCase();
  return (
    (message.includes('whisper folder') &&
      message.includes('exists but the executable')) ||
    (message.includes('executable') && message.includes(normalizedPath)) ||
    (message.includes('missing') && message.includes(normalizedPath)) ||
    (message.includes('enoent') &&
      message.includes(normalizedPath) &&
      message.includes('main'))
  );
}

function getWhisperExecutableCandidates(whisperPath: string): string[] {
  const legacyExecutable = path.join(
    whisperPath,
    process.platform === 'win32' ? 'main.exe' : 'main',
  );
  const modernExecutable = path.join(
    whisperPath,
    'build',
    'bin',
    process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli',
  );
  return [legacyExecutable, modernExecutable];
}

async function hasWhisperExecutable(whisperPath: string): Promise<boolean> {
  const candidates = getWhisperExecutableCandidates(whisperPath);
  for (const executablePath of candidates) {
    try {
      await fs.access(executablePath);
      return true;
    } catch {
      // Continue checking candidates.
    }
  }
  return false;
}

async function ensureWhisperFolderIsUsable(whisperPath: string): Promise<void> {
  try {
    const stat = await fs.stat(whisperPath);
    if (!stat.isDirectory()) {
      await fs.rm(whisperPath, { recursive: true, force: true });
      return;
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  const executableExists = await hasWhisperExecutable(whisperPath);
  if (!executableExists) {
    await fs.rm(whisperPath, { recursive: true, force: true });
  }
}

async function setupWhisperRuntime(
  whisper: WhisperInstallerModule,
  whisperPath: string,
  options?: {
    skipModelDownload?: boolean;
    skipInstall?: boolean;
    modelDownloadFolder?: string;
  },
): Promise<void> {
  if (options?.skipInstall) {
    const executableExists = await hasWhisperExecutable(whisperPath);
    if (!executableExists) {
      throw new Error(
        `Bundled whisper runtime was selected, but no executable was found in ${whisperPath}.`,
      );
    }
  } else {
    await ensureWhisperFolderIsUsable(whisperPath);
    await whisper.installWhisperCpp({
      to: whisperPath,
      version: DEFAULT_WHISPER_CPP_VERSION,
      printOutput: true,
    });
  }

  if (!options?.skipModelDownload) {
    await whisper.downloadWhisperModel({
      folder: options?.modelDownloadFolder ?? whisperPath,
      model: DEFAULT_MODEL,
      printOutput: true,
    });
  }

  const executableExists = await hasWhisperExecutable(whisperPath);
  if (!executableExists) {
    throw new Error(
      `Whisper install completed but no executable was found in ${whisperPath}.`,
    );
  }
}

function mapCaptionGenerationError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Failed to generate word captions.';
  }

  const message = error.message.trim();
  const normalized = message.toLowerCase();

  if (normalized.includes('error while executing git clone')) {
    return 'Failed to install whisper.cpp (git clone failed). Check internet access and that Git is installed, then retry.';
  }

  if (normalized.includes('error while executing make')) {
    return 'Failed to build whisper.cpp (make failed). Install build tools (Xcode Command Line Tools on macOS) and retry.';
  }

  if (
    normalized.includes('error while executing') &&
    normalized.includes('git checkout')
  ) {
    return 'Failed while preparing whisper.cpp sources (git checkout failed). Verify Git access to github.com and retry.';
  }

  if (
    normalized.includes('output_json: failed to open') ||
    normalized.includes('/tmp.json') ||
    normalized.includes(
      'no writable temporary directory is available for whisper output',
    )
  ) {
    return 'Whisper could not write temporary transcription output, even after retrying fallback writable paths. Check temp directory permissions and retry.';
  }

  if (
    normalized.includes('does not exist at') &&
    normalized.includes('model')
  ) {
    return 'Whisper model is missing or incomplete. Retry caption generation to re-download the model.';
  }

  return message || 'Failed to generate word captions.';
}

function isMissingWhisperModelError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const normalized = error.message.toLowerCase();
  return (
    normalized.includes('does not exist at') && normalized.includes('model')
  );
}

function isLikelyWhisperProcessCrashError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const normalized = error.message.toLowerCase();
  return (
    normalized.includes('sigsegv') ||
    normalized.includes('segmentation fault') ||
    normalized.includes('signal 11') ||
    normalized.includes('exit code: 139') ||
    normalized.includes('exit code 139')
  );
}

function isWhisperOutputPathWriteError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const normalized = error.message.toLowerCase();
  return (
    normalized.includes('output_json: failed to open') ||
    normalized.includes('/tmp.json')
  );
}

async function canWriteToDirectory(directoryPath: string): Promise<boolean> {
  try {
    await fs.mkdir(directoryPath, { recursive: true });
    const probeFilePath = path.join(
      directoryPath,
      `.write-probe-${process.pid}-${Date.now()}.tmp`,
    );
    await fs.writeFile(probeFilePath, 'ok', 'utf-8');
    await fs.unlink(probeFilePath).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

async function getWhisperOutputBaseCandidates(
  projectDirectory: string,
): Promise<WhisperTempLocation[]> {
  const projectTempDir = path.join(
    projectDirectory,
    '.dhee',
    'temp',
    'captions',
  );
  const systemTempDir = path.join(app.getPath('temp'), 'dhee', 'captions');
  const userDataTempDir = path.join(
    app.getPath('userData'),
    'temp',
    'captions',
  );
  const candidateDirectories = [projectTempDir, systemTempDir, userDataTempDir];
  const writableLocations: WhisperTempLocation[] = [];
  const token = `${Date.now()}-${process.pid}`;

  for (const candidateDirectoryPath of candidateDirectories) {
    if (
      writableLocations.some(
        ({ directoryPath }) => directoryPath === candidateDirectoryPath,
      )
    ) {
      continue;
    }
    if (await canWriteToDirectory(candidateDirectoryPath)) {
      writableLocations.push({
        directoryPath: candidateDirectoryPath,
        outputBasePath: path.join(
          candidateDirectoryPath,
          `whisper-output-${token}-${writableLocations.length}`,
        ),
      });
    }
  }

  return writableLocations;
}

async function getWhisperExecutablePath(whisperPath: string): Promise<string> {
  const candidates = getWhisperExecutableCandidates(whisperPath);
  for (const executablePath of candidates) {
    try {
      await fs.access(executablePath);
      return executablePath;
    } catch {
      // Continue checking candidates.
    }
  }

  throw new Error(
    `Whisper install completed but no executable was found in ${whisperPath}.`,
  );
}

function getWhisperModelPath(modelFolder: string, model: string): string {
  return path.join(modelFolder, `ggml-${model}.bin`);
}

function getWhisperModelDtw(model: string): string {
  if (model === 'large-v3-turbo') {
    return 'large.v3.turbo';
  }
  if (model === 'large-v3') {
    return 'large.v3';
  }
  if (model === 'large-v2') {
    return 'large.v2';
  }
  if (model === 'large-v1') {
    return 'large.v1';
  }
  return model;
}

async function runWhisperTranscription(options: {
  inputPath: string;
  whisperPath: string;
  model: string;
  modelFolder?: string;
  tokenLevelTimestamps: boolean;
  splitOnWord: boolean;
  printOutput: boolean;
  outputBasePath: string;
}): Promise<WhisperTranscriptionJson> {
  const executablePath = await getWhisperExecutablePath(options.whisperPath);
  const resolvedModelFolder = options.modelFolder ?? options.whisperPath;
  const modelPath = getWhisperModelPath(resolvedModelFolder, options.model);

  try {
    await fs.access(modelPath);
  } catch {
    throw new Error(
      `Error: Model ${options.model} does not exist at ${options.modelFolder ?? modelPath}. Check out the downloadWhisperModel() API at https://www.remotion.dev/docs/install-whisper-cpp/download-whisper-model to see how to install whisper models`,
    );
  }

  const outputJsonPath = `${options.outputBasePath}.json`;
  const args = [
    '-f',
    options.inputPath,
    '--output-file',
    options.outputBasePath,
    '--output-json',
    '-ojf',
    ...(options.tokenLevelTimestamps
      ? ['--dtw', getWhisperModelDtw(options.model)]
      : []),
    '-m',
    modelPath,
    '-pp',
    ...(options.splitOnWord ? ['--split-on-word', 'true'] : []),
  ];

  await new Promise<void>((resolve, reject) => {
    const task = spawn(executablePath, args, {
      cwd: options.whisperPath,
    });
    let combinedOutput = '';
    let stderrOutput = '';

    const onData = (data: Buffer) => {
      const output = data.toString('utf-8');
      combinedOutput += output;

      // Whisper occasionally hangs after shutdown logging on macOS Metal.
      if (output.includes('ggml_metal_free: deallocating')) {
        task.kill();
      }
    };

    task.stdout?.on('data', (data: Buffer) => {
      onData(data);
      if (options.printOutput) {
        process.stdout.write(data.toString('utf-8'));
      }
    });

    task.stderr?.on('data', (data: Buffer) => {
      onData(data);
      const output = data.toString('utf-8');
      stderrOutput += output;
      if (options.printOutput) {
        process.stderr.write(output);
      }
    });

    task.on('error', (error) => {
      reject(error);
    });

    task.on('exit', (code, exitSignal) => {
      if (existsSync(outputJsonPath)) {
        resolve();
        return;
      }

      if (exitSignal) {
        reject(
          new Error(
            `Process was killed with signal ${exitSignal}: ${combinedOutput}`,
          ),
        );
        return;
      }

      if (stderrOutput.includes('must be 16 kHz')) {
        reject(
          new Error(
            'wav file must be 16 kHz - See https://www.remotion.dev/docs/webcodecs/resample-audio-16khz#on-the-server on how to convert your audio to a 16-bit, 16KHz, WAVE file',
          ),
        );
        return;
      }

      reject(
        new Error(
          `No transcription was created (process exited with code ${code}): ${combinedOutput}`,
        ),
      );
    });
  });

  try {
    return JSON.parse(
      await fs.readFile(outputJsonPath, 'utf-8'),
    ) as WhisperTranscriptionJson;
  } finally {
    await fs.unlink(outputJsonPath).catch(() => undefined);
  }
}

async function transcribeWithOutputPathRetry(
  options: {
    inputPath: string;
    whisperPath: string;
    model: string;
    modelFolder?: string;
    tokenLevelTimestamps: boolean;
    splitOnWord: boolean;
    printOutput: boolean;
  },
  outputBaseCandidates: string[],
): Promise<WhisperTranscriptionJson> {
  if (outputBaseCandidates.length === 0) {
    throw new Error(
      'No writable temporary directory is available for whisper output.',
    );
  }

  let lastError: unknown = null;
  for (let index = 0; index < outputBaseCandidates.length; index += 1) {
    const outputBasePath = outputBaseCandidates[index];
    try {
      return await runWhisperTranscription({
        ...options,
        outputBasePath,
      });
    } catch (error) {
      lastError = error;
      const shouldRetryWithFallbackPath =
        index < outputBaseCandidates.length - 1 &&
        isWhisperOutputPathWriteError(error);
      if (!shouldRetryWithFallbackPath) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error('Whisper transcription failed.');
}

async function getBundledWhisperModelFolder(): Promise<string | null> {
  if (!app.isPackaged) {
    return null;
  }

  const candidates = [
    path.join(process.resourcesPath, 'assets', BUNDLED_MODEL_DIR),
    path.join(process.resourcesPath, BUNDLED_MODEL_DIR),
  ];

  for (const folder of candidates) {
    try {
      await fs.access(path.join(folder, DEFAULT_MODEL_FILENAME));
      return folder;
    } catch {
      // Continue checking candidates.
    }
  }

  return null;
}

async function getBundledWhisperRuntimePath(): Promise<string | null> {
  if (!app.isPackaged) {
    return null;
  }

  const runtimeTarget = `${process.platform}-${process.arch}`;
  const candidates = [
    path.join(
      process.resourcesPath,
      'assets',
      BUNDLED_RUNTIME_DIR,
      runtimeTarget,
      'whisper-cpp',
    ),
    path.join(
      process.resourcesPath,
      BUNDLED_RUNTIME_DIR,
      runtimeTarget,
      'whisper-cpp',
    ),
  ];

  for (const folder of candidates) {
    if (await hasWhisperExecutable(folder)) {
      return folder;
    }
  }

  return null;
}

function sanitizeWord(word: WordTimestamp): WordTimestamp | null {
  const text = word.text.trim();
  if (!text) return null;
  if (isWhisperControlToken(text)) return null;
  if (!Number.isFinite(word.startTime) || !Number.isFinite(word.endTime)) {
    return null;
  }
  const startTime = Math.max(0, word.startTime);
  const endTime = Math.max(startTime + 0.01, word.endTime);
  return {
    text,
    startTime,
    endTime,
    confidence: word.confidence,
  };
}

function normalizeInputPath(projectDirectory: string, rawPath: string): string {
  let stripped = rawPath.replace(/^file:\/\/\/?/, '');
  if (/^\/[A-Za-z]:/.test(stripped)) {
    stripped = stripped.slice(1);
  }
  if (path.isAbsolute(stripped)) return stripped;
  return path.join(projectDirectory, stripped);
}

function isWhisperControlToken(text: string): boolean {
  return /^\[_[A-Z]+(?:_[0-9]+)?_?\]$/.test(text);
}

function parseClockTimestampToMilliseconds(value: string): number | null {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4].padEnd(3, '0'));

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    !Number.isFinite(milliseconds)
  ) {
    return null;
  }

  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
}

function timestampToMilliseconds(
  value: number | string | undefined,
): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsedClock = parseClockTimestampToMilliseconds(value);
    if (parsedClock !== null) {
      return parsedClock;
    }

    const parsedNumber = Number(value);
    if (Number.isFinite(parsedNumber)) {
      return parsedNumber;
    }
  }
  return null;
}

function millisecondsToSeconds(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return value / 1000;
}

async function getAudioDurationSeconds(audioPath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(audioPath, (error, metadata) => {
      if (error) {
        resolve(0);
        return;
      }
      resolve(metadata?.format?.duration ?? 0);
    });
  });
}

async function pickLongestAudio(
  projectDirectory: string,
): Promise<string | null> {
  const audioDir = path.join(projectDirectory, '.dhee', 'agent', 'audio');
  let entries: string[] = [];
  try {
    entries = await fs.readdir(audioDir);
  } catch {
    return null;
  }

  let bestPath: string | null = null;
  let bestDuration = -1;

  for (const filename of entries) {
    const fullPath = path.join(audioDir, filename);
    const ext = path.extname(filename).toLowerCase();
    if (!AUDIO_EXTENSIONS.includes(ext)) continue;
    const duration = await getAudioDurationSeconds(fullPath);
    if (duration > bestDuration) {
      bestDuration = duration;
      bestPath = fullPath;
    }
  }

  return bestPath;
}

async function normalizeAudioForWhisper(
  sourceAudioPath: string,
  tempOutputPath: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ffmpeg(sourceAudioPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('pcm_s16le')
      .format('wav')
      .output(tempOutputPath)
      .on('end', () => resolve())
      .on('error', (error) => reject(error))
      .run();
  });
}

function extractWordsFromItems(
  items: TranscriptionItemLike[],
): WordTimestamp[] {
  const result: WordTimestamp[] = [];

  items.forEach((item) => {
    const itemStartMs = timestampToMilliseconds(
      item.offsets?.from ?? item.timestamps?.from,
    );
    const itemEndMs = timestampToMilliseconds(
      item.offsets?.to ?? item.timestamps?.to,
    );

    if (Array.isArray(item.tokens) && item.tokens.length > 0) {
      item.tokens.forEach((token) => {
        const tokenText = token.text?.trim();
        const tokenStartMs = timestampToMilliseconds(
          token.offsets?.from ?? token.timestamps?.from,
        );
        const tokenEndMs = timestampToMilliseconds(
          token.offsets?.to ?? token.timestamps?.to,
        );
        if (!tokenText || tokenStartMs === null || tokenEndMs === null) return;
        result.push({
          text: tokenText,
          startTime: millisecondsToSeconds(tokenStartMs),
          endTime: millisecondsToSeconds(tokenEndMs),
        });
      });
      return;
    }

    const text = item.text?.trim();
    if (!text || itemStartMs === null || itemEndMs === null) return;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return;

    const itemStartSec = millisecondsToSeconds(itemStartMs);
    const itemEndSec = Math.max(
      itemStartSec + 0.05,
      millisecondsToSeconds(itemEndMs),
    );
    const chunkDuration = (itemEndSec - itemStartSec) / words.length;

    words.forEach((word, index) => {
      const startTime = itemStartSec + chunkDuration * index;
      const endTime = Math.max(startTime + 0.01, startTime + chunkDuration);
      result.push({
        text: word,
        startTime,
        endTime,
      });
    });
  });

  const sanitized: WordTimestamp[] = [];
  let previousEnd = 0;
  result
    .map(sanitizeWord)
    .filter((word): word is WordTimestamp => word !== null)
    .sort((a, b) => a.startTime - b.startTime)
    .forEach((word) => {
      const startTime = Math.max(previousEnd, word.startTime);
      const endTime = Math.max(startTime + 0.01, word.endTime);
      sanitized.push({
        ...word,
        startTime,
        endTime,
      });
      previousEnd = endTime;
    });

  return sanitized;
}

export async function generateWordCaptions(
  projectDirectory: string,
  audioPath?: string,
): Promise<GenerateWordCaptionsResult> {
  let normalizedAudioPath: string | null = null;
  try {
    const selectedAudioPath = audioPath
      ? normalizeInputPath(projectDirectory, audioPath)
      : await pickLongestAudio(projectDirectory);

    if (!selectedAudioPath) {
      return {
        success: false,
        error: 'No audio track found to transcribe.',
      };
    }

    await fs.access(selectedAudioPath);

    const userWhisperPath = path.join(app.getPath('userData'), 'whisper-cpp');
    const whisperTempLocations =
      await getWhisperOutputBaseCandidates(projectDirectory);
    if (whisperTempLocations.length === 0) {
      throw new Error(
        'No writable temporary directory is available for whisper output.',
      );
    }
    normalizedAudioPath = path.join(
      whisperTempLocations[0].directoryPath,
      `caption-input-${Date.now()}.wav`,
    );
    const whisperOutputBaseCandidates = whisperTempLocations.map(
      ({ outputBasePath }) => outputBasePath,
    );

    await normalizeAudioForWhisper(selectedAudioPath, normalizedAudioPath);

    const whisper = await loadWhisperInstallerModule();
    let transcription: WhisperTranscriptionJson | null = null;
    let modelFolder = await getBundledWhisperModelFolder();
    const bundledWhisperPath = await getBundledWhisperRuntimePath();
    let whisperPath = bundledWhisperPath ?? userWhisperPath;
    let retryWithFreshUserRuntime = false;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (attempt === 1 && retryWithFreshUserRuntime) {
          whisperPath = userWhisperPath;
          await fs.rm(userWhisperPath, { recursive: true, force: true });
        } else if (attempt === 1 && whisperPath === userWhisperPath) {
          await fs.rm(userWhisperPath, { recursive: true, force: true });
        }

        await setupWhisperRuntime(whisper, whisperPath, {
          skipModelDownload: Boolean(modelFolder),
          skipInstall: Boolean(
            bundledWhisperPath && whisperPath === bundledWhisperPath,
          ),
          modelDownloadFolder: userWhisperPath,
        });

        const fallbackModelFolder =
          modelFolder ??
          (bundledWhisperPath && whisperPath === bundledWhisperPath
            ? userWhisperPath
            : null);
        transcription = await transcribeWithOutputPathRetry(
          {
            inputPath: normalizedAudioPath,
            whisperPath,
            model: DEFAULT_MODEL,
            modelFolder: fallbackModelFolder ?? undefined,
            tokenLevelTimestamps: true,
            splitOnWord: true,
            printOutput: true,
          },
          whisperOutputBaseCandidates,
        );
        break;
      } catch (error) {
        const bundledModelFailed =
          attempt === 0 &&
          Boolean(modelFolder) &&
          isMissingWhisperModelError(error);
        if (bundledModelFailed) {
          modelFolder = null;
          continue;
        }

        const bundledModelCrashed =
          attempt === 0 &&
          Boolean(modelFolder) &&
          isLikelyWhisperProcessCrashError(error);
        if (bundledModelCrashed) {
          modelFolder = null;
          continue;
        }

        const shouldRetry =
          attempt === 0 &&
          isLikelyBrokenWhisperInstallError(error, whisperPath);
        if (!shouldRetry) {
          throw error;
        }

        if (whisperPath !== userWhisperPath) {
          retryWithFreshUserRuntime = true;
        }
      }
    }

    if (!transcription) {
      throw new Error('Whisper setup failed after retry.');
    }

    const words = extractWordsFromItems(
      (transcription.transcription as TranscriptionItemLike[]) ?? [],
    );
    if (words.length === 0) {
      return {
        success: false,
        error: 'Whisper did not return word-level timestamps.',
      };
    }

    const outputPath = path.join(projectDirectory, WORD_CAPTIONS_PATH);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(
      outputPath,
      JSON.stringify(
        {
          model: DEFAULT_MODEL,
          generatedAt: Date.now(),
          audioPath: selectedAudioPath,
          words,
        },
        null,
        2,
      ),
      'utf-8',
    );

    await fs.unlink(normalizedAudioPath).catch(() => undefined);

    return {
      success: true,
      outputPath,
      words,
    };
  } catch (error) {
    return {
      success: false,
      error: mapCaptionGenerationError(error),
    };
  } finally {
    if (normalizedAudioPath) {
      await fs.unlink(normalizedAudioPath).catch(() => undefined);
    }
  }
}

export const __private__ = {
  mapCaptionGenerationError,
  runWhisperTranscription,
};
