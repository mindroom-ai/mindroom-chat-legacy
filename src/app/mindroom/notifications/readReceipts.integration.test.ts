import { createClient, MatrixEvent, ReceiptType, RelationType, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread, ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRoomThreadsUnread, getThreadUnread } from '../threads/roomThreadList';
import { markMainTimelineAsRead, markRoomAndThreadsAsRead, markThreadAsRead } from './readReceipts';

const ROOM_ID = '!receipts:example.org';
const USER_ID = '@alice:example.org';

const message = (id: string, ts: number, threadId?: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: '@bob:example.org',
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.text',
      body: id,
      ...(threadId
        ? { 'm.relates_to': { rel_type: RelationType.Thread, event_id: threadId } }
        : {}),
    },
  });

const rawStreamEdit = (id: string, ts: number, status: string, targetId = '$reply') => ({
  event_id: id,
  room_id: ROOM_ID,
  sender: '@bob:example.org',
  type: 'm.room.message',
  origin_server_ts: ts,
  content: {
    msgtype: 'm.text',
    body: '* answer',
    'm.new_content': { msgtype: 'm.text', body: 'answer', 'io.mindroom.stream_status': status },
    'm.relates_to': { rel_type: RelationType.Replace, event_id: targetId },
  },
});

const streamEdit = (id: string, ts: number, status: string, targetId?: string) =>
  new MatrixEvent(rawStreamEdit(id, ts, status, targetId));

const receiptPath = (eventId: string, receiptType = ReceiptType.Read) =>
  `/rooms/${encodeURIComponent(ROOM_ID)}/receipt/${receiptType}/${encodeURIComponent(eventId)}`;

const setupRoom = async ({ replyEdit }: { replyEdit?: object } = {}) => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: USER_ID });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  const room = new Room(ROOM_ID, mx, USER_ID);
  mx.store.storeRoom(room);
  const requests = vi.spyOn(mx.http, 'authedRequest').mockResolvedValue({});
  const root = message('$root', 1000);
  const reply = message('$reply', 3000, '$root');
  // The server bundles a reply's latest edit with it.
  if (replyEdit) reply.setUnsigned({ 'm.relations': { [RelationType.Replace]: replyEdit } });
  root.setUnsigned({
    'm.relations': {
      [RelationType.Thread]: {
        count: 2,
        current_user_participated: true,
        latest_event: reply.event,
      },
    },
  });
  room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false });
  const thread = room.createThread('$root', root, [], false);
  // An unopened thread keeps the real summary-only SDK state: its history loads when opened.
  await vi.waitFor(() => expect(thread.replyToEvent?.getId()).toBe('$reply'));
  expect(thread.initialEventsFetched).toBe(false);
  // Establish prior threaded-receipt use so the SDK's legacy-client migration
  // heuristic does not treat every subsequently loaded reply as already read.
  room.addReceipt(
    new MatrixEvent({
      type: 'm.receipt',
      room_id: ROOM_ID,
      content: {
        $earlier: { [ReceiptType.Read]: { [USER_ID]: { thread_id: '$root', ts: 2000 } } },
      },
    })
  );
  return { mx, room, thread, requests };
};

const syncThreadReceipt = (room: Room, eventId: string, ts: number) =>
  room.addReceipt(
    new MatrixEvent({
      type: 'm.receipt',
      room_id: ROOM_ID,
      content: { [eventId]: { [ReceiptType.Read]: { [USER_ID]: { thread_id: '$root', ts } } } },
    })
  );

describe('thread receipt unread state with SDK models', () => {
  let previousThreadSupport: FeatureSupport;

  beforeEach(() => {
    previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
  });

  afterEach(() => {
    Thread.hasServerSideSupport = previousThreadSupport;
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    'clears a summary-only thread when marked read (private: %s)',
    async (privateReceipt) => {
      const { mx, thread, requests } = await setupRoom();
      expect(thread.events.some((event) => event.getId() === '$reply')).toBe(false);
      expect(getThreadUnread(thread, USER_ID)).toBe(true);

      await markThreadAsRead(mx, ROOM_ID, '$root', privateReceipt);

      expect(getThreadUnread(thread, USER_ID)).toBe(false);
      expect(requests).toHaveBeenCalledWith(
        'POST',
        `/rooms/${encodeURIComponent(ROOM_ID)}/receipt/${
          privateReceipt ? ReceiptType.ReadPrivate : ReceiptType.Read
        }/%24reply`,
        undefined,
        { thread_id: '$root' }
      );
    }
  );

  it.each([false, true])(
    'clears a summary-only thread when the whole room is marked read (private: %s)',
    async (privateReceipt) => {
      const { mx, thread } = await setupRoom();
      expect(getThreadUnread(thread, USER_ID)).toBe(true);

      await markRoomAndThreadsAsRead(mx, ROOM_ID, privateReceipt);

      expect(getThreadUnread(thread, USER_ID)).toBe(false);
    }
  );

  it('does not resend a receipt for an already-read summary-only reply', async () => {
    const { mx, requests } = await setupRoom();
    await markThreadAsRead(mx, ROOM_ID, '$root', false);
    requests.mockClear();

    await markThreadAsRead(mx, ROOM_ID, '$root', false);

    expect(requests).not.toHaveBeenCalled();
  });

  it('preserves unread thread replies when only the main timeline is read', async () => {
    const { mx, thread } = await setupRoom();

    await markMainTimelineAsRead(mx, ROOM_ID, false);

    expect(getThreadUnread(thread, USER_ID)).toBe(true);
  });

  it('reads thread replies with an unthreaded receipt, not a main one on a newer event', async () => {
    const { mx, room, thread } = await setupRoom();
    room.getUnfilteredTimelineSet().addLiveEvent(message('$card', 4000), { addToState: false });

    await markMainTimelineAsRead(mx, ROOM_ID, false);
    expect(room.getEventReadUpTo(USER_ID)).toBe('$card');
    expect(getThreadUnread(thread, USER_ID)).toBe(true);

    await markRoomAndThreadsAsRead(mx, ROOM_ID, false);
    expect(getThreadUnread(thread, USER_ID)).toBe(false);
  });

  it('keeps a later reply unread after whole-room marking and history hydration', async () => {
    const { mx, thread } = await setupRoom();
    await markRoomAndThreadsAsRead(mx, ROOM_ID, false);
    expect(getThreadUnread(thread, USER_ID)).toBe(false);

    thread.addEvent(message('$reply', 3000, '$root'), false, false);
    expect(getThreadUnread(thread, USER_ID)).toBe(false);
    thread.addEvent(message('$later', 4000, '$root'), false, false);

    expect(getThreadUnread(thread, USER_ID)).toBe(true);
  });

  it.each([ReceiptType.Read, ReceiptType.ReadPrivate])(
    'honors a synchronized %s receipt on a summary-only reply',
    async (receiptType) => {
      const { room, thread } = await setupRoom();
      room.addReceipt(
        new MatrixEvent({
          type: 'm.receipt',
          room_id: ROOM_ID,
          content: { $reply: { [receiptType]: { [USER_ID]: { thread_id: '$root', ts: 3500 } } } },
        })
      );

      expect(getThreadUnread(thread, USER_ID)).toBe(false);
    }
  );

  it.each([ReceiptType.Read, ReceiptType.ReadPrivate])(
    'uses a newer synchronized %s receipt when an older local receipt is retained',
    async (receiptType) => {
      const { mx, room, thread, requests } = await setupRoom();
      room.addLocalEchoReceipt(USER_ID, message('$previous', 2500, '$root'), receiptType);
      room.addReceipt(
        new MatrixEvent({
          type: 'm.receipt',
          room_id: ROOM_ID,
          content: { $reply: { [receiptType]: { [USER_ID]: { thread_id: '$root', ts: 3500 } } } },
        })
      );

      expect(getThreadUnread(thread, USER_ID)).toBe(false);
      requests.mockClear();
      await markThreadAsRead(mx, ROOM_ID, '$root', receiptType === ReceiptType.ReadPrivate);
      expect(requests).not.toHaveBeenCalled();
    }
  );

  it('covers the terminal edit of a streamed reply with one thread receipt', async () => {
    const { mx, thread, requests } = await setupRoom();
    thread.initialEventsFetched = true;
    thread.addEvent(message('$reply', 3000, '$root'), false, false);
    thread.addEvent(streamEdit('$streaming', 3500, 'streaming'), false, false);
    await markThreadAsRead(mx, ROOM_ID, '$root', false);
    expect(requests).toHaveBeenLastCalledWith(
      'POST',
      `/rooms/${encodeURIComponent(ROOM_ID)}/receipt/${ReceiptType.Read}/%24reply`,
      undefined,
      { thread_id: '$root' }
    );

    thread.addEvent(streamEdit('$completed', 4000, 'completed'), false, false);
    requests.mockClear();
    await markThreadAsRead(mx, ROOM_ID, '$root', false);
    expect(requests).toHaveBeenCalledTimes(1);
    expect(requests).toHaveBeenCalledWith(
      'POST',
      `/rooms/${encodeURIComponent(ROOM_ID)}/receipt/${ReceiptType.Read}/%24completed`,
      undefined,
      { thread_id: '$root' }
    );

    requests.mockClear();
    await markThreadAsRead(mx, ROOM_ID, '$root', false);
    expect(requests).not.toHaveBeenCalled();
  });

  it('honors a synchronized receipt on the bundled edit that finished a summary-only reply', async () => {
    const { mx, room, thread, requests } = await setupRoom({
      replyEdit: rawStreamEdit('$completed', 4000, 'completed'),
    });
    expect(thread.replyToEvent?.replacingEvent()?.getId()).toBe('$completed');
    syncThreadReceipt(room, '$completed', 4500);

    expect(getThreadUnread(thread, USER_ID)).toBe(false);
    requests.mockClear();
    await markThreadAsRead(mx, ROOM_ID, '$root', false);
    expect(requests).not.toHaveBeenCalled();
  });

  it('honors a synchronized receipt on the terminal edit an unopened thread buffered', async () => {
    const { mx, room, thread, requests } = await setupRoom();
    await room.addLiveEvents([streamEdit('$completed', 4000, 'completed')], { addToState: false });
    expect(thread.replayEvents?.map((event) => event.getId())).toEqual(['$completed']);
    syncThreadReceipt(room, '$completed', 4500);

    expect(getThreadUnread(thread, USER_ID)).toBe(false);
    requests.mockClear();
    await markThreadAsRead(mx, ROOM_ID, '$root', false);
    expect(requests).not.toHaveBeenCalled();
  });

  it('acknowledges the edit bundled with a loaded reply in the thread', async () => {
    const { mx, thread, requests } = await setupRoom();
    thread.initialEventsFetched = true;
    // A reply fetched with its thread history carries its latest edit bundled.
    const reply = mx.getEventMapper()({
      ...message('$reply', 3000, '$root').event,
      unsigned: { 'm.relations': { [RelationType.Replace]: rawStreamEdit('$done', 4000, 'done') } },
    });
    thread.addEvent(reply, false, false);
    expect(thread.events.map((event) => event.getId())).not.toContain('$done');

    await markThreadAsRead(mx, ROOM_ID, '$root', false);
    expect(requests).toHaveBeenLastCalledWith('POST', receiptPath('$done'), undefined, {
      thread_id: '$root',
    });

    requests.mockClear();
    await markThreadAsRead(mx, ROOM_ID, '$root', false);
    expect(requests).not.toHaveBeenCalled();
  });

  it('acknowledges a reply that finished in an unopened thread after it was read', async () => {
    const { mx, room, requests } = await setupRoom();
    syncThreadReceipt(room, '$reply', 3500);
    await room.addLiveEvents([streamEdit('$completed', 4000, 'completed')], { addToState: false });

    await markThreadAsRead(mx, ROOM_ID, '$root', false);
    expect(requests).toHaveBeenLastCalledWith('POST', receiptPath('$completed'), undefined, {
      thread_id: '$root',
    });

    requests.mockClear();
    await markRoomAndThreadsAsRead(mx, ROOM_ID, false);
    expect(requests).toHaveBeenLastCalledWith('POST', receiptPath('$completed'), undefined, {});
  });

  it('never targets a terminal edit of the root with a thread receipt', async () => {
    const { mx, room, thread, requests } = await setupRoom();
    await room.addLiveEvents([streamEdit('$root-done', 4000, 'completed', '$root')], {
      addToState: false,
    });
    expect(thread.replayEvents?.map((event) => event.getId())).toEqual(['$root-done']);

    await markThreadAsRead(mx, ROOM_ID, '$root', false);
    expect(requests).toHaveBeenLastCalledWith('POST', receiptPath('$reply'), undefined, {
      thread_id: '$root',
    });
  });

  it('shows a reply read mid-stream as unread once it finishes while the user is away', async () => {
    const { room, thread } = await setupRoom();
    syncThreadReceipt(room, '$reply', 3500);
    expect(getThreadUnread(thread, USER_ID)).toBe(false);
    const threadUpdated = vi.fn();
    room.on(ThreadEvent.Update, threadUpdated);

    await room.addLiveEvents([streamEdit('$completed', 4000, 'completed')], { addToState: false });

    // The room overview recomputes its cards, sorting and filters on thread updates.
    await vi.waitFor(() => expect(threadUpdated).toHaveBeenCalled());
    expect(getRoomThreadsUnread(room.getThreads(), USER_ID).get('$root')).toBe(true);
  });

  it('shows a reply read mid-stream as unread when a reload brings its bundled finish', async () => {
    const { room, thread } = await setupRoom({
      replyEdit: rawStreamEdit('$completed', 4000, 'completed'),
    });
    syncThreadReceipt(room, '$reply', 3500);

    expect(getThreadUnread(thread, USER_ID)).toBe(true);
  });

  it('reads a finished reply once a receipt reaches its terminal edit', async () => {
    const { mx, thread } = await setupRoom();
    thread.initialEventsFetched = true;
    thread.addEvent(message('$reply', 3000, '$root'), false, false);
    await markThreadAsRead(mx, ROOM_ID, '$root', false);
    expect(getThreadUnread(thread, USER_ID)).toBe(false);

    thread.addEvent(streamEdit('$completed', 4000, 'completed'), false, false);
    expect(getThreadUnread(thread, USER_ID)).toBe(true);

    await markThreadAsRead(mx, ROOM_ID, '$root', false);
    expect(getThreadUnread(thread, USER_ID)).toBe(false);
  });

  it('rejects a receipt for a bundled reply that belongs to another thread', async () => {
    const { room, thread } = await setupRoom();
    thread.addEvent(message('$reply', 3000, '$root'), false, false);
    vi.spyOn(thread, 'replyToEvent', 'get').mockReturnValue(
      message('$foreign', 5000, '$other-root')
    );
    room.addReceipt(
      new MatrixEvent({
        type: 'm.receipt',
        room_id: ROOM_ID,
        content: {
          $foreign: { [ReceiptType.Read]: { [USER_ID]: { thread_id: '$root', ts: 5500 } } },
        },
      })
    );

    expect(getThreadUnread(thread, USER_ID)).toBe(true);
  });
});
