import { describe, expect, it } from 'vitest';
import { ImagePack } from './ImagePack';
import { ImageUsage, PackContent } from './types';

describe('PackImagesReader', () => {
  it('skips image entries that are not objects instead of throwing', () => {
    // Anyone who may edit a shared pack can publish any JSON, so one bad entry must not break pickers.
    const content = {
      images: { bad: null, list: [], text: 'mxc://x/text', ok: { url: 'mxc://x/ok' } },
    } as unknown as PackContent;
    const pack = new ImagePack('$pack', content, { roomId: '!emoji', stateKey: '' });

    expect(pack.getImages(ImageUsage.Emoticon).map((image) => image.shortcode)).toEqual(['ok']);
    expect([...pack.images.collection.keys()]).toEqual(['ok']);
  });
});
