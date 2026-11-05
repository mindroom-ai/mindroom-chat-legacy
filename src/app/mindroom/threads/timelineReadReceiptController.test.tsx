import React from 'react';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { MatrixEvent, MatrixEventEvent, RelationType, RoomEvent } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markThreadAsRead } from '../notifications/readReceipts';
import {
  shouldMarkStreamFinishAsRead,
  useTimelineReadReceiptController,
} from './timelineReadReceiptController';

vi.mock('../notifications/readReceipts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../notifications/readReceipts')>()),
  markMainTimelineAsRead: vi.fn(),
  markRoomAndThreadsAsRead: vi.fn(),
  markThreadAsRead: vi.fn(),
}));

const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-root';
const REPLY_ID = '$reply';

const makeEdit = (status: string, { roomId = ROOM_ID, threadId = THREAD_ID } = {}) => {
  const edit = new MatrixEvent({
    content: {
      body: '* Done',
      msgtype: 'm.text',
      'm.new_content': { body: 'Done', msgtype: 'm.text', 'io.mindroom.stream_status': status },
      'm.relates_to': { event_id: REPLY_ID, rel_type: RelationType.Replace },
    },
    event_id: `$edit-${status}`,
    origin_server_ts: 2,
    room_id: roomId,
    sender: '@agent:example.org',
    type: 'm.room.message',
  });
  // The SDK attributes an edit of a thread reply to that reply's thread.
  edit.setThreadId(threadId);
  return edit;
};

const visible = {
  atBottom: true,
  atLiveEnd: true,
  hasFocus: true,
  roomId: ROOM_ID,
  threadId: THREAD_ID,
};

describe('shouldMarkStreamFinishAsRead', () => {
  it.each(['completed', 'cancelled', 'interrupted', 'error'])(
    'marks a visible reply read when its stream ends as %s',
    (status) => {
      expect(shouldMarkStreamFinishAsRead({ ...visible, event: makeEdit(status) })).toBe(true);
    }
  );

  it('ignores a streaming edit that is not terminal', () => {
    expect(shouldMarkStreamFinishAsRead({ ...visible, event: makeEdit('streaming') })).toBe(false);
  });

  it.each([
    ['the window is unfocused', { hasFocus: false }],
    ['the user scrolled up', { atBottom: false }],
    ['the timeline is not at its live end', { atLiveEnd: false }],
    ['no thread is open', { threadId: undefined }],
    ['another thread is open', { threadId: '$other-root' }],
    ['another room is open', { roomId: '!other:example.org' }],
  ])('sends nothing when %s', (_, override) => {
    expect(
      shouldMarkStreamFinishAsRead({ ...visible, ...override, event: makeEdit('completed') })
    ).toBe(false);
  });

  it('sends nothing for an edit without a replace relation', () => {
    const event = makeEdit('completed');
    event.event.content = { ...event.getContent(), 'm.relates_to': undefined };
    expect(shouldMarkStreamFinishAsRead({ ...visible, event })).toBe(false);
  });
});

type Listener = (...args: unknown[]) => void;

const makeEmitter = () => {
  const listeners = new Map<string, Set<Listener>>();
  return {
    on: (type: string, listener: Listener) => {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeListener: (type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener);
    },
    emit: (type: string, ...args: unknown[]) => {
      listeners.get(type)?.forEach((listener) => listener(...args));
    },
  };
};

describe('useTimelineReadReceiptController stream finish', () => {
  let hasFocus = true;

  beforeEach(() => {
    hasFocus = true;
    vi.mocked(markThreadAsRead).mockClear();
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      hasFocus: () => hasFocus,
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        disconnect = vi.fn();

        observe = vi.fn();

        unobserve = vi.fn();
      }
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderController = (atBottom = true) => {
    const roomEmitter = makeEmitter();
    const mxEmitter = makeEmitter();
    const room = { roomId: ROOM_ID, ...roomEmitter } as unknown as Room;
    const mx = mxEmitter as unknown as MatrixClient;

    // Stable props, as the timeline passes them; new refs each render would loop the observer.
    const props = {
      atBottom,
      atBottomAnchorRef: { current: null },
      atBottomRef: { current: atBottom },
      atLiveEndRef: { current: true },
      getScrollElement: () => null,
      handleOpenEvent: vi.fn(),
      hideActivity: true,
      mx,
      readUptoEventIdRef: { current: undefined },
      room,
      setAtBottom: vi.fn(),
      threadEventsLength: 2,
      threadId: THREAD_ID,
      threadInitialRenderMode: 'live' as const,
      threadTailLoaded: true,
      timelineAtLiveEnd: true,
      unreadInfo: undefined,
    };
    const Harness = () => {
      useTimelineReadReceiptController(props);
      return null;
    };

    act(() => {
      create(<Harness />);
    });
    // Opening the thread at its live end marks it read once; only later receipts matter here.
    vi.mocked(markThreadAsRead).mockClear();

    return {
      arrive: (event: MatrixEvent) =>
        roomEmitter.emit(RoomEvent.Timeline, event, room, false, false, { liveEvent: false }),
      decrypt: (event: MatrixEvent) => mxEmitter.emit(MatrixEventEvent.Decrypted, event),
    };
  };

  it('marks the thread read when the terminal edit arrives, as a non-live insert too', () => {
    const { arrive } = renderController();

    act(() => arrive(makeEdit('streaming')));
    expect(markThreadAsRead).not.toHaveBeenCalled();

    act(() => arrive(makeEdit('completed')));
    expect(markThreadAsRead).toHaveBeenCalledWith(expect.anything(), ROOM_ID, THREAD_ID, true);
  });

  it('marks the thread read when the terminal edit is decrypted', () => {
    const { decrypt } = renderController();

    act(() => decrypt(makeEdit('completed')));
    expect(markThreadAsRead).toHaveBeenCalledTimes(1);
  });

  it('sends nothing while the window is unfocused or the user scrolled away', () => {
    const scrolledAway = renderController(false);
    act(() => scrolledAway.arrive(makeEdit('completed')));

    hasFocus = false;
    const unfocused = renderController();
    act(() => unfocused.arrive(makeEdit('completed')));
    act(() => unfocused.decrypt(makeEdit('completed')));

    expect(markThreadAsRead).not.toHaveBeenCalled();
  });
});
