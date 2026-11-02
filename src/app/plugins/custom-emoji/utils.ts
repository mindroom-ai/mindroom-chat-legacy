import { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { ImagePack } from './ImagePack';
import { EmoteRoomsContent, ImageUsage, PackContent, PackImage, PackImages } from './types';
import { StateEvent } from '../../../types/matrix/room';
import { getAccountData, getStateEvent, getStateEvents } from '../../utils/room';
import { AccountDataEvent } from '../../../types/matrix/accountData';
import { PackMetaReader } from './PackMetaReader';
import { PackAddress } from './PackAddress';

export function packAddressEqual(a1?: PackAddress, a2?: PackAddress): boolean {
  if (!a1 && !a2) return true;
  if (!a1 || !a2) return false;
  return a1.roomId === a2.roomId && a1.stateKey === a2.stateKey;
}

export function imageUsageEqual(u1: ImageUsage[], u2: ImageUsage[]) {
  return u1.length === u2.length && u1.every((u) => u2.includes(u));
}

export function packMetaEqual(a: PackMetaReader, b: PackMetaReader): boolean {
  return (
    a.name === b.name &&
    a.avatar === b.avatar &&
    a.attribution === b.attribution &&
    imageUsageEqual(a.usage, b.usage)
  );
}

export function makeImagePacks(packEvents: MatrixEvent[]): ImagePack[] {
  return packEvents.reduce<ImagePack[]>((imagePacks, packEvent) => {
    const packId = packEvent.getId();
    if (!packId) return imagePacks;
    imagePacks.push(ImagePack.fromMatrixEvent(packId, packEvent));
    return imagePacks;
  }, []);
}

export function getRoomImagePack(room: Room, stateKey: string): ImagePack | undefined {
  const packEvent = getStateEvent(room, StateEvent.PoniesRoomEmotes, stateKey);
  if (!packEvent) return undefined;
  const packId = packEvent.getId();
  if (!packId) return undefined;
  return ImagePack.fromMatrixEvent(packId, packEvent);
}

export function getRoomImagePacks(room: Room): ImagePack[] {
  const packEvents = getStateEvents(room, StateEvent.PoniesRoomEmotes);
  return makeImagePacks(packEvents);
}

export function getGlobalImagePacks(mx: MatrixClient): ImagePack[] {
  const emoteRoomsContent = getAccountData(mx, AccountDataEvent.PoniesEmoteRooms)?.getContent() as
    | EmoteRoomsContent
    | undefined;
  if (typeof emoteRoomsContent !== 'object') return [];

  const { rooms: roomIdToPackInfo } = emoteRoomsContent;
  if (typeof roomIdToPackInfo !== 'object') return [];

  const roomIds = Object.keys(roomIdToPackInfo);

  const packs = roomIds.flatMap((roomId) => {
    if (typeof roomIdToPackInfo[roomId] !== 'object') return [];
    const room = mx.getRoom(roomId);
    if (!room) return [];
    const packStateKeyToUnknown = roomIdToPackInfo[roomId];
    const packEvents = getStateEvents(room, StateEvent.PoniesRoomEmotes);
    const globalPackEvents = packEvents.filter((mE) => {
      const stateKey = mE.getStateKey();
      if (typeof stateKey === 'string') return !!packStateKeyToUnknown[stateKey];
      return false;
    });
    return makeImagePacks(globalPackEvents);
  });

  return packs;
}

export function getUserImagePack(mx: MatrixClient): ImagePack | undefined {
  const packEvent = getAccountData(mx, AccountDataEvent.PoniesUserEmotes);
  const userId = mx.getUserId();
  if (!packEvent || !userId) {
    return undefined;
  }

  const userImagePack = ImagePack.fromMatrixEvent(userId, packEvent);
  return userImagePack;
}

/** The pack already has an image under the shortcode. */
export class ShortcodeTakenError extends Error {
  constructor(public readonly shortcode: string) {
    super(`The shortcode ${shortcode} is taken.`);
  }
}

/** Whether a live pack among `packs`, as last synced, has an image under the shortcode. */
export const packsHaveShortcode = (
  packs: Array<ImagePack | undefined>,
  shortcode: string
): boolean =>
  packs.some((pack) => !!pack && !pack.deleted && pack.images.collection.has(shortcode));

/** Adds an image to a pack as an emoji; throws `ShortcodeTakenError` when the shortcode is taken. */
export function addEmoticonToPackContent(
  content: PackContent | undefined,
  shortcode: string,
  image: PackImage
): PackContent {
  const images: PackImages = { ...content?.images };
  if (Object.prototype.hasOwnProperty.call(images, shortcode))
    throw new ShortcodeTakenError(shortcode);
  const packUsage = new PackMetaReader(content?.pack ?? {}).usage;
  const emoticon = packUsage.includes(ImageUsage.Emoticon)
    ? image
    : { ...image, usage: [ImageUsage.Emoticon] };
  // A computed key defines an own property even for `__proto__`; assigning one would not.
  return { ...content, images: { ...images, [shortcode]: emoticon } };
}

// Matrix caps an event at 64 KiB with its envelope, and Tuwunel counts the content an update replaces
// (`unsigned.prev_content`) toward that limit, so a pack and its previous version must fit in it together.
export const MAX_PACK_CONTENT_BYTES = 30_000;

export const packContentBytes = (content: PackContent): number =>
  new TextEncoder().encode(JSON.stringify(content)).length;

/** The state key of a new overflow pack: the smallest unused whole number from 2 up. */
export const nextPackStateKey = (taken: string[]): string => {
  let next = 2;
  while (taken.includes(String(next))) next += 1;
  return String(next);
};
