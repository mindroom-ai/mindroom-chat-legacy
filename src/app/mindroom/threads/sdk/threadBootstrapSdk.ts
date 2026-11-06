import {
  Direction,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type Thread,
} from 'matrix-js-sdk';

/** An unopened thread has not loaded its first page, so its empty backward token proves nothing. */
export const hasLoadedFirstThreadPage = (
  thread: Partial<Pick<Thread, 'initialEventsFetched'>>
): boolean => thread.initialEventsFetched === true;

/** The edits and reactions an unopened thread holds back until it is shown. */
export const getBufferedThreadRelations = (
  thread: Partial<Pick<Thread, 'replayEvents'>>
): readonly MatrixEvent[] => thread.replayEvents ?? [];

/** Caller supplies an identified root and retains the subsequent server bootstrap. */
export function createInitializedThreadForRoot(room: Room, root: MatrixEvent): Thread {
  const thread = room.createThread(root.getId()!, root, [], false);
  // Constructor-started metadata must not reset replies arriving before that request completes.
  thread.initialEventsFetched = true;
  thread.replayEvents = null;
  return thread;
}

/** One bounded fallback page; mapping and cancellation belong to the caller. */
export function fetchThreadBootstrapRelations(
  mx: MatrixClient,
  roomId: string,
  threadId: string
): ReturnType<MatrixClient['fetchRelations']> {
  return mx.fetchRelations(roomId, threadId, 'm.thread' as any, null, {
    dir: Direction.Backward,
    limit: 50,
  });
}

/** Preserve SDK metadata, then join known historical events through native pagination. */
export function appendThreadBootstrapRelations({
  thread,
  events,
  nextBatch,
}: {
  thread: Thread;
  events: MatrixEvent[];
  nextBatch: string | undefined;
}): void {
  // The SDK selects the new live segment synchronously and observes conversion failures.
  // Relations already supply their own cursor; conversion must not block fetched replies.
  void thread.flushPendingTimelineReset();
  events.forEach((event) => thread.setEventMetadata(event));
  const timelineSet = thread.getUnfilteredTimelineSet();
  // Thread.addEvents skips IDs already indexed in another segment. The pagination
  // API joins those segments and preserves their existing cursor on overlap.
  timelineSet.addEventsToTimeline(
    events.slice().reverse(),
    true,
    false,
    timelineSet.getLiveTimeline(),
    nextBatch ?? null
  );
}
