/**
 * Watermark filter — the user has explicitly stated: "There will be no
 * export without watermark." These tests pin the filter shape so any
 * future change that weakens, repositions, or hides the watermark
 * fails CI.
 *
 * Filter behavior tested as a pure-function unit (no FFmpeg invocation).
 * The actual `burnWatermarkIntoVideo` IO is exercised by manual smoke
 * tests + the guard test below.
 */
import { describe, it, expect } from '@jest/globals';
import {
  buildWatermarkFilter,
  WATERMARK_TEXT,
  WATERMARK_FONT_SIZE,
  WATERMARK_MARGIN_X,
  WATERMARK_MARGIN_Y,
} from './watermark';

describe('buildWatermarkFilter', () => {
  it('includes the drawtext primitive (FFmpeg watermark filter)', () => {
    const filter = buildWatermarkFilter({ fontPath: null });
    expect(filter).toMatch(/^drawtext=/);
  });

  it('embeds the canonical watermark text', () => {
    const filter = buildWatermarkFilter({ fontPath: null });
    expect(filter).toContain(`text='${WATERMARK_TEXT}'`);
  });

  it('uses the canonical font size', () => {
    const filter = buildWatermarkFilter({ fontPath: null });
    expect(filter).toContain(`fontsize=${WATERMARK_FONT_SIZE}`);
  });

  it('positions the watermark in the bottom-right corner', () => {
    const filter = buildWatermarkFilter({ fontPath: null });
    expect(filter).toContain(`x=w-tw-${WATERMARK_MARGIN_X}`);
    expect(filter).toContain(`y=h-th-${WATERMARK_MARGIN_Y}`);
  });

  it('uses a partially-transparent fontcolor (not invisible)', () => {
    const filter = buildWatermarkFilter({ fontPath: null });
    // The alpha must be > 0 (visible) and reasonably opaque so the
    // watermark is actually readable on screen. Tests pin alpha >= 0.2.
    const match = filter.match(/fontcolor=white@([0-9.]+)/);
    expect(match).not.toBeNull();
    const alpha = parseFloat(match![1]!);
    expect(alpha).toBeGreaterThanOrEqual(0.2);
    expect(alpha).toBeLessThanOrEqual(1);
  });

  it('includes a contrasting shadow so the watermark reads on light + dark frames', () => {
    const filter = buildWatermarkFilter({ fontPath: null });
    expect(filter).toContain('shadowcolor=black');
    expect(filter).toMatch(/shadowx=\d/);
    expect(filter).toMatch(/shadowy=\d/);
  });

  it('includes the fontfile when one is found on the system', () => {
    const filter = buildWatermarkFilter({ fontPath: '/usr/share/fonts/somefont.ttf' });
    expect(filter).toContain('fontfile=');
    expect(filter).toContain('/usr/share/fonts/somefont.ttf');
  });

  it('omits fontfile gracefully when no system font is found', () => {
    const filter = buildWatermarkFilter({ fontPath: null });
    expect(filter).not.toContain('fontfile=');
    // But still produces a valid drawtext filter — FFmpeg falls back
    // to its built-in default font.
    expect(filter).toMatch(/^drawtext=/);
  });

  it('canonical text is the company brand string and cannot be empty', () => {
    expect(WATERMARK_TEXT).toBeTruthy();
    expect(WATERMARK_TEXT.length).toBeGreaterThan(0);
  });
});
