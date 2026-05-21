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

  it('produces a single message containing all metadata the agent needs to call dhee_new', () => {
    const { message } = buildWizardKickoff(baseArgs);
    expect(message).toContain('Better Image');
    expect(message).toContain('narrative');
    expect(message).toContain('anime');
    expect(message).toContain('60');
    expect(message).toContain('/Users/dev/dhee-studios/Better Image');
    expect(message).toContain('existingDir');
    expect(message).toContain('A story about two characters');
  });

  it('returns an empty message when story is blank — caller short-circuits the dispatch', () => {
    expect(buildWizardKickoff({ ...baseArgs, story: '' }).message).toBe('');
    expect(buildWizardKickoff({ ...baseArgs, story: '   \n\t  ' }).message).toBe('');
  });

  it('trims surrounding whitespace from the story before embedding', () => {
    const { message } = buildWizardKickoff({
      ...baseArgs,
      story: '\n\n  A story body.  \n\n',
    });
    expect(message).toContain('A story body.');
    expect(message).not.toContain('\n\n  A story body.');
  });

  it('ends with a clear instruction to start the pipeline so the agent knows to dispatch dhee_run_to', () => {
    const { message } = buildWizardKickoff(baseArgs);
    expect(message).toMatch(/start the pipeline/i);
  });

  it('handles names / paths containing spaces correctly', () => {
    const { message } = buildWizardKickoff({
      ...baseArgs,
      projectName: 'Better Image V2',
      projectDir: '/Users/dev/my projects/Better Image V2',
    });
    expect(message).toContain('"Better Image V2"');
    expect(message).toContain('/Users/dev/my projects/Better Image V2');
  });
});
