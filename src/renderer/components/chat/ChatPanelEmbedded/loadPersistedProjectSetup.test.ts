import { describe, expect, it, jest } from '@jest/globals';
import { loadPersistedProjectSetup } from './loadPersistedProjectSetup';

function reader(content: string | null) {
  return {
    readFile: jest.fn(async () => content) as (p: string) => Promise<string | null>,
  };
}

describe('loadPersistedProjectSetup', () => {
  it('returns null when projectDirectory is empty', async () => {
    const r = reader('{}');
    expect(await loadPersistedProjectSetup('', r)).toBeNull();
  });

  it('returns null when the file is missing (reader returns null)', async () => {
    const r = reader(null);
    const result = await loadPersistedProjectSetup('/x/y', r);
    expect(result).toBeNull();
  });

  it('returns null when the file is malformed JSON', async () => {
    const r = reader('not-json');
    expect(await loadPersistedProjectSetup('/x/y', r)).toBeNull();
  });

  it('returns null when style is empty (the desktop stub case)', async () => {
    // NewProjectDialog → ProjectService.createProject writes a stub
    // project.json with style="". That MUST be treated as "not yet
    // configured" so the wizard pops.
    const r = reader(
      JSON.stringify({
        id: 'p',
        title: 'p',
        templateId: 'narrative',
        style: '',
        targetDuration: 60,
      }),
    );
    expect(await loadPersistedProjectSetup('/x/y', r)).toBeNull();
  });

  it('returns null when templateId is missing', async () => {
    const r = reader(
      JSON.stringify({ style: 'anime', targetDuration: 60 }),
    );
    expect(await loadPersistedProjectSetup('/x/y', r)).toBeNull();
  });

  it('returns null when duration is missing entirely', async () => {
    const r = reader(
      JSON.stringify({ templateId: 'narrative', style: 'anime' }),
    );
    expect(await loadPersistedProjectSetup('/x/y', r)).toBeNull();
  });

  it('returns the populated setup when all three fields are valid', async () => {
    const r = reader(
      JSON.stringify({
        templateId: 'narrative',
        style: 'cinematic_realism',
        targetDuration: 60,
      }),
    );
    const result = await loadPersistedProjectSetup('/x/y', r);
    expect(result).toEqual({
      templateId: 'narrative',
      style: 'cinematic_realism',
      duration: 60,
      autonomousMode: false,
    });
  });

  it('falls back to "duration" when "targetDuration" is absent', async () => {
    const r = reader(
      JSON.stringify({
        templateId: 'narrative',
        style: 'anime',
        duration: 90,
      }),
    );
    const result = await loadPersistedProjectSetup('/x/y', r);
    expect(result?.duration).toBe(90);
  });

  it('preserves autonomousMode when set to true', async () => {
    const r = reader(
      JSON.stringify({
        templateId: 'narrative',
        style: 'anime',
        targetDuration: 60,
        autonomousMode: true,
      }),
    );
    const result = await loadPersistedProjectSetup('/x/y', r);
    expect(result?.autonomousMode).toBe(true);
  });

  it('returns null when the reader throws', async () => {
    const r = {
      readFile: jest.fn(async () => {
        throw new Error('disk error');
      }) as (p: string) => Promise<string | null>,
    };
    expect(await loadPersistedProjectSetup('/x/y', r)).toBeNull();
  });
});
