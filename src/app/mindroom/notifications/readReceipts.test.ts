import { Direction, EventStatus, MatrixEvent, RelationType, ReceiptType } from 'matrix-js-sdk';
import { MAIN_ROOM_TIMELINE } from 'matrix-js-sdk/lib/@types/read_receipts';
import { describe, expect, it, vi } from 'vitest';
import { markMainTimelineAsRead, markRoomAndThreadsAsRead, markThreadAsRead } from './readReceipts';

const ROOM_ID = '!room:example.org';
const USER_ID = '@alice:example.org';
const THREAD_ID = '$thread-root';

const makeMessageEvent = (eventId: string, ts = 1) =>
  new MatrixEvent({
    content: {
      body: eventId,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: ROOM_ID,
    sender: '@bob:example.org',
    type: 'm.room.message',
  });

const makeThreadReplyEvent = (eventId: string, ts = 1) =>
  new MatrixEvent({
    content: {
      'm.relates_to': {
        event_id: THREAD_ID,
        'm.in_reply_to': {
          event_id: THREAD_ID,
        },
        is_falling_back: true,
        rel_type: RelationType.Thread,
      },
      body: eventId,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: ROOM_ID,
    sender: '@bob:example.org',
    type: 'm.room.message',
  });

const makeRoom = (events: MatrixEvent[]) => ({
  roomId: ROOM_ID,
  findEventById: vi.fn(),
  getEventReadUpTo: vi.fn(() => null),
  getLiveTimeline: vi.fn(() => ({
    getEvents: () => events,
  })),
  getThread: vi.fn(() => null),
  getThreads: vi.fn(() => []),
});

const makeClient = (room: ReturnType<typeof makeRoom>) => ({
  fetchRelations: vi.fn(),
  getEventMapper: vi.fn(
    () => (rawEvent: ConstructorParameters<typeof MatrixEvent>[0]) => new MatrixEvent(rawEvent)
  ),
  getRoom: vi.fn(() => room),
  getUserId: vi.fn(() => USER_ID),
  sendReadReceipt: vi.fn(),
  sendReceipt: vi.fn(),
});

describe('markMainTimelineAsRead', () => {
  it('filters hidden thread replies and sends a main-timeline receipt', async () => {
    const visibleMainEvent = makeMessageEvent('$main', 1);
    const hiddenThreadReply = makeThreadReplyEvent('$thread-reply', 2);
    const room = makeRoom([visibleMainEvent, hiddenThreadReply]);
    const mx = makeClient(room);

    await markMainTimelineAsRead(mx as never, ROOM_ID, false);

    expect(mx.sendReceipt).toHaveBeenCalledWith(visibleMainEvent, ReceiptType.Read, {
      thread_id: MAIN_ROOM_TIMELINE,
    });
    expect(mx.sendReadReceipt).not.toHaveBeenCalled();
  });
});

describe('markThreadAsRead', () => {
  it.each([false, true])(
    'acknowledges a distinct latest reply with an equal timestamp (older reply read: %s)',
    async (olderReplyRead) => {
      const previous = makeThreadReplyEvent('$previous', 3);
      const latest = makeThreadReplyEvent('$latest', 3);
      const room = {
        ...makeRoom([]),
        getThread: vi.fn(() => ({
          id: THREAD_ID,
          events: olderReplyRead ? [previous, latest] : [previous],
          replyToEvent: latest,
          getEventReadUpTo: vi.fn(() => (olderReplyRead ? previous.getId() : null)),
          getReadReceiptForUserId: vi.fn(() => null),
          getLastUnthreadedReceiptFor: vi.fn(() => undefined),
        })),
      };
      const mx = makeClient(room);

      await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

      expect(mx.sendReceipt).toHaveBeenCalledWith(latest, ReceiptType.Read, {
        thread_id: THREAD_ID,
      });
    }
  );

  it('targets the original reply when a streamed edit follows it', async () => {
    const reply = makeThreadReplyEvent('$reply', 2);
    const edit = new MatrixEvent({
      ...makeMessageEvent('$edit', 3).event,
      content: {
        'm.relates_to': { rel_type: RelationType.Replace, event_id: '$reply' },
        'm.new_content': { msgtype: 'm.text', body: 'Updated reply' },
      },
    });
    reply.makeReplaced(edit);
    const room = {
      ...makeRoom([]),
      getThread: vi.fn(() => ({
        id: THREAD_ID,
        events: [reply, edit],
        replyToEvent: reply,
        getEventReadUpTo: vi.fn(() => null),
        getReadReceiptForUserId: vi.fn(() => null),
        getLastUnthreadedReceiptFor: vi.fn(() => undefined),
      })),
    };
    const mx = makeClient(room);

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(mx.sendReceipt).toHaveBeenCalledWith(reply, ReceiptType.Read, { thread_id: THREAD_ID });
  });

  it('targets the terminal edit that ends a streamed reply', async () => {
    const reply = makeThreadReplyEvent('$reply', 2);
    const finish = new MatrixEvent({
      ...makeMessageEvent('$finish', 3).event,
      content: {
        'm.relates_to': { rel_type: RelationType.Replace, event_id: '$reply' },
        'm.new_content': {
          msgtype: 'm.text',
          body: 'Final reply',
          'io.mindroom.stream_status': 'completed',
        },
      },
    });
    finish.setThreadId(THREAD_ID);
    reply.makeReplaced(finish);
    const room = {
      ...makeRoom([]),
      getThread: vi.fn(() => ({
        id: THREAD_ID,
        events: [reply, finish],
        replyToEvent: reply,
        getEventReadUpTo: vi.fn(() => reply.getId()),
        getReadReceiptForUserId: vi.fn(() => null),
        getLastUnthreadedReceiptFor: vi.fn(() => undefined),
      })),
    };
    const mx = makeClient(room);

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, true);

    expect(mx.sendReceipt).toHaveBeenCalledWith(finish, ReceiptType.ReadPrivate, {
      thread_id: THREAD_ID,
    });
  });

  it('does not fetch relations or send a receipt for a local thread id', async () => {
    const room = makeRoom([]);
    const mx = makeClient(room);

    await markThreadAsRead(mx as never, ROOM_ID, `~${ROOM_ID}:txn-local`, false);

    expect(mx.fetchRelations).not.toHaveBeenCalled();
    expect(mx.sendReceipt).not.toHaveBeenCalled();
  });

  it('sends a thread-scoped receipt for the latest loaded thread reply', async () => {
    const latestReply = makeThreadReplyEvent('$reply-2', 2);
    const room = {
      ...makeRoom([]),
      getThread: vi.fn(() => ({
        id: THREAD_ID,
        events: [makeThreadReplyEvent('$reply-1', 1), latestReply],
        getEventReadUpTo: vi.fn(() => null),
        getReadReceiptForUserId: vi.fn(() => null),
        getLastUnthreadedReceiptFor: vi.fn(() => undefined),
      })),
    };
    const mx = makeClient(room);

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(mx.sendReceipt).toHaveBeenCalledWith(latestReply, ReceiptType.Read, {
      thread_id: THREAD_ID,
    });
  });

  it('fetches the authoritative thread tail when the SDK thread model is unavailable', async () => {
    const staleLoadedReply = makeThreadReplyEvent('$reply-1', 1);
    const latestRemoteReply = makeThreadReplyEvent('$reply-2', 2);
    const room = makeRoom([staleLoadedReply]);
    const mx = makeClient(room);
    mx.fetchRelations.mockResolvedValue({
      chunk: [latestRemoteReply.event],
    });

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(mx.fetchRelations).toHaveBeenCalledWith(
      ROOM_ID,
      THREAD_ID,
      RelationType.Thread,
      null,
      expect.objectContaining({ dir: Direction.Backward, limit: 1 })
    );
    expect((mx.sendReceipt.mock.calls[0]?.[0] as MatrixEvent | undefined)?.getId()).toBe(
      latestRemoteReply.getId()
    );
    expect(mx.sendReceipt.mock.calls[0]?.[2]).toEqual({
      thread_id: THREAD_ID,
    });
  });
});

describe('markRoomAndThreadsAsRead', () => {
  it('prefers the known thread tail over an equal-timestamp main event', async () => {
    const reply = makeThreadReplyEvent('$reply', 3);
    const room = {
      ...makeRoom([makeMessageEvent('$main', 3)]),
      getThreads: vi.fn(() => [{ id: THREAD_ID, events: [], replyToEvent: reply }]),
    };
    const mx = makeClient(room);

    await markRoomAndThreadsAsRead(mx as never, ROOM_ID, false);

    expect(mx.sendReadReceipt).toHaveBeenCalledWith(reply, ReceiptType.Read, true);
  });

  it('marks known threads even when the main timeline is empty', async () => {
    const reply = makeThreadReplyEvent('$reply', 2);
    const room = {
      ...makeRoom([]),
      getThreads: vi.fn(() => [{ id: THREAD_ID, events: [reply] }]),
    };
    const mx = makeClient(room);

    await markRoomAndThreadsAsRead(mx as never, ROOM_ID, false);

    expect(mx.sendReadReceipt).toHaveBeenCalledWith(reply, ReceiptType.Read, true);
  });

  it('skips a pending summary reply and marks the latest confirmed reply', async () => {
    const confirmed = makeThreadReplyEvent('$confirmed', 3);
    const pending = makeThreadReplyEvent('~pending', 4);
    pending.setStatus(EventStatus.SENDING);
    const room = {
      ...makeRoom([makeMessageEvent('$main', 1)]),
      getThreads: vi.fn(() => [
        {
          id: THREAD_ID,
          events: [confirmed, pending],
          replyToEvent: pending,
        },
      ]),
    };
    const mx = makeClient(room);

    await markRoomAndThreadsAsRead(mx as never, ROOM_ID, false);

    expect(mx.sendReadReceipt).toHaveBeenCalledWith(confirmed, ReceiptType.Read, true);
  });

  it.each([false, true])(
    'includes newer summary-only thread replies (private: %s)',
    async (privateReceipt) => {
      const latestReply = makeThreadReplyEvent('$summary-reply', 3);
      const room = {
        ...makeRoom([makeMessageEvent('$main', 2)]),
        getThreads: vi.fn(() => [
          {
            id: THREAD_ID,
            events: [makeMessageEvent(THREAD_ID)],
            replyToEvent: latestReply,
          },
        ]),
      };
      const mx = makeClient(room);

      await markRoomAndThreadsAsRead(mx as never, ROOM_ID, privateReceipt);

      expect(mx.sendReadReceipt).toHaveBeenCalledWith(
        latestReply,
        privateReceipt ? ReceiptType.ReadPrivate : ReceiptType.Read,
        true
      );
    }
  );

  it('still sends an explicit unthreaded receipt when only older thread unread remains', async () => {
    const olderThreadReply = makeThreadReplyEvent('$thread-reply', 1);
    const newestMainEvent = makeMessageEvent('$main', 2);
    const room = makeRoom([olderThreadReply, newestMainEvent]);
    room.getEventReadUpTo.mockReturnValue(newestMainEvent.getId());
    const mx = makeClient(room);

    await markRoomAndThreadsAsRead(mx as never, ROOM_ID, true);

    expect(mx.sendReadReceipt).toHaveBeenCalledWith(newestMainEvent, ReceiptType.ReadPrivate, true);
    expect(mx.sendReceipt).not.toHaveBeenCalled();
  });
});
