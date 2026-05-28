/**
 * Build the first user-facing message dispatched into chat after the
 * New Project wizard completes.
 *
 * The agent receives this message, recognizes it as a project-creation
 * task, and calls `dhee_new` with the metadata it needs:
 *   - `name`         ← projectName
 *   - `template`     ← templateId
 *   - `style`        ← style
 *   - `duration`     ← duration
 *   - `renderMethod` ← renderMethod (which dispatcher path the project
 *                     uses; persists to project.json)
 *   - `bundleSource` ← desktop-resolved bundle id (e.g.
 *                     "built-in:narrative_qwen_chain_relay"). The
 *                     desktop is the source of truth for the
 *                     renderMethod→bundle mapping (see
 *                     RENDER_METHOD_TO_BUNDLE_SOURCE in wizardCatalog.ts),
 *                     so pi-agent doesn't have to infer or recompute it.
 *   - `input`        ← story
 *   - `existingDir`  ← projectDir (so dhee_new creates in-place, not in
 *                     the default projects directory)
 *
 * As of the System-B removal refactor, this is the SOLE path that
 * writes `project.json`. The renderer no longer pre-stubs the file
 * via `ProjectService.createProject`, and the WS `configure_project`
 * handler is no longer called from the wizard. If `dhee_new` doesn't
 * run (LLM unavailable, etc.), no project.json exists — which is fine,
 * since nothing downstream can proceed without LLM access anyway.
 *
 * Returns an empty message when no story is provided — the caller
 * short-circuits the dispatch in that case.
 */
import { RENDER_METHOD_TO_BUNDLE_SOURCE } from './wizardCatalog';

interface BuildWizardKickoffArgs {
  projectName: string;
  projectDir: string;
  templateId: string;
  style: string;
  duration: number;
  /** Render method (shot_by_shot | prompt_relay | qwen_chain). Value must come from kshana-core's RenderMethod registry. */
  renderMethod: string;
  story: string;
}

interface BuildWizardKickoffResult {
  message: string;
}

export function buildWizardKickoff(
  args: BuildWizardKickoffArgs,
): BuildWizardKickoffResult {
  const trimmedStory = args.story.trim();
  if (!trimmedStory) {
    return { message: '' };
  }

  const bundleSource =
    RENDER_METHOD_TO_BUNDLE_SOURCE[args.renderMethod] ?? `built-in:narrative_${args.renderMethod}`;

  const lines = [
    `Create the dhee project "${args.projectName}" with these settings:`,
    `- Template: ${args.templateId}`,
    `- Style: ${args.style}`,
    `- Duration: ${args.duration} seconds`,
    `- Render method: ${args.renderMethod}`,
    `- Bundle source: ${bundleSource}`,
    `- Folder: ${args.projectDir} (pass as existingDir)`,
    '',
    'Story:',
    trimmedStory,
    '',
    `Call dhee_new with renderMethod="${args.renderMethod}" and bundleSource="${bundleSource}" along with the settings above. Then start the pipeline.`,
  ];

  return { message: lines.join('\n') };
}
