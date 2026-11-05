import {
  Direction,
  MatrixClient,
  MatrixEvent,
  RelationType,
  Room,
  ReceiptType,
  type Thread,
} from 'matrix-js-sdk';
import { MAIN_ROOM_TIMELINE } from 'matrix-js-sdk/lib/@types/read_receipts';
import { getStreamStatusFromContent, TERMINAL_STREAM_STATUSES } from '../messages/aiRun';
import { isThreadOnlyRoomActivity } from '../threads/threadRenderUtils';
import { isLocalEchoEventId } from '../threads/threadRouteUtils';
import { eventBelongsToThread } from '../threads/threadUtils';
import { getThreadReadState } from '../threads/roomThreadList';

const getReceiptType = (privateReceipt: boolean): ReceiptType =>
  privateReceipt ? ReceiptType.ReadPrivate : ReceiptType.Read;

const getLatestReceiptTarget = (
  events: MatrixEvent[],
  readEventId: string | null,
  isEligible: (event: MatrixEvent) => boolean = () => true
): MatrixEvent | undefined => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    const eventId = event.getId();
    if (eventId === readEventId) return undefined;
    if (!eventId || isLocalEchoEventId(eventId) || !isEligible(event) || event.isSending())
      continue;
    return event;
  }
  return undefined;
};

/**
 * The edit that ends a streamed reply: the server counts it as a new message,
 * so a receipt must reach it for the finished reply to count as read.
 * Undecrypted edits have no readable status yet and do not match.
 */
export const isTerminalStreamEdit = (event: MatrixEvent): boolean => {
  if (event.getRelation()?.rel_type !== RelationType.Replace) return false;
  const status = getStreamStatusFromContent(event.getContent());
  return !!status && TERMINAL_STREAM_STATUSES.has(status);
};

const isThreadReplyReceiptTarget = (event: MatrixEvent, threadId: string): boolean => {
  if (event.getId() === threadId || !eventBelongsToThread(event, threadId)) return false;
  return event.getRelation()?.rel_type === RelationType.Thread || isTerminalStreamEdit(event);
};

const getThreadReplyTarget = (thread: Thread): MatrixEvent | undefined => {
  const isEligible = (event: MatrixEvent) => isThreadReplyReceiptTarget(event, thread.id);
  const loadedReply = getLatestReceiptTarget(thread.events, null, isEligible);
  // Before history is loaded, the SDK keeps the bundled latest reply outside events.
  const replyToEvent = thread.replyToEvent;
  const summaryReply = replyToEvent
    ? getLatestReceiptTarget([replyToEvent], null, isEligible)
    : undefined;
  return summaryReply && (!loadedReply || summaryReply.getTs() >= loadedReply.getTs())
    ? summaryReply
    : loadedReply;
};

const getLatestThreadReplyTarget = async (
  mx: MatrixClient,
  room: Room,
  threadId: string
): Promise<MatrixEvent | undefined> => {
  const userId = mx.getUserId();
  const thread = room.getThread(threadId);
  if (thread) {
    const latestReply = getThreadReplyTarget(thread);
    if (!latestReply) return undefined;
    const readState = getThreadReadState(thread, userId ?? undefined);
    if (readState?.readEventIds.has(latestReply.getId()!)) return undefined;
    // Equal timestamps do not prove that distinct events have been acknowledged.
    if (readState?.readUpToTs !== undefined && latestReply.getTs() < readState.readUpToTs) {
      return undefined;
    }
    return latestReply;
  }

  const relationResponse = await mx.fetchRelations(
    room.roomId,
    threadId,
    RelationType.Thread,
    null,
    {
      dir: Direction.Backward,
      limit: 1,
    }
  );
  const latestReply = relationResponse.chunk?.[0];
  if (!latestReply) {
    return undefined;
  }

  const mappedReply = mx.getEventMapper()(latestReply);
  if (mappedReply.isSending() || !isThreadReplyReceiptTarget(mappedReply, threadId)) {
    const loadedThread = room.getThread(threadId);
    return loadedThread
      ? getThreadReplyTarget(loadedThread)
      : getLatestReceiptTarget(room.getLiveTimeline().getEvents(), null, (event) =>
          isThreadReplyReceiptTarget(event, threadId)
        );
  }

  return mappedReply;
};

export async function markMainTimelineAsRead(
  mx: MatrixClient,
  roomId: string,
  privateReceipt: boolean
) {
  const room = mx.getRoom(roomId);
  const userId = mx.getUserId();
  if (!room || !userId) return;

  const timeline = room.getLiveTimeline().getEvents();
  if (timeline.length === 0) return;

  const latestEvent = getLatestReceiptTarget(
    timeline,
    room.getEventReadUpTo(userId),
    (event) => !isThreadOnlyRoomActivity(room, event)
  );
  if (!latestEvent) return;

  await mx.sendReceipt(latestEvent, getReceiptType(privateReceipt), {
    thread_id: MAIN_ROOM_TIMELINE,
  });
}

export async function markThreadAsRead(
  mx: MatrixClient,
  roomId: string,
  threadId: string,
  privateReceipt: boolean
) {
  if (isLocalEchoEventId(threadId)) return;

  const room = mx.getRoom(roomId);
  if (!room) return;

  const latestReply = await getLatestThreadReplyTarget(mx, room, threadId);
  if (!latestReply) return;

  await mx.sendReceipt(latestReply, getReceiptType(privateReceipt), {
    thread_id: threadId,
  });
}

export async function markRoomAndThreadsAsRead(
  mx: MatrixClient,
  roomId: string,
  privateReceipt: boolean
) {
  const room = mx.getRoom(roomId);
  const userId = mx.getUserId();
  if (!room || !userId) return;

  const timeline = room.getLiveTimeline().getEvents();
  let latestEvent = getLatestReceiptTarget(timeline, null);
  for (const thread of room.getThreads()) {
    const reply = getThreadReplyTarget(thread);
    if (reply && (!latestEvent || reply.getTs() >= latestEvent.getTs())) latestEvent = reply;
  }
  if (!latestEvent) return;

  await mx.sendReadReceipt(latestEvent, getReceiptType(privateReceipt), true);
}
