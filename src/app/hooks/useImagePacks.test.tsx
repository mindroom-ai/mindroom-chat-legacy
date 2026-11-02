import React from 'react';
import { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImagePack } from '../plugins/custom-emoji';
import { useRoomsImagePacks } from './useImagePacks';

vi.mock('./useMatrixClient', () => ({
  useMatrixClient: () => ({ on: vi.fn(), removeListener: vi.fn() }),
}));

/** A room whose synced state holds one emoji pack at state key `''`. */
const roomWithPack = (roomId: string): Room => {
  const pack = new MatrixEvent({
    type: 'im.ponies.room_emotes',
    state_key: '',
    content: { images: { 'party-parrot': { url: `mxc://example.org/${roomId}` } } },
    sender: '@op:example.org',
    room_id: roomId,
    event_id: `$pack${roomId}`,
  });
  return {
    roomId,
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (type: string, stateKey?: string) => {
          const ofType = type === 'im.ponies.room_emotes' ? [pack] : [];
          return stateKey === undefined ? ofType : ofType[0] ?? null;
        },
      }),
    }),
  } as unknown as Room;
};

let renderer: ReactTestRenderer | undefined;
let packs: ImagePack[] = [];

function Harness({ rooms }: { rooms: Room[] }) {
  packs = useRoomsImagePacks(rooms);
  return null;
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('useRoomsImagePacks', () => {
  it('reads the packs of a room added after mount without waiting for a pack event', () => {
    act(() => {
      renderer = create(<Harness rooms={[]} />);
    });
    expect(packs).toEqual([]);

    const emojiRoom = roomWithPack('!emoji');
    act(() => renderer!.update(<Harness rooms={[emojiRoom]} />));

    expect(packs.map((pack) => pack.address?.roomId)).toEqual(['!emoji']);
  });

  it('keeps the same packs when the caller passes a new array of the same rooms', () => {
    const emojiRoom = roomWithPack('!emoji');
    act(() => {
      renderer = create(<Harness rooms={[emojiRoom]} />);
    });
    const first = packs;

    act(() => renderer!.update(<Harness rooms={[emojiRoom]} />));

    expect(packs).toBe(first);
  });
});
