/**
 * In-renderer event bus for ephemeral chat-window notices.
 *
 * Why this exists: Sibling components (RedoFromMenu, settings tabs, the
 * future per-shot edit flow, etc.) need to surface short status
 * messages into the chat panel WITHOUT going through the LLM — same
 * semantics as the executor's `🛑 stop` ephemeral notifications, just
 * sourced from the renderer side instead of the server side.
 *
 * The chat panel already renders a `system` role row for notification
 * events received over IPC. This bus lets the renderer push the same
 * shape of row from any component, even before any agent turn has
 * started (so `session.activeEvents` is undefined and the server-side
 * notification path is unavailable).
 *
 * Semantics:
 *   - Fire-and-forget. Posting before any chat panel mounts drops the
 *     notice silently — by design. Chat panel is essentially always
 *     mounted in production (LandingScreen and WorkspaceLayout both
 *     render it).
 *   - No history persistence. The notice is rendered into the chat
 *     panel's local message state only. On reload it vanishes, like
 *     the server-side ephemeral notifications.
 *   - Multiple listeners (e.g. dev tools or future debug overlay) all
 *     receive each post.
 *
 * Pure module — no React, no IPC, fully unit-testable.
 */

export type ChatNoticeLevel = 'info' | 'warning' | 'error';

export interface ChatNotice {
  level: ChatNoticeLevel;
  message: string;
}

type NoticeListener = (notice: ChatNotice) => void;

const listeners = new Set<NoticeListener>();

/**
 * Subscribe to chat notices. Returns an unsubscribe function — call it
 * on unmount (or in a useEffect cleanup) so torn-down chat panels stop
 * receiving notices.
 */
export function subscribeChatNotices(listener: NoticeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Post a notice to every active listener. If no listeners are
 * registered (no chat panel mounted yet), the notice is dropped.
 */
export function postChatNotice(notice: ChatNotice): void {
  for (const l of listeners) {
    try {
      l(notice);
    } catch {
      // A misbehaving listener must not block the others — swallow.
    }
  }
}

/**
 * Test-only escape hatch: clear all listeners. Used by tests to
 * isolate cases; production never calls this.
 */
export function __resetChatNoticesForTests(): void {
  listeners.clear();
}
