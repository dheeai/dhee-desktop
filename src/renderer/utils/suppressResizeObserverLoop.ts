/**
 * suppressResizeObserverLoop — silences the harmless
 *   "ResizeObserver loop completed with undelivered notifications"
 * (and the older "ResizeObserver loop limit exceeded") warnings.
 *
 * Why: xyflow's layout pass triggers cascading resize observations.
 * The browser reports this as a benign warning (loop continues fine
 * on the next frame), but webpack-dev-server's error overlay
 * catches the window-error event and surfaces it as a crash. The
 * UX is misleading — nothing's broken.
 *
 * The shim handles the window-error event for this exact message
 * only, calling stopImmediatePropagation + preventDefault. Other
 * errors bubble normally to the overlay.
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

export function installResizeObserverLoopSuppressor(): () => void {
  const handler = (event: ErrorEvent) => {
    if (shouldSuppress(event.message)) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  };
  // Capture phase + first-registered so webpack-dev-server's listener
  // (which runs in bubble phase) never sees the event.
  window.addEventListener('error', handler, { capture: true });
  return () => window.removeEventListener('error', handler, { capture: true });
}
