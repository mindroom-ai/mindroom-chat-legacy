import {
  EventTimeline,
  MatrixClient,
  MatrixEvent,
  RelationType,
  Room,
  Thread,
} from 'matrix-js-sdk';
import to from 'await-to-js';

export const getTimelineEventById = (
  linkedTimelines: EventTimeline[],
  eventId: string
): MatrixEvent | undefined => {
  for (const timeline of linkedTimelines) {
    const event = timeline.getEvents().find((mEvent) => mEvent.getId() === eventId);
    if (event) {
      return event;
    }
  }

  return undefined;
};

const getRoomEventById = (
  room: Room,
  eventId: string,
  linkedTimelines?: EventTimeline[]
): MatrixEvent | undefined =>
  room.findEventById(eventId) ??
  (linkedTimelines ? getTimelineEventById(linkedTimelines, eventId) : undefined);

const getThreadRootIdForEventTarget = ({
  eventId,
  event,
  room,
  roomThreads,
}: {
  eventId: string;
  event: MatrixEvent | undefined;
  room: Room;
  roomThreads?: Array<Pick<Thread, 'id' | 'rootEvent'>>;
}): string | undefined => {
  const threadRootId = event?.threadRootId;
  if (threadRootId && threadRootId !== eventId) {
    return threadRootId;
  }

  if (event?.isThreadRoot || room.getThread(eventId)) {
    return eventId;
  }

  return roomThreads?.some((thread) => thread.id === eventId) ? eventId : undefined;
};

export const getRoomEventThreadOpenTarget = ({
  eventId,
  room,
  linkedTimelines,
  roomThreads,
}: {
  eventId: string;
  room: Room;
  linkedTimelines?: EventTimeline[];
  roomThreads?: Array<Pick<Thread, 'id' | 'rootEvent'>>;
}):
  | {
      threadId: string;
      eventId?: string;
    }
  | undefined => {
  const targetEvent = getRoomEventById(room, eventId, linkedTimelines);
  const directThreadRootId = getThreadRootIdForEventTarget({
    eventId,
    event: targetEvent,
    room,
    roomThreads,
  });
  if (directThreadRootId) {
    return {
      threadId: directThreadRootId,
      eventId: directThreadRootId === eventId ? undefined : eventId,
    };
  }

  const relatedEventId = targetEvent?.getAssociatedId() ?? targetEvent?.getRelation()?.event_id;
  if (!relatedEventId) return undefined;

  const relatedEvent = getRoomEventById(room, relatedEventId, linkedTimelines);
  const relatedThreadRootId = getThreadRootIdForEventTarget({
    eventId: relatedEventId,
    event: relatedEvent,
    room,
    roomThreads,
  });
  if (!relatedThreadRootId) return undefined;

  return {
    threadId: relatedThreadRootId,
    eventId: relatedThreadRootId === relatedEventId ? undefined : relatedEventId,
  };
};

export const isRoomEventThreadRedirectActive = ({
  focusEventInRoom,
  threadId,
  roomOverviewOrderActive,
}: {
  focusEventInRoom?: boolean;
  threadId?: string;
  roomOverviewOrderActive: boolean;
}): boolean => !focusEventInRoom && !threadId && roomOverviewOrderActive;

// The thread an event is in, from the cleartext relation of the server's copy.
export const fetchRoomEventThreadRootId = async (
  mx: Pick<MatrixClient, 'fetchRoomEvent'>,
  roomId: string,
  eventId: string
): Promise<string | undefined> => {
  const [, event] = await to(mx.fetchRoomEvent(roomId, eventId));
  const relation = event?.content?.['m.relates_to'];
  return relation?.rel_type === RelationType.Thread &&
    typeof relation.event_id === 'string' &&
    relation.event_id !== eventId
    ? relation.event_id
    : undefined;
};

export const resolveRoomEventThreadRedirect = ({
  eventId,
  room,
  linkedTimelines,
  roomThreads,
  roomOverviewOrderActive,
  threadId,
  focusEventInRoom,
}: {
  eventId: string;
  room: Room;
  linkedTimelines?: EventTimeline[];
  roomThreads?: Array<Pick<Thread, 'id' | 'rootEvent'>>;
  roomOverviewOrderActive: boolean;
  threadId?: string;
  focusEventInRoom?: boolean;
}):
  | {
      threadId: string;
      eventId?: string;
    }
  | undefined => {
  if (!isRoomEventThreadRedirectActive({ focusEventInRoom, threadId, roomOverviewOrderActive })) {
    return undefined;
  }

  return getRoomEventThreadOpenTarget({
    eventId,
    room,
    linkedTimelines,
    roomThreads,
  });
};
