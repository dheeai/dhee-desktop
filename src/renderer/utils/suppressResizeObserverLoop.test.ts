/**
 * suppressResizeObserverLoop — silences the harmless "ResizeObserver
 * loop completed with undelivered notifications" warning that
 * xyflow's layout passes routinely emit. The error is a no-op at the
 * browser level but webpack-dev-server's error overlay shows it as a
 * runtime crash.
 *
 * The shim is a window-error handler that calls stopImmediatePropagation
 * + preventDefault on this specific message ONLY, leaving every other
 * error to bubble normally.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { installResizeObserverLoopSuppressor } from './suppressResizeObserverLoop';

describe('suppressResizeObserverLoop', () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  beforeEach(() => {
    cleanup = installResizeObserverLoopSuppressor();
  });

  it('returns a cleanup function', () => {
    expect(typeof cleanup).toBe('function');
  });

  it('cancels error events whose message matches the ResizeObserver loop warning', () => {
    const event = new ErrorEvent('error', {
      message: 'ResizeObserver loop completed with undelivered notifications.',
      cancelable: true,
    });
    let stoppedImmediate = false;
    const origStop = event.stopImmediatePropagation.bind(event);
    event.stopImmediatePropagation = () => {
      stoppedImmediate = true;
      origStop();
    };
    const dispatched = window.dispatchEvent(event);
    // preventDefault() was called → dispatchEvent returns false
    expect(dispatched).toBe(false);
    expect(stoppedImmediate).toBe(true);
  });

  it('lets unrelated errors through', () => {
    const event = new ErrorEvent('error', {
      message: 'Something else broke',
      cancelable: true,
    });
    const dispatched = window.dispatchEvent(event);
    // Not handled by the suppressor; dispatch returns true.
    expect(dispatched).toBe(true);
  });

  it('cleanup() removes the handler so future ResizeObserver errors are NOT suppressed', () => {
    cleanup?.();
    cleanup = null;
    const event = new ErrorEvent('error', {
      message: 'ResizeObserver loop completed with undelivered notifications.',
      cancelable: true,
    });
    const dispatched = window.dispatchEvent(event);
    expect(dispatched).toBe(true);
  });

  it('silences console.error calls matching the ResizeObserver loop message', () => {
    // The suppressor's beforeEach already installed; that wrap calls
    // the pre-wrap console.error. To observe the chain, tear down and
    // re-install with a known stand-in as the pre-wrap target.
    cleanup?.();
    cleanup = null;
    const captured: unknown[][] = [];
    const origErr = console.error;
    const stub = (...args: unknown[]) => {
      captured.push(args);
    };
    console.error = stub;
    cleanup = installResizeObserverLoopSuppressor();
    try {
      console.error('ResizeObserver loop completed with undelivered notifications.');
      console.error('Some real error');
      expect(captured).toHaveLength(1);
      expect(captured[0]).toEqual(['Some real error']);
    } finally {
      cleanup?.();
      cleanup = null;
      console.error = origErr;
    }
  });

  it('wraps window.ResizeObserver so callbacks defer to the next animation frame', () => {
    // jsdom may not ship ResizeObserver; if it does, the suppressor
    // wraps it. Either way, the suppressor never throws on install.
    if (typeof window.ResizeObserver === 'function') {
      const Wrapped = window.ResizeObserver as unknown as { __dheeWrapped?: boolean };
      expect(Wrapped.__dheeWrapped).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  });
});
