import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createClient, EventStatus, MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createLegacyMediaClient,
  saveAttachmentOwner,
  persistAttachmentEvents,
} from '../threads/__tests__/attachmentFixtures';
import { createSessionId } from '../../state/sessions';
import {
  clearRoomCachedContent,
  resetCacheStoreForTesting,
  readRoomAttachmentStorage,
  loadCachedAttachment,
  getCachedAttachmentMetadata,
} from '../threads/cacheStore';
import {
  hydrateCachedMindroomLongText,
  clearAttachmentRepositoryMemory,
  prefetchEventAttachments,
} from './attachmentRepository';
import {
  clearMindroomLongTextHydrationCache,
  getCachedMindroomLongTextContent,
  getMindroomLongTextSource,
} from './longText';
import { getEventAttachmentOwner } from './eventAttachments';
import { clearMindroomInMemoryCaches } from '../cache/sessionCleanup';

const baseUrl = 'https://matrix.example.org';
const roomId = '!test:matrix.example.org';
const userId = '@alice:matrix.example.org';
const sessionId = createSessionId(baseUrl, userId);
const source = {
  mxcUri: 'mxc://matrix.example.org/body',
  isV2ContentJson: true,
  previewContent: { msgtype: 'm.text', body: 'preview' },
  owner: { roomId, eventId: '$body', revisionTs: 1 },
};
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  clearAttachmentRepositoryMemory();
  clearMindroomLongTextHydrationCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each(['room-clear', 'logout', 'unowned-logout'] as const)(
  'fences parsed-memory publication after %s',
  async (kind) => {
    const mx = createLegacyMediaClient({ baseUrl, userId });
    let finish!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          })
      )
    );
    const pending = hydrateCachedMindroomLongText(
      mx,
      kind === 'unowned-logout' ? { ...source, owner: undefined } : source
    );
    await vi.waitFor(() => expect(finish).toBeDefined());
    if (kind === 'room-clear') await clearRoomCachedContent(sessionId, roomId);
    else clearMindroomInMemoryCaches();
    finish(new Response(JSON.stringify({ msgtype: 'm.text', body: 'late body' })));
    expect(await pending).toEqual(source.previewContent);
    expect(await loadCachedAttachment(sessionId, source.mxcUri)).toBeUndefined();
    expect(getCachedMindroomLongTextContent(source, mx)).toBeUndefined();
  }
);
it('does not store or read attachment reference rows for ordinary text batches', async () => {
  const mx = createLegacyMediaClient({ baseUrl, userId });
  let rowsRead = 0;
  let roomReads = 0;
  let referenceReads = 0;
  const original = IDBIndex.prototype.getAll;
  vi.spyOn(IDBIndex.prototype, 'getAll').mockImplementation(function countReferenceReads(
    query,
    count
  ) {
    const request = original.call(this, query, count);
    if (this.objectStore.name === 'attachment_references') {
      referenceReads += 1;
      if (query === roomId || query === undefined) roomReads += 1;
      request.addEventListener('success', () => {
        rowsRead += request.result.length;
      });
    }
    return request;
  });
  const events = Array.from(
    { length: 300 },
    (_, i) =>
      new MatrixEvent({
        room_id: roomId,
        event_id: `$plain${i}`,
        sender: userId,
        origin_server_ts: i + 1,
        type: 'm.room.message',
        content: { msgtype: 'm.text', body: 'ordinary text' },
      })
  );
  await prefetchEventAttachments(mx, events);

  expect(roomReads).toBe(0);
  expect(rowsRead).toBe(0);
  await prefetchEventAttachments(mx, events);
  expect(roomReads).toBe(0);
  expect(rowsRead).toBe(0);
  expect(referenceReads).toBe(0);
});

it('accepts the server revision after hydrating a pending SDK edit with a later local timestamp', async () => {
  const mx = createLegacyMediaClient({ baseUrl, userId });
  const room = new Room(roomId, mx, userId);
  mx.store.storeRoom(room);
  const root = new MatrixEvent({
    event_id: '$root',
    room_id: roomId,
    sender: userId,
    type: 'm.room.message',
    origin_server_ts: 1,
    content: { msgtype: 'm.text', body: 'original' },
  });
  await room.addLiveEvents([root], { addToState: false });
  const edit = new MatrixEvent({
    event_id: '~local-edit',
    room_id: roomId,
    sender: userId,
    type: 'm.room.message',
    origin_server_ts: 100,
    content: {
      'm.relates_to': { rel_type: 'm.replace', event_id: '$root' },
      'm.new_content': {
        msgtype: 'm.text',
        body: 'preview',
        url: source.mxcUri,
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      },
    },
  });
  edit.setStatus(EventStatus.SENDING);
  edit.setTxnId('edit-transaction');
  room.addPendingEvent(edit, 'edit-transaction');
  await vi.waitFor(() => expect(root.replacingEvent()).toBe(edit));
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'complete edited body' }))
    )
  );
  const hydrateRoot = () =>
    hydrateCachedMindroomLongText(mx, {
      ...getMindroomLongTextSource(root.getContent())!,
      owner: getEventAttachmentOwner(root),
    });
  expect(await hydrateRoot()).toMatchObject({ body: 'complete edited body' });
  room.updatePendingEvent(edit, EventStatus.SENT, '$server-edit');
  room.handleRemoteEcho(
    new MatrixEvent({
      ...edit.event,
      event_id: '$server-edit',
      origin_server_ts: 2,
      unsigned: { transaction_id: 'edit-transaction' },
    }),
    edit
  );
  await persistAttachmentEvents(mx, [root]);
  await prefetchEventAttachments(mx, [root]);
  expect(await hydrateRoot()).toMatchObject({ body: 'complete edited body' });
  expect((await getCachedAttachmentMetadata(sessionId, source.mxcUri))?.references).toEqual([
    expect.objectContaining({
      eventId: '$root',
      revisionId: '$server-edit',
      revisionTs: 2,
      status: 'cached',
    }),
  ]);
});

it('preserves saved ownership when a standalone SDK edit fails decryption, then accepts its retry', async () => {
  const mx = createLegacyMediaClient({ baseUrl, userId });
  const content = {
    msgtype: 'm.text',
    body: 'preview',
    url: source.mxcUri,
    'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
  };
  const root = new MatrixEvent({
    event_id: '$body',
    room_id: roomId,
    sender: userId,
    type: 'm.room.message',
    origin_server_ts: 1,
    content,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'saved body' })))
  );
  await persistAttachmentEvents(mx, [root]);
  await prefetchEventAttachments(mx, [root]);
  const relation = { rel_type: 'm.replace', event_id: '$body' };
  const edit = new MatrixEvent({
    event_id: '$encrypted-edit',
    room_id: roomId,
    sender: userId,
    type: 'm.room.encrypted',
    origin_server_ts: 2,
    content: { ciphertext: 'unreadable', 'm.relates_to': relation },
  });
  await edit.attemptDecryption({
    decryptEvent: async () => {
      throw new Error('missing key');
    },
  } as never);
  expect(edit.isDecryptionFailure()).toBe(true);
  expect(edit.getType()).toBe('m.room.message');
  root.makeReplaced(edit);
  await persistAttachmentEvents(mx, [root, edit]);
  await prefetchEventAttachments(mx, [root, edit]);
  expect(await loadCachedAttachment(sessionId, source.mxcUri)).toBeDefined();
  expect((await getCachedAttachmentMetadata(sessionId, source.mxcUri))?.references).toEqual([
    expect.objectContaining({ eventId: '$body', revisionTs: 1, revisionId: '', status: 'cached' }),
  ]);
  await edit.attemptDecryption({
    decryptEvent: async () => ({
      clearEvent: {
        type: 'm.room.message',
        content: { 'm.relates_to': relation, 'm.new_content': content },
      },
    }),
  } as never);
  await persistAttachmentEvents(mx, [root, edit]);
  await prefetchEventAttachments(mx, [root, edit]);
  expect(await readRoomAttachmentStorage(sessionId, roomId)).toMatchObject({
    saved: 1,
    missing: 0,
  });
  expect((await getCachedAttachmentMetadata(sessionId, source.mxcUri))?.references).toEqual([
    expect.objectContaining({
      eventId: '$body',
      revisionTs: 2,
      revisionId: '$encrypted-edit',
      status: 'cached',
    }),
  ]);
});

it('retries failed capability lookup on a later explicit download', async () => {
  const { createRoomOfflineController } = await import('../engine/roomOffline');
  const { createBackfillScheduler } = await import('../engine/backfillScheduler');
  const { saveRoomEventsToCacheCommitted } = await import('../threads/cacheStore');
  const mx = createClient({ baseUrl, userId, accessToken: 'test-token' });
  const room = {
    roomId,
    findEventById: () => undefined,
    getThread: () => undefined,
    getLiveTimeline: () => ({ getEvents: () => [], getPaginationToken: () => null }),
    getLastActiveTimestamp: () => 0,
  };
  vi.spyOn(mx, 'getRoom').mockReturnValue(room as never);
  vi.spyOn(mx, 'getEventMapper').mockReturnValue(((raw: object) => new MatrixEvent(raw)) as never);
  vi.spyOn(mx, 'decryptEventIfNeeded').mockResolvedValue(undefined);
  vi.spyOn(mx, 'createMessagesRequest').mockResolvedValue({ chunk: [] } as never);
  const versions = vi
    .spyOn(mx, 'getVersions')
    .mockRejectedValueOnce(new TypeError('transient'))
    .mockResolvedValue({ versions: ['v1.11'] });
  const fetched: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url);
      return url.includes('/_matrix/client/v1/media/')
        ? new Response(JSON.stringify({ msgtype: 'm.text', body: 'restored body' }))
        : new Response('', { status: 403 });
    })
  );
  await saveRoomEventsToCacheCommitted(sessionId, roomId, [
    {
      event_id: '$body',
      room_id: roomId,
      sender: userId,
      origin_server_ts: 1,
      type: 'm.room.message',
      content: {
        msgtype: 'm.text',
        body: 'preview',
        url: source.mxcUri,
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      },
    },
  ]);
  await saveAttachmentOwner(sessionId, roomId, '$body', 1, [
    { mxcUri: source.mxcUri, essential: true },
  ]);
  const scheduler = createBackfillScheduler({ mx });
  const control = createRoomOfflineController({
    mx,
    sessionId,
    scheduler,
    connection: {
      getSnapshot: () => ({ connected: true, unmetered: true }),
      subscribe: () => () => {},
    },
    getPrefetchConfig: () => ({ scope: 'current-room-only' }),
    onChanged: () => {},
  });
  control.start();
  const unsubscribe = control.controller.subscribe(roomId, () => {});
  try {
    control.focus(roomId);
    await vi.waitFor(() => expect(control.controller.getSnapshot(roomId).status).toBe('ready'));
    expect(versions).toHaveBeenCalledTimes(1);
    expect(control.controller.getSnapshot(roomId).missingEssential).toBe(1);
    control.controller.download(roomId);
    await vi.waitFor(() => expect(fetched.length).toBeGreaterThan(1));
    await vi.waitFor(() => expect(control.controller.getSnapshot(roomId).downloading).toBe(false));
    expect(versions).toHaveBeenCalledTimes(2);
    expect(control.controller.getSnapshot(roomId).missingEssential).toBe(0);
  } finally {
    unsubscribe();
    control.stop();
    scheduler.abortAll();
  }
});

it('keeps validated essential coverage when storage pressure denies a repeated prefetch', async () => {
  const { __setCacheStoreByteBudgetForTests, runCacheEvictionIfOverBudget } = await import(
    '../threads/cacheStore'
  );
  const mx = createLegacyMediaClient({ baseUrl, userId });
  const body = new MatrixEvent({
    room_id: roomId,
    event_id: '$body',
    sender: userId,
    origin_server_ts: 1,
    type: 'm.room.message',
    content: {
      msgtype: 'm.text',
      body: 'preview',
      url: source.mxcUri,
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    },
  });
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'validated body' }))
  );
  vi.stubGlobal('fetch', fetch);
  await persistAttachmentEvents(mx, [body]);
  await prefetchEventAttachments(mx, [body]);
  expect(await readRoomAttachmentStorage(sessionId, roomId)).toMatchObject({
    saved: 1,
    missing: 0,
  });
  __setCacheStoreByteBudgetForTests(1);
  try {
    await prefetchEventAttachments(mx, [body], {
      canDownload: async () => !(await runCacheEvictionIfOverBudget(sessionId)).underPressure,
    });
    expect(await readRoomAttachmentStorage(sessionId, roomId)).toMatchObject({
      saved: 1,
      missingEssential: 0,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    clearMindroomLongTextHydrationCache();
    expect(await hydrateCachedMindroomLongText(mx, source)).toMatchObject({
      body: 'validated body',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    __setCacheStoreByteBudgetForTests(undefined);
  }
});
