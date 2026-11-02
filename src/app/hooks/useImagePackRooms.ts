import { Room } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { useServerEmojiRoom } from '../mindroom/server-emoji/useServerEmojiRoom';
import { getAllParents } from '../utils/room';
import { useMatrixClient } from './useMatrixClient';

export const useImagePackRooms = (
  roomId: string,
  roomToParents: Map<string, Set<string>>
): Room[] => {
  const mx = useMatrixClient();
  const serverEmojiRoom = useServerEmojiRoom();

  const imagePackRooms: Room[] = useMemo(() => {
    const allParentSpaces = [roomId].concat(Array.from(getAllParents(roomToParents, roomId)));
    const rooms = allParentSpaces.reduce<Room[]>((list, rId) => {
      const r = mx.getRoom(rId);
      if (r) list.push(r);
      return list;
    }, []);
    // Every picker offers the server's emoji after the packs of the room and its spaces.
    if (serverEmojiRoom && !rooms.some((r) => r.roomId === serverEmojiRoom.roomId)) {
      rooms.push(serverEmojiRoom);
    }
    return rooms;
  }, [mx, roomId, roomToParents, serverEmojiRoom]);

  return imagePackRooms;
};
