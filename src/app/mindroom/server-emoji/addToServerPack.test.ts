import { MatrixError, MatrixEvent } from 'matrix-js-sdk';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ShortcodeTakenError } from '../../plugins/custom-emoji';
import type { PackContent, PackImage } from '../../plugins/custom-emoji';
import { addToServerPack, canAddServerEmoji } from './addToServerPack';

const EMOTES = 'im.ponies.room_emotes';
const image: PackImage = { url: 'mxc://example.org/new', info: { w: 32, h: 24 } };

const stateEvent = (type: string, stateKey: string, content: object, sender = '@op:example.org') =>
  new MatrixEvent({
    type,
    state_key: stateKey,
    content,
    sender,
    room_id: '!emoji',
    event_id: `$${type}${stateKey}`,
  });

/** A room whose synced state holds these events, as `getStateEvent(s)` reads them. */
const roomWith = (...events: MatrixEvent[]): Room =>
  ({
    roomId: '!emoji',
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (type: string, stateKey?: string) => {
          const ofType = events.filter((event) => event.getType() === type);
          if (stateKey === undefined) return ofType;
          return ofType.find((event) => event.getStateKey() === stateKey) ?? null;
        },
      }),
    }),
  } as unknown as Room);

/** The room's synced packs, one per state key. */
const roomWithPacks = (packs: Record<string, PackContent>): Room =>
  roomWith(...Object.entries(packs).map(([key, content]) => stateEvent(EMOTES, key, content)));

/** A client whose pack reads return what the server holds; a pack it lacks is a 404. */
const clientHolding = (serverPacks: Record<string, PackContent>) => {
  const mx = {
    getStateEvent: vi.fn(async (_roomId: string, _type: string, stateKey: string) => {
      if (!(stateKey in serverPacks)) {
        throw new MatrixError({ errcode: 'M_NOT_FOUND', error: 'Not found' }, 404);
      }
      return serverPacks[stateKey];
    }),
    sendStateEvent: vi.fn(
      async (_roomId: string, _type: string, _content: PackContent, _stateKey: string) => ({
        event_id: '$sent',
      })
    ),
    getSafeUserId: vi.fn(() => '@alice:example.org'),
  };
  return { mx, client: mx as unknown as MatrixClient };
};

/** A pack past the 30,000-byte budget: 500 images with long URLs. */
const fullPack = (pack: PackContent['pack']): PackContent => ({
  pack,
  images: Object.fromEntries(
    Array.from({ length: 500 }, (_, i) => [
      `e${i}`,
      { url: `mxc://example.org/${'x'.repeat(100)}${i}` },
    ])
  ),
});

describe('addToServerPack', () => {
  it('adds the emoji to the first pack as the server has it', async () => {
    const { mx, client } = clientHolding({
      '': { pack: { display_name: 'MindRoom' }, images: { a: { url: 'mxc://x/a' } } },
    });
    // The synced copy lags behind the server's.
    const room = roomWithPacks({ '': { pack: { display_name: 'MindRoom' }, images: {} } });

    await addToServerPack(client, room, 'party-parrot', image);

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      '!emoji',
      EMOTES,
      {
        pack: { display_name: 'MindRoom' },
        images: { a: { url: 'mxc://x/a' }, 'party-parrot': image },
      },
      ''
    );
  });

  it('starts the first pack when the room has none yet', async () => {
    const { mx, client } = clientHolding({});

    await addToServerPack(client, roomWith(), 'party-parrot', image);

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    const [roomId, type, content, stateKey] = mx.sendStateEvent.mock.calls[0];
    expect([roomId, type, stateKey]).toEqual(['!emoji', EMOTES, '']);
    expect(content.images?.['party-parrot'].url).toBe('mxc://example.org/new');
  });

  it('refuses a shortcode another pack has, before reading or writing', async () => {
    const first = { images: {} };
    const second = { images: { 'party-parrot': { url: 'mxc://x/old' } } };
    const { mx, client } = clientHolding({ '': first, '2': second });

    await expect(
      addToServerPack(client, roomWithPacks({ '': first, '2': second }), 'party-parrot', image)
    ).rejects.toBeInstanceOf(ShortcodeTakenError);

    expect(mx.getStateEvent).not.toHaveBeenCalled();
    expect(mx.sendStateEvent).not.toHaveBeenCalled();
  });

  it('refuses a shortcode the pack got on the server since the last sync', async () => {
    const { mx, client } = clientHolding({
      '': { images: { 'party-parrot': { url: 'mxc://x/old' } } },
    });

    await expect(
      addToServerPack(client, roomWithPacks({ '': { images: {} } }), 'party-parrot', image)
    ).rejects.toBeInstanceOf(ShortcodeTakenError);

    expect(mx.sendStateEvent).not.toHaveBeenCalled();
  });

  it("opens a new pack with the first pack's metadata when the packs are full", async () => {
    const meta = { display_name: 'MindRoom', usage: ['emoticon' as const] };
    const first = fullPack(meta);
    const { mx, client } = clientHolding({ '': first });

    await addToServerPack(client, roomWithPacks({ '': first }), 'party-parrot', image);

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      '!emoji',
      EMOTES,
      { pack: meta, images: { 'party-parrot': image } },
      '2'
    );
  });

  it('opens the next free pack when the existing ones are full', async () => {
    const first = fullPack({ display_name: 'MindRoom' });
    const second = fullPack({ display_name: 'Second' });
    const { mx, client } = clientHolding({ '': first, '2': second });

    await addToServerPack(client, roomWithPacks({ '': first, '2': second }), 'party-parrot', image);

    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      '!emoji',
      EMOTES,
      { pack: { display_name: 'MindRoom' }, images: { 'party-parrot': image } },
      '3'
    );
  });

  it('adds to an overflow pack another device opened that has not synced here yet', async () => {
    // Pack '2' exists on the server, but this client's synced state only knows the full '' pack.
    const meta = { display_name: 'MindRoom' };
    const first = fullPack(meta);
    const earlier = { pack: meta, images: { earlier: { url: 'mxc://example.org/earlier' } } };
    const { mx, client } = clientHolding({ '': first, '2': earlier });

    await addToServerPack(client, roomWithPacks({ '': first }), 'later', image);

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      '!emoji',
      EMOTES,
      { pack: meta, images: { earlier: { url: 'mxc://example.org/earlier' }, later: image } },
      '2'
    );
  });

  it('skips an unsynced overflow pack that is full too', async () => {
    const first = fullPack({ display_name: 'MindRoom' });
    const second = fullPack({ display_name: 'MindRoom' });
    const { mx, client } = clientHolding({ '': first, '2': second });

    await addToServerPack(client, roomWithPacks({ '': first }), 'later', image);

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(mx.sendStateEvent.mock.calls[0][3]).toBe('3');
  });

  it('moves on to the next pack that has room', async () => {
    const first = fullPack({ display_name: 'MindRoom' });
    const second = { pack: { display_name: 'Second' }, images: { a: { url: 'mxc://x/a' } } };
    const { mx, client } = clientHolding({ '': first, '2': second });

    await addToServerPack(client, roomWithPacks({ '': first, '2': second }), 'party-parrot', image);

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      '!emoji',
      EMOTES,
      {
        pack: { display_name: 'Second' },
        images: { a: { url: 'mxc://x/a' }, 'party-parrot': image },
      },
      '2'
    );
  });

  it('fills a pack up to the 30,000-byte budget and no further', async () => {
    const bytesWithEmoji = (name: string) =>
      JSON.stringify({ pack: { display_name: name }, images: { 'party-parrot': image } }).length;
    const padding = 30_000 - bytesWithEmoji('');
    const writeKeyFor = async (nameLength: number) => {
      const pack = { pack: { display_name: 'x'.repeat(nameLength) }, images: {} };
      const { mx, client } = clientHolding({ '': pack });
      await addToServerPack(client, roomWithPacks({ '': pack }), 'party-parrot', image);
      return mx.sendStateEvent.mock.calls[0][3];
    };

    await expect(writeKeyFor(padding)).resolves.toBe('');
    await expect(writeKeyFor(padding + 1)).resolves.toBe('2');
  });

  it('refuses a name another device added to a different pack since the last sync', async () => {
    // Synced state shows no party-parrot anywhere, but the server's pack '2' already has one.
    const meta = { display_name: 'MindRoom' };
    const second = { pack: meta, images: { other: { url: 'mxc://example.org/other' } } };
    const { mx, client } = clientHolding({
      '': { pack: meta, images: {} },
      '2': { pack: meta, images: { ...second.images, 'party-parrot': { url: 'mxc://x/theirs' } } },
    });

    await expect(
      addToServerPack(
        client,
        roomWithPacks({ '': { pack: meta, images: {} }, '2': second }),
        'party-parrot',
        image
      )
    ).rejects.toBeInstanceOf(ShortcodeTakenError);
    expect(mx.sendStateEvent).not.toHaveBeenCalled();
  });

  it('refuses a name in a pack another device restored since the last sync', async () => {
    // Synced state still shows pack '2' deleted, but the server has it back with party-parrot in it.
    const meta = { display_name: 'MindRoom' };
    const { mx, client } = clientHolding({
      '': { pack: meta, images: {} },
      '2': { pack: meta, images: { 'party-parrot': { url: 'mxc://x/theirs' } } },
    });

    await expect(
      addToServerPack(
        client,
        roomWithPacks({ '': { pack: meta, images: {} }, '2': {} }),
        'party-parrot',
        image
      )
    ).rejects.toBeInstanceOf(ShortcodeTakenError);
    expect(mx.sendStateEvent).not.toHaveBeenCalled();
  });

  it('reads the first pack before starting it, so a pack another device created is kept', async () => {
    // Synced state knows only a deleted pack '2'; meanwhile another device created '' with an emoji.
    const meta = { display_name: 'MindRoom' };
    const earlier = { url: 'mxc://example.org/earlier' };
    const { mx, client } = clientHolding({ '': { pack: meta, images: { earlier } }, '2': {} });

    await addToServerPack(client, roomWithPacks({ '2': {} }), 'later', image);

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      '!emoji',
      EMOTES,
      { pack: meta, images: { earlier, later: image } },
      ''
    );
  });

  it('never writes to a deleted pack', async () => {
    const second = { pack: { display_name: 'Second' }, images: {} };
    // A deleted pack is an event with neither `pack` nor `images`.
    const { mx, client } = clientHolding({ '': {}, '2': second });

    await addToServerPack(client, roomWithPacks({ '': {}, '2': second }), 'party-parrot', image);

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      '!emoji',
      EMOTES,
      { pack: { display_name: 'Second' }, images: { 'party-parrot': image } },
      '2'
    );
  });

  it('rethrows errors other than a missing pack', async () => {
    const { mx, client } = clientHolding({});
    mx.getStateEvent.mockRejectedValue(
      new MatrixError({ errcode: 'M_FORBIDDEN', error: 'No access' }, 403)
    );
    const room = roomWithPacks({ '': { images: {} } });

    await expect(addToServerPack(client, room, 'party-parrot', image)).rejects.toMatchObject({
      errcode: 'M_FORBIDDEN',
    });

    expect(mx.sendStateEvent).not.toHaveBeenCalled();
  });
});

describe('canAddServerEmoji', () => {
  // Another user created the room, in a version without creator power,
  // so only the power levels decide.
  const createdByOperator = () => stateEvent('m.room.create', '', { room_version: '10' });
  const powerLevels = (level: number) =>
    stateEvent('m.room.power_levels', '', { users_default: 0, events: { [EMOTES]: level } });
  const alice = (room: Room) =>
    canAddServerEmoji(
      { getSafeUserId: () => '@alice:example.org' } as unknown as MatrixClient,
      room
    );

  it('is true when the pack event needs power level 0', () => {
    expect(alice(roomWith(createdByOperator(), powerLevels(0)))).toBe(true);
  });

  it('is false when the pack event needs power level 50', () => {
    expect(alice(roomWith(createdByOperator(), powerLevels(50)))).toBe(false);
  });

  it('is true for a creator of a room version with creator power', () => {
    const createdByAlice = stateEvent(
      'm.room.create',
      '',
      { room_version: '12' },
      '@alice:example.org'
    );
    expect(alice(roomWith(createdByAlice, powerLevels(50)))).toBe(true);
  });

  it('is false without the create event', () => {
    expect(alice(roomWith(powerLevels(0)))).toBe(false);
  });
});
