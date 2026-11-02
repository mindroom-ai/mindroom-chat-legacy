import { useCallback, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { Membership, StateEvent } from '../../../types/matrix/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useStateEventCallback } from '../../hooks/useStateEventCallback';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { isRoomAlias } from '../../utils/matrix';
import { getStateEvent } from '../../utils/room';
import { useServerEmojiRoomAddress } from './serverEmojiConfig';

/** The joined room the address names, found by room ID or by canonical alias. */
export const findServerEmojiRoom = (
  mx: MatrixClient,
  address: string | undefined
): Room | undefined => {
  if (!address) return undefined;
  if (!isRoomAlias(address)) {
    const room = mx.getRoom(address);
    // An upgraded room stays joined; its tombstone retires it, as for the alias match below.
    return room?.getMyMembership() === Membership.Join &&
      getStateEvent(room, StateEvent.RoomTombstone) === undefined
      ? room
      : undefined;
  }
  // Only a joined, current, local-only room may match. A room left after a replacement, or an
  // invite whose stripped state claims the alias, must not hide it, and another server can set any
  // canonical alias in its own rooms; a room with m.federate false cannot come from elsewhere.
  return mx
    .getRooms()
    .find(
      (room) =>
        room.getMyMembership() === Membership.Join &&
        room.getCanonicalAlias() === address &&
        getStateEvent(room, StateEvent.RoomTombstone) === undefined &&
        getStateEvent(room, StateEvent.RoomCreate)?.getContent()['m.federate'] === false
    );
};

/** The server emoji room once the user has joined it; follows joins, leaves, upgrades and aliases. */
export const useServerEmojiRoom = (): Room | undefined => {
  const mx = useMatrixClient();
  const address = useServerEmojiRoomAddress();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  // A tombstone or a moved alias changes which room matches without changing membership.
  const [matchStateChanges, setMatchStateChanges] = useState(0);
  useStateEventCallback(
    mx,
    useCallback((event) => {
      const type = event.getType();
      if (type === StateEvent.RoomTombstone || type === StateEvent.RoomCanonicalAlias) {
        setMatchStateChanges((count) => count + 1);
      }
    }, [])
  );
  return useMemo(
    () => findServerEmojiRoom(mx, address),
    // The client holds the rooms; the joined room list and the match state changes signal that
    // the answer may differ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mx, address, joinedRoomIds, matchStateChanges]
  );
};
