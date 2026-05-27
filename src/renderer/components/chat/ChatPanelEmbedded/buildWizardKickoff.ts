/**
 * Build the first user-facing message dispatched into chat after the
 * New Project wizard completes.
 *
 * The agent receives this message, recognizes it as a project-creation
 * task, and calls `dhee_new` with the metadata it needs:
 *   - `name`     ← projectName
 *   - `template` ← templateId
 *   - `style`    ← style
 *   - `duration` ← duration
 *   - `input`    ← story
 *   - `existingDir` ← projectDir (so dhee_new creates in-place, not in
 *                    the default projects directory)
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
interface BuildWizardKickoffArgs {
  projectName: string;
  projectDir: string;
  templateId: string;
  style: string;
  duration: number;
  story: string;
  characterReferenceImages?: Array<{
    name: string;
    relativePath: string;
    sourcePath?: string;
    originalFilename?: string;
    mimeType?: string;
    size?: number;
  }>;
  referenceImages?: Array<{
    name: string;
    relativePath: string;
    purpose: 'character_ref' | 'setting_ref' | 'reference_general';
    referenceRole: 'auto' | 'character' | 'setting';
    sourcePath?: string;
    originalFilename?: string;
    mimeType?: string;
    size?: number;
  }>;
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

  const lines = [
    `Create the dhee project "${args.projectName}" with these settings:`,
    `- Template: ${args.templateId}`,
    `- Style: ${args.style}`,
    `- Duration: ${args.duration} seconds`,
    `- Folder: ${args.projectDir} (pass as existingDir)`,
    '',
    'Story:',
    trimmedStory,
  ];

  const referenceImages =
    args.referenceImages ??
    args.characterReferenceImages?.map((image) => ({
      ...image,
      purpose: 'character_ref' as const,
      referenceRole: 'character' as const,
    }));

  if (referenceImages && referenceImages.length > 0) {
    lines.push(
      '',
      'Pass these copied project-local reference images exactly as the dhee_new referenceImages parameter, not characterReferenceImages:',
      JSON.stringify(referenceImages, null, 2),
    );
  }

  lines.push('', 'Then start the pipeline.');

  return { message: lines.join('\n') };
}
