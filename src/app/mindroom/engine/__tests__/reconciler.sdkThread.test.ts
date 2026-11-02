import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import type { IEvent, Thread } from 'matrix-js-sdk';
import { Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { FeatureSupport, Thread as SdkThread, ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { createBackfillScheduler } from '../backfillScheduler';
import { scheduleReconcile } from '../reconciler';
import { createInitializedThreadForRoot } from '../../threads/sdk/threadBootstrapSdk';
import type { HydratedThreadCachePage } from '../../threads/types';

const ROOT = '$root';
const SENDER = '@agent:example.org';

const reply = (index: number): Partial<IEvent> => ({
  event_id: `$reply-${index}`,
  room_id: '!room:example.org',
  type: 'm.room.message',
  sender: SENDER,
  origin_server_ts: 100 * index,
  content: {
    msgtype: 'm.text',
    body: `reply ${index}`,
    'm.relates_to': { rel_type: 'm.thread', event_id: ROOT },
  },
});

const edit = (index: number): Partial<IEvent> => ({
  event_id: `$edit-${index}`,
  room_id: '!room:example.org',
  type: 'm.room.message',
  sender: SENDER,
  origin_server_ts: 100 * index + 10,
  content: {
    msgtype: 'm.text',
    body: `* reply ${index} edited`,
    'm.new_content': { msgtype: 'm.text', body: `reply ${index} edited` },
    'm.relates_to': { rel_type: 'm.replace', event_id: `$reply-${index}` },
  },
});

/** Replies 1..count, each followed by its edit, in server order. */
const thread = (count: number): Partial<IEvent>[] =>
  Array.from({ length: count }, (_, i) => [reply(i + 1), edit(i + 1)]).flat();

const ids = (events: readonly Partial<IEvent>[]): string[] =>
  events.map((event) => event.event_id as string);

// The SDK announces replies after an awaited metadata update.
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const setup = () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  mx.canSupport.set(Feature.RelationsRecursion, ServerSupport.Stable);
  const room = new Room('!room:example.org', mx, '@alice:example.org', { timelineSupport: true });
  mx.store.storeRoom(room);
  const root = new MatrixEvent({
    event_id: ROOT,
    room_id: room.roomId,
    type: 'm.room.message',
    sender: SENDER,
    origin_server_ts: 1,
    content: { msgtype: 'm.text', body: 'root' },
  });
  return { mx, room, root, mapper: mx.getEventMapper() };
};

/** Records what the SDK announces while the reconcile adds `server` to `sdkThread`. */
const reconcile = async (
  { mx, room }: ReturnType<typeof setup>,
  sdkThread: Thread,
  server: Partial<IEvent>[]
) => {
  const newReplies: string[] = [];
  const liveArrivals: string[] = [];
  sdkThread.on(ThreadEvent.NewReply, (_thread, event) => newReplies.push(event.getId()!));
  sdkThread.on(RoomEvent.Timeline, (event, _room, _toStart, _removed, data) => {
    if (data.liveEvent) liveArrivals.push(event.getId()!);
  });
  vi.spyOn(mx, 'fetchRelations').mockResolvedValue({ chunk: server.slice().reverse() as never });
  const onRepaired = vi.fn();
  const result = await scheduleReconcile({
    mx,
    sessionId: 'session',
    scheduler: createBackfillScheduler({ mx }),
    roomId: room.roomId,
    room,
    threadId: ROOT,
    cachedPage: { events: [], hasMoreBefore: true, tailLoaded: true } as HydratedThreadCachePage,
    persistRepair: () => ({ rawEvents: [], loadedReplyCount: 0, write: Promise.resolve(true) }),
    onRepaired,
  });
  await settle();
  expect(result.repaired).toBe(true);
  return { newReplies, liveArrivals, onRepaired };
};

describe('reconciler SDK thread injection', () => {
  let support: FeatureSupport;
  beforeEach(() => {
    support = SdkThread.hasServerSideSupport;
    SdkThread.hasServerSideSupport = FeatureSupport.Stable;
  });
  afterEach(() => {
    SdkThread.hasServerSideSupport = support;
    vi.restoreAllMocks();
  });

  it('adds history older than the SDK window as backfill, not as new replies', async () => {
    const env = setup();
    const server = thread(40);
    // Like a fresh app open: the SDK thread holds only the latest page.
    const sdkThread = createInitializedThreadForRoot(env.room, env.root);
    sdkThread.addEvents(server.slice(-6).map(env.mapper), false);
    await settle();

    const { newReplies, liveArrivals } = await reconcile(env, sdkThread, server);

    expect(newReplies).toEqual([]);
    expect(liveArrivals).toEqual([]);
    expect(sdkThread.events.map((event) => event.getId())).toEqual(ids(server));
  });

  it('appends events newer than the SDK window as new replies, not as live events', async () => {
    // Announced as live, each fetched edit and reaction re-hydrated the open thread's
    // render fallback and was saved on its own: a cold start into a long thread froze
    // for 5.5 s in Chromium at 4x CPU throttling.
    const env = setup();
    const server = thread(40);
    const sdkThread = createInitializedThreadForRoot(env.room, env.root);
    sdkThread.addEvents(server.slice(68, 76).map(env.mapper), false);
    await settle();

    const { newReplies, liveArrivals } = await reconcile(env, sdkThread, server);

    expect(newReplies).toEqual(['$reply-39', '$reply-40']);
    expect(liveArrivals).toEqual([]);
    expect(sdkThread.events.map((event) => event.getId())).toEqual(ids(server));
    expect(sdkThread.lastReply()?.getId()).toBe('$reply-40');
  });

  it('appends to a window that starts at the root as history, not as live events', async () => {
    const env = setup();
    const server = thread(5);
    const sdkThread = createInitializedThreadForRoot(env.room, env.root);
    sdkThread.timelineSet.addEventsToTimeline(
      [env.root],
      true,
      false,
      sdkThread.liveTimeline,
      null
    );
    sdkThread.addEvents(server.slice(0, 6).map(env.mapper), false);
    await settle();

    const { newReplies, liveArrivals } = await reconcile(env, sdkThread, server);

    expect(newReplies).toEqual(['$reply-4', '$reply-5']);
    expect(liveArrivals).toEqual([]);
    expect(sdkThread.events.map((event) => event.getId())).toEqual([ROOT, ...ids(server)]);
  });

  it('adds everything as backfill to an opened thread with an empty window', async () => {
    const env = setup();
    const server = thread(10);
    const sdkThread = createInitializedThreadForRoot(env.room, env.root);

    const { newReplies, liveArrivals } = await reconcile(env, sdkThread, server);

    expect(newReplies).toEqual([]);
    expect(liveArrivals).toEqual([]);
    expect(sdkThread.events.map((event) => event.getId())).toEqual(ids(server));
  });

  // A sync gap leaves the window in an older segment; the SDK defers the new live
  // segment until an event is added to the thread.
  const gappedThread = (env: ReturnType<typeof setup>, server: Partial<IEvent>[]) => {
    const sdkThread = createInitializedThreadForRoot(env.room, env.root);
    sdkThread.addEvents(server.slice(-6).map(env.mapper), false);
    sdkThread.deferLiveTimelineReset('gap-back', 'gap-forward');
    return sdkThread;
  };
  const segmentEventIds = (sdkThread: Thread) =>
    sdkThread
      .getUnfilteredTimelineSet()
      .getTimelines()
      .map((timeline) => timeline.getEvents().map((event) => event.getId()));
  const flushGap = (sdkThread: Thread) => {
    // The new segment exists at once; converting its tokens needs a server.
    void sdkThread.flushPendingTimelineReset()?.catch(() => undefined);
  };

  it('leaves history behind an older segment out of the live segment after a sync gap', async () => {
    const env = setup();
    const server = thread(40);
    const sdkThread = gappedThread(env, server);
    await settle();

    await reconcile(env, sdkThread, server);

    // The older history belongs behind the older segment; pagination places it there.
    expect(segmentEventIds(sdkThread)).toEqual([ids(server.slice(-6)), []]);
  });

  it('adds replies newer than an older segment to an empty live segment after a sync gap', async () => {
    const env = setup();
    const sdkThread = gappedThread(env, thread(40));
    flushGap(sdkThread);
    await settle();

    await reconcile(env, sdkThread, thread(42));

    expect(segmentEventIds(sdkThread)).toEqual([
      ids(thread(40).slice(-6)),
      ids(thread(42).slice(-4)),
    ]);
    expect(sdkThread.lastReply()?.getId()).toBe('$reply-42');
  });

  it('leaves a fetched page from deep in the history out of the live segment', async () => {
    const env = setup();
    const sdkThread = gappedThread(env, thread(40));
    flushGap(sdkThread);
    sdkThread.addEvents(thread(42).slice(-4).map(env.mapper), false);
    await settle();

    // A scan resumed from a saved position can fetch only an old page.
    await reconcile(env, sdkThread, thread(10));

    expect(segmentEventIds(sdkThread)).toEqual([
      ids(thread(40).slice(-6)),
      ids(thread(42).slice(-4)),
    ]);
  });

  it('leaves a late edit of an older reply out of the live segment', async () => {
    const env = setup();
    const sdkThread = gappedThread(env, thread(40));
    flushGap(sdkThread);
    await settle();
    // Sent after reply 40 but before its edit, both of which the older segment holds.
    const lateEdit = { ...edit(39), event_id: '$edit-39-late', origin_server_ts: 4005 };

    await reconcile(env, sdkThread, [
      ...thread(40).slice(0, -1),
      lateEdit,
      edit(40),
      reply(41),
      edit(41),
    ]);

    expect(segmentEventIds(sdkThread)).toEqual([
      ids(thread(40).slice(-6)),
      ['$reply-41', '$edit-41'],
    ]);
  });

  it('leaves an unopened thread to load its own first page', async () => {
    const env = setup();
    const server = thread(10);
    const sdkThread = env.room.createThread(ROOT, env.root, [], false);
    sdkThread.addEvents(server.slice(-2).map(env.mapper), false);
    await settle();
    const eventsBefore = sdkThread.events.map((event) => event.getId());
    const replayBefore = sdkThread.replayEvents?.length;

    const { newReplies, onRepaired } = await reconcile(env, sdkThread, server);

    expect(sdkThread.initialEventsFetched).toBe(false);
    expect(newReplies).toEqual([]);
    expect(sdkThread.events.map((event) => event.getId())).toEqual(eventsBefore);
    expect(sdkThread.replayEvents?.length).toBe(replayBefore);
    // The render still receives the repaired batch.
    expect(onRepaired).toHaveBeenCalledTimes(1);
  });
});
