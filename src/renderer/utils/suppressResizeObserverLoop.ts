/**
 * suppressResizeObserverLoop — silences the harmless
 *   "ResizeObserver loop completed with undelivered notifications"
 * (and the older "ResizeObserver loop limit exceeded") warnings.
 *
 * Why: xyflow's layout pass triggers cascading resize observations.
 * The browser reports this as a benign warning (loop continues fine
 * on the next frame), but webpack-dev-server's error overlay
 * catches the window-error event and surfaces it as a crash.
 *
 * Two-layer defence:
 *   1. window.ResizeObserver is wrapped so callbacks fire inside
 *      requestAnimationFrame. This prevents the loop warning from
 *      firing AT ALL — the cascading observations get coalesced into
 *      the next frame. Root-cause fix.
 *   2. As belt-and-suspenders, a window-error listener swallows the
 *      message if it still slips through (some libraries instantiate
 *      ResizeObserver before this shim runs).
 *
 * Returns a cleanup function so tests + future teardown can detach.
 */
const SUPPRESSED_PREFIXES = [
  'ResizeObserver loop completed with undelivered notifications',
  'ResizeObserver loop limit exceeded',
];

function shouldSuppress(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  return SUPPRESSED_PREFIXES.some((prefix) => message.startsWith(prefix));
}

function wrapResizeObserver(): () => void {
  if (typeof window === 'undefined' || !window.ResizeObserver) return () => {};
  const OriginalRO = window.ResizeObserver;
  // If a previous install already wrapped, don't double-wrap.
  if ((OriginalRO as unknown as { __dheeWrapped?: boolean }).__dheeWrapped) {
    return () => {};
  }
  class DebouncedResizeObserver extends OriginalRO {
    constructor(callback: ResizeObserverCallback) {
      const wrapped: ResizeObserverCallback = (entries, observer) => {
        // Defer the callback so cascading layouts don't trip the
        // browser's "loop completed" warning. requestAnimationFrame
        // is the canonical way to break the synchronous loop chain.
        window.requestAnimationFrame(() => {
          try {
            callback(entries, observer);
          } catch (err) {
            // Swallow ResizeObserver loop errors at the callback level
            // too. Other errors propagate.
            if (!shouldSuppress((err as Error)?.message)) throw err;
          }
        });
      };
      super(wrapped);
    }
  }
  (DebouncedResizeObserver as unknown as { __dheeWrapped: boolean }).__dheeWrapped = true;
  window.ResizeObserver = DebouncedResizeObserver as unknown as typeof ResizeObserver;
  return () => {
    window.ResizeObserver = OriginalRO;
  };
}

export function installResizeObserverLoopSuppressor(): () => void {
  const unwrapRO = wrapResizeObserver();
  const handler = (event: ErrorEvent | Event) => {
    const message = (event as ErrorEvent).message;
    if (shouldSuppress(message)) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  };
  // Capture phase + first-registered so webpack-dev-server's listener
  // doesn't see this specific event.
  window.addEventListener('error', handler, { capture: true });
  // Some browsers fire the warning via console.error directly, which
  // some dev overlays mirror to the overlay. Patch console.error too.
  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    if (args.length > 0 && shouldSuppress(args[0])) return;
    origConsoleError(...args);
  };
  return () => {
    window.removeEventListener('error', handler, { capture: true });
    console.error = origConsoleError;
    unwrapRO();
  };
}
