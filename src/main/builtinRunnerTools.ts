/**
 * Tool ids dhee-core registers built-in (mirrors src/dag/runners/index.ts).
 * Bundle runnerPackages for these are skipped on npm install — only external
 * runners are pulled.
 */
export const BUILTIN_RUNNER_TOOLS = [
  'llm.generate',
  'comfy.tti',
  'comfy.fl2v',
  'comfy.klein',
  'comfy.qwen_edit_chain',
  'comfy.ltx_director',
  'ffmpeg.kenburns',
  'ffmpeg.shot_clip',
  'ffmpeg.concat',
  'vlm.judge',
] as const;
