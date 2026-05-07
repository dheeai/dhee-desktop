const fs = require('fs');
const path = require('path');

const MODEL = 'tiny.en';
const DEFAULT_WHISPER_CPP_VERSION = '1.5.5';
const MODEL_FILENAME = `ggml-${MODEL}.bin`;
const rootPath = path.resolve(__dirname, '../..');
const modelFolder = path.join(rootPath, 'assets', 'whisper-models');
const modelPath = path.join(modelFolder, MODEL_FILENAME);
const runtimeTarget = `${process.platform}-${process.arch}`;
const runtimeFolder = path.join(
  rootPath,
  'assets',
  'whisper-runtime',
  runtimeTarget,
  'whisper-cpp',
);

async function modelExistsWithContent(filePath) {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function getWhisperExecutableCandidates(whisperPath) {
  return [
    path.join(whisperPath, process.platform === 'win32' ? 'main.exe' : 'main'),
    path.join(
      whisperPath,
      'build',
      'bin',
      process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli',
    ),
  ];
}

async function hasWhisperExecutable(whisperPath) {
  const candidates = getWhisperExecutableCandidates(whisperPath);
  for (const candidate of candidates) {
    try {
      await fs.promises.access(candidate);
      return true;
    } catch {
      // Check next candidate.
    }
  }
  return false;
}

function isModelSizeMismatchError(error) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes(`model ${MODEL}`) &&
    message.includes('already exists at') &&
    message.includes('expected')
  );
}

function isBrokenWhisperRuntimeError(error) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('whisper folder') &&
    message.includes('exists but the executable')
  );
}

function isMissingContentLengthError(error) {
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes('content-length header not found');
}

async function validateOrDownloadModel(whisper) {
  try {
    const result = await whisper.downloadWhisperModel({
      folder: modelFolder,
      model: MODEL,
      printOutput: true,
    });

    if (result?.alreadyExisted) {
      console.log(`[Whisper model] validated existing ${modelPath}`);
    } else {
      console.log(`[Whisper model] downloaded ${modelPath}`);
    }
  } catch (error) {
    if (isMissingContentLengthError(error)) {
      if (await modelExistsWithContent(modelPath)) {
        console.warn(
          `[Whisper model] Download completed but validation could not determine Content-Length. Continuing with existing ${modelPath}.`,
        );
        return;
      }
    }

    if (!isModelSizeMismatchError(error)) {
      throw error;
    }

    console.log(
      `[Whisper model] Found invalid ${MODEL_FILENAME}, deleting and re-downloading...`,
    );
    await fs.promises.rm(modelPath, { force: true });
    await whisper.downloadWhisperModel({
      folder: modelFolder,
      model: MODEL,
      printOutput: true,
    });
    console.log(`[Whisper model] re-downloaded invalid ${modelPath}`);
  }
}

async function ensureBundledWhisperRuntime(whisper) {
  fs.mkdirSync(path.dirname(runtimeFolder), { recursive: true });

  const removeGitDirIfPresent = async () => {
    const gitDir = path.join(runtimeFolder, '.git');
    try {
      const stat = await fs.promises.stat(gitDir);
      if (!stat.isDirectory()) return;
    } catch {
      return;
    }

    // The packaged app should not ship with the full whisper.cpp git history.
    // Removing it prevents huge `.pack` files from being copied into extraResources.
    await fs.promises.rm(gitDir, { recursive: true, force: true });
  };

  const installRuntime = () =>
    whisper.installWhisperCpp({
      to: runtimeFolder,
      version: DEFAULT_WHISPER_CPP_VERSION,
      printOutput: true,
    });

  try {
    await installRuntime();
  } catch (error) {
    if (!isBrokenWhisperRuntimeError(error)) {
      throw error;
    }

    console.log(
      `[Whisper runtime] Found invalid runtime at ${runtimeFolder}, rebuilding...`,
    );
    await fs.promises.rm(runtimeFolder, { recursive: true, force: true });
    await installRuntime();
  }

  await removeGitDirIfPresent();

  if (!(await hasWhisperExecutable(runtimeFolder))) {
    throw new Error(
      `Whisper runtime was prepared at ${runtimeFolder}, but no executable was found.`,
    );
  }

  console.log(`[Whisper runtime] Prepared ${runtimeFolder}`);
}

async function main() {
  fs.mkdirSync(modelFolder, { recursive: true });

  const whisper = await import('@remotion/install-whisper-cpp');
  if (!whisper.downloadWhisperModel || !whisper.installWhisperCpp) {
    throw new Error(
      'Failed to load @remotion/install-whisper-cpp exports required for model/runtime preparation.',
    );
  }

  await validateOrDownloadModel(whisper);

  if (!(await modelExistsWithContent(modelPath))) {
    throw new Error(
      `Model download completed but ${MODEL_FILENAME} was not found in ${modelFolder}.`,
    );
  }
  console.log(`[Whisper model] Prepared ${modelPath}`);

  await ensureBundledWhisperRuntime(whisper);
}

main().catch((error) => {
  console.error(
    `[Whisper model] Failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
