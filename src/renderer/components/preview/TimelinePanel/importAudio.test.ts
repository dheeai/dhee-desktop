import { describe, expect, it, jest } from '@jest/globals';
import { importAudioFromFileToProject } from './importAudio';

describe('importAudioFromFileToProject', () => {
  it('copies selected audio and returns manifest-friendly metadata', async () => {
    const callOrder: string[] = [];

    const projectBridge = {
      selectAudioFile: jest.fn(async () => {
        callOrder.push('select');
        return '/tmp/voice.mp3';
      }),
      createFolder: jest.fn(async (basePath: string, relativePath: string) => {
        callOrder.push(`mkdir:${basePath}:${relativePath}`);
        return `${basePath}/${relativePath}`;
      }),
      copy: jest.fn(async () => {
        callOrder.push('copy');
        return '/project/assets/audio/voice.mp3';
      }),
    };

    const imported = await importAudioFromFileToProject({
      projectDirectory: '/project',
      projectBridge,
    });

    expect(imported).toEqual({
      sourcePath: '/tmp/voice.mp3',
      destinationPath: '/project/assets/audio/voice.mp3',
      relativePath: 'assets/audio/voice.mp3',
      fileName: 'voice.mp3',
    });
    // PROJECT_PATHS.AGENT_AUDIO is `assets/audio`, so we mkdir
    // `assets` then `audio` — two levels, not three.
    expect(projectBridge.createFolder).toHaveBeenCalledTimes(2);
    expect(projectBridge.copy).toHaveBeenCalledWith(
      '/tmp/voice.mp3',
      '/project/assets/audio',
    );
    expect(callOrder[callOrder.length - 1]).toBe('copy');
  });

  it('returns false when the user does not select an audio file', async () => {
    const projectBridge = {
      selectAudioFile: jest.fn(async () => null),
      createFolder: jest.fn(async () => null),
      copy: jest.fn(async () => ''),
    };
    const imported = await importAudioFromFileToProject({
      projectDirectory: '/project',
      projectBridge,
    });

    expect(imported).toBeNull();
    expect(projectBridge.createFolder).not.toHaveBeenCalled();
    expect(projectBridge.copy).not.toHaveBeenCalled();
  });
});
