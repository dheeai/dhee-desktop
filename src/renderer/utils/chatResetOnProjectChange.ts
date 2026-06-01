/**
 * Decide whether the chat session must be reset when a project
 * lifecycle event fires.
 *
 * Background: every chat session is bound to one project. Without this
 * gate, creating a NEW project from the dialog reused the previous
 * project's session — so the new project's first prompt was treated
 * as a continuation of the previous chat (the Village → Soft Seinen
 * bug, 2026-05-19).
 *
 * Semantics:
 *
 *   intent='create' (the dialog just finished writing a fresh project.json)
 *     → always reset. The new project is by definition unrelated to
 *       whatever the user was doing before.
 *
 *   intent='open' + same path as currently open (re-open same project)
 *     → no reset. User is rehydrating; chat history is part of context.
 *
 *   intent='open' + different path (switch between existing projects)
 *     → reset/switch chat scope. Chat history and agent context are
 *       project-scoped; carrying them across projects leaks history.
 *
 *   intent='open' + no previous project (first open at session start)
 *     → no reset. Nothing to clear; the session is already fresh.
 *
 * Pure — accepts loose inputs, returns boolean.
 */

export type ProjectChangeIntent = 'create' | 'open';

export function shouldResetChatOnProjectChange(opts: {
  intent: ProjectChangeIntent;
  previousProjectDirectory: string | null | undefined;
  nextProjectDirectory: string | null | undefined;
}): boolean {
  const prev = (opts.previousProjectDirectory ?? '').trim();
  const next = (opts.nextProjectDirectory ?? '').trim();

  // Defensive: a missing destination means nothing meaningful happened.
  if (!next) return false;

  if (opts.intent === 'create') {
    // Fresh project always gets a fresh chat — even if no project was
    // open before (some host flows mount the dialog cold).
    return true;
  }

  // intent === 'open'
  if (!prev) return false; // first-ever open: nothing to clear
  if (prev === next) return false; // re-opening same project: keep history
  return true; // switching projects: isolate chat scope
}
