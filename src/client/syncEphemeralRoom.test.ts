import { ClientEvent, createClient, MemoryStore, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ROOM_ID = '!room:example';
const USER_ID = '@alice:example';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const initialRoom = {
  join: {
    [ROOM_ID]: {
      state: {
        events: [
          {
            event_id: '$member',
            sender: USER_ID,
            origin_server_ts: 1,
            type: 'm.room.member',
            state_key: USER_ID,
            content: { membership: 'join' },
          },
        ],
      },
      timeline: { events: [], limited: false },
    },
  },
};

const liveFrame = {
  type: 'io.mindroom.live',
  sender: '@agent:example',
  origin_server_ts: 2,
  content: { v: 1, reply: '$reply' },
};

describe('Matrix sync ephemeral events', () => {
  const clients: MatrixClient[] = [];

  afterEach(() => {
    clients.splice(0).forEach((client) => client.stopClient());
  });

  it('gives a custom ephemeral event the room of the sync section it arrived in', async () => {
    const responses: Record<string, unknown> = {
      'initial-request': { next_batch: 'initial', rooms: initialRoom },
      initial: {
        next_batch: 'after-frame',
        rooms: { join: { [ROOM_ID]: { ephemeral: { events: [liveFrame] } } } },
      },
    };
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/versions')) return json({ versions: ['v1.11'] });
      if (url.pathname.includes('/pushrules')) return json({ global: {} });
      if (url.pathname.endsWith('/filter')) return json({ filter_id: 'filter' });
      if (!url.pathname.endsWith('/sync')) return json({});
      const response = responses[url.searchParams.get('since') ?? 'initial-request'];
      if (response) return json(response);
      return new Promise<Response>(() => {
        // Long poll with nothing new.
      });
    });
    const client = createClient({
      baseUrl: 'https://matrix.example',
      userId: USER_ID,
      deviceId: 'DEVICE',
      accessToken: 'token',
      store: new MemoryStore(),
      fetchFn,
    });
    clients.push(client);
    const received = new Promise<{ roomId?: string; sender?: string | null }>((resolve) => {
      client.on(ClientEvent.Event, (event) => {
        if (event.getType() === 'io.mindroom.live') {
          resolve({ roomId: event.getRoomId(), sender: event.getSender() });
        }
      });
    });

    await client.startClient({ initialSyncLimit: 10 });

    await expect(received).resolves.toEqual({ roomId: ROOM_ID, sender: '@agent:example' });
  });
});
