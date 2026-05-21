/**
 * Build the first user-facing message dispatched into chat after the
 * New Project wizard completes.
 *
 * By the time this runs:
 *   - The wizard has already called `dhee.setup-project` IPC, which
 *     wrote `project.json` with `style`, `templateId`, `duration`.
 *   - The project folder exists on disk.
 *   - The active-project announcement (in `projectAnnouncement.ts`)
 *     injects "Active project: <name>" into the agent's task so the
 *     model already knows which project it's working on.
 *   - The pi-orchestrator skill prompt (`prompts/system/pi-orchestrator.md`)
 *     documents `dhee_new` / `existingDir` / `dhee_run_to` semantics.
 *
 * So the kickoff message does NOT need to repeat any of that. The user
 * sees a clean chat starting with their own story. The agent has
 * everything it needs to save the story and start the pipeline.
 *
 * Returns an empty message when no story is provided — the caller
 * short-circuits the dispatch in that case.
 */
interface BuildWizardKickoffArgs {
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

  return {
    message: `${trimmedStory}\n\nSave this as the project input and start the pipeline.`,
  };
}
