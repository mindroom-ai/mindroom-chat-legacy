import {
  createClient,
  MatrixEvent,
  Room,
  RoomEvent,
  ThreadEvent,
  type IEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { Direction } from 'matrix-js-sdk/lib/models/event-timeline';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { MemoryStore } from 'matrix-js-sdk/lib/store/memory';
import type { ISavedSync } from 'matrix-js-sdk/lib/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRoomThreads } from './roomThreadList';
import { restoreCachedRoomThreads } from './sdk/roomTimelineSdk';

const roomId = '!room:example.org';
const userId = '@alice:example.org';

const message = (eventId: string, ts: number, content: Record<string, unknown> = {}): IEvent =>
  ({
    event_id: eventId,
    room_id: roomId,
    sender: userId,
    type: 'm.room.message',
    origin_server_ts: ts,
    unsigned: {},
    content: { msgtype: 'm.text', body: eventId, ...content },
  } as IEvent);
const reply = (rootId: string, index: number, ts = index + 1): IEvent =>
  message(`${rootId}-reply-${index}`, ts, {
    'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
  });
/** A root as listed by /threads or /event: its unsigned bundle is the server's thread summary. */
const summarizedRoot = (rootId: string, count: number, ts = 0): IEvent => ({
  ...message(rootId, ts),
  unsigned: {
    'm.relations': {
      'm.thread': {
        count,
        current_user_participated: true,
        latest_event: reply(rootId, count, ts + count),
      },
    },
  },
});
const rootIdAt = (index: number) => `$root-${String(index).padStart(3, '0')}`;
const edit = (targetId: string, body: string, ts: number) =>
  new MatrixEvent(
    message(`$edit-${ts}`, ts, {
      body: `* ${body}`,
      'm.new_content': { msgtype: 'm.text', body },
      'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
    })
  );
const replyCount = (root: IEvent | undefined) =>
  (root?.unsigned?.['m.relations'] as { 'm.thread'?: { count: number } } | undefined)?.['m.thread']
    ?.count ?? 0;

const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

type ServerOptions = { roots?: IEvent[]; store?: MemoryStore; syncs?: unknown[] };

/** Real SDK client whose fetch transport records every Matrix request it is asked to send. */
const server = ({ roots = [], store, syncs = [] }: ServerOptions = {}) => {
  const requests: URL[] = [];
  const network: {
    relationsDown: boolean;
    relationsHeld?: Promise<void>;
    rootHeld?: Promise<void>;
  } = { relationsDown: false };
  const rootsById = new Map(roots.map((root) => [root.event_id, root]));
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const client = createClient({
    baseUrl: 'https://example.org',
    userId,
    accessToken: 'token',
    timelineSupport: true,
    store,
    fetchFn: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      const path = decodeURIComponent(url.pathname);
      if (path.endsWith('/versions'))
        return json({ versions: ['v1.4', 'v1.10'], unstable_features: {} });
      if (path.endsWith('/pushrules/')) return json({ global: {} });
      if (path.endsWith('/filter')) return json({ filter_id: 'filter' });
      if (path.endsWith('/capabilities')) return json({ capabilities: {} });
      if (path.endsWith('/sync')) {
        const response = syncs.shift();
        return response ? json(response) : new Promise<Response>(() => {});
      }
      if (path.endsWith('/messages')) return json({ chunk: [], start: 'start', end: 'end' });
      if (path.endsWith('/threads')) {
        const listed = [...rootsById.values()].reverse();
        const from = Number(url.searchParams.get('from') ?? 0);
        const limit = Number(url.searchParams.get('limit'));
        const next = from + limit < listed.length ? String(from + limit) : undefined;
        return json({ chunk: listed.slice(from, from + limit), next_batch: next });
      }
      const eventId = path.match(/\/event\/(.+)$/)?.[1];
      if (eventId) {
        await network.rootHeld;
        return json(rootsById.get(eventId) ?? message(eventId, 0));
      }
      const relationsRoot = path.match(/\/relations\/([^/]+)/)?.[1];
      if (relationsRoot) {
        await network.relationsHeld;
        if (network.relationsDown) throw new TypeError('Load failed');
        const latest = reply(relationsRoot, replyCount(rootsById.get(relationsRoot)));
        return json({ chunk: [latest], next_batch: 'older' });
      }
      throw new Error(`Unexpected request ${path}`);
    },
  });
  const count = (pattern: RegExp, from = 0) =>
    requests.slice(from).filter((url) => pattern.test(decodeURIComponent(url.pathname))).length;
  return {
    client,
    network,
    requests,
    rootFetches: (from?: number) => count(/\/event\//, from),
    relationPages: (from?: number) => count(/\/relations\//, from),
    threadListPages: (from?: number) => count(/\/threads$/, from),
  };
};

const roomFor = (client: MatrixClient) => {
  vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
  const room = new Room(roomId, client, userId, { timelineSupport: true });
  room.setMaxListeners(0);
  client.store.storeRoom(room);
  return room;
};

describe('SDK thread bootstrap requests', () => {
  let support: [FeatureSupport, FeatureSupport, FeatureSupport];
  beforeEach(() => {
    support = [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ];
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    Thread.hasServerSideListSupport = FeatureSupport.Stable;
    Thread.hasServerSideFwdPaginationSupport = FeatureSupport.Stable;
  });
  afterEach(() => {
    [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ] = support;
    vi.restoreAllMocks();
  });

  it('lists 100 cached roots from their summaries without a request per thread', async () => {
    // Before deferral this sent 200 root requests and 100 relation pages.
    const f = server();
    const room = roomFor(f.client);
    const mapper = f.client.getEventMapper();
    const roots = Array.from({ length: 100 }, (_, index) => ({
      rootEvent: mapper(summarizedRoot(rootIdAt(index), 3)),
    }));

    restoreCachedRoomThreads(room, roots);
    await settle();

    expect(f.requests).toHaveLength(0);
    expect(room.getThreads()).toHaveLength(100);
    const thread = room.getThread(rootIdAt(7))!;
    expect(thread.length).toBe(3);
    expect(thread.replyToEvent?.getId()).toBe(`${rootIdAt(7)}-reply-3`);
    expect(thread.hasCurrentUserParticipated).toBe(true);
  });

  it('pages the server thread list without initializing every listed thread', async () => {
    const f = server({
      roots: Array.from({ length: 90 }, (_, index) => summarizedRoot(rootIdAt(index), 2, index)),
    });
    const room = roomFor(f.client);

    await loadRoomThreads(room);
    await settle();

    expect(room.getThreads()).toHaveLength(90);
    // All and My lists, then two more pages of the All list.
    expect(f.threadListPages()).toBe(4);
    expect(f.rootFetches()).toBe(0);
    expect(f.relationPages()).toBe(0);
  });

  it('initializes a listed thread once when it is opened', async () => {
    const root = summarizedRoot(rootIdAt(1), 4);
    const f = server({ roots: [root] });
    const room = roomFor(f.client);
    room.processThreadRoots([f.client.getEventMapper()(root)], true);
    const thread = room.getThread(rootIdAt(1))!;
    await settle();
    expect(thread.initialEventsFetched).toBe(false);

    await Promise.all([thread.initialize(), thread.initialize()]);
    await thread.initialize();

    expect(f.rootFetches()).toBe(1);
    expect(f.relationPages()).toBe(1);
    expect(thread.initialEventsFetched).toBe(true);
    expect(thread.events.map((event) => event.getId())).toContain(`${rootIdAt(1)}-reply-4`);
    expect(thread.liveTimeline.getPaginationToken(Direction.Backward)).toBe('older');
  });

  it('keeps a failed opening from resetting the thread on later events', async () => {
    const root = summarizedRoot(rootIdAt(1), 2);
    const f = server({ roots: [root] });
    const room = roomFor(f.client);
    room.processThreadRoots([f.client.getEventMapper()(root)], true);
    const thread = room.getThread(rootIdAt(1))!;
    f.network.relationsDown = true;
    await thread.initialize();
    // The app's own open bootstrap still fills the timeline.
    const fetched = new MatrixEvent(reply(rootIdAt(1), 1));
    thread.timelineSet.addEventsToTimeline([fetched], true, false, thread.liveTimeline, 'older');
    const pages = f.relationPages();

    const liveReply = new MatrixEvent(reply(rootIdAt(1), 3, 10));
    await room.addLiveEvents([liveReply], { addToState: false });
    await settle();

    expect(f.relationPages()).toBe(pages);
    expect(thread.events).toEqual([fetched, liveReply]);
  });

  it('does not reject events that arrived while a failing first page loaded', async () => {
    const root = summarizedRoot(rootIdAt(1), 2);
    const f = server({ roots: [root] });
    const room = roomFor(f.client);
    room.processThreadRoots([f.client.getEventMapper()(root)], true);
    const thread = room.getThread(rootIdAt(1))!;
    let release!: () => void;
    f.network.relationsHeld = new Promise((resolve) => {
      release = resolve;
    });
    f.network.relationsDown = true;
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const opening = thread.initialize();
      await vi.waitFor(() => expect(f.relationPages()).toBe(1));
      await room.addLiveEvents([new MatrixEvent(reply(rootIdAt(1), 3, 10))], { addToState: false });
      release();
      await opening;
      await settle();
    } finally {
      process.off('unhandledRejection', unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
    expect(thread.initialEventsFetched).toBe(false);
  });

  it('keeps edits that arrived during a failed opening for the next one', async () => {
    const root = summarizedRoot(rootIdAt(1), 3);
    const f = server({ roots: [root] });
    const room = roomFor(f.client);
    room.processThreadRoots([f.client.getEventMapper()(root)], true);
    const thread = room.getThread(rootIdAt(1))!;
    const liveReply = reply(rootIdAt(1), 3, 10);
    await room.addLiveEvents([new MatrixEvent(liveReply)], { addToState: false });
    let release!: () => void;
    f.network.rootHeld = new Promise((resolve) => {
      release = resolve;
    });
    f.network.relationsDown = true;

    const opening = thread.initialize();
    await vi.waitFor(() => expect(f.rootFetches()).toBe(1));
    await room.addLiveEvents([edit(liveReply.event_id, 'edited while loading', 11)], {
      addToState: false,
    });
    release();
    await opening;
    f.network.relationsDown = false;
    await thread.initialize();
    await settle();

    // The first page shows this reply as a new object, with the buffered edit replayed onto it.
    expect(thread.findEventById(liveReply.event_id)!.getContent().body).toBe(
      'edited while loading'
    );
  });

  it.each([false, true])(
    'drops an edit and a reaction redacted before opening (after a failed first page: %s)',
    async (failedFirst) => {
      const rootId = rootIdAt(1);
      const f = server({ roots: [summarizedRoot(rootId, 3)] });
      const room = roomFor(f.client);
      room.processThreadRoots([f.client.getEventMapper()(summarizedRoot(rootId, 3))], true);
      const thread = room.getThread(rootId)!;
      const replyId = `${rootId}-reply-3`;
      await room.addLiveEvents([new MatrixEvent(reply(rootId, 3, 10))], { addToState: false });
      if (failedFirst) {
        f.network.relationsDown = true;
        await thread.initialize();
        f.network.relationsDown = false;
        await room.addLiveEvents([new MatrixEvent(reply(rootId, 3, 10))], { addToState: false });
      }
      const reaction = new MatrixEvent(
        message('$reaction', 11, {
          'm.relates_to': { rel_type: 'm.annotation', event_id: replyId, key: '🛑' },
        })
      );
      reaction.event.type = 'm.reaction';
      const redaction = (eventId: string, ts: number) =>
        new MatrixEvent({
          ...message(`$redaction-${ts}`, ts),
          type: 'm.room.redaction',
          redacts: eventId,
          content: { redacts: eventId },
        });
      const reactionCount = () =>
        thread.timelineSet.relations
          .getChildEventsForEvent(replyId, 'm.annotation', 'm.reaction')
          ?.getSortedAnnotationsByKey()
          ?.find(([key]) => key === '🛑')?.[1].size ?? 0;
      await room.addLiveEvents([reaction, edit(replyId, 'deleted edit', 12)], {
        addToState: false,
      });
      expect(reactionCount()).toBe(1);

      await room.addLiveEvents([redaction('$reaction', 13), redaction('$edit-12', 14)], {
        addToState: false,
      });
      expect(reactionCount()).toBe(0);
      await thread.initialize();
      await settle();

      expect(thread.initialEventsFetched).toBe(true);
      expect(reactionCount()).toBe(0);
      expect(thread.findEventById(replyId)!.getContent().body).toBe(replyId);
    }
  );

  it('retries opening a thread whose first page failed', async () => {
    const root = summarizedRoot(rootIdAt(1), 2);
    const f = server({ roots: [root] });
    const room = roomFor(f.client);
    room.processThreadRoots([f.client.getEventMapper()(root)], true);
    const thread = room.getThread(rootIdAt(1))!;

    f.network.relationsDown = true;
    await thread.initialize();
    expect(thread.initialEventsFetched).toBe(false);
    f.network.relationsDown = false;
    await thread.initialize();

    expect(thread.initialEventsFetched).toBe(true);
    expect(thread.events.map((event) => event.getId())).toContain(`${rootIdAt(1)}-reply-2`);
    expect(f.relationPages()).toBe(2);
  });

  it('keeps opened threads from refetching their roots when another thread initializes', async () => {
    const roots = [summarizedRoot(rootIdAt(1), 2), summarizedRoot(rootIdAt(2), 2)];
    const f = server({ roots });
    const room = roomFor(f.client);
    room.processThreadRoots(roots.map(f.client.getEventMapper()), true);
    const [first, second] = roots.map((root) => room.getThread(root.event_id)!);
    await first.initialize();
    const before = f.requests.length;

    // The second thread's own timeline reset reaches every thread through the room.
    await second.initialize();
    await room.addLiveEvents([new MatrixEvent(reply(rootIdAt(1), 3, 10))], { addToState: false });
    await settle();

    expect(f.rootFetches(before)).toBe(1);
    expect(f.relationPages(before)).toBe(1);
  });

  it('refreshes only initialized thread roots after a room sync gap', async () => {
    const roots = [summarizedRoot(rootIdAt(1), 2), summarizedRoot(rootIdAt(2), 2)];
    const f = server({ roots });
    const room = roomFor(f.client);
    room.processThreadRoots(roots.map(f.client.getEventMapper()), true);
    const [unopened, initialized] = roots.map((root) => room.getThread(root.event_id)!);
    // As the app's open bootstrap marks a zero-reply root it created itself.
    initialized.initialEventsFetched = true;
    initialized.replayEvents = null;
    await room.addLiveEvents([new MatrixEvent(reply(rootIdAt(1), 3, 10))], { addToState: false });

    room.resetLiveTimeline('back', 'forward');
    await settle();
    await room.addLiveEvents(
      [new MatrixEvent(reply(rootIdAt(1), 4, 20)), new MatrixEvent(reply(rootIdAt(2), 3, 21))],
      { addToState: false }
    );
    await settle();

    // The unopened thread keeps its live count instead of its stored summary.
    expect(unopened.length).toBe(4);
    expect(
      f.requests
        .map((url) => decodeURIComponent(url.pathname))
        .filter((path) => path.includes('/event/'))
    ).toEqual([`/_matrix/client/v3/rooms/${roomId}/event/${rootIdAt(2)}`]);
  });

  it('applies edits made after opening to the replies the first page shows', async () => {
    const rootId = rootIdAt(1);
    const f = server({ roots: [summarizedRoot(rootId, 1)] });
    const room = roomFor(f.client);
    room.processThreadRoots([f.client.getEventMapper()(summarizedRoot(rootId, 1))], true);
    const thread = room.getThread(rootId)!;
    // The page returns this reply again as a new object.
    const replyId = `${rootId}-reply-1`;
    await room.addLiveEvents([new MatrixEvent(reply(rootId, 1))], { addToState: false });
    await room.addLiveEvents([edit(replyId, 'before opening', 5)], { addToState: false });

    await thread.initialize();
    await room.addLiveEvents([edit(replyId, 'after opening', 6)], { addToState: false });
    await settle();

    expect(thread.findEventById(replyId)!.getContent().body).toBe('after opening');
  });

  it('streams edits of a summary-only reply without a request per edit', async () => {
    const rootId = rootIdAt(1);
    const f = server({ roots: [summarizedRoot(rootId, 2)] });
    const room = roomFor(f.client);
    room.processThreadRoots([f.client.getEventMapper()(summarizedRoot(rootId, 2))], true);
    const thread = room.getThread(rootId)!;
    // The thread knows this reply only from its root's summary.
    const replyId = `${rootId}-reply-2`;

    for (let chunk = 1; chunk <= 5; chunk += 1) {
      await room.addLiveEvents([edit(replyId, `chunk ${chunk}`, 10 + chunk)], {
        addToState: false,
      });
    }
    await settle();
    expect(f.requests).toHaveLength(0);
    // Only the newest edit waits for the first page.
    expect(thread.replayEvents).toHaveLength(1);

    await thread.initialize();
    await settle();
    expect(f.rootFetches()).toBe(1);
    expect(f.relationPages()).toBe(1);
    expect(thread.findEventById(replyId)!.getContent().body).toBe('chunk 5');
  });

  it('replays what an unopened thread buffered as history, not as new events', async () => {
    // Opening a thread announced each buffered reaction and edit as a live event, one at a
    // time, so live-event listeners saved and rendered each on its own.
    const rootId = rootIdAt(1);
    const f = server({ roots: [summarizedRoot(rootId, 30)] });
    // Tuwunel serves recursive relations, so the SDK appends replayed relations.
    f.client.canSupport.set(Feature.RelationsRecursion, ServerSupport.Stable);
    const room = roomFor(f.client);
    room.processThreadRoots([f.client.getEventMapper()(summarizedRoot(rootId, 30))], true);
    const thread = room.getThread(rootId)!;
    // The saved sync holds the replies, then their reactions and streamed edits.
    await room.addLiveEvents(
      Array.from({ length: 30 }, (_, index) => new MatrixEvent(reply(rootId, index + 1))),
      { addToState: false, fromCache: true }
    );
    const relations = Array.from({ length: 30 }, (_, index) => {
      const replyId = `${rootId}-reply-${index + 1}`;
      const reaction = new MatrixEvent(
        message(`$reaction-${index}`, 100 + index, {
          'm.relates_to': { rel_type: 'm.annotation', event_id: replyId, key: '🛑' },
        })
      );
      reaction.event.type = 'm.reaction';
      return [reaction, edit(replyId, `final ${index + 1}`, 200 + index)];
    }).flat();
    await room.addLiveEvents(relations, { addToState: false, fromCache: true });
    expect(thread.replayEvents).toHaveLength(60);
    await settle();
    const live = vi.fn();
    const updates = vi.fn();
    room.on(RoomEvent.Timeline, (_event, _room, toStart, _removed, data) => {
      if (!toStart && data?.liveEvent) live();
    });
    room.on(ThreadEvent.Update, updates);

    await thread.initialize();
    await settle();

    expect(live).not.toHaveBeenCalled();
    // The opening's own updates, not one per replayed event.
    expect(updates.mock.calls.length).toBeLessThanOrEqual(2);
    // The first page holds the latest reply, whose buffered edit still applies.
    expect(thread.findEventById(`${rootId}-reply-30`)!.getContent().body).toBe('final 30');
    const stopCount = thread.timelineSet.relations
      .getChildEventsForEvent(`${rootId}-reply-1`, 'm.annotation', 'm.reaction')
      ?.getSortedAnnotationsByKey()
      ?.find(([key]) => key === '🛑')?.[1].size;
    expect(stopCount).toBe(1);
  });

  it('lists encrypted threads without fetching their edits', async () => {
    const f = server();
    const room = roomFor(f.client);
    const encryptedRoot = (rootId: string): IEvent => {
      const root = summarizedRoot(rootId, 1);
      const relations = root.unsigned!['m.relations'] as { 'm.thread': { latest_event: IEvent } };
      relations['m.thread'].latest_event = {
        ...relations['m.thread'].latest_event,
        type: 'm.room.encrypted',
        content: {
          algorithm: 'm.megolm.v1.aes-sha2',
          ciphertext: 'ciphertext',
          'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
        },
      };
      return root;
    };
    const mapper = f.client.getEventMapper();

    // Without relations recursion, the SDK fetched each encrypted reply's latest edit.
    restoreCachedRoomThreads(
      room,
      Array.from({ length: 10 }, (_, index) => ({
        rootEvent: mapper(encryptedRoot(rootIdAt(index))),
      }))
    );
    await settle();

    expect(f.requests).toHaveLength(0);
  });

  it('gives a shown thread its server count when its replies came with its root', async () => {
    const rootId = rootIdAt(1);
    const f = server({ roots: [summarizedRoot(rootId, 2)] });
    const room = roomFor(f.client);
    await room.addLiveEvents(
      [summarizedRoot(rootId, 2), reply(rootId, 1), reply(rootId, 2)].map(
        (event) => new MatrixEvent(event)
      ),
      { addToState: false, fromCache: true }
    );
    const thread = room.getThread(rootId)!;
    await settle();

    await thread.initialize();
    await settle();

    expect(thread.length).toBe(2);
  });

  it('upgrades unopened threads from listed summaries without stale or older rollbacks', async () => {
    const rootId = rootIdAt(1);
    const f = server({ roots: [summarizedRoot(rootId, 3)] });
    const room = roomFor(f.client);
    const mapper = f.client.getEventMapper();
    restoreCachedRoomThreads(room, [{ rootEvent: mapper(summarizedRoot(rootId, 1)) }]);
    const thread = room.getThread(rootId)!;
    expect(thread.length).toBe(1);

    await loadRoomThreads(room);
    await settle();
    expect(thread.length).toBe(3);
    expect(thread.replyToEvent?.getId()).toBe(`${rootId}-reply-3`);

    // Cached history prepends the stale copy again.
    room.processThreadRoots([mapper(summarizedRoot(rootId, 1))], false);
    await room.addLiveEvents([new MatrixEvent(reply(rootId, 4, 10))], { addToState: false });
    // A listing requested before that reply arrived.
    room.threadsTimelineSets.forEach((set) => set.resetLiveTimeline());
    await room.client.paginateEventTimeline(room.threadsTimelineSets[0]!.getLiveTimeline(), {
      backwards: true,
    });
    await settle();

    expect(thread.length).toBe(4);
    expect(thread.replyToEvent?.getId()).toBe(`${rootId}-reply-4`);
    expect(f.rootFetches()).toBe(0);
    expect(f.relationPages()).toBe(0);
  });

  it('updates the latest reply when a later listing bundles a newer edit of it', async () => {
    const rootId = rootIdAt(1);
    const latestWithEdit = (body: string, ts: number): IEvent => ({
      ...reply(rootId, 2),
      unsigned: { 'm.relations': { 'm.replace': edit(`${rootId}-reply-2`, body, ts).event } },
    });
    const listedRoot = (body: string, ts: number): IEvent => ({
      ...message(rootId, 0),
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 2,
            current_user_participated: true,
            latest_event: latestWithEdit(body, ts),
          },
        },
      },
    });
    const f = server();
    const room = roomFor(f.client);
    const root = f.client.getEventMapper()(listedRoot('partial', 5));
    room.processThreadRoots([root], true);
    const thread = room.getThread(rootId)!;
    await settle();
    expect(thread.replyToEvent?.getContent().body).toBe('partial');

    // The mapper merges a later listing into the same root object.
    root.setUnsigned(listedRoot('final answer', 6).unsigned!);
    room.processListedThreadRoots([root], true);
    await settle();

    expect(thread.replyToEvent?.getContent().body).toBe('final answer');
  });

  it('keeps a live reply over a listing with the same timestamp', async () => {
    const rootId = rootIdAt(1);
    const f = server();
    const room = roomFor(f.client);
    room.processThreadRoots([f.client.getEventMapper()(summarizedRoot(rootId, 1))], true);
    const thread = room.getThread(rootId)!;
    const liveReply = new MatrixEvent(reply(rootId, 2, 10));
    await room.addLiveEvents([liveReply], { addToState: false });

    // A listing taken just before that reply, whose latest reply has the same timestamp.
    room.processListedThreadRoots([f.client.getEventMapper()(summarizedRoot(rootId, 1, 9))], true);
    await settle();

    expect(thread.replyToEvent).toBe(liveReply);
    expect(thread.length).toBe(2);
  });

  it('records room sync gaps on 200 unopened threads without allocating timelines', async () => {
    const f = server();
    const room = roomFor(f.client);
    const mapper = f.client.getEventMapper();
    room.processThreadRoots(
      Array.from({ length: 200 }, (_, index) => mapper(summarizedRoot(rootIdAt(index), 1))),
      true
    );
    for (let gap = 0; gap < 20; gap += 1) room.resetLiveTimeline(`back-${gap}`, `forward-${gap}`);
    await settle();

    const timelines = () =>
      room
        .getThreads()
        .reduce((total, thread) => total + thread.timelineSet.getTimelines().length, 0);
    expect(timelines()).toBe(200);
    // One conversion per gap for the whole room, plus the earliest forward boundary.
    expect(f.requests.filter((url) => url.pathname.endsWith('/messages'))).toHaveLength(21);
    expect(f.rootFetches() + f.relationPages()).toBe(0);
  });

  it('replays a cached sync and catches up without thread requests but a missing root', async () => {
    const events: IEvent[] = [];
    for (let index = 0; index < 40; index += 1) {
      events.push(message(rootIdAt(index), index * 10), reply(rootIdAt(index), 1, index * 10 + 1));
    }
    // Replies whose roots fell out of the saved window still need their root.
    events.push(reply('$old-root', 7, 500));
    const savedSync: ISavedSync = {
      nextBatch: 'cached-token',
      accountData: [],
      roomsData: {
        join: {
          [roomId]: {
            state: {
              events: [
                {
                  type: 'm.room.member',
                  event_id: '$membership',
                  sender: userId,
                  state_key: userId,
                  content: { membership: 'join' },
                } as IEvent,
              ],
            },
            timeline: { events, prev_batch: 'cached-history' },
            ephemeral: { events: [] },
            account_data: { events: [] },
          },
        } as unknown as ISavedSync['roomsData']['join'],
        invite: {},
        leave: {},
        knock: {},
      },
    };
    const store = new MemoryStore();
    vi.spyOn(store, 'getSavedSync').mockResolvedValue(savedSync);
    vi.spyOn(store, 'getSavedSyncToken').mockResolvedValue('cached-token');
    // The first live sync brings a new reply to every thread and edits of their cached replies.
    const catchUp = Array.from({ length: 40 }, (_, index) => [
      reply(rootIdAt(index), 2, 1000 + index),
      edit(`${rootIdAt(index)}-reply-1`, `edited ${index}`, 2000 + index).event,
    ]).flat();
    const f = server({
      store,
      syncs: [
        {
          next_batch: 'live-token',
          rooms: { join: { [roomId]: { timeline: { events: catchUp, limited: false } } } },
        },
      ],
    });
    // Production starts with cached server versions (clientSyncPolicy.startClient).
    (f.client as unknown as { serverVersionsPromise: Promise<unknown> }).serverVersionsPromise =
      Promise.resolve({ versions: ['v1.4', 'v1.10'], unstable_features: {} });

    await f.client.startClient({ threadSupport: true, lazyLoadMembers: true });
    await vi.waitFor(() =>
      expect(f.requests.filter((url) => url.pathname.endsWith('/sync'))).toHaveLength(2)
    );
    await settle();
    f.client.stopClient();

    const room = f.client.getRoom(roomId)!;
    expect(room.getThreads()).toHaveLength(41);
    expect(room.getThread(rootIdAt(7))!.replyToEvent?.getId()).toBe(`${rootIdAt(7)}-reply-2`);
    const beforeSync = f.requests.slice(
      0,
      f.requests.findIndex((url) => url.pathname.endsWith('/sync'))
    );
    expect(beforeSync.filter((url) => /\/relations\//.test(url.pathname))).toHaveLength(0);
    expect(beforeSync.filter((url) => /\/event\//.test(url.pathname))).toHaveLength(1);
    expect(f.rootFetches()).toBe(1);
    expect(f.relationPages()).toBe(0);
  });
});
