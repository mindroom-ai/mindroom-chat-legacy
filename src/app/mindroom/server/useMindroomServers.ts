import {
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomMember,
  type RoomState,
} from 'matrix-js-sdk';
import { Capacitor } from '@capacitor/core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useForceUpdate } from '../../hooks/useForceUpdate';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { agentRoomState, useAgentRoomState } from '../matrix/agentRoomState';
import { readOpenIdBinding } from '../matrix/openidAudience';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';
import {
  MINDROOM_SERVER_EVENT,
  distinctServerUrls,
  isLoopbackOrigin,
  selectMindroomServers,
  type MindroomServer,
} from './mindroomServer';

// In the native apps a published localhost server is the phone itself, never the agent's MindRoom.
const selectRoomServers = (events: MatrixEvent[]): MindroomServer[] =>
  selectMindroomServers(events).filter(
    (server) => !(Capacitor.isNativePlatform() && isLoopbackOrigin(server.apiUrl))
  );

const roomServers = (room: Room): MindroomServer[] =>
  selectRoomServers(agentRoomState(room, MINDROOM_SERVER_EVENT));

// One answer per client for what Chat shows; a token for a published origin is only ever requested after a
// new check. A check that could not reach the homeserver is not kept, so the next mount asks again.
const bindingChecks = new WeakMap<MatrixClient, Promise<boolean | undefined>>();

/** Whether the homeserver binds OpenID tokens, asked once per client, so Chat may offer the origins agents publish. */
export const useBindsOpenIdTokens = (): boolean => {
  const mx = useMatrixClient();
  const [binds, setBinds] = useState(false);
  useEffect(() => {
    let current = true;
    let check = bindingChecks.get(mx);
    if (!check) {
      check = readOpenIdBinding(mx);
      bindingChecks.set(mx, check);
    }
    check.then((value) => {
      if (value === undefined) bindingChecks.delete(mx);
      if (current) setBinds(value === true);
    });
    return () => {
      current = false;
    };
  }, [mx]);
  return binds;
};

/** The servers of the room's agents, read again when one changes or an agent's membership does. */
export const useRoomMindroomServers = (room: Room): MindroomServer[] =>
  useAgentRoomState(room, MINDROOM_SERVER_EVENT, selectRoomServers);

const joinedRoomServerUrls = (mx: MatrixClient): string[] =>
  distinctServerUrls(
    mx
      .getRooms()
      .filter((room) => room.getMyMembership() === 'join')
      .flatMap(roomServers)
  );

const sameUrls = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((url, index) => url === b[index]);

/** Every server the agents in the user's rooms publish, newest first, while the homeserver binds tokens. */
export const useMindroomServerUrls = (): string[] => {
  const mx = useMatrixClient();
  const bindsTokens = useBindsOpenIdTokens();
  const [version, refresh] = useForceUpdate();
  const urls = useMemo(() => {
    void version;
    return bindsTokens ? joinedRoomServerUrls(mx) : [];
  }, [mx, bindsTokens, version]);
  const renderedUrls = useRef(urls);
  // Synchronously with the commit, so a check that runs before passive effects compares with what is shown.
  useLayoutEffect(() => {
    renderedUrls.current = urls;
  }, [urls]);
  useEffect(() => {
    const viewer = mx.getUserId() ?? undefined;
    const onState = (event: MatrixEvent) => {
      if (event.getType() === MINDROOM_SERVER_EVENT) refresh();
    };
    // Only an agent's membership, or the user's own, changes which servers count. Sync hands an
    // agent's member event over again with every batch it sends in, unchanged, so render again
    // only when the servers change. A batch can carry many member events, and reading the
    // servers walks every room, so read them once after the batch.
    let check: ReturnType<typeof setTimeout> | undefined;
    const checkServers = () => {
      check = undefined;
      if (!sameUrls(joinedRoomServerUrls(mx), renderedUrls.current)) refresh();
    };
    const onMember = (_event: MatrixEvent, _state: RoomState, member: RoomMember) => {
      if (!bindsTokens || !isMindroomAgentUserIdForViewer(member.userId, viewer)) return;
      check ??= setTimeout(checkServers, 0);
    };
    mx.on(RoomStateEvent.Events, onState);
    mx.on(RoomStateEvent.Members, onMember);
    mx.on(RoomEvent.MyMembership, refresh);
    return () => {
      clearTimeout(check);
      mx.removeListener(RoomStateEvent.Events, onState);
      mx.removeListener(RoomStateEvent.Members, onMember);
      mx.removeListener(RoomEvent.MyMembership, refresh);
    };
  }, [mx, bindsTokens, refresh]);
  return urls;
};
