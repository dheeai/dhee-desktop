/**
 * TDD tests for chat-notice event bus. Failure modes (real things
 * that go wrong in production):
 *
 *   FM1. Post before any subscriber → notice silently dropped, no throw.
 *   FM2. One subscriber → receives every post.
 *   FM3. Two subscribers (panel + debug overlay) → both receive.
 *   FM4. Unsubscribe → stops receiving (and doesn't break others).
 *   FM5. A misbehaving listener (throws) doesn't prevent siblings
 *        from receiving the same notice.
 *   FM6. Subscribing the same listener twice is idempotent (Set
 *        semantics) — it still receives once per post.
 *   FM7. Posting different levels (info/warning/error) all forward
 *        verbatim — no level filtering at the bus.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  __resetChatNoticesForTests,
  postChatNotice,
  subscribeChatNotices,
  type ChatNotice,
} from './chatNotices';

const vi = jest;

afterEach(() => {
  __resetChatNoticesForTests();
});

describe('chatNotices event bus', () => {
  it('FM1: post without subscribers is a no-op (no throw)', () => {
    expect(() =>
      postChatNotice({ level: 'info', message: 'lonely tree' }),
    ).not.toThrow();
  });

  it('FM2: a single subscriber receives every post', () => {
    const seen: ChatNotice[] = [];
    subscribeChatNotices((n) => seen.push(n));
    postChatNotice({ level: 'info', message: 'one' });
    postChatNotice({ level: 'warning', message: 'two' });
    expect(seen).toEqual([
      { level: 'info', message: 'one' },
      { level: 'warning', message: 'two' },
    ]);
  });

  it('FM3: two subscribers both receive the same notice', () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeChatNotices(a);
    subscribeChatNotices(b);
    const notice: ChatNotice = { level: 'info', message: 'hello' };
    postChatNotice(notice);
    expect(a).toHaveBeenCalledWith(notice);
    expect(b).toHaveBeenCalledWith(notice);
  });

  it('FM4: unsubscribe stops delivery for that listener only', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeChatNotices(a);
    subscribeChatNotices(b);
    postChatNotice({ level: 'info', message: 'first' });
    unsubA();
    postChatNotice({ level: 'info', message: 'second' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('FM5: a throwing listener does not prevent others from running', () => {
    const seen: ChatNotice[] = [];
    subscribeChatNotices(() => {
      throw new Error('boom');
    });
    subscribeChatNotices((n) => seen.push(n));
    expect(() =>
      postChatNotice({ level: 'error', message: 'survives' }),
    ).not.toThrow();
    expect(seen).toEqual([{ level: 'error', message: 'survives' }]);
  });

  it('FM6: subscribing the same listener twice is idempotent (delivered once)', () => {
    const fn = vi.fn();
    subscribeChatNotices(fn);
    subscribeChatNotices(fn);
    postChatNotice({ level: 'info', message: 'once' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('FM7: all levels are forwarded verbatim — no level filtering at the bus', () => {
    const seen: ChatNotice[] = [];
    subscribeChatNotices((n) => seen.push(n));
    const levels: Array<'info' | 'warning' | 'error'> = ['info', 'warning', 'error'];
    for (const level of levels) {
      postChatNotice({ level, message: `m-${level}` });
    }
    expect(seen.map((n) => n.level)).toEqual(levels);
  });
});
