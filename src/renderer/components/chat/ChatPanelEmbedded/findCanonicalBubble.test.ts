/**
 * findCanonicalAssistantBubbleIdx — TDD coverage for the agent_response
 * "which bubble do I update" lookup.
 *
 * Failure modes:
 *  1. empty array → -1.
 *  2. only user messages → -1.
 *  3. only system messages → -1 (no assistant to update).
 *  4. user → assistant → returns the assistant index.
 *  5. user → assistant → tool → returns the assistant index (tool is
 *     interleaved, doesn't disqualify the assistant from the turn).
 *  6. user → assistant → tool → assistant → returns the LAST
 *     assistant (the most recent one in this turn).
 *  7. user → assistant → user → assistant → returns the LAST
 *     assistant (we stop walking backward at the second user, so the
 *     prior turn's assistant is ignored).
 *  8. assistant (no prior user — e.g. first onboarding greeting) →
 *     returns 0 (the assistant is still the current turn's).
 *  9. tool → assistant → returns the assistant index.
 * 10. user → tool only → -1 (no assistant bubble exists yet).
 * 11. user → assistant (streaming: false) → still found (the flag
 *     doesn't gate the lookup — this is the whole point of the
 *     refactor).
 */
import { describe, it, expect } from '@jest/globals';
import {
  findCanonicalAssistantBubbleIdx,
  type MessageLike,
} from './findCanonicalBubble';

const m = (role: MessageLike['role']): MessageLike => ({ role });

describe('findCanonicalAssistantBubbleIdx', () => {
  it('1. empty array → -1', () => {
    expect(findCanonicalAssistantBubbleIdx([])).toBe(-1);
  });

  it('2. only user messages → -1', () => {
    expect(findCanonicalAssistantBubbleIdx([m('user'), m('user')])).toBe(-1);
  });

  it('3. only system messages → -1', () => {
    expect(findCanonicalAssistantBubbleIdx([m('system'), m('system')])).toBe(-1);
  });

  it('4. user → assistant → returns assistant idx', () => {
    expect(findCanonicalAssistantBubbleIdx([m('user'), m('assistant')])).toBe(1);
  });

  it('5. user → assistant → tool → returns assistant idx', () => {
    expect(findCanonicalAssistantBubbleIdx([m('user'), m('assistant'), m('tool')])).toBe(1);
  });

  it('6. user → assistant → tool → assistant → returns LAST assistant', () => {
    expect(
      findCanonicalAssistantBubbleIdx([m('user'), m('assistant'), m('tool'), m('assistant')]),
    ).toBe(3);
  });

  it('7. user → assistant → user → assistant → returns last assistant (prior turn ignored)', () => {
    expect(
      findCanonicalAssistantBubbleIdx([m('user'), m('assistant'), m('user'), m('assistant')]),
    ).toBe(3);
  });

  it('8. assistant only (no prior user) → returns 0', () => {
    expect(findCanonicalAssistantBubbleIdx([m('assistant')])).toBe(0);
  });

  it('9. tool → assistant → returns assistant idx', () => {
    expect(findCanonicalAssistantBubbleIdx([m('tool'), m('assistant')])).toBe(1);
  });

  it('10. user → tool only → -1 (no assistant in current turn)', () => {
    expect(findCanonicalAssistantBubbleIdx([m('user'), m('tool')])).toBe(-1);
  });

  it('11. classic chain user → assistant → tool → assistant → tool → assistant', () => {
    // This is the exact shape of an agent's mid-turn state after 3
    // "Let me check X" intermediates + tool calls. The agent_response
    // canonical should update the LAST assistant (index 5).
    const messages: MessageLike[] = [
      m('user'),
      m('assistant'),
      m('tool'),
      m('assistant'),
      m('tool'),
      m('assistant'),
    ];
    expect(findCanonicalAssistantBubbleIdx(messages)).toBe(5);
  });
});
