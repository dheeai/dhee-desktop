import type {
  Runner,
  RunnerManifest,
} from '@dheeai/runner-sdk' with { 'resolution-mode': 'import' };
import { verifyAssemblyRunner } from './verifyAssembly.js';
import { ffmpegNormalizeRunner } from './ffmpegNormalize.js';
import { ffmpegReplaceAudioRunner } from './ffmpegReplaceAudio.js';

export type { RunnerContext } from '@dheeai/runner-sdk' with { 'resolution-mode': 'import' };
export {
  checkSceneIntent,
  sceneInputDigest,
  sceneIntentSchema,
  assertSceneIntent,
} from './sceneIntent.js';
export const runners: Array<{ manifest: RunnerManifest; runner: Runner }> = [
  {
    manifest: {
      tool: 'media.verify_assembly',
      version: '0.1.0',
      engineCompat: '>=0.1.0',
      credentials: [],
      displayName: 'Check assembled picture and narration',
    },
    runner: verifyAssemblyRunner,
  },
  {
    manifest: {
      tool: 'ffmpeg.normalize',
      version: '0.1.0',
      engineCompat: '>=0.1.0',
      credentials: [],
      displayName: 'Normalize clip',
    },
    runner: ffmpegNormalizeRunner,
  },
  {
    manifest: {
      tool: 'ffmpeg.replace_audio',
      version: '0.1.0',
      engineCompat: '>=0.1.0',
      credentials: [],
      displayName: 'Preserve selected narration',
    },
    runner: ffmpegReplaceAudioRunner,
  },
];
export {
  executeProductionRequest,
  createDesktopProductionControl,
  configureProductionRuntime,
} from './control.js';
