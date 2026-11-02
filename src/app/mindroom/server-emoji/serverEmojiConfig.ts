import { useMemo } from 'react';
import type { AutoDiscoveryInfo } from '../../cs-api';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import { isRoomAlias, isRoomId } from '../../utils/matrix';

export const SERVER_EMOJI_WELL_KNOWN_KEY = 'io.mindroom.emoji';

/** The room that holds the server's emoji packs, from the homeserver's client well-known. */
export const getServerEmojiRoomAddress = (info: AutoDiscoveryInfo): string | undefined => {
  const section = info[SERVER_EMOJI_WELL_KNOWN_KEY] as { room?: unknown } | null | undefined;
  const room = section?.room;
  if (typeof room !== 'string') return undefined;
  // Room version 12 IDs have no server name, so a bare `!<id>` is valid; `!` alone is not.
  if (isRoomAlias(room) || (isRoomId(room) && room.length > 1)) return room;
  return undefined;
};

/** Follows the well-known, which may load after the timeline mounts. */
export const useServerEmojiRoomAddress = (): string | undefined => {
  const info = useAutoDiscoveryInfo();
  return useMemo(() => getServerEmojiRoomAddress(info), [info]);
};
