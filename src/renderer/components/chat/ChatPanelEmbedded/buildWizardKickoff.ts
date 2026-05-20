interface BuildWizardKickoffArgs {
  projectDir: string;
  projectName: string;
  templateId: string;
  style: string;
  duration: number;
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

  const lines = [
    `Create a new dhee project named "${args.projectName}" in the existing folder ${args.projectDir}.`,
    `Use the ${args.templateId} template with ${args.style} style for ${args.duration} seconds.`,
    '',
    'Story:',
    trimmedStory,
    '',
    'Pass the absolute folder path as `existingDir` to dhee_new so the project is created in place rather than under the default projects directory.',
  ];

  return { message: lines.join('\n') };
}
