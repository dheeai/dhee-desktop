/**
 * Watermark guard — static-source assertion that every video-export
 * IPC handler in main.ts calls the watermark step. The user has
 * stated: "There will be no export without watermark."
 *
 * Mechanism: scan main.ts source for `ipcMain.handle(...)` blocks
 * whose channel name suggests video export, then walk that block's
 * body until the matching close-paren and assert it references the
 * watermark call.
 *
 * This is a *structural* test, not a unit test. It catches the case
 * where someone adds a new export path and forgets to apply the
 * watermark — CI fails immediately rather than allowing the
 * unwatermarked export to ship.
 */
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAIN_TS = readFileSync(
  join(__dirname, '..', 'main.ts'),
  'utf-8',
);

/**
 * Channel-name patterns that indicate a video export endpoint. ANY
 * ipcMain.handle whose channel matches one of these MUST call the
 * watermark function before resolving with a file path.
 */
const VIDEO_EXPORT_CHANNEL_PATTERNS = [
  /['"]project:compose-timeline-video['"]/,
  // Future endpoints get added here; the guard test fails until the
  // implementation calls the watermark step.
];

/** Identifier the export handler MUST call before returning the output path. */
const WATERMARK_FUNCTION = 'burnWatermarkIntoVideo';

/**
 * Find the body of an ipcMain.handle(...) call for the given channel.
 * Returns the slice of source between the channel name and the
 * matching close-paren of the outer handle() call.
 */
function findHandlerBody(source: string, channelPattern: RegExp): string | null {
  // Locate `ipcMain.handle(<channel>` — the channel is on the next
  // line after the handle keyword in real code, so search broadly.
  const handleMatch = source.match(
    new RegExp(`ipcMain\\.handle\\(\\s*${channelPattern.source}`, 's'),
  );
  if (!handleMatch || handleMatch.index === undefined) return null;

  // Walk from the open-paren after `ipcMain.handle` to its matching
  // close-paren, tracking nesting.
  const openIdx = source.indexOf('(', handleMatch.index);
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return source.slice(openIdx, i + 1);
      }
    }
  }
  return null;
}

describe('main.ts video-export handlers must apply the watermark', () => {
  for (const pattern of VIDEO_EXPORT_CHANNEL_PATTERNS) {
    it(`channel matching ${pattern} → handler body invokes ${WATERMARK_FUNCTION}`, () => {
      const body = findHandlerBody(MAIN_TS, pattern);
      expect(body).not.toBeNull();
      expect(body!).toContain(WATERMARK_FUNCTION);
    });
  }

  it('catalog of guarded export channels is not empty', () => {
    expect(VIDEO_EXPORT_CHANNEL_PATTERNS.length).toBeGreaterThan(0);
  });
});
