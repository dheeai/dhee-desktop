import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import {
  jest,
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
} from '@jest/globals';

const mockSpawn = jest.fn();

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => {
      if (name === 'temp') {
        return os.tmpdir();
      }
      if (name === 'userData') {
        return path.join(os.tmpdir(), 'dhee-word-caption-tests');
      }
      return os.tmpdir();
    },
  },
}));

jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

jest.mock('@ffmpeg-installer/ffmpeg', () => ({
  __esModule: true,
  default: { path: '/tmp/ffmpeg' },
}));

jest.mock('@ffprobe-installer/ffprobe', () => ({
  __esModule: true,
  default: { path: '/tmp/ffprobe' },
}));

jest.mock('@ts-ffmpeg/fluent-ffmpeg', () => {
  const ffmpeg = jest.fn(() => ({
    audioChannels: jest.fn().mockReturnThis(),
    audioFrequency: jest.fn().mockReturnThis(),
    audioCodec: jest.fn().mockReturnThis(),
    format: jest.fn().mockReturnThis(),
    output: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
    run: jest.fn(),
  }));
  Object.assign(ffmpeg, {
    setFfmpegPath: jest.fn(),
    setFfprobePath: jest.fn(),
    ffprobe: jest.fn(),
  });
  return {
    __esModule: true,
    default: ffmpeg,
  };
});

import { __private__ } from './wordCaptionService';

type FakeChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: jest.Mock;
};

function createFakeChildProcess(): FakeChildProcess {
  const child = new EventEmitter() as FakeChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  return child;
}

describe('wordCaptionService', () => {
  let tempRoot: string;

  beforeEach(async () => {
    mockSpawn.mockReset();
    tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'word-caption-service-'),
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('uses the provided writable output base path for whisper JSON output', async () => {
    const whisperPath = path.join(tempRoot, 'whisper-cpp');
    const outputBasePath = path.join(tempRoot, 'captions', 'whisper-output');
    const outputJsonPath = `${outputBasePath}.json`;
    const inputPath = path.join(tempRoot, 'input.wav');
    const modelPath = path.join(whisperPath, 'ggml-tiny.en.bin');
    const executablePath = path.join(whisperPath, 'main');

    await fs.mkdir(path.dirname(outputBasePath), { recursive: true });
    await fs.mkdir(whisperPath, { recursive: true });
    await fs.writeFile(inputPath, 'wav', 'utf-8');
    await fs.writeFile(modelPath, 'model', 'utf-8');
    await fs.writeFile(executablePath, 'bin', 'utf-8');

    mockSpawn.mockImplementation((spawnedExecutable, args) => {
      const child = createFakeChildProcess();
      const executable = spawnedExecutable as string;
      const spawnArgs = args as string[];

      setTimeout(async () => {
        await fs.writeFile(
          outputJsonPath,
          JSON.stringify({ transcription: [] }),
          'utf-8',
        );
        expect(executable).toBe(executablePath);
        expect(spawnArgs).toContain('--output-file');
        expect(spawnArgs).toContain(outputBasePath);
        expect(spawnArgs).not.toContain(path.join(process.cwd(), 'tmp'));
        child.emit('exit', 0, null);
      }, 0);

      return child;
    });

    const result = await __private__.runWhisperTranscription({
      inputPath,
      whisperPath,
      model: 'tiny.en',
      tokenLevelTimestamps: true,
      splitOnWord: true,
      printOutput: false,
      outputBasePath,
    });

    expect(result).toEqual({ transcription: [] });
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });
});
