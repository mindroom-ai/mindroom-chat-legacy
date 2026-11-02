import React from 'react';
import type { Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useImagePackRooms } from './useImagePackRooms';

const mocks = vi.hoisted(() => ({
  mx: { getRoom: (roomId: string) => ({ roomId }) },
  serverEmojiRoom: undefined as { roomId: string } | undefined,
}));

vi.mock('../mindroom/server-emoji/useServerEmojiRoom', () => ({
  useServerEmojiRoom: () => mocks.serverEmojiRoom,
}));

vi.mock('./useMatrixClient', () => ({
  useMatrixClient: () => mocks.mx,
}));

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  mocks.serverEmojiRoom = undefined;
});

/** Renders the hook for a room inside the given parent spaces; `roomIds()` reads its last result. */
const renderPickerRooms = (roomId: string, parentIds: string[] = []) => {
  const roomToParents = new Map([[roomId, new Set(parentIds)]]);
  let listed: Room[] = [];
  function Probe() {
    listed = useImagePackRooms(roomId, roomToParents);
    return null;
  }
  act(() => {
    renderer = create(<Probe />);
  });
  return {
    roomIds: () => listed.map((room) => room.roomId),
    renderAgain: () => {
      act(() => {
        renderer?.update(<Probe />);
      });
    },
  };
};

describe('useImagePackRooms', () => {
  it('appends the server emoji room after the room and its parent spaces', () => {
    mocks.serverEmojiRoom = { roomId: '!emoji' };

    expect(renderPickerRooms('!room', ['!space']).roomIds()).toEqual(['!room', '!space', '!emoji']);
  });

  it('lists the server emoji room once when it is the current room', () => {
    mocks.serverEmojiRoom = { roomId: '!emoji' };

    expect(renderPickerRooms('!emoji').roomIds()).toEqual(['!emoji']);
  });

  it('returns only the room and its parents without a server emoji room', () => {
    expect(renderPickerRooms('!room', ['!space']).roomIds()).toEqual(['!room', '!space']);
  });

  it('follows the server emoji room as it is joined and left', () => {
    const picker = renderPickerRooms('!room', ['!space']);
    expect(picker.roomIds()).toEqual(['!room', '!space']);

    mocks.serverEmojiRoom = { roomId: '!emoji' };
    picker.renderAgain();
    expect(picker.roomIds()).toEqual(['!room', '!space', '!emoji']);

    mocks.serverEmojiRoom = undefined;
    picker.renderAgain();
    expect(picker.roomIds()).toEqual(['!room', '!space']);
  });
});
