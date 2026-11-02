import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createClient, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionId } from '../../state/sessions';
import {
  clearAttachmentRepositoryMemory,
  hydrateCachedMindroomLongText,
  prefetchEventAttachments,
} from '../messages/attachmentRepository';
import { getEventAttachmentOwner } from '../messages/eventAttachments';
import {
  clearMindroomLongTextHydrationCache,
  getMindroomLongTextSource,
} from '../messages/longText';
import { resetCacheHealthForTesting } from './cacheHealth';
import {
  getCachedAttachmentMetadata,
  loadCachedAttachment,
  loadCachedRoomEvent,
  resetCacheStoreForTesting,
} from './cacheStore';
import { persistRoomChunkWithPreferLive } from './eventRepository';
import { hydrateCachedEvents } from './eventCacheEditUtils';

const roomId = '!retraction:example.org';
const userId = '@alice:example.org';
const account = () => {
  const mx = createClient({ baseUrl: 'https://matrix.example.org', userId });
  const room = new Room(roomId, mx, userId);
  mx.getRoom = (id) => (id === roomId ? room : null);
  return { mx, room };
};
const raw = (eventId: string, ts: number, content: IEvent['content']): Partial<IEvent> => ({
  event_id: eventId,
  room_id: roomId,
  sender: userId,
  type: 'm.room.message',
  origin_server_ts: ts,
  content,
});
const edit = (eventId: string, ts: number, name: string) => {
  const content = {
    msgtype: 'm.text',
    body: `${name} preview`,
    url: `mxc://test/${name}`,
    'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
  };
  return raw(eventId, ts, {
    ...content,
    'm.new_content': content,
    'm.relates_to': { rel_type: 'm.replace', event_id: '$root' },
  });
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  resetCacheHealthForTesting();
  clearAttachmentRepositoryMemory();
  clearMindroomLongTextHydrationCache();
});
afterEach(() => {
  resetCacheStoreForTesting();
  clearAttachmentRepositoryMemory();
  clearMindroomLongTextHydrationCache();
  vi.unstubAllGlobals();
});

it('restores a server-supplied surviving edit after latest-edit retraction and cache restart', async () => {
  let client = account();
  const sessionId = createSessionId(client.mx.getHomeserverUrl(), userId);
  const root = raw('$root', 1, { msgtype: 'm.text', body: 'original inline body' });
  const earlier = edit('$earlier', 2, 'earlier');
  const latest = edit('$latest', 3, 'latest');
  const persist = (chunk: Partial<IEvent>[]) =>
    persistRoomChunkWithPreferLive({ ...client, sessionId, chunk: structuredClone(chunk) });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify({
            msgtype: 'm.text',
            body: `complete ${new URL(url).pathname.split('/').pop()}`,
          })
        )
    )
  );
  for (const chunk of [[root, earlier], [latest]]) {
    const saved = await persist(chunk);
    await prefetchEventAttachments(client.mx, saved!.events);
  }
  expect(await loadCachedAttachment(sessionId, 'mxc://test/latest')).toBeDefined();
  expect(await loadCachedAttachment(sessionId, 'mxc://test/earlier')).toBeUndefined();
  resetCacheStoreForTesting();
  clearAttachmentRepositoryMemory();
  clearMindroomLongTextHydrationCache();
  client = account();

  // Server history supplies the previous edit, which compaction no longer retains.
  const repaired = await persist([
    { ...raw('$retract-latest', 4, {}), type: 'm.room.redaction', redacts: '$latest' },
    earlier,
  ]);
  const survivor = repaired!.events.find((event) => event.getId() === '$root')!;
  expect(survivor.replacingEvent()?.getId()).toBe('$earlier');
  await prefetchEventAttachments(client.mx, repaired!.events);
  expect((await getCachedAttachmentMetadata(sessionId, 'mxc://test/earlier'))?.references).toEqual([
    expect.objectContaining({
      eventId: '$root',
      revisionId: '$earlier',
      status: 'cached',
    }),
  ]);
  expect(await loadCachedAttachment(sessionId, 'mxc://test/latest')).toBeUndefined();

  const stale = await persist([latest]);
  await prefetchEventAttachments(client.mx, stale!.events);
  expect(await loadCachedAttachment(sessionId, 'mxc://test/latest')).toBeUndefined();
  expect(
    (await loadCachedRoomEvent(sessionId, roomId, '$root'))?.unsigned?.['m.relations']?.[
      'm.replace'
    ]?.event_id
  ).toBe('$earlier');

  resetCacheStoreForTesting();
  clearAttachmentRepositoryMemory();
  clearMindroomLongTextHydrationCache();
  const offlineFetch = vi.fn().mockRejectedValue(new TypeError('offline'));
  vi.stubGlobal('fetch', offlineFetch);
  const reopened = account();
  const cachedRoot = await loadCachedRoomEvent(sessionId, roomId, '$root');
  const cold = new MatrixEvent(cachedRoot!);
  hydrateCachedEvents({ room: reopened.room, events: [cold] });
  expect(
    await hydrateCachedMindroomLongText(reopened.mx, {
      ...getMindroomLongTextSource(cold.getContent())!,
      owner: getEventAttachmentOwner(cold),
    })
  ).toMatchObject({ body: 'complete earlier' });
  expect(offlineFetch).not.toHaveBeenCalled();
});
