/**
 * Render the hierarchical scene-breakdown JSONs as readable markdown.
 *
 * The Content tab renders everything as markdown via MarkdownEditor +
 * ReactMarkdown. Raw breakdown JSON dumps are technically readable but
 * fight the eye — keys / quotes / commas drown the prose. This module
 * turns each of the three breakdown JSON shapes into the same tone of
 * markdown that scene_N.md uses (bold shot headings, prose paragraphs,
 * dialogue blockquotes) so users can skim a plan or a per-shot
 * breakdown the same way they skim a scene.
 *
 * Three input shapes — auto-detected from the parsed object:
 *
 *   - Plan        (Stage A, scene_N.plan.json)
 *     { sceneNumber, sceneTitle, totalDuration, mainSubject,
 *       secondarySubject?, entry?, exit?,
 *       shotPlan: [{ shotNumber, purpose, duration, oneLineSummary, ... }] }
 *
 *   - Single shot (Stage B, scene_N.shots/M.json)
 *     { shotNumber, purpose, duration, description, cameraWork,
 *       perspective?, focus?, audio?, transition?, ... }
 *
 *   - Assembled scene (Stage C, scene_N.json)
 *     { sceneNumber, sceneTitle, totalDuration, mainSubject,
 *       secondarySubject?, entry?, exit?,
 *       shots: [ { full shot object } ] }
 *
 * Pure: no fs, no React. JSON string in, markdown string out. The
 * caller decides whether the editor should be read-only (it should
 * for any of these — the rendered markdown is a view, not the source).
 */

interface ShotPlanEntry {
  shotNumber?: number;
  purpose?: string;
  duration?: number;
  oneLineSummary?: string;
  perspective?: string;
  continuityRole?: string;
}

interface Focus {
  primary?: string;
  background?: string[];
  lurking?: string | null;
}

interface Shot {
  shotNumber?: number;
  purpose?: string;
  duration?: number;
  description?: string;
  cameraWork?: string;
  perspective?: string;
  perspectiveOf?: string;
  focus?: Focus;
  continuityRole?: string;
  audio?: string;
  transition?: string;
  characters?: string[];
  setting?: string | null;
  shotType?: string;
}

interface ScenePlan {
  sceneNumber?: number;
  sceneTitle?: string;
  totalDuration?: number;
  mainSubject?: string;
  secondarySubject?: string | null;
  entry?: string;
  exit?: string;
  shotPlan?: ShotPlanEntry[];
}

interface AssembledScene {
  sceneNumber?: number;
  sceneTitle?: string;
  totalDuration?: number;
  mainSubject?: string;
  secondarySubject?: string | null;
  entry?: string;
  exit?: string;
  shots?: Shot[];
}

type BreakdownShape = 'plan' | 'shot' | 'assembled' | 'unknown';

/**
 * Sniff which of the three breakdown shapes a parsed object is.
 *
 *   - `shotPlan` array  → plan (Stage A)
 *   - `shots` array     → assembled scene (Stage C)
 *   - top-level shotNumber + description → single shot (Stage B)
 *
 * Exported for tests.
 */
export function detectBreakdownShape(parsed: unknown): BreakdownShape {
  if (!parsed || typeof parsed !== 'object') return 'unknown';
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.shotPlan)) return 'plan';
  if (Array.isArray(obj.shots)) return 'assembled';
  if (typeof obj.shotNumber === 'number' && typeof obj.description === 'string') {
    return 'shot';
  }
  return 'unknown';
}

// ─── shared helpers ──────────────────────────────────────────────────────

function humanPurpose(purpose: string | undefined): string {
  if (!purpose) return '';
  return purpose.replace(/_/g, ' ');
}

function metaPills(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(' · ');
}

function audioBlock(audio: string | undefined): string {
  if (!audio) return '';
  // Detect a NAME: dialogue prefix (uppercase chars + optional (V.O.) + colon).
  // Lift dialogue into a blockquote so it visually pops the way the
  // scene markdown does today; keep ambient/sfx on a following line.
  const dialogueRe = /^([A-Z][A-Z _.()'-]+):\s*(.+)$/s;
  const match = audio.match(dialogueRe);
  if (!match) {
    return `**Audio** _${escapeMd(audio)}_`;
  }
  const speaker = match[1]!.trim();
  // The rest may include the spoken line plus trailing ambient cues.
  // We don't split that further — the source author already wrote them
  // as one phrase ("Stay here. Thunder crack."), and over-splitting
  // would distort their intent.
  const rest = match[2]!.trim();
  return `> **${speaker}** — ${escapeMd(rest)}`;
}

function escapeMd(text: string): string {
  // Minimal escape: just the chars that would close a blockquote or
  // emphasis context mid-line. Markdown is forgiving; over-escaping
  // makes the output harder to read.
  return text.replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'));
}

function focusBlock(focus: Focus | undefined): string[] {
  if (!focus) return [];
  const lines: string[] = [];
  if (focus.primary) lines.push(`**Focus (sharp)** ${focus.primary}`);
  if (focus.background && focus.background.length > 0) {
    lines.push(`**Focus (blurred)** ${focus.background.join(', ')}`);
  }
  if (focus.lurking) {
    lines.push(`**Focus (lurking)** ${focus.lurking}`);
  }
  return lines;
}

// ─── one shot block (shared between Stage B + Stage C) ───────────────────

function renderShotSection(shot: Shot, opts: { headingLevel: '##' | '###' }): string {
  const lines: string[] = [];
  const purpose = humanPurpose(shot.purpose);
  const dur =
    typeof shot.duration === 'number' ? `${shot.duration}s` : null;
  const heading = metaPills([
    `Shot ${shot.shotNumber ?? '?'}`,
    purpose || null,
    dur,
  ]);
  lines.push(`${opts.headingLevel} ${heading}`);

  if (shot.description) lines.push('', shot.description);

  const metaLines: string[] = [];
  if (shot.cameraWork) metaLines.push(`**Camera** ${shot.cameraWork}`);
  if (shot.perspective) {
    const who = shot.perspectiveOf ? ` (${shot.perspectiveOf})` : '';
    metaLines.push(`**Perspective** ${humanPurpose(shot.perspective)}${who}`);
  }
  metaLines.push(...focusBlock(shot.focus));
  if (shot.continuityRole && shot.continuityRole !== 'none') {
    metaLines.push(`**Continuity** ${shot.continuityRole}`);
  }
  if (shot.setting) {
    metaLines.push(`**Setting** ${shot.setting}`);
  }
  if (shot.characters && shot.characters.length > 0) {
    metaLines.push(`**Characters** ${shot.characters.join(', ')}`);
  }
  if (metaLines.length > 0) {
    lines.push('', metaLines.join('  \n'));
  }

  const audioMd = audioBlock(shot.audio);
  if (audioMd) {
    lines.push('', audioMd);
  }

  if (shot.transition) {
    lines.push('', `_Transition: ${shot.transition}_`);
  }

  return lines.join('\n');
}

// ─── shape renderers ─────────────────────────────────────────────────────

function renderPlan(plan: ScenePlan): string {
  const lines: string[] = [];
  const title = plan.sceneTitle
    ? `Scene ${plan.sceneNumber ?? '?'} — ${plan.sceneTitle}`
    : `Scene ${plan.sceneNumber ?? '?'} — Shot Plan`;
  lines.push(`# ${title}`);

  const subtitle = metaPills([
    typeof plan.totalDuration === 'number' ? `${plan.totalDuration}s total` : null,
    plan.mainSubject ? `main: ${plan.mainSubject}` : null,
    plan.secondarySubject ? `secondary: ${plan.secondarySubject}` : null,
    'shot plan',
  ]);
  if (subtitle) lines.push('', `_${subtitle}_`);

  if (plan.entry) lines.push('', `**Entry** ${plan.entry}`);
  if (plan.exit) lines.push('', `**Exit** ${plan.exit}`);

  if (plan.shotPlan && plan.shotPlan.length > 0) {
    lines.push('', '## Shots');
    for (const entry of plan.shotPlan) {
      const meta = metaPills([
        `Shot ${entry.shotNumber ?? '?'}`,
        humanPurpose(entry.purpose) || null,
        typeof entry.duration === 'number' ? `${entry.duration}s` : null,
      ]);
      lines.push('', `**${meta}**`);
      if (entry.oneLineSummary) lines.push('', entry.oneLineSummary);
      const extras: string[] = [];
      if (entry.perspective) extras.push(`perspective: ${humanPurpose(entry.perspective)}`);
      if (entry.continuityRole && entry.continuityRole !== 'none') {
        extras.push(`continuity: ${entry.continuityRole}`);
      }
      if (extras.length > 0) {
        lines.push('', `_${extras.join(' · ')}_`);
      }
    }
  }

  return lines.join('\n');
}

function renderShot(shot: Shot): string {
  const lines: string[] = [];
  const heading = metaPills([
    `Shot ${shot.shotNumber ?? '?'}`,
    humanPurpose(shot.purpose) || null,
    typeof shot.duration === 'number' ? `${shot.duration}s` : null,
  ]);
  lines.push(`# ${heading}`);
  // Single-shot view: render the same shot section but use the file as
  // the top of the page (no scene wrapper). The shared helper expects
  // ## headings inside an assembled scene — here we promote to a top
  // section by overriding the heading level prefix.
  const body = renderShotSection(shot, { headingLevel: '##' });
  // Strip the first heading that renderShotSection adds (we just emitted
  // our own H1 with the same content); keep everything after it.
  const bodyLines = body.split('\n').slice(1);
  lines.push(...bodyLines);
  return lines.join('\n');
}

function renderAssembled(scene: AssembledScene): string {
  const lines: string[] = [];
  const title = scene.sceneTitle
    ? `Scene ${scene.sceneNumber ?? '?'} — ${scene.sceneTitle}`
    : `Scene ${scene.sceneNumber ?? '?'} — Breakdown`;
  lines.push(`# ${title}`);

  const subtitle = metaPills([
    typeof scene.totalDuration === 'number' ? `${scene.totalDuration}s total` : null,
    scene.mainSubject ? `main: ${scene.mainSubject}` : null,
    scene.secondarySubject ? `secondary: ${scene.secondarySubject}` : null,
    scene.shots && scene.shots.length > 0
      ? `${scene.shots.length} shot${scene.shots.length === 1 ? '' : 's'}`
      : null,
  ]);
  if (subtitle) lines.push('', `_${subtitle}_`);

  if (scene.entry) lines.push('', `**Entry** ${scene.entry}`);
  if (scene.exit) lines.push('', `**Exit** ${scene.exit}`);

  if (scene.shots && scene.shots.length > 0) {
    for (const shot of scene.shots) {
      lines.push('', renderShotSection(shot, { headingLevel: '##' }));
    }
  }

  return lines.join('\n');
}

// ─── entry point ─────────────────────────────────────────────────────────

/**
 * Parse the raw JSON file contents and emit reader-friendly markdown.
 * On parse failure (or an unrecognized shape) the input is wrapped in a
 * fenced code block so the user still sees SOMETHING rather than an
 * empty view — same fallback the previous "JSON-as-plain-text" rendering
 * relied on, but explicitly fenced as `json`.
 */
export function renderBreakdownAsMarkdown(rawJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    const msg = (err as Error).message;
    return [
      `> ⚠️ Could not parse this breakdown as JSON: \`${msg}\`.`,
      '',
      '```json',
      rawJson,
      '```',
    ].join('\n');
  }

  const shape = detectBreakdownShape(parsed);
  switch (shape) {
    case 'plan':
      return renderPlan(parsed as ScenePlan);
    case 'shot':
      return renderShot(parsed as Shot);
    case 'assembled':
      return renderAssembled(parsed as AssembledScene);
    default:
      return [
        '> Unrecognized breakdown shape — falling back to raw JSON.',
        '',
        '```json',
        JSON.stringify(parsed, null, 2),
        '```',
      ].join('\n');
  }
}
