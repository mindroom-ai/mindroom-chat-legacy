import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { summarizeThreadConversationCost } from './threadConversationCost';

const AGENT = '@mindroom_code:example.org';
const PERSON = '@alice:example.org';

const message = (id: string, sender: string, usd?: string, extra: Record<string, unknown> = {}) =>
  new MatrixEvent({
    type: 'm.room.message',
    event_id: id,
    room_id: '!room:example.org',
    sender,
    content: {
      msgtype: 'm.text',
      body: id,
      ...(usd === undefined
        ? {}
        : { 'io.mindroom.ai_run': { version: 1, status: 'completed', cost: { usd } } }),
      ...extra,
    },
  });

const edit = (id: string, targetId: string, usd: string) =>
  new MatrixEvent({
    type: 'm.room.message',
    event_id: id,
    room_id: '!room:example.org',
    sender: AGENT,
    content: {
      msgtype: 'm.text',
      body: '* edited',
      'm.new_content': {
        msgtype: 'm.text',
        body: 'edited',
        'io.mindroom.ai_run': { version: 1, status: 'completed', cost: { usd } },
      },
      'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
    },
  });

const loaded = { sdkLoaded: true, canPaginateBack: false, hasMoreCachedBack: false };
const isTrustedSender = (userId: string) => userId === AGENT;

describe('summarizeThreadConversationCost', () => {
  it('sums priced agent replies in order', () => {
    const cost = summarizeThreadConversationCost(
      [message('$root', PERSON), message('$r1', AGENT, '0.01'), message('$r2', AGENT, '0.02')],
      { history: loaded, isTrustedSender }
    );

    expect(cost?.byEventId.get('$r1')).toEqual({ usd: 0.01, replyCount: 1 });
    expect(cost?.byEventId.get('$r2')?.usd).toBeCloseTo(0.03);
    expect(cost?.byEventId.get('$r2')?.replyCount).toBe(2);
    expect(cost?.replies).toEqual([
      { eventId: '$r1', usd: 0.01 },
      { eventId: '$r2', usd: 0.02 },
    ]);
  });

  it("uses the latest edit's cost", () => {
    const original = message('$r1', AGENT);
    const latest = edit('$e1', '$r1', '0.5');
    const cost = summarizeThreadConversationCost([original, latest], {
      history: loaded,
      isTrustedSender,
      getContent: (event) =>
        event === original
          ? (latest.getContent()['m.new_content'] as Record<string, unknown>)
          : event.getContent(),
    });

    expect(cost?.byEventId.get('$r1')).toEqual({ usd: 0.5, replyCount: 1 });
    expect(cost?.byEventId.has('$e1')).toBe(false);
  });

  it('ignores costs from non-agent senders', () => {
    const cost = summarizeThreadConversationCost(
      [message('$r1', AGENT, '0.01'), message('$fake', PERSON, '100')],
      { history: loaded, isTrustedSender }
    );

    expect(cost?.replies).toEqual([{ eventId: '$r1', usd: 0.01 }]);
    expect(cost?.byEventId.has('$fake')).toBe(false);
  });

  it('ignores costs from ignored senders', () => {
    const cost = summarizeThreadConversationCost([message('$r1', AGENT, '0.01')], {
      history: loaded,
      isTrustedSender,
      ignoredUserIds: new Set([AGENT]),
    });

    expect(cost).toBeUndefined();
  });

  it('skips replies without cost', () => {
    const cost = summarizeThreadConversationCost(
      [message('$r1', AGENT), message('$r2', AGENT, '0.02')],
      { history: loaded, isTrustedSender }
    );

    expect(cost?.replies).toEqual([{ eventId: '$r2', usd: 0.02 }]);
    expect(cost?.byEventId.has('$r1')).toBe(false);
  });

  it('returns undefined when nothing is priced', () => {
    expect(
      summarizeThreadConversationCost([message('$root', PERSON), message('$r1', AGENT)], {
        history: loaded,
        isTrustedSender,
      })
    ).toBeUndefined();
  });

  it('is complete only once the thread start is loaded', () => {
    const events = [message('$r1', AGENT, '0.01')];
    const options = { isTrustedSender };

    expect(summarizeThreadConversationCost(events, { ...options, history: loaded })?.complete).toBe(
      true
    );
    [
      { ...loaded, sdkLoaded: false },
      { ...loaded, canPaginateBack: true },
      { ...loaded, hasMoreCachedBack: true },
    ].forEach((history) => {
      expect(summarizeThreadConversationCost(events, { ...options, history })?.complete).toBe(
        false
      );
    });
  });
});
