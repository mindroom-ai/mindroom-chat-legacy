import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createClient, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createSessionId } from '../../state/sessions';
import { createEnginePersistFacade } from '../engine/enginePersistFacade';
import {
  persistRoomChunkWithPreferLive,
  persistThreadEventCacheSnapshotCommitted,
} from './eventRepository';
import {
  prefetchEventAttachments,
  hydrateCachedMindroomLongText,
  clearAttachmentRepositoryMemory,
} from '../messages/attachmentRepository';
import { getEventAttachmentOwner } from '../messages/eventAttachments';
import {
  getMindroomLongTextSource,
  clearMindroomLongTextHydrationCache,
} from '../messages/longText';
import {
  resetCacheStoreForTesting,
  saveRoomEventsToCacheCommitted,
  loadCachedThreadEvent,
  loadCachedAttachment,
  loadCachedRoomEvent,
  getCachedAttachmentMetadata,
} from './cacheStore';
import { resetCacheHealthForTesting } from './cacheHealth';

const roomId = '!canonical:test';
const userId = '@owner:test';
const raw = (id: string, ts: number, content: IEvent['content']): Partial<IEvent> => ({
  event_id: id,
  room_id: roomId,
  sender: userId,
  origin_server_ts: ts,
  type: 'm.room.message',
  content,
});
const body = (name: string) => ({
  msgtype: 'm.text',
  body: name + ' preview',
  url: 'mxc://test/' + name,
  'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
});
const client = () => {
  const mx = createClient({ baseUrl: 'https://matrix.test', userId });
  const room = new Room(roomId, mx, userId);
  mx.getRoom = (id) => (id === roomId ? room : null);
  return { mx, room, sessionId: createSessionId(mx.getHomeserverUrl(), userId) };
};
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  resetCacheHealthForTesting();
  clearAttachmentRepositoryMemory();
  clearMindroomLongTextHydrationCache();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'complete original' }))
    )
  );
});
afterEach(() => {
  resetCacheStoreForTesting();
  clearAttachmentRepositoryMemory();
  clearMindroomLongTextHydrationCache();
  vi.unstubAllGlobals();
});
it.each(['room', 'thread', 'grouped'] as const)(
  '%s facade retires attachments after a confirmed inline edit',
  async (scope) => {
    const ctx = client();
    const initial = raw('$image', 1, {
      msgtype: 'm.image',
      body: 'image',
      url: 'mxc://test/image',
      info: { size: 4 },
      ...(scope === 'grouped'
        ? { 'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' } }
        : {}),
    });
    const saved = await persistRoomChunkWithPreferLive({ ...ctx, chunk: [initial] });
    await prefetchEventAttachments(ctx.mx, saved!.events);
    const target = new MatrixEvent(initial);
    const inline = { msgtype: 'm.text', body: 'inline' };
    target.makeReplaced(
      new MatrixEvent(
        raw('$edit', 2, {
          'm.new_content': inline,
          'm.relates_to': { rel_type: 'm.replace', event_id: '$image' },
        })
      )
    );
    const facade = createEnginePersistFacade({ sessionId: ctx.sessionId });
    if (scope === 'room') facade.persistRoomEventCache(ctx.room, [target]);
    else if (scope === 'thread') facade.persistThreadEventCache(ctx.room, '$thread', [target]);
    else facade.persistThreadCacheFromRoomEvents(ctx.room, [target]);
    await vi.waitFor(async () =>
      expect(
        (
          await (scope === 'room'
            ? loadCachedRoomEvent(ctx.sessionId, roomId, '$image')
            : loadCachedThreadEvent(ctx.sessionId, roomId, '$thread', '$image'))
        )?.unsigned?.['m.relations']?.['m.replace']?.event_id
      ).toBe('$edit')
    );
    expect(await loadCachedAttachment(ctx.sessionId, 'mxc://test/image')).toBeUndefined();
  }
);
it('authoritative thread repair must allow original full-body ownership after edit redaction', async () => {
  const ctx = client();
  const original = raw('$reply', 1, {
    ...body('original'),
    'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
  });
  const edit = raw('$edit', 2, {
    'm.new_content': body('edited'),
    'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
  });
  const current = new MatrixEvent(original);
  current.makeReplaced(new MatrixEvent(edit));
  await persistThreadEventCacheSnapshotCommitted({ ...ctx, threadId: '$thread', events: [current] })
    .write;
  await prefetchEventAttachments(ctx.mx, [current]);
  const restored = new MatrixEvent(original);
  const redactedEdit = new MatrixEvent(edit);
  redactedEdit.makeRedacted(
    new MatrixEvent({ ...raw('$redaction', 3, {}), type: 'm.room.redaction', redacts: '$edit' }),
    ctx.room
  );
  const saved = persistThreadEventCacheSnapshotCommitted({
    ...ctx,
    threadId: '$thread',
    events: [restored, redactedEdit],
    relationSnapshotMode: 'authoritative',
    authoritativeRawEvents: [original, redactedEdit.event],
  });
  expect(await saved.write).toBe(true);
  const source = {
    ...getMindroomLongTextSource(restored.getContent())!,
    owner: getEventAttachmentOwner(restored),
  };
  expect(await hydrateCachedMindroomLongText(ctx.mx, source)).toMatchObject({
    body: 'complete original',
  });
  expect(
    (await getCachedAttachmentMetadata(ctx.sessionId, 'mxc://test/original'))?.references
  ).toEqual([expect.objectContaining({ eventId: '$reply', revisionId: '', status: 'cached' })]);
});

it('ignores attachment candidates older than the accepted stored event revision', async () => {
  const ctx = client();
  const original = raw('$owner', 1, body('stale'));
  const latest = raw('$latest', 3, {
    'm.new_content': body('latest'),
    'm.relates_to': { rel_type: 'm.replace', event_id: '$owner' },
  });
  await saveRoomEventsToCacheCommitted(ctx.sessionId, roomId, [
    {
      ...original,
      unsigned: { 'm.relations': { 'm.replace': latest } },
    },
  ]);
  const stale = new MatrixEvent(original);
  createEnginePersistFacade({ sessionId: ctx.sessionId }).persistRoomEventCache(ctx.room, [stale]);
  await prefetchEventAttachments(ctx.mx, [stale]);
  expect(await loadCachedAttachment(ctx.sessionId, 'mxc://test/stale')).toBeUndefined();
});

it('takes attachment content from the authoritative snapshot rather than older live content', async () => {
  const ctx = client();
  const original = raw('$reply', 1, {
    ...body('original'),
    'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
  });
  const edit = raw('$latest', 3, {
    'm.new_content': body('latest'),
    'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
  });
  const authoritative = { ...original, unsigned: { 'm.relations': { 'm.replace': edit } } };
  const stale = new MatrixEvent(original);
  const snapshot = persistThreadEventCacheSnapshotCommitted({
    ...ctx,
    threadId: '$thread',
    events: [stale],
    relationSnapshotMode: 'authoritative',
    authoritativeRawEvents: [authoritative],
  });
  expect(await snapshot.write).toBe(true);
  await prefetchEventAttachments(ctx.mx, [stale]);
  expect(await loadCachedAttachment(ctx.sessionId, 'mxc://test/original')).toBeUndefined();
  const current = new MatrixEvent(original);
  current.makeReplaced(new MatrixEvent(edit));
  await prefetchEventAttachments(ctx.mx, [current]);
  expect(
    (await getCachedAttachmentMetadata(ctx.sessionId, 'mxc://test/latest'))?.references
  ).toEqual([
    expect.objectContaining({ eventId: '$reply', revisionId: '$latest', status: 'cached' }),
  ]);
});

it('keeps newer attachment ownership when another scope first receives an older event', async () => {
  const ctx = client();
  const original = raw('$owner', 1, body('old-scope'));
  const current = new MatrixEvent(original);
  current.makeReplaced(
    new MatrixEvent(
      raw('$latest', 3, {
        'm.new_content': body('new-scope'),
        'm.relates_to': { rel_type: 'm.replace', event_id: '$owner' },
      })
    )
  );
  await persistThreadEventCacheSnapshotCommitted({ ...ctx, threadId: '$thread', events: [current] })
    .write;
  await prefetchEventAttachments(ctx.mx, [current]);
  const stale = new MatrixEvent(original);
  await persistRoomChunkWithPreferLive({ ...ctx, chunk: [original], mappedEvents: [stale] });
  await prefetchEventAttachments(ctx.mx, [stale]);
  expect(await loadCachedAttachment(ctx.sessionId, 'mxc://test/old-scope')).toBeUndefined();
  expect(
    (await getCachedAttachmentMetadata(ctx.sessionId, 'mxc://test/new-scope'))?.references
  ).toEqual([
    expect.objectContaining({ eventId: '$owner', revisionId: '$latest', status: 'cached' }),
  ]);
});

it('admits attachment ownership for a metadata-only thread root', async () => {
  const ctx = client();
  const root = new MatrixEvent(raw('$thread', 1, body('root')));
  expect(
    await persistThreadEventCacheSnapshotCommitted({
      ...ctx,
      threadId: '$thread',
      events: [],
      rootEvent: root,
    }).write
  ).toBe(true);
  await prefetchEventAttachments(ctx.mx, [root]);
  expect((await getCachedAttachmentMetadata(ctx.sessionId, 'mxc://test/root'))?.references).toEqual(
    [expect.objectContaining({ eventId: '$thread', status: 'cached' })]
  );
});
