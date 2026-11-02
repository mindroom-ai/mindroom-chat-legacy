import { MatrixClient } from 'matrix-js-sdk';
import { getAccountData } from '../utils/room';
import { IEmoji, emojis } from './emoji';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { ImagePack, ImageUsage, PackImageReader } from './custom-emoji';

type EmojiUnicode = string;
type EmojiUsageCount = number;

export type IRecentEmojiContent = {
  recent_emoji?: [EmojiUnicode, EmojiUsageCount][];
};

/**
 * The recent emoji, most used first. A Unicode key is found among the emoji, an `mxc://` key among
 * the packs' emoji images; a key found in neither is left out and does not count toward `limit`.
 */
export const getRecentEmojis = (
  mx: MatrixClient,
  limit?: number,
  packs: ImagePack[] = []
): Array<IEmoji | PackImageReader> => {
  const recentEmojiEvent = getAccountData(mx, AccountDataEvent.ElementRecentEmoji);
  const recentEmoji = recentEmojiEvent?.getContent<IRecentEmojiContent>().recent_emoji;
  if (!Array.isArray(recentEmoji)) return [];

  const images = packs.flatMap((pack) => pack.getImages(ImageUsage.Emoticon));
  return recentEmoji
    .sort((e1, e2) => e2[1] - e1[1])
    .reduce<Array<IEmoji | PackImageReader>>((list, [key]) => {
      const emoji =
        emojis.find((e) => e.unicode === key) ?? images.find((image) => image.url === key);
      if (emoji) list.push(emoji);
      return list;
    }, [])
    .slice(0, limit);
};

export function addRecentEmoji(mx: MatrixClient, unicode: string) {
  const recentEmojiEvent = getAccountData(mx, AccountDataEvent.ElementRecentEmoji);
  const recentEmojiContent = recentEmojiEvent?.getContent<IRecentEmojiContent>();
  const recentEmoji =
    recentEmojiContent && Array.isArray(recentEmojiContent.recent_emoji)
      ? structuredClone(recentEmojiContent.recent_emoji)
      : [];

  const emojiIndex = recentEmoji.findIndex(([u]) => u === unicode);
  let entry: [EmojiUnicode, EmojiUsageCount];
  if (emojiIndex < 0) {
    entry = [unicode, 1];
  } else {
    [entry] = recentEmoji.splice(emojiIndex, 1);
    entry[1] += 1;
  }
  recentEmoji.unshift(entry);
  mx.setAccountData(
    AccountDataEvent.ElementRecentEmoji as any,
    {
      recent_emoji: recentEmoji.slice(0, 100),
    } as any
  );
}
