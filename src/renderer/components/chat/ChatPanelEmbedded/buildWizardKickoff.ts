/**
 * Build the post-setup chat model after the New Project wizard
 * completes.
 *
 * Project creation is app-owned and deterministic: the renderer/main
 * process calls the typed `dhee:createProject` IPC path directly. The
 * agent sees only the small follow-up task that starts the pipeline for
 * the already-created current project.
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
  displayText: string;
  agentTask: string;
}

export function buildWizardKickoff(
  args: BuildWizardKickoffArgs,
): BuildWizardKickoffResult {
  const trimmedStory = args.story.trim();
  if (!trimmedStory) {
    return { displayText: '', agentTask: '' };
  }

  const agentTask =
    'Run the pipeline for the current project to completion. Use dhee_run_to with no stage so it runs to the end. Stream progress as nodes finish.';

  return { displayText: trimmedStory, agentTask };
}
