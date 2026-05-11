/**
 * Render a kshana-core `.failed` sidecar (the raw broken LLM output)
 * plus its `.failed.error` companion into a single readable markdown
 * blob for the Content tab.
 *
 * The output is intentionally loud so the user knows they're looking
 * at a failure, not a normal artifact:
 *
 *   # <Title> — Failed Output
 *
 *   > ⚠️ **Validation rejected this output**
 *   >
 *   > <error message>
 *
 *   ## Raw model output
 *
 *   ```json
 *   {...broken JSON or text...}
 *   ```
 *
 *   ---
 *
 *   _Source: <relative .failed path>_
 *
 * Pure — no fs, no React. Takes the already-read content + error
 * strings and emits markdown.
 */

export interface RenderFailedAttemptInput {
  /** Project-relative path to the `.failed` sidecar (informational). */
  failedPath: string;
  /** Human-readable title (the sidebar's displayName works). */
  title: string;
  /** Raw text the LLM produced — usually JSON, sometimes garbage. */
  brokenContent: string;
  /** Validation error from the `.failed.error` companion, or null when
   *  the companion is missing on disk. */
  errorMessage: string | null;
}

/** Best-effort guess at whether the broken content is JSON-ish, so the
 *  code block uses ```json (gives ReactMarkdown's syntax highlighter
 *  hooks something to bind to) vs a plain fence. */
function looksLikeJson(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export function renderFailedAttemptAsMarkdown(
  input: RenderFailedAttemptInput,
): string {
  const fenceLang = looksLikeJson(input.brokenContent) ? 'json' : '';
  const errorBlock = input.errorMessage
    ? [
        '> ⚠️ **Validation rejected this output**',
        '>',
        ...input.errorMessage
          .split('\n')
          .map((line) => `> ${line}`.trimEnd()),
      ].join('\n')
    : '> ⚠️ **Validation rejected this output** _(no error message recorded)_';

  return [
    `# ${input.title}`,
    '',
    errorBlock,
    '',
    '## Raw model output',
    '',
    '```' + fenceLang,
    input.brokenContent,
    '```',
    '',
    '---',
    '',
    `_Source: \`${input.failedPath}\`_`,
  ].join('\n');
}
