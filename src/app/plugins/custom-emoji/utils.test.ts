import { describe, expect, it } from 'vitest';
import {
  addEmoticonToPackContent,
  nextPackStateKey,
  packContentBytes,
  ShortcodeTakenError,
} from './utils';
import { ImageUsage } from './types';

const image = { url: 'mxc://example.org/new', info: { w: 32, h: 32 } };

describe('addEmoticonToPackContent', () => {
  it('starts a pack when the user has none', () => {
    expect(addEmoticonToPackContent(undefined, 'party', image)).toEqual({
      images: { party: image },
    });
  });

  it('keeps the pack meta and existing images', () => {
    const existing = { url: 'mxc://example.org/old' };
    const content = addEmoticonToPackContent(
      { pack: { display_name: 'Mine' }, images: { old: existing } },
      'party',
      image
    );

    expect(content).toEqual({
      pack: { display_name: 'Mine' },
      images: { old: existing, party: image },
    });
  });

  it('refuses a taken shortcode, whatever the image is used as', () => {
    const sticker = { url: 'mxc://example.org/old', usage: [ImageUsage.Sticker] };

    expect(() => addEmoticonToPackContent({ images: { party: sticker } }, 'party', image)).toThrow(
      ShortcodeTakenError
    );
  });

  it('saves a shortcode named like an Object.prototype key', () => {
    const content = addEmoticonToPackContent(undefined, '__proto__', image);

    expect(JSON.stringify(content)).toBe(
      '{"images":{"__proto__":{"url":"mxc://example.org/new","info":{"w":32,"h":32}}}}'
    );
  });

  it('marks the image as an emoji in a sticker-only pack', () => {
    const content = addEmoticonToPackContent(
      { pack: { usage: [ImageUsage.Sticker] } },
      'party',
      image
    );

    expect(content.images?.party).toEqual({ ...image, usage: [ImageUsage.Emoticon] });
  });
});

describe('nextPackStateKey', () => {
  it('opens the second pack when only the first exists', () => {
    expect(nextPackStateKey(['', 'party'])).toBe('2');
  });

  it('continues after the last numbered pack', () => {
    expect(nextPackStateKey(['', '2', '3'])).toBe('4');
  });

  it('takes the smallest unused number', () => {
    expect(nextPackStateKey(['', '3'])).toBe('2');
  });
});

describe('packContentBytes', () => {
  it('counts the UTF-8 bytes of the JSON, where a character can take two', () => {
    // 29 characters, `é` takes two bytes.
    expect(packContentBytes({ pack: { display_name: 'é' } })).toBe(30);
  });
});
