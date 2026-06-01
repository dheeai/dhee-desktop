/**
 * findCanonicalAssistantBubbleIdx — pure helper for the
 * `agent_response` event handler in ChatPanelEmbedded.
 *
 * When pi-coding-agent's `agent_response` event lands with the
 * canonical full text for the turn, the renderer needs to decide
 * which existing bubble to UPDATE versus appending a new one. The
 * old logic searched for the most recent bubble with `streaming:
 * true`, but `tool_call` events explicitly flip prior bubbles to
 * `streaming: false` — so by the time `agent_response` arrives
 * after several tool calls, no bubble has `streaming: true` and
 * the renderer appended a brand-new bubble carrying the entire
 * turn's text, which the user already saw as intermediate
 * "Let me check X" bubbles. That's the "duplicate dump on stop"
 * the user reported.
 *
 * This helper returns the index of the most recent assistant
 * bubble in the current turn — regardless of streaming flag —
 * which is what the agent_response handler should update.
 *
 * "Current turn" means: from the most recent `user` message
 * (exclusive) to the end of the array. If there's no user
 * message ahead of any assistant bubble (e.g. the very first
 * onboarding greeting), the helper still finds the assistant
 * bubble — that's also "current turn".
 *
 * Returns -1 when no assistant bubble exists in the current turn
 * (in which case the caller should append a new bubble).
 */
export interface MessageLike {
  role: 'user' | 'assistant' | 'tool' | 'system' | 'media' | 'question' | 'phase' | 'progress' | 'thinking' | 'bundle-choices';
}

export function findCanonicalAssistantBubbleIdx(messages: ReadonlyArray<MessageLike>): number {
  // Walk backwards. Stop at the most recent user message (we don't
  // want to update a bubble from a previous turn).
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === 'user') return -1;
    if (messages[i]!.role === 'assistant') return i;
  }
  return -1;
}
