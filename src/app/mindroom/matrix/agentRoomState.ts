import {
  RoomEvent,
  RoomStateEvent,
  type MatrixEvent,
  type Room,
  type RoomMember,
  type RoomState,
} from 'matrix-js-sdk';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useForceUpdate } from '../../hooks/useForceUpdate';
import { isMindroomAgentUserIdForViewer } from './agentIdentity';

/**
 * Whether a state event is a MindRoom agent describing itself: keyed by its own user ID, which Matrix
 * accepts only from that user, and sent by an agent on the viewer's homeserver.
 */
export const isAgentSelfState = (event: MatrixEvent, viewerUserId: string | undefined): boolean => {
  const sender = event.getSender();
  return (
    !!sender &&
    event.getStateKey() === sender &&
    isMindroomAgentUserIdForViewer(sender, viewerUserId)
  );
};

/**
 * The state agents published about themselves, from agents still in the room. An agent known to have
 * left cannot clear its state, so it is ignored; one whose membership is not loaded yet, as with
 * lazy-loaded members, counts as joined until its member event says otherwise.
 */
export const selectAgentSelfState = (
  events: MatrixEvent[],
  viewerUserId: string | undefined,
  isJoined: (userId: string) => boolean
): MatrixEvent[] =>
  events.filter((event) => isAgentSelfState(event, viewerUserId) && isJoined(event.getSender()!));

/** The room's current state of one type that its agents published about themselves. */
export const agentRoomState = (room: Room, eventType: string): MatrixEvent[] =>
  selectAgentSelfState(room.currentState.getStateEvents(eventType), room.myUserId, (userId) => {
    const member = room.getMember(userId);
    return member === null || member.membership === 'join';
  });

const sameEvents = (a: MatrixEvent[], b: MatrixEvent[]): boolean =>
  a.length === b.length && a.every((event, index) => event === b[index]);

/** The room's agent state of this type, read again when it, an agent's membership, or the live state changes. */
const useAgentRoomStateEvents = (room: Room, eventType: string): MatrixEvent[] => {
  const [version, refresh] = useForceUpdate();
  const events = useMemo(() => {
    void version;
    return agentRoomState(room, eventType);
  }, [room, eventType, version]);
  const renderedEvents = useRef(events);
  // Synchronously with the commit, so an event that lands before passive effects compares with what is shown.
  useLayoutEffect(() => {
    renderedEvents.current = events;
  }, [events]);
  useEffect(() => {
    const onState = (event: MatrixEvent) => {
      if (event.getType() === eventType) refresh();
    };
    // Sync hands an agent's member event over again with every batch it sends in, unchanged, so
    // render again only when a membership change adds or drops state.
    const onMember = (_event: MatrixEvent, _state: RoomState, member: RoomMember) => {
      if (!isMindroomAgentUserIdForViewer(member.userId, room.myUserId)) return;
      if (!sameEvents(agentRoomState(room, eventType), renderedEvents.current)) refresh();
    };
    room.on(RoomStateEvent.Events, onState);
    room.on(RoomStateEvent.Members, onMember);
    room.on(RoomEvent.CurrentStateUpdated, refresh);
    return () => {
      room.removeListener(RoomStateEvent.Events, onState);
      room.removeListener(RoomStateEvent.Members, onMember);
      room.removeListener(RoomEvent.CurrentStateUpdated, refresh);
    };
  }, [room, eventType, refresh]);
  return events;
};

/** What `select` makes of the room's agent state of this type, read again only when that state could have changed. */
export const useAgentRoomState = <T>(
  room: Room,
  eventType: string,
  select: (events: MatrixEvent[]) => T
): T => {
  const events = useAgentRoomStateEvents(room, eventType);
  return useMemo(() => select(events), [select, events]);
};
