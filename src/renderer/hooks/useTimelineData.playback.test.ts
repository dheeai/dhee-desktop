import { describe, expect, it, jest } from '@jest/globals';
import {
  collectAudioFilesWithDuration,
  getTimelineFileState,
} from './useTimelineData';

/**
 * Covers the timeline *source-derivation* gate (getTimelineFileState) and the
 * audio-duration fallback policy (collectAudioFilesWithDuration). These are the
 * pure functions that decide (a) whether the UI renders a real server timeline
 * vs. an empty/error state, and (b) what duration each audio track resolves to
 * when probing fails. The existing server-timeline test only exercised two of
 * getTimelineFileState's branches (null content, malformed JSON) — this fills
 * the structural-validation branches and the happy path.
 */

describe('getTimelineFileState — timeline source derivation', () => {
  it('reports "none" with no error when content is null', () => {
    expect(getTimelineFileState(null)).toEqual({
      source: 'none',
      timeline: null,
      error: null,
    });
  });

  it('reports "none" with no error when content is an empty string', () => {
    // Empty string is falsy -> treated as "file absent", not a parse error.
    expect(getTimelineFileState('')).toEqual({
      source: 'none',
      timeline: null,
      error: null,
    });
  });

  it('flags malformed JSON as invalid and includes the parser message', () => {
    const result = getTimelineFileState('{not valid');
    expect(result.source).toBe('none');
    expect(result.timeline).toBeNull();
    expect(result.error).toMatch(/timeline\.json is invalid/i);
  });

  it('rejects an array — passes the object-record check but has no segments array', () => {
    // typeof [] === 'object' so isObjectRecord accepts it; it then fails the
    // segments-array gate (an array has no `.segments` field).
    const result = getTimelineFileState('[]');
    expect(result.source).toBe('none');
    expect(result.timeline).toBeNull();
    expect(result.error).toBe('timeline.json is missing a segments array.');
  });

  it('rejects valid JSON that is not an object (scalar / null literal)', () => {
    expect(getTimelineFileState('42').error).toBe('timeline.json is invalid.');
    // JSON literal null parses to null, which is not an object record.
    expect(getTimelineFileState('null').error).toBe(
      'timeline.json is invalid.',
    );
  });

  it('rejects an object missing the segments array', () => {
    const result = getTimelineFileState(
      JSON.stringify({ version: '1.0', totalDuration: 5 }),
    );
    expect(result.source).toBe('none');
    expect(result.timeline).toBeNull();
    expect(result.error).toBe('timeline.json is missing a segments array.');
  });

  it('rejects an object whose segments field is not an array', () => {
    const result = getTimelineFileState(
      JSON.stringify({ segments: { nope: true } }),
    );
    expect(result.error).toBe('timeline.json is missing a segments array.');
  });

  it('accepts a well-formed timeline document (including an empty segment list)', () => {
    const doc = { version: '1.0', totalDuration: 0, segments: [] };
    const result = getTimelineFileState(JSON.stringify(doc));
    expect(result.source).toBe('server_timeline');
    expect(result.error).toBeNull();
    expect(result.timeline).toEqual(doc);
  });

  it('accepts a populated timeline document and returns it verbatim', () => {
    const doc = {
      version: '1.0',
      totalDuration: 8,
      segments: [
        {
          id: 'segment_1',
          label: 'Intro',
          startTime: 0,
          endTime: 8,
          fillStatus: 'filled',
          layers: [],
        },
      ],
    };
    const result = getTimelineFileState(JSON.stringify(doc));
    expect(result.source).toBe('server_timeline');
    expect(result.timeline?.segments).toHaveLength(1);
  });
});

describe('collectAudioFilesWithDuration — duration resolution & fallback', () => {
  it('uses the probed duration when probing succeeds', async () => {
    const getAudioDuration = jest.fn(async () => 9.5);
    const result = await collectAudioFilesWithDuration({
      audioFiles: [{ path: 'assets/audio/a.mp3', duration: 0 }],
      projectDirectory: '/proj',
      transcriptDuration: 30,
      getAudioDuration,
    });
    expect(result).toEqual([{ path: 'assets/audio/a.mp3', duration: 9.5 }]);
    // Probe is called with the joined absolute path.
    expect(getAudioDuration).toHaveBeenCalledWith('/proj/assets/audio/a.mp3');
  });

  it('falls back to transcriptDuration when probing rejects', async () => {
    const getAudioDuration = jest.fn(async () => {
      throw new Error('ffprobe failed');
    });
    const result = await collectAudioFilesWithDuration({
      audioFiles: [{ path: 'assets/audio/broken.wav', duration: 0 }],
      projectDirectory: '/proj',
      transcriptDuration: 12,
      getAudioDuration,
    });
    expect(result).toEqual([
      { path: 'assets/audio/broken.wav', duration: 12 },
    ]);
  });

  it('falls back to 0 when probing fails AND there is no transcript duration', async () => {
    const getAudioDuration = jest.fn(async () => {
      throw new Error('ffprobe failed');
    });
    const result = await collectAudioFilesWithDuration({
      audioFiles: [{ path: 'assets/audio/broken.wav', duration: 0 }],
      projectDirectory: '/proj',
      transcriptDuration: 0,
      getAudioDuration,
    });
    expect(result).toEqual([
      { path: 'assets/audio/broken.wav', duration: 0 },
    ]);
  });

  it('resolves each track independently and preserves input order', async () => {
    const getAudioDuration = jest.fn(async (audioPath: string) => {
      if (audioPath.endsWith('first.mp3')) return 3;
      throw new Error('probe failed for the second file');
    });
    const result = await collectAudioFilesWithDuration({
      audioFiles: [
        { path: 'assets/audio/first.mp3', duration: 0 },
        { path: 'assets/audio/second.mp3', duration: 0 },
      ],
      projectDirectory: '/proj',
      transcriptDuration: 7,
      getAudioDuration,
    });
    expect(result).toEqual([
      { path: 'assets/audio/first.mp3', duration: 3 }, // probed
      { path: 'assets/audio/second.mp3', duration: 7 }, // fallback
    ]);
  });

  it('returns an empty array when there are no audio files (no probing)', async () => {
    const getAudioDuration = jest.fn(async () => 1);
    const result = await collectAudioFilesWithDuration({
      audioFiles: [],
      projectDirectory: '/proj',
      transcriptDuration: 5,
      getAudioDuration,
    });
    expect(result).toEqual([]);
    expect(getAudioDuration).not.toHaveBeenCalled();
  });
});
