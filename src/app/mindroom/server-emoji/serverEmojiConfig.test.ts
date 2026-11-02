import { describe, expect, it } from 'vitest';
import type { AutoDiscoveryInfo } from '../../cs-api';
import { getServerEmojiRoomAddress } from './serverEmojiConfig';

const info = (extra: Record<string, unknown>): AutoDiscoveryInfo =>
  ({ 'm.homeserver': { base_url: 'https://hs.example' }, ...extra } as AutoDiscoveryInfo);

describe('getServerEmojiRoomAddress', () => {
  it('returns a room alias', () => {
    expect(
      getServerEmojiRoomAddress(info({ 'io.mindroom.emoji': { room: '#emoji:example.com' } }))
    ).toBe('#emoji:example.com');
  });

  it('returns a room ID, including a room version 12 ID without a server name', () => {
    expect(
      getServerEmojiRoomAddress(info({ 'io.mindroom.emoji': { room: '!abc:example.com' } }))
    ).toBe('!abc:example.com');
    expect(getServerEmojiRoomAddress(info({ 'io.mindroom.emoji': { room: '!AbCd123' } }))).toBe(
      '!AbCd123'
    );
  });

  it('treats a missing or malformed key as not configured', () => {
    for (const value of [
      undefined,
      [],
      { room: 42 },
      { room: 'emoji' },
      { room: '#emoji' },
      { room: '!' },
    ]) {
      expect(
        getServerEmojiRoomAddress(info(value === undefined ? {} : { 'io.mindroom.emoji': value }))
      ).toBeUndefined();
    }
  });
});
