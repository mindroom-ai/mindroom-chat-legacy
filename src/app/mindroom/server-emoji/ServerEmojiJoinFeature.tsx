import { useEffect, useRef } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  getRoomNotificationMode,
  RoomNotificationMode,
  setRoomNotificationPreference,
  useRoomsNotificationPreferences,
} from '../../hooks/useRoomsNotificationPreferences';
import { useClientStartupContext } from '../../pages/client/ClientStartupContext';
import { useServerEmojiRoomAddress } from './serverEmojiConfig';
import { useServerEmojiRoom } from './useServerEmojiRoom';

/**
 * Joins the room the homeserver names for server emoji, at most once per session and address,
 * and mutes it. A refused join (banned, or an alias that names nothing) is logged and not retried.
 */
export function ServerEmojiJoinFeature() {
  const mx = useMatrixClient();
  const address = useServerEmojiRoomAddress();
  const room = useServerEmojiRoom();
  // A cached shell can mount before the first sync shows a room joined from another device.
  const { hasCompletedInitialSync } = useClientStartupContext();
  const attempted = useRef(new Set<string>());
  const notificationPreferences = useRoomsNotificationPreferences();
  const muteChecked = useRef(new Set<string>());

  useEffect(() => {
    if (!address || room || !hasCompletedInitialSync || attempted.current.has(address)) return;
    attempted.current.add(address);
    mx.joinRoom(address).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[server-emoji] could not join the server emoji room', address, error);
    });
  }, [mx, address, room, hasCompletedInitialSync]);

  // Nobody can see the hidden room to mute it, and a member allowed to edit a pack could put
  // mentions in a pack event; muting it keeps anything there from notifying anyone.
  useEffect(() => {
    if (!room || !hasCompletedInitialSync || muteChecked.current.has(room.roomId)) return;
    muteChecked.current.add(room.roomId);
    const mode = getRoomNotificationMode(notificationPreferences, room.roomId);
    if (mode === RoomNotificationMode.Mute) return;
    setRoomNotificationPreference(mx, room.roomId, RoomNotificationMode.Mute, mode).catch(
      (error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[server-emoji] could not mute the server emoji room', room.roomId, error);
      }
    );
  }, [mx, room, hasCompletedInitialSync, notificationPreferences]);

  return null;
}
