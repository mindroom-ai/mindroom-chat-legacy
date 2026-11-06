import React from 'react';
import type { MatrixClient, Room as RoomModel } from 'matrix-js-sdk';
import { createClient, MatrixEvent, MatrixEventEvent, RelationType, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markThreadAsRead } from '../notifications/readReceipts';
import { useTimelineReadReceiptController } from './timelineReadReceiptController';

vi.mock('../notifications/readReceipts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../notifications/readReceipts')>()),
  markMainTimelineAsRead: vi.fn(),
  markRoomAndThreadsAsRead: vi.fn(),
  markThreadAsRead: vi.fn(),
}));

const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-root';
const AGENT_ID = '@agent:example.org';

const rawReply = ({ roomId = ROOM_ID, threadId = THREAD_ID } = {}) => ({
  content: {
    body: 'Thinking',
    msgtype: 'm.text',
    'm.relates_to': { event_id: threadId, rel_type: RelationType.Thread },
  },
  event_id: '$reply',
  origin_server_ts: 1,
  room_id: roomId,
  sender: AGENT_ID,
  type: 'm.room.message',
});

const rawEdit = (status: string, roomId = ROOM_ID) => ({
  content: {
    body: '* Done',
    msgtype: 'm.text',
    'm.new_content': { body: 'Done', msgtype: 'm.text', 'io.mindroom.stream_status': status },
    'm.relates_to': { event_id: '$reply', rel_type: RelationType.Replace },
  },
  event_id: `$edit-${status}`,
  origin_server_ts: 2,
  room_id: roomId,
  sender: AGENT_ID,
  type: 'm.room.message',
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

let hasFocus = true;

beforeEach(() => {
  hasFocus = true;
  vi.mocked(markThreadAsRead).mockClear();
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    hasFocus: vi.fn(() => hasFocus),
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

type ViewOptions = {
  atLiveEnd?: boolean;
  distanceFromBottom?: number;
  threadOpen?: boolean;
};

const renderController = (
  mx: MatrixClient,
  room: RoomModel,
  { atLiveEnd = true, distanceFromBottom = 0, threadOpen = true }: ViewOptions = {}
) => {
  const scrollElement = {
    clientHeight: 500,
    scrollHeight: 2000,
    scrollTop: 1500 - distanceFromBottom,
  } as HTMLElement;
  // Stable props, as the timeline passes them; new refs each render would loop the observer.
  const props = {
    atBottom: true,
    atBottomAnchorRef: { current: null },
    // The debounced bottom state still says bottom for a second after the user scrolls away.
    atBottomRef: { current: true },
    atLiveEndRef: { current: atLiveEnd },
    getScrollElement: () => scrollElement,
    handleOpenEvent: vi.fn(),
    hideActivity: true,
    mx,
    readUptoEventIdRef: { current: undefined },
    room,
    setAtBottom: vi.fn(),
    threadEventsLength: 2,
    threadId: threadOpen ? THREAD_ID : undefined,
    threadInitialRenderMode: 'live' as const,
    threadTailLoaded: true,
    timelineAtLiveEnd: true,
    unreadInfo: undefined,
  };
  const Harness = () => {
    useTimelineReadReceiptController(props);
    return null;
  };

  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(<Harness />);
  });
  // Opening the thread at its live end marks it read once; only later receipts matter here.
  vi.mocked(markThreadAsRead).mockClear();
  vi.mocked(document.hasFocus).mockClear();
  return {
    atLiveEndRef: props.atLiveEndRef,
    scrollElement,
    unmount: () => act(() => renderer?.unmount()),
  };
};

// Frames that run only when the test says so, as when the browser is busy.
const holdFrames = () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  return {
    frames,
    run: () => act(() => frames.splice(0).forEach((callback) => callback(0))),
  };
};

describe('useTimelineReadReceiptController stream finish', () => {
  const setup = (view?: ViewOptions) => {
    const mxEmitter = makeEmitter();
    const rendered = renderController(
      mxEmitter as unknown as MatrixClient,
      { roomId: ROOM_ID } as unknown as RoomModel,
      view
    );
    return {
      ...rendered,
      finish: (reply = new MatrixEvent(rawReply()), status = 'completed') => {
        reply.makeReplaced(new MatrixEvent(rawEdit(status, reply.getRoomId())));
        act(() => mxEmitter.emit(MatrixEventEvent.Replaced, reply));
      },
    };
  };

  it.each(['completed', 'cancelled', 'interrupted', 'error'])(
    'marks the open thread read when a watched reply ends as %s',
    (status) => {
      setup().finish(undefined, status);
      expect(markThreadAsRead).toHaveBeenCalledWith(expect.anything(), ROOM_ID, THREAD_ID, true);
    }
  );

  it('ignores an edit that keeps the reply streaming', () => {
    setup().finish(undefined, 'streaming');
    expect(markThreadAsRead).not.toHaveBeenCalled();
  });

  it.each<[string, ViewOptions, Parameters<typeof rawReply>[0]]>([
    ['the user scrolled away before the bottom state caught up', { distanceFromBottom: 1500 }, {}],
    ['the timeline is not at its live end', { atLiveEnd: false }, {}],
    ['the reply is in another thread', {}, { threadId: '$other-root' }],
    ['the reply is in another room', {}, { roomId: '!other:example.org' }],
  ])('sends nothing when %s', (_, view, reply) => {
    setup(view).finish(new MatrixEvent(rawReply(reply)));
    expect(markThreadAsRead).not.toHaveBeenCalled();
  });

  it('sends nothing while the window is unfocused', () => {
    const { finish } = setup();
    hasFocus = false;
    finish();
    expect(markThreadAsRead).not.toHaveBeenCalled();
  });

  it('sends nothing when the window loses focus before the frame', () => {
    const { frames, run } = holdFrames();
    const { finish } = setup();
    frames.length = 0;

    finish();
    expect(frames).toHaveLength(1);
    hasFocus = false;
    run();

    expect(markThreadAsRead).not.toHaveBeenCalled();
  });

  // A mark scheduled earlier, by opening the thread or a new reply, must not
  // read a finish the user no longer watches when the frame runs.
  it('drops a scheduled mark when the user scrolls away and the reply then finishes', () => {
    const { frames, run } = holdFrames();
    const { finish, scrollElement } = setup();
    expect(frames).toHaveLength(1);

    scrollElement.scrollTop = 0;
    finish();
    run();

    expect(markThreadAsRead).not.toHaveBeenCalled();
  });

  it('drops a scheduled mark when the user leaves the thread before the frame', () => {
    const { frames, run } = holdFrames();
    const { finish, unmount } = setup();
    expect(frames).toHaveLength(1);

    unmount();
    finish();
    run();

    expect(markThreadAsRead).not.toHaveBeenCalled();
  });

  it('drops a scheduled mark when the user leaves the live end before the frame', () => {
    const { frames, run } = holdFrames();
    const { atLiveEndRef, finish } = setup();
    expect(frames).toHaveLength(1);

    atLiveEndRef.current = false;
    finish();
    run();

    expect(markThreadAsRead).not.toHaveBeenCalled();
  });

  it('keeps a scheduled mark while the user still watches the finish', () => {
    const { frames, run } = holdFrames();
    const { finish } = setup();
    expect(frames).toHaveLength(1);

    finish();
    run();

    expect(markThreadAsRead).toHaveBeenCalledTimes(2);
  });

  it('reads neither focus nor the reply while no thread is open', () => {
    setup({ threadOpen: false }).finish();
    expect(document.hasFocus).not.toHaveBeenCalled();
    expect(markThreadAsRead).not.toHaveBeenCalled();
  });
});

describe('useTimelineReadReceiptController stream finish with SDK models', () => {
  let previousThreadSupport: FeatureSupport;

  beforeEach(() => {
    previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
  });

  afterEach(() => {
    Thread.hasServerSideSupport = previousThreadSupport;
    vi.restoreAllMocks();
  });

  const setupThread = () => {
    const mx = createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
    vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
    vi.spyOn(mx.http, 'authedRequest').mockResolvedValue({});
    const room = new Room(ROOM_ID, mx, '@alice:example.org');
    mx.store.storeRoom(room);
    const mapEvent = mx.getEventMapper();
    const root = mapEvent({
      content: { body: 'Question', msgtype: 'm.text' },
      event_id: THREAD_ID,
      origin_server_ts: 0,
      room_id: ROOM_ID,
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false });
    const thread = room.createThread(THREAD_ID, root, [], false);
    thread.initialEventsFetched = true;
    thread.addEvent(mapEvent(rawReply()), false, false);
    renderController(mx, room);
    return { mapEvent, thread };
  };

  it('marks the thread read when the terminal edit arrives in the open thread', async () => {
    const { mapEvent, thread } = setupThread();

    thread.addEvent(mapEvent(rawEdit('streaming')), false, false);
    await vi.waitFor(() => expect(thread.findEventById('$reply')?.replacingEvent()).toBeTruthy());
    expect(markThreadAsRead).not.toHaveBeenCalled();

    thread.addEvent(mapEvent(rawEdit('completed')), false, false);
    await vi.waitFor(() => expect(markThreadAsRead).toHaveBeenCalledTimes(1));
  });

  it('marks the thread read when a refetched reply brings its terminal edit', () => {
    const { mapEvent, thread } = setupThread();

    // A reply fetched again (gap recovery, backfill) carries its latest edit bundled.
    // Servers bundle the edit without its room.
    const { room_id: _roomId, ...bundledEdit } = rawEdit('completed');
    mapEvent({ ...rawReply(), unsigned: { 'm.relations': { 'm.replace': bundledEdit } } });

    expect(thread.findEventById('$reply')?.replacingEvent()?.getId()).toBe('$edit-completed');
    expect(markThreadAsRead).toHaveBeenCalledTimes(1);
  });
});
