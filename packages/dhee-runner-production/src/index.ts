import type {
  Runner,
  RunnerManifest,
} from '@dheeai/runner-sdk' with { 'resolution-mode': 'import' };
import { voiceQualityRunner } from './voiceQualityRunner.js';
import { continuityPreflightRunner } from './continuityRunner.js';
import { prepareNarrationRunner } from './prepareNarration.js';
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
      tool: 'audio.check_voice',
      version: '0.1.0',
      engineCompat: '>=0.1.0',
      credentials: [],
      displayName: 'Check voice audition',
    },
    runner: voiceQualityRunner,
  },
  {
    manifest: {
      tool: 'production.continuity_preflight',
      version: '0.1.0',
      engineCompat: '>=0.1.0',
      credentials: [],
      displayName: 'Check continuity constraints',
    },
    runner: continuityPreflightRunner,
  },
  {
    manifest: {
      tool: 'audio.prepare_narration',
      version: '0.1.0',
      engineCompat: '>=0.1.0',
      credentials: [],
      displayName: 'Prepare approved narration',
    },
    runner: prepareNarrationRunner,
  },
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
