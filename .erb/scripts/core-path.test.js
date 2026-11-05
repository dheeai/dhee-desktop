/** @jest-environment node */
const path = require('path');
const { resolveCorePath } = require('./core-path');
test('prefers the configured Core checkout and supports the legacy name', () => {
  expect(resolveCorePath('/workspace/desktop', {dhee_CORE_PATH:'/custom/core', dhee_INK_PATH:'/legacy/core'})).toBe('/custom/core');
  expect(resolveCorePath('/workspace/desktop', {dhee_INK_PATH:'/legacy/core'})).toBe('/legacy/core');
});
test('ignores empty settings and falls back to the companion checkout', () => {
  expect(resolveCorePath('/workspace/desktop', {dhee_CORE_PATH:' ', dhee_INK_PATH:'/legacy/core'})).toBe('/legacy/core');
  expect(resolveCorePath('/workspace/desktop', {})).toBe('/workspace/dhee-core');
  expect(resolveCorePath('/workspace/desktop', {dhee_CORE_PATH:'  ./nested  '})).toBe(path.resolve('./nested'));
});
