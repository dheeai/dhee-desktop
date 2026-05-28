// Check if the renderer and main bundles are built
import path from 'path';
import chalk from 'chalk';
import fs from 'fs';
import { TextEncoder, TextDecoder } from 'node:util';
import webpackPaths from '../configs/webpack.paths';

const mainPath = path.join(webpackPaths.distMainPath, 'main.js');
const rendererPath = path.join(webpackPaths.distRendererPath, 'renderer.js');

if (!fs.existsSync(mainPath)) {
  throw new Error(
    chalk.whiteBright.bgRed.bold(
      'The main process is not built yet. Build it by running "npm run build:main"',
    ),
  );
}

if (!fs.existsSync(rendererPath)) {
  throw new Error(
    chalk.whiteBright.bgRed.bold(
      'The renderer process is not built yet. Build it by running "npm run build:renderer"',
    ),
  );
}

// JSDOM does not implement TextEncoder and TextDecoder. The Node-built-in
// types use a generic ArrayBufferLike that doesn't structurally match
// lib.dom's `TextEncoder` which uses plain ArrayBuffer; the cast is
// safe at runtime (the methods are identical) and unblocks Jest under
// recent @types/node.
if (!global.TextEncoder) {
  // @ts-expect-error — Node TextEncoder is structurally compatible with the DOM one for our purposes
  global.TextEncoder = TextEncoder;
}
if (!global.TextDecoder) {
  // @ts-expect-error — same shape mismatch as above
  global.TextDecoder = TextDecoder;
}

// JSDOM does not implement ResizeObserver. xyflow (@xyflow/react) reads
// it at mount to track its viewport size; without this polyfill any
// test that renders an InspectorCanvas crashes inside React's commit
// phase. The polyfill is a no-op observer — that's fine because the
// canvas's auto-fit behaviour isn't under test (its `bundleToFlowGraph`
// is tested separately and the canvas tests assert on DOM presence,
// not on layout dimensions).
if (!(global as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
}

// JSDOM does not implement DOMMatrixReadOnly. xyflow uses it when
// projecting node positions in zoomed viewports. Same no-op rationale.
if (!(global as unknown as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly) {
  class DOMMatrixReadOnlyStub {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    constructor(_init?: unknown) {}
  }
  (global as unknown as { DOMMatrixReadOnly: typeof DOMMatrixReadOnlyStub }).DOMMatrixReadOnly = DOMMatrixReadOnlyStub;
}
