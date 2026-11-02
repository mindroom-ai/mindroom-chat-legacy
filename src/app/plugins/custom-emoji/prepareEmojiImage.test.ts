import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getThumbnail } from '../../utils/dom';
import { EmojiImageTooLargeError, fitWithin, prepareEmojiImage } from './prepareEmojiImage';

vi.mock('../../utils/dom', () => ({ getThumbnail: vi.fn() }));

const loaded = (width: number, height: number) => ({ width, height } as HTMLImageElement);
const fileOf = (bytes: number, name: string, type: string) =>
  new File([new Uint8Array(bytes)], name, { type });

describe('fitWithin', () => {
  it('shrinks to the limit and keeps the aspect ratio', () => {
    expect(fitWithin(512, 256, 128)).toEqual([128, 64]);
  });

  it('never enlarges', () => {
    expect(fitWithin(64, 32, 128)).toEqual([64, 32]);
  });
});

describe('prepareEmojiImage', () => {
  beforeEach(() => {
    vi.mocked(getThumbnail).mockReset();
  });

  it('keeps a GIF of up to 256 KB as it is, so it still animates', async () => {
    const gif = fileOf(200 * 1024, 'parrot.gif', 'image/gif');

    const prepared = await prepareEmojiImage(gif, loaded(512, 512));

    expect(prepared.file).toBe(gif);
    expect(prepared.info).toEqual({ w: 512, h: 512, mimetype: 'image/gif', size: 200 * 1024 });
    expect(getThumbnail).not.toHaveBeenCalled();
  });

  it('refuses a larger GIF', async () => {
    const gif = fileOf(300 * 1024, 'parrot.gif', 'image/gif');

    await expect(prepareEmojiImage(gif, loaded(64, 64))).rejects.toBeInstanceOf(
      EmojiImageTooLargeError
    );
  });

  it('keeps a still image that already fits', async () => {
    const png = fileOf(100, 'parrot.png', 'image/png');

    const prepared = await prepareEmojiImage(png, loaded(64, 64));

    expect(prepared.file).toBe(png);
    expect(prepared.info).toEqual({ w: 64, h: 64, mimetype: 'image/png', size: 100 });
    expect(getThumbnail).not.toHaveBeenCalled();
  });

  it('draws a larger still image at 128 pixels as a PNG', async () => {
    const blob = new Blob(['resized'], { type: 'image/png' });
    vi.mocked(getThumbnail).mockResolvedValue(blob);
    const img = loaded(512, 256);

    const prepared = await prepareEmojiImage(fileOf(5000, 'party parrot.jpg', 'image/jpeg'), img);

    expect(getThumbnail).toHaveBeenCalledWith(img, 128, 64, 'image/png');
    expect(prepared.file.name).toBe('party parrot.png');
    expect(prepared.file.type).toBe('image/png');
    expect(prepared.file.size).toBe(blob.size);
    expect(prepared.info).toEqual({ w: 128, h: 64, mimetype: 'image/png', size: blob.size });
  });

  it('fails when the image cannot be drawn', async () => {
    vi.mocked(getThumbnail).mockResolvedValue(undefined);

    await expect(
      prepareEmojiImage(fileOf(5000, 'parrot.jpg', 'image/jpeg'), loaded(512, 256))
    ).rejects.toThrow();
  });
});
