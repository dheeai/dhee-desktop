/**
 * GIVEN a kshana-core `.failed` sidecar + its `.failed.error` companion
 * WHEN renderFailedAttemptAsMarkdown stitches them
 * THEN the result is a loud, read-only markdown block: error banner
 *   at the top, raw output in a fenced code block, source path footer.
 */
import { describe, expect, it } from '@jest/globals';
import { renderFailedAttemptAsMarkdown } from './failedAttemptToMarkdown';

describe('renderFailedAttemptAsMarkdown', () => {
  const title = 'Shot Composition — Scene 1 Shot 3 (failed)';
  const failedPath = 'prompts/images/shots/scene-1-shot-3.json.failed';
  const brokenJson = '{"imagePrompt": "wandered off"}';
  const errorMsg =
    'No reference to any known character / setting / object found in the imagePrompt or references[]. Expected at least one of: character_image:protagonist.';

  it('opens with an H1 carrying the title', () => {
    const md = renderFailedAttemptAsMarkdown({
      failedPath,
      title,
      brokenContent: brokenJson,
      errorMessage: errorMsg,
    });
    expect(md.split('\n')[0]).toBe(`# ${title}`);
  });

  it('surfaces the validation error as a blockquote banner', () => {
    const md = renderFailedAttemptAsMarkdown({
      failedPath,
      title,
      brokenContent: brokenJson,
      errorMessage: errorMsg,
    });
    expect(md).toContain('> ⚠️ **Validation rejected this output**');
    expect(md).toContain('No reference to any known character');
  });

  it('renders multi-line error messages preserving each line as blockquote', () => {
    const md = renderFailedAttemptAsMarkdown({
      failedPath,
      title,
      brokenContent: brokenJson,
      errorMessage: 'line one\nline two\nline three',
    });
    expect(md).toContain('> line one');
    expect(md).toContain('> line two');
    expect(md).toContain('> line three');
  });

  it('wraps the broken content in a ```json fence when it looks like JSON', () => {
    const md = renderFailedAttemptAsMarkdown({
      failedPath,
      title,
      brokenContent: brokenJson,
      errorMessage: errorMsg,
    });
    expect(md).toContain('```json');
    expect(md).toContain(brokenJson);
  });

  it('wraps non-JSON content in a plain fence (no language tag)', () => {
    const md = renderFailedAttemptAsMarkdown({
      failedPath,
      title,
      brokenContent: 'this is just some prose the model returned',
      errorMessage: errorMsg,
    });
    // Plain ``` fence, no `json` after it.
    expect(md).toMatch(/^```\n/m);
    expect(md).not.toMatch(/```json/);
  });

  it('includes a footer linking back to the .failed path', () => {
    const md = renderFailedAttemptAsMarkdown({
      failedPath,
      title,
      brokenContent: brokenJson,
      errorMessage: errorMsg,
    });
    expect(md).toContain(`_Source: \`${failedPath}\`_`);
  });

  it('falls back to a generic banner when the error companion is missing', () => {
    const md = renderFailedAttemptAsMarkdown({
      failedPath,
      title,
      brokenContent: brokenJson,
      errorMessage: null,
    });
    expect(md).toContain('_(no error message recorded)_');
  });
});
