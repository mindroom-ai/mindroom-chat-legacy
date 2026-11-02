import React from 'react';
import { Provider, createStore } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { AutoDiscoveryInfoProvider } from '../../hooks/useAutoDiscoveryInfo';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { findServerEmojiRoom, useServerEmojiRoom } from './useServerEmojiRoom';

const ROOM_ID = '!emoji:example.com';
const ALIAS = '#emoji:example.com';

/** What the alias match and the membership check read from a room; local-only unless `federated`. */
const fakeRoom = (
  membership: string,
  roomId = ROOM_ID,
  tombstoned = false,
  federated = false
): Room =>
  ({
    roomId,
    getCanonicalAlias: () => ALIAS,
    getMyMembership: () => membership,
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (type: string) => {
          if (type === 'm.room.create') {
            return { getContent: () => (federated ? {} : { 'm.federate': false }) };
          }
          return tombstoned && type === 'm.room.tombstone' ? {} : null;
        },
      }),
    }),
  } as unknown as Room);

const stateListeners = new Set<(event: { getType: () => string }) => void>();

const fakeClient = (rooms: Room[]): MatrixClient =>
  ({
    getRooms: () => rooms,
    getRoom: (roomId: string) => rooms.find((room) => room.roomId === roomId) ?? null,
    on: (_name: string, listener: (event: { getType: () => string }) => void) =>
      stateListeners.add(listener),
    removeListener: (_name: string, listener: (event: { getType: () => string }) => void) =>
      stateListeners.delete(listener),
  } as unknown as MatrixClient);

describe('findServerEmojiRoom', () => {
  it('returns the joined room for a room ID', () => {
    const room = fakeRoom('join');
    expect(findServerEmojiRoom(fakeClient([room]), ROOM_ID)).toBe(room);
  });

  it('returns the joined room whose canonical alias matches an alias', () => {
    const room = fakeRoom('join');
    expect(findServerEmojiRoom(fakeClient([room]), ALIAS)).toBe(room);
  });

  it.each(['leave', 'invite'])('ignores a room with membership %s', (membership) => {
    const client = fakeClient([fakeRoom(membership)]);
    expect(findServerEmojiRoom(client, ROOM_ID)).toBeUndefined();
    expect(findServerEmojiRoom(client, ALIAS)).toBeUndefined();
  });

  it('finds the joined room by alias past a left and an invited room that carry it', () => {
    // An operator replaced the room, or an invite's stripped state claims the alias.
    const left = fakeRoom('leave', '!old:example.com');
    const invited = fakeRoom('invite', '!invited:example.com');
    const joined = fakeRoom('join');
    expect(findServerEmojiRoom(fakeClient([left, invited, joined]), ALIAS)).toBe(joined);
  });

  it('finds the current room by alias past a tombstoned room that carries it', () => {
    const replaced = fakeRoom('join', '!old:example.com', true);
    const current = fakeRoom('join');
    expect(findServerEmojiRoom(fakeClient([replaced, current]), ALIAS)).toBe(current);
    expect(findServerEmojiRoom(fakeClient([replaced]), ALIAS)).toBeUndefined();
  });

  it('ignores a federated room that claims the alias', () => {
    // Another server can set any canonical alias in its own room; only a local-only room can be ours.
    const remote = fakeRoom('join', '!remote:evil.example', false, true);
    const real = fakeRoom('join');
    expect(findServerEmojiRoom(fakeClient([remote]), ALIAS)).toBeUndefined();
    expect(findServerEmojiRoom(fakeClient([remote, real]), ALIAS)).toBe(real);
  });

  it('ignores a tombstoned room named by its room ID', () => {
    // After an upgrade the old room stays joined; its packs must not keep being used or written.
    const client = fakeClient([fakeRoom('join', ROOM_ID, true)]);
    expect(findServerEmojiRoom(client, ROOM_ID)).toBeUndefined();
  });

  it('returns nothing for a room the client does not know', () => {
    const client = fakeClient([]);
    expect(findServerEmojiRoom(client, ROOM_ID)).toBeUndefined();
    expect(findServerEmojiRoom(client, ALIAS)).toBeUndefined();
  });

  it('returns nothing without an address', () => {
    expect(findServerEmojiRoom(fakeClient([fakeRoom('join')]), undefined)).toBeUndefined();
  });
});

describe('useServerEmojiRoom', () => {
  it('finds the room when it enters the joined room list', async () => {
    const rooms: Room[] = [];
    const store = createStore();
    let found: Room | undefined;
    const Probe = () => {
      found = useServerEmojiRoom();
      return null;
    };

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          MatrixClientProvider,
          { value: fakeClient(rooms) },
          React.createElement(
            AutoDiscoveryInfoProvider,
            {
              value: {
                'm.homeserver': { base_url: 'https://example.com' },
                'io.mindroom.emoji': { room: ALIAS },
              },
            },
            React.createElement(Provider, { store }, React.createElement(Probe))
          )
        )
      );
    });
    expect(found).toBeUndefined();

    // The client holds the room before the list does, as after a join.
    const room = fakeRoom('join');
    rooms.push(room);
    await act(async () => {
      store.set(allRoomsAtom, { type: 'PUT', roomId: ROOM_ID });
    });

    expect(found).toBe(room);
    act(() => renderer.unmount());
  });

  it('drops the room when a tombstone arrives while it is in use', async () => {
    // An operator upgrades the room while Chat is open: membership stays, only state changes.
    let tombstoned = false;
    const room = {
      ...fakeRoom('join'),
      getLiveTimeline: () => ({
        getState: () => ({
          getStateEvents: (type: string) => {
            if (type === 'm.room.create') return { getContent: () => ({ 'm.federate': false }) };
            return tombstoned && type === 'm.room.tombstone' ? {} : null;
          },
        }),
      }),
    } as unknown as Room;
    let found: Room | undefined;
    const Probe = () => {
      found = useServerEmojiRoom();
      return null;
    };

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          MatrixClientProvider,
          { value: fakeClient([room]) },
          React.createElement(
            AutoDiscoveryInfoProvider,
            {
              value: {
                'm.homeserver': { base_url: 'https://example.com' },
                'io.mindroom.emoji': { room: ALIAS },
              },
            },
            React.createElement(Provider, { store: createStore() }, React.createElement(Probe))
          )
        )
      );
    });
    expect(found).toBe(room);

    tombstoned = true;
    await act(async () => {
      stateListeners.forEach((listener) => listener({ getType: () => 'm.room.tombstone' }));
    });

    expect(found).toBeUndefined();
    act(() => renderer.unmount());
  });
});
