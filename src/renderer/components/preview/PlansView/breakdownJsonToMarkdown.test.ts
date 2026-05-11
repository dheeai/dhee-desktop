/**
 * GIVEN one of the three hierarchical scene-breakdown JSON shapes
 * WHEN renderBreakdownAsMarkdown processes it
 * THEN it returns markdown that mirrors the visual style of scene_N.md
 *   - H1 scene heading with title + scene number
 *   - subtitle italics with duration, subjects, shot count
 *   - bold shot pills, prose, camera/perspective/focus meta
 *   - dialogue blockquotes lifted out of the audio field
 */
import { describe, expect, it } from '@jest/globals';
import {
  detectBreakdownShape,
  renderBreakdownAsMarkdown,
} from './breakdownJsonToMarkdown';

describe('detectBreakdownShape', () => {
  it('classifies an object with shotPlan[] as "plan"', () => {
    expect(
      detectBreakdownShape({ sceneNumber: 1, shotPlan: [{}] }),
    ).toBe('plan');
  });

  it('classifies an object with shots[] as "assembled"', () => {
    expect(detectBreakdownShape({ sceneNumber: 1, shots: [{}] })).toBe(
      'assembled',
    );
  });

  it('classifies a top-level shotNumber+description object as "shot"', () => {
    expect(
      detectBreakdownShape({ shotNumber: 3, description: 'a description' }),
    ).toBe('shot');
  });

  it('returns "unknown" for an empty object', () => {
    expect(detectBreakdownShape({})).toBe('unknown');
  });

  it('returns "unknown" for non-object input', () => {
    expect(detectBreakdownShape(null)).toBe('unknown');
    expect(detectBreakdownShape('not json')).toBe('unknown');
  });
});

describe('renderBreakdownAsMarkdown — plan shape', () => {
  const plan = {
    sceneNumber: 2,
    sceneTitle: 'Arrival at the Singh House',
    totalDuration: 13,
    mainSubject: 'parvati',
    secondarySubject: 'mrs._singh',
    entry: 'Parvati steps off the bus, dust settling.',
    exit: 'Parvati closes the bungalow gate behind her.',
    shotPlan: [
      {
        shotNumber: 1,
        purpose: 'meet_character',
        duration: 4,
        oneLineSummary:
          'Parvati walks the last stretch of road to the Singh bungalow.',
        perspective: 'main_subject',
        continuityRole: 'entry',
      },
      {
        shotNumber: 2,
        purpose: 'show_action',
        duration: 3,
        oneLineSummary: "She pushes open the servant's door.",
      },
    ],
  };

  it('opens with an H1 carrying the scene number and title', () => {
    const md = renderBreakdownAsMarkdown(JSON.stringify(plan));
    expect(md.split('\n')[0]).toBe('# Scene 2 — Arrival at the Singh House');
  });

  it('emits a subtitle line with duration, subjects, and a "shot plan" pill', () => {
    const md = renderBreakdownAsMarkdown(JSON.stringify(plan));
    expect(md).toContain('_13s total · main: parvati · secondary: mrs._singh · shot plan_');
  });

  it('emits Entry and Exit blocks for scene transitions', () => {
    const md = renderBreakdownAsMarkdown(JSON.stringify(plan));
    expect(md).toContain('**Entry** Parvati steps off the bus, dust settling.');
    expect(md).toContain(
      '**Exit** Parvati closes the bungalow gate behind her.',
    );
  });

  it('lists each shot with a bold pill (number · purpose · duration) and the one-line summary', () => {
    const md = renderBreakdownAsMarkdown(JSON.stringify(plan));
    expect(md).toContain('**Shot 1 · meet character · 4s**');
    expect(md).toContain(
      'Parvati walks the last stretch of road to the Singh bungalow.',
    );
    expect(md).toContain('**Shot 2 · show action · 3s**');
  });

  it('annotates per-shot perspective and continuity when set', () => {
    const md = renderBreakdownAsMarkdown(JSON.stringify(plan));
    expect(md).toContain('_perspective: main subject · continuity: entry_');
  });
});

describe('renderBreakdownAsMarkdown — single shot shape', () => {
  const shot = {
    shotNumber: 3,
    purpose: 'show_dialogue',
    duration: 6,
    description:
      'Mrs. Singh sits at the polished teak table, bone china teacup in hand.',
    cameraWork: 'medium shot from side, slightly high angle, static',
    perspective: 'secondary_subject',
    perspectiveOf: 'mrs._singh',
    focus: {
      primary: 'mrs._singh',
      background: ['teak_table', 'teacup'],
      lurking: null,
    },
    continuityRole: 'none',
    audio: "MRS. SINGH: You're late, Parvati. Newspaper rustle, teacup clink.",
    transition: 'cut',
  };

  it('opens with an H1 pill (Shot N · purpose · Xs)', () => {
    const md = renderBreakdownAsMarkdown(JSON.stringify(shot));
    expect(md.split('\n')[0]).toBe('# Shot 3 · show dialogue · 6s');
  });

  it('includes the description as flowing prose', () => {
    const md = renderBreakdownAsMarkdown(JSON.stringify(shot));
    expect(md).toContain(
      'Mrs. Singh sits at the polished teak table, bone china teacup in hand.',
    );
  });

  it('exposes camera, perspective (with the named subject), and focus rows', () => {
    const md = renderBreakdownAsMarkdown(JSON.stringify(shot));
    expect(md).toContain(
      '**Camera** medium shot from side, slightly high angle, static',
    );
    expect(md).toContain('**Perspective** secondary subject (mrs._singh)');
    expect(md).toContain('**Focus (sharp)** mrs._singh');
    expect(md).toContain('**Focus (blurred)** teak_table, teacup');
  });

  it('lifts the speaker out of the audio field into a blockquote', () => {
    const md = renderBreakdownAsMarkdown(JSON.stringify(shot));
    expect(md).toContain(
      "> **MRS. SINGH** — You're late, Parvati. Newspaper rustle, teacup clink.",
    );
  });

  it('omits a "Continuity" row when continuityRole === none', () => {
    const md = renderBreakdownAsMarkdown(JSON.stringify(shot));
    expect(md).not.toContain('**Continuity**');
  });

  it('emits the transition as italic trailing line', () => {
    const md = renderBreakdownAsMarkdown(JSON.stringify(shot));
    expect(md).toContain('_Transition: cut_');
  });

  it('falls back to italic audio when the line has no NAME: prefix', () => {
    const ambientOnly = {
      ...shot,
      audio: 'footsteps on gravel, distant cicada hum',
    };
    const md = renderBreakdownAsMarkdown(JSON.stringify(ambientOnly));
    expect(md).toContain('**Audio** _footsteps on gravel, distant cicada hum_');
    // No blockquote when there's no speaker.
    expect(md).not.toContain('> **');
  });
});

describe('renderBreakdownAsMarkdown — assembled scene shape', () => {
  const scene = {
    sceneNumber: 2,
    sceneTitle: 'Arrival at the Singh House',
    totalDuration: 13,
    mainSubject: 'parvati',
    secondarySubject: 'mrs._singh',
    entry: 'Parvati steps off the bus, dust settling.',
    exit: 'Parvati closes the bungalow gate behind her.',
    shots: [
      {
        shotNumber: 1,
        purpose: 'meet_character',
        duration: 4,
        description:
          'Parvati walks the last stretch of road to the Singh bungalow.',
        cameraWork: 'medium, slight low angle, tracking left to right',
        perspective: 'main_subject',
        perspectiveOf: 'parvati',
        focus: { primary: 'parvati', background: ['singh_bungalow'] },
        continuityRole: 'entry',
        audio: 'footsteps on gravel, distant cicada hum',
        transition: 'fade',
      },
    ],
  };

  it('opens with an H1 carrying the scene title', () => {
    const md = renderBreakdownAsMarkdown(JSON.stringify(scene));
    expect(md.split('\n')[0]).toBe('# Scene 2 — Arrival at the Singh House');
  });

  it('subtitle reports total duration, subjects, and shot count', () => {
    const md = renderBreakdownAsMarkdown(JSON.stringify(scene));
    expect(md).toContain(
      '_13s total · main: parvati · secondary: mrs._singh · 1 shot_',
    );
  });

  it('embeds each shot as a ## section (not the H1 the single-shot view uses)', () => {
    const md = renderBreakdownAsMarkdown(JSON.stringify(scene));
    expect(md).toContain('## Shot 1 · meet character · 4s');
    // No second H1 in the body — only the scene-level one.
    expect(md.match(/^# /gm)?.length ?? 0).toBe(1);
  });

  it('still inlines Entry/Exit at the scene level', () => {
    const md = renderBreakdownAsMarkdown(JSON.stringify(scene));
    expect(md).toContain('**Entry** Parvati steps off the bus, dust settling.');
    expect(md).toContain('**Exit** Parvati closes the bungalow gate behind her.');
  });
});

describe('renderBreakdownAsMarkdown — error paths', () => {
  it('wraps unparseable JSON in a fenced block with a warning', () => {
    const md = renderBreakdownAsMarkdown('{not valid json');
    expect(md).toMatch(/Could not parse this breakdown as JSON/);
    expect(md).toContain('```json');
    expect(md).toContain('{not valid json');
  });

  it('falls back to fenced JSON for an unrecognized shape', () => {
    const md = renderBreakdownAsMarkdown(JSON.stringify({ random: 'thing' }));
    expect(md).toContain('Unrecognized breakdown shape');
    expect(md).toContain('```json');
  });
});
