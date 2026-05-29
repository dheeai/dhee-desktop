import { describe, expect, it } from '@jest/globals';
import { buildWizardKickoff } from './buildWizardKickoff';

describe('buildWizardKickoff', () => {
  const baseArgs = {
    projectName: 'Better Image',
    projectDir: '/Users/dev/dhee-studios/Better Image',
    templateId: 'narrative',
    style: 'anime',
    duration: 60,
    story: 'A story about two characters on an observation deck.',
  };

  it('returns display text for the user and a minimal pipeline task for the agent', () => {
    const result = buildWizardKickoff(baseArgs);
    expect(result.displayText).toBe(
      'A story about two characters on an observation deck.',
    );
    expect(result.agentTask).toMatch(
      /Run the pipeline for the current project/i,
    );
    expect(result.agentTask).toContain('dhee_run_to');
  });

  it('does not leak project setup metadata into the user-visible text', () => {
    const { displayText } = buildWizardKickoff({
      ...baseArgs,
      referenceImages: [
        {
          name: 'field.png',
          relativePath: 'assets/uploads/settings/field.png',
          purpose: 'setting_ref',
          referenceRole: 'setting',
          sourcePath: '/Users/me/Desktop/field.png',
          originalFilename: 'field.png',
          mimeType: 'image/png',
          size: 4,
        },
      ],
    });

    expect(displayText).toBe(baseArgs.story);
    expect(displayText).not.toContain('dhee_new');
    expect(displayText).not.toContain('existingDir');
    expect(displayText).not.toContain('referenceImages');
    expect(displayText).not.toContain('/Users/me/Desktop/field.png');
  });

  it('returns empty fields when story is blank so the caller can short-circuit', () => {
    expect(buildWizardKickoff({ ...baseArgs, story: '' })).toEqual({
      displayText: '',
      agentTask: '',
    });
    expect(buildWizardKickoff({ ...baseArgs, story: '   \n\t  ' })).toEqual({
      displayText: '',
      agentTask: '',
    });
  });

  it('trims surrounding whitespace from the display text', () => {
    const { displayText } = buildWizardKickoff({
      ...baseArgs,
      story: '\n\n  A story body.  \n\n',
    });
    expect(displayText).toBe('A story body.');
  });
});
