import { useAtomValue } from 'jotai';
import { MatrixClient } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { RoomToParents } from '../../../../types/matrix/room';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { mDirectAtom } from '../../../state/mDirectList';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { useOrphanRooms, useRooms } from '../../../state/hooks/roomList';
import { useSimpleMode } from '../../../mindroom/settings/useMindroomAccountSettings';
import { isMindroomEmojiRoom, isSpace } from '../../../utils/room';

export const useHomeRooms = () => {
  const mx = useMatrixClient();
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  // Simple mode keeps Home as one complete room list alongside the visible
  // space tabs, so users can browse either the flat list or their organization.
  const simpleMode = useSimpleMode();
  const orphanRooms = useOrphanRooms(mx, allRoomsAtom, mDirects, roomToParents);
  const flatRooms = useRooms(mx, allRoomsAtom, mDirects);
  return simpleMode ? flatRooms : orphanRooms;
};

export const getHomeSearchRooms = (
  mx: MatrixClient,
  allRooms: string[],
  mDirects: Set<string>,
  roomToParents: RoomToParents,
  includeSpaceChildren = false
): string[] =>
  allRooms.filter(
    (roomId) =>
      !mDirects.has(roomId) &&
      (includeSpaceChildren || !roomToParents.has(roomId)) &&
      !isSpace(mx.getRoom(roomId)) &&
      !isMindroomEmojiRoom(mx.getRoom(roomId))
  );

export const mergeHomeSearchRoomSources = (sdkRoomIds: string[], allRoomIds: string[]): string[] =>
  Array.from(new Set([...sdkRoomIds, ...allRoomIds]));

export const useHomeSearchRooms = () => {
  const mx = useMatrixClient();
  const allRooms = useAtomValue(allRoomsAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const simpleMode = useSimpleMode();
  const sdkRoomIdsKey = mx
    .getRooms()
    .map((room) => room.roomId)
    .join('\n');

  return useMemo(() => {
    const sdkRoomIds = sdkRoomIdsKey ? sdkRoomIdsKey.split('\n') : [];
    return getHomeSearchRooms(
      mx,
      mergeHomeSearchRoomSources(sdkRoomIds, allRooms),
      mDirects,
      roomToParents,
      simpleMode
    );
  }, [allRooms, mDirects, mx, roomToParents, sdkRoomIdsKey, simpleMode]);
};
