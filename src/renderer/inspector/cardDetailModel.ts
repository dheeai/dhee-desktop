/**
 * Pure state model for the card detail modal — open/close,
 * which instance is open, and which actions are enabled
 * given the instance's status. The React component reads
 * this; tests exercise it without a DOM.
 *
 * Actions are signaled by name (regenerate / edit / open-file
 * / invalidate / select-version) — the action handler is wired
 * by the desktop's IPC bridge at a higher level. This module
 * decides AVAILABILITY, not invocation.
 */

export interface InstanceLike {
  nodeId: string;
  itemId?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'invalidated';
  outputPath?: string;
}

export type CardAction =
  | 'open-file'
  | 'regenerate'
  | 'edit'
  | 'invalidate'
  | 'show-versions';

export interface CardModalState {
  openInstanceKey: string | null;
}

export const closedModalState: CardModalState = { openInstanceKey: null };

export function instanceKey(inst: Pick<InstanceLike, 'nodeId' | 'itemId'>): string {
  return inst.itemId !== undefined ? `${inst.nodeId}:${inst.itemId}` : inst.nodeId;
}

export function openModal(state: CardModalState, key: string): CardModalState {
  if (state.openInstanceKey === key) return state;
  return { openInstanceKey: key };
}

export function closeModal(state: CardModalState): CardModalState {
  if (state.openInstanceKey === null) return state;
  return { openInstanceKey: null };
}

/**
 * Decide which actions are usable for an instance.
 *
 * - 'open-file' — available whenever an outputPath exists on disk
 *   (completed OR failed-but-prior-artifact-survives)
 * - 'regenerate' — for completed/failed/invalidated; not for
 *   in_progress (already running) or pending (nothing to regen yet)
 * - 'edit' — only for completed text/JSON artifacts (md/json
 *   extensions); image/video edits are out of scope for v1
 * - 'invalidate' — for completed only (marks it stale; downstream
 *   cascades on next walk). Pending/in_progress/failed don't need it.
 * - 'show-versions' — always available (the version tray may be empty
 *   but the action itself is always meaningful)
 */
export function availableActions(inst: InstanceLike): CardAction[] {
  const actions: CardAction[] = ['show-versions'];
  const hasFile = Boolean(inst.outputPath) && (inst.status === 'completed' || inst.status === 'failed' || inst.status === 'invalidated');
  if (hasFile) actions.push('open-file');
  if (inst.status === 'completed' || inst.status === 'failed' || inst.status === 'invalidated') {
    actions.push('regenerate');
  }
  if (inst.status === 'completed') {
    actions.push('invalidate');
  }
  if (inst.status === 'completed' && inst.outputPath) {
    const lower = inst.outputPath.toLowerCase();
    if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.json')) {
      actions.push('edit');
    }
  }
  return actions;
}

/**
 * Human label for each action — used by the modal's button row.
 */
export function actionLabel(action: CardAction): string {
  switch (action) {
    case 'open-file':     return 'Open file';
    case 'regenerate':    return 'Regenerate';
    case 'edit':          return 'Edit';
    case 'invalidate':    return 'Mark stale';
    case 'show-versions': return 'Versions';
  }
}
