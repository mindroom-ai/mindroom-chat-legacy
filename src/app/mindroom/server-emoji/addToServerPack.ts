import type { MatrixClient, Room } from 'matrix-js-sdk';
import { StateEvent } from '../../../types/matrix/room';
import { ErrorCode } from '../../cs-errorcode';
import { getPowersLevelFromMatrixEvent } from '../../hooks/usePowerLevels';
import { getRoomCreators } from '../../hooks/useRoomCreators';
import { getRoomPermissionsAPI } from '../../hooks/useRoomPermissions';
import {
  addEmoticonToPackContent,
  getRoomImagePacks,
  MAX_PACK_CONTENT_BYTES,
  nextPackStateKey,
  packContentBytes,
  PackContent,
  PackImage,
  PackMeta,
  packsHaveShortcode,
  ShortcodeTakenError,
} from '../../plugins/custom-emoji';
import { getStateEvent } from '../../utils/room';

/** Whether the user's power level allows adding to the room's emoji packs. */
export const canAddServerEmoji = (mx: MatrixClient, room: Room): boolean => {
  const createEvent = getStateEvent(room, StateEvent.RoomCreate);
  if (!createEvent) return false;
  const powerLevels = getPowersLevelFromMatrixEvent(
    getStateEvent(room, StateEvent.RoomPowerLevels)
  );
  return getRoomPermissionsAPI(getRoomCreators(createEvent), powerLevels).stateEvent(
    StateEvent.PoniesRoomEmotes,
    mx.getSafeUserId()
  );
};

/** The pack as the server has it; `undefined` when the room has no pack at that state key. */
const fetchPackContent = async (
  mx: MatrixClient,
  roomId: string,
  stateKey: string
): Promise<PackContent | undefined> => {
  try {
    return await mx.getStateEvent(roomId, StateEvent.PoniesRoomEmotes, stateKey);
  } catch (error) {
    if ((error as { errcode?: string })?.errcode !== ErrorCode.M_NOT_FOUND) throw error;
    return undefined;
  }
};

/** Whether pack content as the server holds it is a live pack; a deleted pack has empty content. */
const isLivePack = (content: PackContent | undefined): boolean =>
  content?.pack !== undefined || content?.images !== undefined;

/** Whether pack content as the server holds it has an image under the shortcode. */
const hasImage = (content: PackContent | undefined, shortcode: string): boolean =>
  typeof content?.images === 'object' &&
  content.images !== null &&
  Object.prototype.hasOwnProperty.call(content.images, shortcode);

/**
 * Adds an image to the server emoji room's first pack with room for it, or to a new pack
 * when every pack is full. Throws `ShortcodeTakenError` when a server pack has the shortcode.
 */
export const addToServerPack = async (
  mx: MatrixClient,
  room: Room,
  shortcode: string,
  image: PackImage
): Promise<void> => {
  // Synced state only names the pack keys this client knows, deleted ones included. What each holds,
  // whether it is live, and which names are taken come from the server right before writing, so an
  // edit, a restored pack, or a name another device added since the last sync is taken into account.
  const synced = getRoomImagePacks(room);
  // A name the synced packs already show is refused without any request.
  if (packsHaveShortcode(synced, shortcode)) throw new ShortcodeTakenError(shortcode);
  // The first pack's key is always read too: the fallback below starts it, and another device may
  // have created it since the last sync.
  const keys = [
    ...new Set(['', ...synced.flatMap((pack) => (pack.address ? [pack.address.stateKey] : []))]),
  ].sort();
  const serverPacks = await Promise.all(keys.map((key) => fetchPackContent(mx, room.roomId, key)));
  if (serverPacks.some((content) => hasImage(content, shortcode))) {
    throw new ShortcodeTakenError(shortcode);
  }
  const firstMeta: PackMeta | undefined = serverPacks.find((content) => content?.pack)?.pack;
  const livePacks = keys.flatMap((key, index) =>
    isLivePack(serverPacks[index]) ? [{ key, content: serverPacks[index] }] : []
  );
  // No live pack, not even '' as just read: start the first one.
  if (livePacks.length === 0) {
    const content = addEmoticonToPackContent({ pack: firstMeta }, shortcode, image);
    await mx.sendStateEvent(room.roomId, StateEvent.PoniesRoomEmotes as any, content, '');
    return;
  }
  for (const { key, content: current } of livePacks) {
    const content = addEmoticonToPackContent(current, shortcode, image);
    if (packContentBytes(content) <= MAX_PACK_CONTENT_BYTES) {
      await mx.sendStateEvent(room.roomId, StateEvent.PoniesRoomEmotes as any, content, key);
      return;
    }
  }

  // The next free key in this client's view may already hold a pack another device opened since
  // the last sync, so read it as well: add to it if it fits, otherwise try the key after it.
  for (;;) {
    const key = nextPackStateKey(keys);
    const current = await fetchPackContent(mx, room.roomId, key);
    const live = isLivePack(current);
    const content = addEmoticonToPackContent(
      live ? current : { pack: firstMeta },
      shortcode,
      image
    );
    if (!live || packContentBytes(content) <= MAX_PACK_CONTENT_BYTES) {
      await mx.sendStateEvent(room.roomId, StateEvent.PoniesRoomEmotes as any, content, key);
      return;
    }
    keys.push(key);
  }
};
