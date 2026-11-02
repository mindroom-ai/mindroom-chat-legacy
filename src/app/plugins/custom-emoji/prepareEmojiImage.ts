import { IImageInfo } from '../../../types/matrix/common';
import { getThumbnail } from '../../utils/dom';
import { getImageInfo } from '../../utils/matrix';
import { getFileNameWithoutExt } from '../../utils/mimeTypes';

export const MAX_EMOJI_DIMENSION = 128;
export const MAX_ANIMATED_EMOJI_BYTES = 256 * 1024;

/** The size that fits in a `max` square with the same aspect ratio; never larger than given. */
export const fitWithin = (width: number, height: number, max: number): [number, number] => {
  const scale = Math.min(1, max / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
};

export class EmojiImageTooLargeError extends Error {}

/**
 * The file to upload as an emoji: a still image larger than 128 pixels is drawn at that size as a
 * PNG, so a large photo does not reach every member at full size. GIFs are never redrawn, so they keep animating, and one over 256 KB is refused.
 */
export const prepareEmojiImage = async (
  file: File,
  img: HTMLImageElement
): Promise<{ file: File; info: IImageInfo }> => {
  if (file.type === 'image/gif') {
    if (file.size > MAX_ANIMATED_EMOJI_BYTES) throw new EmojiImageTooLargeError();
    return { file, info: getImageInfo(img, file) };
  }
  if (Math.max(img.width, img.height) <= MAX_EMOJI_DIMENSION) {
    return { file, info: getImageInfo(img, file) };
  }
  const [w, h] = fitWithin(img.width, img.height, MAX_EMOJI_DIMENSION);
  const blob = await getThumbnail(img, w, h, 'image/png');
  if (!blob) throw new Error('Could not draw the emoji image');
  return {
    file: new File([blob], `${getFileNameWithoutExt(file.name)}.png`, { type: 'image/png' }),
    info: { w, h, mimetype: 'image/png', size: blob.size },
  };
};
