import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createClient, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionId } from '../../state/sessions';
import { createMindroomSyncEngine } from '../engine/mindroomSyncEngine';
import { createEngineWriteThrough } from '../engine/engineWriteThrough';
import {
  clearAttachmentRepositoryMemory,
  prefetchEventAttachments,
} from '../messages/attachmentRepository';
import { resetCacheHealthForTesting } from './cacheHealth';
import {
  clearRoomCachedContent,
  loadCachedAttachment,
  loadCachedRoomEvent,
  resetCacheStoreForTesting,
} from './cacheStore';
import { readRoomOfflineProgress } from './cacheStore/cacheStoreMeta';
import { persistRoomChunkWithPreferLive } from './eventRepository';

const roomId = '!encrypted-replay:test';
const userId = '@alice:test';
const bodyUri = 'mxc://test/encrypted-edit-body';
const body = {
  msgtype: 'm.text',
  body: 'preview',
  url: bodyUri,
  'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
};
const relation = { rel_type: 'm.replace', event_id: '$root' };
const wire = (id: string, ts: number): Partial<IEvent> => ({
  event_id: id,
  room_id: roomId,
  sender: userId,
  origin_server_ts: ts,
  type: 'm.room.encrypted',
  content: { ciphertext: id, ...(id === '$edit' ? { 'm.relates_to': relation } : {}) },
});
const clear = (event: MatrixEvent) =>
  event.setClearData({
    clearEvent: {
      type: 'm.room.message',
      content:
        event.getId() === '$root'
          ? { msgtype: 'm.text', body: 'original' }
          : { ...body, 'm.new_content': body, 'm.relates_to': relation },
    },
  });
const account = () => {
  const mx = createClient({ baseUrl: 'https://matrix.test', userId });
  const room = new Room(roomId, mx, userId);
  mx.getRoom = (id) => (id === roomId ? room : null);
  mx.decryptEventIfNeeded = vi.fn(async (event) => {
    clear(event);
  });
  const sessionId = createSessionId(mx.getHomeserverUrl(), userId);
  return { mx, room, sessionId };
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  resetCacheHealthForTesting();
  clearAttachmentRepositoryMemory();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'full saved body' })))
  );
});
afterEach(() => {
  resetCacheStoreForTesting();
  clearAttachmentRepositoryMemory();
  vi.unstubAllGlobals();
});

const seed = async () => {
  const client = account();
  const saved = await persistRoomChunkWithPreferLive({
    ...client,
    chunk: [wire('$root', 1), wire('$edit', 2)],
  });
  await prefetchEventAttachments(client.mx, saved!.events);
  expect(await loadCachedAttachment(client.sessionId, bodyUri)).toBeDefined();
  const retained = (await loadCachedRoomEvent(client.sessionId, roomId, '$root'))!;
  resetCacheStoreForTesting();
  clearAttachmentRepositoryMemory();
  return retained;
};

it.each(['available', 'missing', 'failed'])(
  'preserves compacted encrypted attachment across cold replay (edit key: %s)',
  async (keyState) => {
    const missingKey = keyState !== 'available';
    const retained = await seed();
    const client = account();
    client.mx.decryptEventIfNeeded = vi.fn(async (event) => {
      if (event.getId() !== '$edit' || !missingKey) clear(event);
      else if (keyState === 'failed')
        await event.attemptDecryption({
          decryptEvent: async () => {
            throw new Error('Missing replacement key');
          },
        } as never);
    });
    const replay = await persistRoomChunkWithPreferLive({ ...client, chunk: [retained] });
    expect(await loadCachedAttachment(client.sessionId, bodyUri)).toBeDefined();
    const progress = await readRoomOfflineProgress(client.sessionId, roomId);
    expect(progress.undecryptedEventIds).toEqual(missingKey ? ['$root'] : []);
    if (missingKey) {
      // A later activation retries the retained owner, because the edit is compacted into it.
      client.mx.decryptEventIfNeeded = vi.fn(async (event) => {
        clear(event);
      });
      const raw = (await loadCachedRoomEvent(client.sessionId, roomId, '$root'))!;
      const repaired = await persistRoomChunkWithPreferLive({ ...client, chunk: [raw] });
      expect(repaired!.events.find((event) => event.getId() === '$root')?.getContent()).toEqual(
        body
      );
      expect((await readRoomOfflineProgress(client.sessionId, roomId)).undecryptedEventIds).toEqual(
        []
      );
    } else {
      expect(replay!.events.find((event) => event.getId() === '$root')?.getContent()).toEqual(body);
    }
    const stored = (await loadCachedRoomEvent(client.sessionId, roomId, '$root'))!;
    expect(stored.type).toBe('m.room.encrypted');
    expect(stored.content).toEqual({ ciphertext: '$root' });
    expect(stored.unsigned?.['m.relations']?.['m.replace']).toMatchObject({
      type: 'm.room.encrypted',
      content: { ciphertext: '$edit' },
    });
    expect(JSON.stringify(stored)).not.toContain('preview');
  }
);

it('rejects encrypted replay that finishes after room clear', async () => {
  const retained = await seed();
  const client = account();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  client.mx.decryptEventIfNeeded = vi.fn(async (event) => {
    if (event.getId() === '$edit') await pending;
    clear(event);
  });
  const replay = persistRoomChunkWithPreferLive({ ...client, chunk: [retained] });
  const rejected = expect(replay).rejects.toThrow('revoked');
  await vi.waitFor(() =>
    expect(client.mx.decryptEventIfNeeded).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ event_id: '$edit' }) })
    )
  );
  await clearRoomCachedContent(client.sessionId, roomId);
  release();
  await rejected;
  expect(await loadCachedRoomEvent(client.sessionId, roomId, '$root')).toBeUndefined();
  expect(await loadCachedAttachment(client.sessionId, bodyUri)).toBeUndefined();
});

it('does not write an encrypted event twice when repository decryption emits through the SDK', async () => {
  const client = account();
  const duplicateWrites: Promise<unknown>[] = [];
  const engine = createMindroomSyncEngine({
    mx: client.mx,
    writeThrough: createEngineWriteThrough({
      sessionId: client.sessionId,
      persist: (room, events) => {
        duplicateWrites.push(
          persistRoomChunkWithPreferLive({
            ...client,
            room,
            chunk: events.map((event) => event.event),
            mappedEvents: events,
          })
        );
      },
    }),
    gapTracker: { stop: () => undefined } as never,
    connection: {
      getSnapshot: () => ({ connected: true, unmetered: true }),
      subscribe: () => () => undefined,
    },
  });
  client.mx.decryptEventIfNeeded = (event) =>
    event.attemptDecryption({
      decryptEvent: async () => ({
        clearEvent: { type: 'm.room.message', content: { msgtype: 'm.text', body: 'decoded' } },
      }),
    } as never);
  const puts = vi.spyOn(IDBObjectStore.prototype, 'put');
  engine.start();
  try {
    await persistRoomChunkWithPreferLive({ ...client, chunk: [wire('$root', 1)] });
    await Promise.all(duplicateWrites);
    expect(puts.mock.calls.filter(([value]) => value.eventId === '$root')).toHaveLength(1);
    expect(await loadCachedRoomEvent(client.sessionId, roomId, '$root')).toBeDefined();
  } finally {
    engine.stop();
    puts.mockRestore();
  }
});
