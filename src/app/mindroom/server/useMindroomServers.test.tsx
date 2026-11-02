import React, { useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createClient, MatrixEvent, MemoryStore, Room, RoomStateEvent } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { MINDROOM_SERVER_EVENT, type MindroomServer } from './mindroomServer';
import {
  useBindsOpenIdTokens,
  useMindroomServerUrls,
  useRoomMindroomServers,
} from './useMindroomServers';

const native = vi.hoisted(() => ({ isNativePlatform: false }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.isNativePlatform },
}));

const viewer = '@alice:example.org';
const agent = '@mindroom_code:example.org';
let serial = 0;
let renderer: ReactTestRenderer | undefined;

const stateEvent = (type: string, stateKey: string, content: Record<string, unknown>) => {
  serial += 1;
  return new MatrixEvent({
    type,
    state_key: stateKey,
    sender: type === 'm.room.topic' ? viewer : stateKey,
    room_id: '!room:example.org',
    event_id: `$state${serial}`,
    origin_server_ts: serial,
    content,
  });
};

const serverEvent = (apiOrigin: string) =>
  stateEvent(MINDROOM_SERVER_EVENT, agent, { api_origin: apiOrigin, computer: true });
const membership = (value: string) => stateEvent('m.room.member', agent, { membership: value });

const makeRoom = (
  mx = createClient({ baseUrl: 'http://localhost:1', userId: viewer, timelineSupport: true })
) => new Room('!room:example.org', mx, viewer, { timelineSupport: true });

// Sync hands the sender's member event over again with each batch, as a new event object.
const redeliver = (room: Room, event: MatrixEvent) =>
  act(() => {
    room.currentState.setStateEvents([new MatrixEvent(event.event)]);
  });

const mount = (room: Room) => {
  const seen: MindroomServer[][] = [];
  function Probe() {
    seen.push(useRoomMindroomServers(room));
    return null;
  }
  act(() => {
    renderer = create(<Probe />);
  });
  return seen;
};

const addState = (room: Room, event: MatrixEvent) =>
  act(async () => {
    await room.addLiveEvents([event], { addToState: true });
  });

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => renderer?.unmount());
  renderer = undefined;
});

it('follows an agent that moves to another server and drops it once it leaves', async () => {
  const room = makeRoom();
  await room.addLiveEvents([membership('join'), serverEvent('http://localhost:8765')], {
    addToState: true,
  });
  const seen = mount(room);
  expect(seen.at(-1)?.map((server) => server.apiUrl)).toEqual(['http://localhost:8765']);

  await addState(room, serverEvent('https://mind.example.org'));
  expect(seen.at(-1)?.map((server) => server.apiUrl)).toEqual(['https://mind.example.org']);

  await addState(room, membership('leave'));
  expect(seen.at(-1)).toEqual([]);
});

it('does not render again for unrelated room state', async () => {
  const room = makeRoom();
  await room.addLiveEvents([membership('join'), serverEvent('http://localhost:8765')], {
    addToState: true,
  });
  const seen = mount(room);
  const renders = seen.length;

  await addState(room, stateEvent('m.room.topic', '', { topic: 'Release prep' }));

  expect(seen).toHaveLength(renders);
});

it('does not render again when sync re-delivers an agent membership that did not change', async () => {
  const room = makeRoom();
  const joined = membership('join');
  await room.addLiveEvents([joined, serverEvent('http://localhost:8765')], { addToState: true });
  const seen = mount(room);
  const renders = seen.length;

  redeliver(room, joined);
  redeliver(room, joined);
  expect(seen).toHaveLength(renders);

  await addState(room, membership('leave'));
  expect(seen.at(-1)).toEqual([]);
  await addState(room, membership('join'));
  expect(seen.at(-1)?.map((server) => server.apiUrl)).toEqual(['http://localhost:8765']);
});

it('shows a membership change that lands between a commit and its passive effects', async () => {
  const room = makeRoom();
  await room.addLiveEvents([membership('join'), serverEvent('http://localhost:8765')], {
    addToState: true,
  });
  const seen: MindroomServer[][] = [];
  let rejoined = false;
  function Probe() {
    const servers = useRoomMindroomServers(room);
    seen.push(servers);
    // Runs right after the commit that drops the server, before React runs passive effects.
    useLayoutEffect(() => {
      if (servers.length > 0 || rejoined) return;
      rejoined = true;
      room.currentState.setStateEvents([membership('join')]);
    }, [servers]);
    return null;
  }
  act(() => {
    renderer = create(<Probe />);
  });

  await addState(room, membership('leave'));

  expect(rejoined).toBe(true);
  expect(seen.at(-1)?.map((server) => server.apiUrl)).toEqual(['http://localhost:8765']);
});

// A client whose one joined room has an agent with a server, re-emitting room state as the SDK does.
const mountServerUrls = async () => {
  const mx = createClient({
    baseUrl: 'https://example.org',
    userId: viewer,
    store: new MemoryStore(),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            versions: ['v1.11'],
            unstable_features: { 'io.mindroom.openid_audience': true },
          }),
          { status: 200 }
        )
    )
  );
  const room = makeRoom(mx);
  const joined = membership('join');
  await room.addLiveEvents([joined, serverEvent('http://localhost:8765')], { addToState: true });
  room.updateMyMembership('join');
  mx.store.storeRoom(room);
  mx.reEmitter.reEmit(room, [RoomStateEvent.Events, RoomStateEvent.Members]);
  const seen: string[][] = [];
  function Probe() {
    seen.push(useMindroomServerUrls());
    return null;
  }
  await act(async () => {
    renderer = create(
      <MatrixClientProvider value={mx}>
        <Probe />
      </MatrixClientProvider>
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { mx, room, joined, seen };
};

// Member events are checked once after the task that delivered them.
const afterSyncBatch = () =>
  act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });

it('renders the servers of all rooms again only when an agent membership changes them', async () => {
  const { room, joined, seen } = await mountServerUrls();
  expect(seen.at(-1)).toEqual(['http://localhost:8765']);
  const renders = seen.length;

  redeliver(room, joined);
  redeliver(room, joined);
  await afterSyncBatch();
  expect(seen).toHaveLength(renders);

  await addState(room, membership('leave'));
  await afterSyncBatch();
  expect(seen.at(-1)).toEqual([]);
});

it('reads the servers of all rooms once for a sync batch of agent member events', async () => {
  const { mx, room, joined, seen } = await mountServerUrls();
  const renders = seen.length;
  const roomScans = vi.spyOn(mx, 'getRooms');

  // Initial and catch-up syncs deliver many member events at once.
  act(() => {
    for (let index = 0; index < 20; index += 1) {
      room.currentState.setStateEvents([new MatrixEvent(joined.event)]);
    }
  });
  await afterSyncBatch();
  expect(roomScans).toHaveBeenCalledTimes(1);
  expect(seen).toHaveLength(renders);

  act(() => {
    room.currentState.setStateEvents([membership('leave')]);
    room.currentState.setStateEvents([membership('join')]);
    room.currentState.setStateEvents([membership('leave')]);
  });
  await afterSyncBatch();
  expect(seen.at(-1)).toEqual([]);
});

it('asks the homeserver again after a check that could not reach it', async () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: viewer });
  const versions = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          versions: ['v1.11'],
          unstable_features: { 'io.mindroom.openid_audience': true },
        }),
        { status: 200 }
      )
    );
  vi.stubGlobal('fetch', versions);
  const mountBinding = async () => {
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useBindsOpenIdTokens());
      return null;
    }
    await act(async () => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <Probe />
        </MatrixClientProvider>
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => renderer?.unmount());
    renderer = undefined;
    return seen.at(-1);
  };
  expect(await mountBinding()).toBe(false);
  expect(await mountBinding()).toBe(true);
  expect(await mountBinding()).toBe(true);
  expect(versions).toHaveBeenCalledTimes(2);
});

it('ignores a published localhost server in the native apps, where it is the phone itself', async () => {
  const room = makeRoom();
  await room.addLiveEvents([membership('join'), serverEvent('http://localhost:8765')], {
    addToState: true,
  });
  native.isNativePlatform = true;
  const seen = mount(room);
  expect(seen.at(-1)).toEqual([]);
  native.isNativePlatform = false;
});
