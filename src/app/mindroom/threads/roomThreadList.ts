/* eslint-disable no-console */

import { Direction } from 'matrix-js-sdk/lib/models/event-timeline';
import { RelationType } from 'matrix-js-sdk/lib/@types/event';
import { ReceiptType } from 'matrix-js-sdk/lib/@types/read_receipts';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { Thread } from 'matrix-js-sdk/lib/models/thread';
import { getStreamStatusFromContent, TERMINAL_STREAM_STATUSES } from '../messages/aiRun';
import { getBufferedThreadRelations } from './sdk/threadBootstrapSdk';
import { eventBelongsToThread, isVisibleThreadReplyEvent } from './threadUtils';

/** A thread that has not loaded its latest page knows its newest reply from the root's summary. */
export const getLatestVisibleReply = (thread: Thread): MatrixEvent | undefined => {
  const events = thread.events ?? [];
  let loaded: MatrixEvent | undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (isVisibleThreadReplyEvent(event)) {
      loaded = event;
      break;
    }
  }
  const summary = thread.replyToEvent;
  if (!summary || !isVisibleThreadReplyEvent(summary)) return loaded;
  return loaded && loaded.getTs() >= summary.getTs() ? loaded : summary;
};

/**
 * The edit that ends a streamed reply. The server counts it as a new message,
 * so a reply read half-way is unread again until a receipt reaches this edit.
 * Undecrypted edits have no readable status yet and do not match.
 */
export const isTerminalStreamEdit = (event: MatrixEvent | null | undefined): boolean => {
  if (event?.getRelation()?.rel_type !== RelationType.Replace) return false;
  const status = getStreamStatusFromContent(event.getContent());
  return !!status && TERMINAL_STREAM_STATUSES.has(status);
};

/** A reply in the thread, or the terminal edit of one: the events a thread receipt reads. */
export const isThreadReceiptTarget = (event: MatrixEvent, threadId: string): boolean => {
  if (event.getId() === threadId || !eventBelongsToThread(event, threadId)) return false;
  if (event.getRelation()?.rel_type === RelationType.Thread) return true;
  // An edit of the root belongs to the main timeline.
  return isTerminalStreamEdit(event) && event.getAssociatedId() !== threadId;
};

/**
 * The newest terminal edit of a reply, wherever the thread keeps it: in its
 * timeline, as a reply's latest edit (which the server bundles with the reply
 * and backfills apply the same way), or buffered while the thread is unopened.
 */
export const getLatestTerminalEdit = (thread: Thread): MatrixEvent | undefined => {
  let latest: MatrixEvent | undefined;
  // Newest first, so most events cost a timestamp check; a tie goes to the later
  // place: buffered, then the summary reply, then the timeline, an edit over its reply.
  const consider = (edit: MatrixEvent | null | undefined, event: MatrixEvent) => {
    if (!edit || (latest && edit.getTs() <= latest.getTs())) return;
    if (isTerminalStreamEdit(edit) && isThreadReceiptTarget(event, thread.id)) latest = edit;
  };
  const buffered = getBufferedThreadRelations(thread);
  for (let index = buffered.length - 1; index >= 0; index -= 1) {
    consider(buffered[index], buffered[index]);
  }
  const events = [...(thread.events ?? []), thread.replyToEvent];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event) {
      consider(event.replacingEvent?.(), event);
      consider(event, event);
    }
  }
  return latest;
};

/**
 * The event a thread receipt names, with the thread it belongs to.
 * A receipt on the edit that ended a streamed reply counts through that reply,
 * whose latest edit the server bundles; an unopened thread buffers live edits.
 */
const findThreadReceiptEvent = (
  thread: Thread,
  eventId: string
): { event: MatrixEvent; threadRootId: string | undefined } | undefined => {
  const match = (event: MatrixEvent | null | undefined) => {
    if (!event) return undefined;
    if (event.getId?.() === eventId) return { event, threadRootId: event.threadRootId };
    const edit = event.replacingEvent?.();
    return edit?.getId() === eventId
      ? { event: edit, threadRootId: event.threadRootId }
      : undefined;
  };
  // Receipts mostly name recent events.
  const events = thread.events ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const found = match(events[index]);
    if (found) return found;
  }
  return (
    match(thread.replyToEvent) ??
    match(thread.rootEvent) ??
    match(getBufferedThreadRelations(thread).find((event) => event.getId() === eventId))
  );
};

export const getThreadReadState = (
  thread: Thread | null | undefined,
  userId: string | undefined
): { readEventIds: Set<string>; readUpToTs: number | undefined } | undefined => {
  if (!thread || !userId || typeof thread.getEventReadUpTo !== 'function') return undefined;

  // The SDK validates receipt targets against its timeline, which omits replies
  // known only through the bundled summary. Resolve those receipt IDs here too.
  const readUpToId = thread.getEventReadUpTo(userId);
  const readEventIds = new Set([readUpToId]);
  for (const receiptType of [ReceiptType.Read, ReceiptType.ReadPrivate]) {
    // A retained local echo can mask a newer server receipt outside the timeline.
    for (const ignoreSynthesized of [false, true]) {
      const receipt = thread.getReadReceiptForUserId(userId, ignoreSynthesized, receiptType);
      if (receipt && receipt.data.thread_id === thread.id) readEventIds.add(receipt.eventId);
    }
  }
  let readUpToTs = thread.getLastUnthreadedReceiptFor(userId)?.ts;
  const validReadEventIds = new Set<string>();
  for (const eventId of readEventIds) {
    if (!eventId) continue;
    const found = findThreadReceiptEvent(thread, eventId);
    // Preserve the SDK's consistency check for raw receipt targets.
    if (!found || (eventId !== readUpToId && found.threadRootId !== thread.id)) continue;
    validReadEventIds.add(eventId);
    const eventTs = found.event.getTs();
    if (readUpToTs === undefined || eventTs > readUpToTs) {
      readUpToTs = eventTs;
    }
  }
  return { readEventIds: validReadEventIds, readUpToTs };
};

export const getThreadLastActivityTs = (thread: Thread): number =>
  getLatestVisibleReply(thread)?.getTs() ?? thread.rootEvent?.getTs() ?? 0;

/**
 * A thread is unread when its latest reply, or a later terminal edit of a reply,
 * is from another user and newer than the user's thread or unthreaded receipt;
 * a main-timeline receipt reads no replies. A reply read half-way is unread
 * again once it finishes, as the server counts it.
 */
export const getThreadUnread = (thread: Thread, userId: string): boolean => {
  const latestReply = getLatestVisibleReply(thread);
  const finish = getLatestTerminalEdit(thread);
  const latest =
    finish && (!latestReply || finish.getTs() >= latestReply.getTs()) ? finish : latestReply;
  if (!latest || latest.getSender() === userId) return false;
  const readState = getThreadReadState(thread, userId);
  if (readState?.readUpToTs === undefined) return true;
  const { readEventIds, readUpToTs } = readState;
  if (latest.getTs() !== readUpToTs) return latest.getTs() > readUpToTs;
  // A finish in the same millisecond as the reply a receipt names still follows it.
  return (
    latest === finish &&
    !readEventIds.has(latest.getId()!) &&
    readEventIds.has(latest.getAssociatedId()!)
  );
};

/**
 * Return a Map of threadRootId → boolean for all given threads,
 * indicating which have unread messages.
 */
export const getRoomThreadsUnread = (threads: Thread[], userId: string): Map<string, boolean> =>
  new Map(threads.map((thread) => [thread.id, getThreadUnread(thread, userId)]));

export const sortThreadsByActivity = (
  threads: Thread[],
  threadUnreads?: Map<string, boolean>
): Thread[] => {
  const activity = new Map(threads.map((thread) => [thread, getThreadLastActivityTs(thread)]));
  return [...threads].sort((threadA, threadB) => {
    // Unread threads sort first when unread data is provided
    if (threadUnreads) {
      const aUnread = threadUnreads.get(threadA.id) ?? false;
      const bUnread = threadUnreads.get(threadB.id) ?? false;
      if (aUnread !== bUnread) return aUnread ? -1 : 1;
    }
    return activity.get(threadB)! - activity.get(threadA)!;
  });
};

const getAllThreadsLiveTimeline = (room: Room) => room.threadsTimelineSets[0]?.getLiveTimeline();

type RoomThreadListLoad = {
  consumers: Map<symbol, (() => void) | undefined>;
  promise: Promise<void>;
};

const roomThreadListLoads = new WeakMap<Room, RoomThreadListLoad>();

const ensureThreadTimelineSets = async (room: Room): Promise<void> => {
  if (!Thread.hasServerSideListSupport || room.threadsTimelineSets.length > 0) {
    return;
  }

  if (!room.client?.supportsThreads?.()) {
    console.warn('[threadList] SDK thread support not enabled, skipping server-side thread list');
    return;
  }

  try {
    await room.createThreadsTimelineSets();
  } catch (err) {
    console.warn('[threadList] createThreadsTimelineSets failed:', err);
  }

  if (room.threadsTimelineSets.length === 0) {
    console.warn('[threadList] Timeline sets empty after creation attempt');
  }
};

export const roomThreadListIsComplete = (room: Room): boolean => {
  if (!Thread.hasServerSideListSupport) return true;

  const allThreadsLiveTimeline = getAllThreadsLiveTimeline(room);
  if (!allThreadsLiveTimeline) return true;

  return allThreadsLiveTimeline.getPaginationToken(Direction.Backward) === null;
};

const loadRoomThreadsOnce = async (
  room: Room,
  onProgress: () => void,
  onSettled: () => void,
  shouldContinue: () => boolean
): Promise<void> => {
  try {
    await room.client?.threadSupportPending;
    if (!shouldContinue()) return;
    await ensureThreadTimelineSets(room);
    if (!shouldContinue()) return;
    try {
      await room.fetchRoomThreads();
    } catch (err) {
      console.warn('[threadList] fetchRoomThreads failed:', err);
      return;
    }
    onProgress?.();

    if (!Thread.hasServerSideListSupport) return;

    const allThreadsLiveTimeline = getAllThreadsLiveTimeline(room);
    if (!allThreadsLiveTimeline) return;

    for (;;) {
      if (!shouldContinue()) return;
      const currentToken = allThreadsLiveTimeline.getPaginationToken(Direction.Backward);
      if (currentToken === null) return;

      const hasMore = await room.client.paginateEventTimeline(allThreadsLiveTimeline, {
        backwards: true,
      });
      onProgress?.();

      const nextToken = allThreadsLiveTimeline.getPaginationToken(Direction.Backward);
      if (!hasMore || nextToken === currentToken) {
        return;
      }
    }
  } finally {
    onSettled();
  }
};

export const loadRoomThreads = (
  room: Room,
  onProgress?: () => void,
  signal?: AbortSignal
): Promise<void> => {
  if (signal?.aborted) return Promise.resolve();

  let load = roomThreadListLoads.get(room);
  if (!load) {
    const consumers = new Map<symbol, (() => void) | undefined>();
    let activeLoad: RoomThreadListLoad;
    const promise = Promise.resolve().then(() =>
      loadRoomThreadsOnce(
        room,
        () => {
          consumers.forEach((listener) => {
            if (!listener) return;
            try {
              listener();
            } catch (err) {
              console.warn('[threadList] progress listener failed:', err);
            }
          });
        },
        () => {
          if (roomThreadListLoads.get(room) === activeLoad) {
            roomThreadListLoads.delete(room);
          }
        },
        () => consumers.size > 0
      )
    );
    activeLoad = {
      consumers,
      promise,
    };
    load = activeLoad;
    roomThreadListLoads.set(room, activeLoad);
  }

  const consumerId = Symbol('room-thread-list-consumer');
  load.consumers.set(consumerId, onProgress);
  const removeConsumer = () => {
    load.consumers.delete(consumerId);
  };
  signal?.addEventListener('abort', removeConsumer, { once: true });

  return load.promise.finally(() => {
    signal?.removeEventListener('abort', removeConsumer);
    removeConsumer();
  });
};
