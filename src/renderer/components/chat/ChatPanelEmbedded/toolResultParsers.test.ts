import { describe, it, expect } from '@jest/globals';
import { parseStatusCounts, parseVersionList } from './toolResultParsers';

describe('parseStatusCounts', () => {
  it('parses the dhee_get_status counts block', () => {
    const text = [
      'Project: /x',
      '',
      'Status counts:',
      '  pending:     11',
      '  in_progress: 1',
      '  completed:   28',
      '  failed:      0',
      '',
      'In progress (run is active):',
      '  - shot_image:scene_1_shot_3',
    ].join('\n');
    expect(parseStatusCounts(text)).toEqual({
      pending: 11,
      inProgress: 1,
      completed: 28,
      failed: 0,
      total: 40,
    });
  });

  it('returns null when no counts block is present', () => {
    expect(parseStatusCounts('project.json not found at /x')).toBeNull();
    expect(parseStatusCounts('')).toBeNull();
  });
});

describe('parseVersionList', () => {
  it('parses dhee_list_versions lines with selection, tool and cost', () => {
    const text = [
      'Versions for shot_07 (3 candidates):',
      '★ v3           via ltx_director $0.0400 → /a/v3.png',
      '  v2           via ltx_director $0.0400 → /a/v2.png',
      '  v1           via flux_still $0.0200 → /a/v1.png',
    ].join('\n');
    const versions = parseVersionList(text);
    expect(versions).toHaveLength(3);
    expect(versions[0]).toMatchObject({
      id: 'v3',
      selected: true,
      tool: 'ltx_director',
      cost: '$0.0400',
    });
    expect(versions[1].selected).toBe(false);
    expect(versions[2].tool).toBe('flux_still');
  });

  it('handles a version line with no cost', () => {
    const v = parseVersionList('★ v1           via comfy → /a/v1.png');
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ id: 'v1', selected: true, tool: 'comfy' });
    expect(v[0].cost).toBeUndefined();
  });

  it('returns empty for the no-versions message', () => {
    expect(parseVersionList('No versions yet for shot_07.')).toEqual([]);
    expect(parseVersionList('')).toEqual([]);
  });
});
