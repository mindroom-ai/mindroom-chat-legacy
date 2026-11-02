import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { encryptAttachment } from 'browser-encrypt-attachment';
import { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createLegacyMediaClient,
  persistAttachmentEvents,
} from '../threads/__tests__/attachmentFixtures';
import { createSessionId } from '../../state/sessions';
import {
  readRoomAttachmentStorage,
  resetCacheStoreForTesting,
  loadCachedAttachment,
  getCachedAttachmentMetadata,
} from '../threads/cacheStore';
import { resetCacheHealthForTesting } from '../threads/cacheHealth';
import { clearAttachmentRepositoryMemory, downloadCachedAttachment } from './attachmentRepository';
import { collectEventAttachments } from './eventAttachments';
import { prefetchEventAttachments } from './attachmentRepository';

const saveAndReadCoverage = async (...args: Parameters<typeof prefetchEventAttachments>) => {
  await persistAttachmentEvents(args[0], args[1]);
  await prefetchEventAttachments(...args);
  return readRoomAttachmentStorage(
    createSessionId(args[0].getHomeserverUrl(), args[0].getSafeUserId()),
    args[1][0].getRoomId()!
  );
};

const mx = createLegacyMediaClient({
  baseUrl: 'https://matrix.example.org',
  userId: '@alice:example.org',
});
const sessionId = createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());
const event = (eventId: string, content: Record<string, unknown>, ts = 1) =>
  new MatrixEvent({
    event_id: eventId,
    sender: '@alice:example.org',
    room_id: '!room',
    type: 'm.room.message',
    origin_server_ts: ts,
    content,
  });
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  resetCacheHealthForTesting();
  clearAttachmentRepositoryMemory();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('describes current essential bodies, images, audio and thumbnails with stable message ownership', () => {
  const result = collectEventAttachments([
    event('$body', {
      msgtype: 'm.text',
      body: 'preview',
      url: 'mxc://test/body',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    }),
    event('$image', {
      msgtype: 'm.image',
      url: 'mxc://test/image',
      info: {
        size: 1024,
        mimetype: 'image/png',
        thumbnail_url: 'mxc://test/thumb',
        thumbnail_info: { size: 100, mimetype: 'image/png' },
      },
    }),
    event('$audio', {
      msgtype: 'm.audio',
      url: 'mxc://test/audio',
      info: { size: 5 * 1024 * 1024 },
    }),
    event('$video', {
      msgtype: 'm.video',
      url: 'mxc://test/video',
      info: { size: 10 * 1024 * 1024 },
    }),
  ]);
  expect(
    result.flatMap((message) =>
      message.attachments.map((a) => [a.mxcUri, a.essential, a.autoDownload])
    )
  ).toEqual([
    ['mxc://test/body', true, true],
    ['mxc://test/image', false, true],
    ['mxc://test/thumb', false, true],
    ['mxc://test/audio', false, true],
    ['mxc://test/video', false, false],
  ]);
  expect(result[0]).toMatchObject({ eventId: '$body', roomId: '!room', revisionTs: 1 });
});

it('counts missing essentials before failed fetch and retires old revisions on replacement/redaction', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  const body = {
    msgtype: 'm.text',
    url: 'mxc://test/body',
    'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
  };
  expect(await saveAndReadCoverage(mx, [event('$body', body)])).toMatchObject({
    saved: 0,
    missing: 1,
  });
  expect(await readRoomAttachmentStorage(sessionId, '!room')).toMatchObject({
    missingEssential: 1,
  });
  await saveAndReadCoverage(mx, [
    event('$body', body),
    event(
      '$edit',
      {
        'm.relates_to': { rel_type: 'm.replace', event_id: '$body' },
        'm.new_content': { msgtype: 'm.text', body: 'short' },
      },
      2
    ),
  ]);
  expect(await readRoomAttachmentStorage(sessionId, '!room')).toMatchObject({
    missingEssential: 0,
  });
  await saveAndReadCoverage(mx, [event('$body', body)]);
  expect(await readRoomAttachmentStorage(sessionId, '!room')).toMatchObject({
    missingEssential: 0,
  });
});

it('skips unknown and large optional media unless explicitly included', async () => {
  const fetchMock = vi.fn(async () => new Response('file bytes'));
  vi.stubGlobal('fetch', fetchMock);
  const events = [
    event('$unknown', { msgtype: 'm.image', url: 'mxc://test/unknown' }),
    event('$file', { msgtype: 'm.file', url: 'mxc://test/file', info: { size: 6 * 1024 * 1024 } }),
  ];
  expect(await saveAndReadCoverage(mx, events)).toMatchObject({ saved: 0, missing: 2 });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await saveAndReadCoverage(mx, events, { includeAllMedia: true })).toMatchObject({
    saved: 2,
    missing: 0,
  });
  expect(await loadCachedAttachment(sessionId, 'mxc://test/file')).toBeDefined();
});

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  'validates shared essential bytes per owner (reverse=%s, crossRoom=%s)',
  async (reverse, crossRoom) => {
    vi.stubGlobal('window', { crypto, atob, btoa, location: { protocol: 'https:' } });
    const encrypted = await encryptAttachment(
      new TextEncoder().encode(JSON.stringify({ msgtype: 'm.text', body: 'complete body' }))
    );
    const mxcUri = 'mxc://test/shared-encrypted';
    const valid = event('$valid', {
      msgtype: 'm.text',
      file: { ...encrypted.info, url: mxcUri },
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    });
    const invalid = event('$invalid', {
      ...valid.getContent(),
      file: { ...encrypted.info, url: mxcUri, hashes: { sha256: 'invalid' } },
    });
    if (crossRoom) invalid.event.room_id = '!other';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(encrypted.data))
    );
    const events = reverse ? [invalid, valid] : [valid, invalid];
    await saveAndReadCoverage(mx, events);
    expect((await getCachedAttachmentMetadata(sessionId, mxcUri))?.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: '$valid', status: 'cached' }),
        expect.objectContaining({ eventId: '$invalid', status: 'missing' }),
      ])
    );
    expect(await readRoomAttachmentStorage(sessionId, invalid.getRoomId()!)).toMatchObject({
      missingEssential: 1,
    });
    // Retrying the unreadable owner cannot downgrade its independently validated sibling.
    await saveAndReadCoverage(mx, events);
    expect(await readRoomAttachmentStorage(sessionId, invalid.getRoomId()!)).toMatchObject({
      saved: 0,
      missing: 1,
    });
  }
);

it('downloads a historical sticker through optional media policy and reopens it offline', async () => {
  const sticker = new MatrixEvent({
    event_id: '$sticker',
    room_id: '!room',
    sender: '@alice:example.org',
    origin_server_ts: 1,
    type: 'm.sticker',
    content: { body: 'sticker', url: 'mxc://test/sticker', info: { mimetype: 'image/png' } },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('sticker bytes'))
  );
  expect(await saveAndReadCoverage(mx, [sticker])).toMatchObject({ saved: 0, missing: 1 });
  expect(fetch).not.toHaveBeenCalled();
  expect(await saveAndReadCoverage(mx, [sticker], { includeAllMedia: true })).toMatchObject({
    saved: 1,
    missing: 0,
  });
  clearAttachmentRepositoryMemory();
  resetCacheStoreForTesting();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  const coldClient = createLegacyMediaClient({
    baseUrl: mx.getHomeserverUrl(),
    userId: mx.getSafeUserId(),
  });
  const blob = await downloadCachedAttachment(coldClient, { mxcUri: 'mxc://test/sticker' });
  expect(await blob.text()).toBe('sticker bytes');
  expect(fetch).not.toHaveBeenCalled();
});

it('leaves oversized essential bodies incomplete even if an explicit download already cached bytes', async () => {
  const { putCachedAttachment } = await import('../threads/cacheStore');
  await putCachedAttachment(sessionId, {
    mxcUri: 'mxc://test/oversized',
    mimeType: 'application/json',
    bytes: new ArrayBuffer(32 * 1024 * 1024 + 1),
  });
  const body = event('$huge', {
    msgtype: 'm.text',
    body: 'preview',
    url: 'mxc://test/oversized',
    'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
  });
  expect(await saveAndReadCoverage(mx, [body])).toMatchObject({ saved: 0, missing: 1 });
  expect(await readRoomAttachmentStorage(sessionId, '!room')).toMatchObject({
    missingEssential: 1,
    saved: 0,
  });
});

it('keeps body coverage incomplete after quota failure while interactive bytes remain usable', async () => {
  // eslint-disable-next-line no-console
  const originalWarn = console.warn;
  // eslint-disable-next-line no-console
  const originalError = console.error;
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args) => {
    if (!String(args[0]).startsWith('[mindroom-cache:attachment.save]')) originalWarn(...args);
  });
  const error = vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (!String(args[0]).startsWith('[mindroom-cache] storage quota exceeded'))
      originalError(...args);
  });
  const original = IDBObjectStore.prototype.put;
  const put = vi
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementation(function failBlob(value, key) {
      if (this.name === 'attachments') throw new DOMException('Storage full', 'QuotaExceededError');
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'complete body' })))
  );
  const body = event('$quota', {
    msgtype: 'm.text',
    url: 'mxc://test/quota',
    'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
  });
  expect(await saveAndReadCoverage(mx, [body])).toMatchObject({ saved: 0, missing: 1 });
  expect(await readRoomAttachmentStorage(sessionId, '!room')).toMatchObject({
    missingEssential: 1,
  });
  expect(fetch).toHaveBeenCalledOnce();
  expect(await loadCachedAttachment(sessionId, 'mxc://test/quota')).toBeUndefined();
  const { downloadCachedAttachment } = await import('./attachmentRepository');
  const interactive = await downloadCachedAttachment(
    mx,
    { mxcUri: 'mxc://test/quota', isV2ContentJson: true },
    { essential: true }
  );
  expect(await interactive.text()).toContain('complete body');
  const { getCacheHealth } = await import('../threads/cacheHealth');
  expect(getCacheHealth().state).toBe('read-only');
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('[mindroom-cache:attachment.save]'),
    expect.objectContaining({ name: 'QuotaExceededError' })
  );
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining('[mindroom-cache] storage quota exceeded')
  );
  put.mockRestore();
  resetCacheHealthForTesting();
});

it('does not count malformed body JSON as readable saved content', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('not valid body JSON'))
  );
  const body = event('$invalid', {
    msgtype: 'm.text',
    body: 'preview',
    url: 'mxc://test/invalid',
    'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
  });
  expect(await saveAndReadCoverage(mx, [body])).toMatchObject({ saved: 0, missing: 1 });
  expect(await readRoomAttachmentStorage(sessionId, '!room')).toMatchObject({
    missingEssential: 1,
    saved: 0,
  });
});

it('ignores foreign-sender and unresolved edits when tracking essential ownership', async () => {
  const content = {
    msgtype: 'm.text',
    body: 'preview',
    url: 'mxc://test/protected',
    'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
  };
  const root = event('$protected', content);
  const foreign = new MatrixEvent({
    event_id: '$foreign',
    room_id: '!room',
    sender: '@mallory:example.org',
    type: 'm.room.message',
    origin_server_ts: 2,
    content: {
      'm.relates_to': { rel_type: 'm.replace', event_id: '$protected' },
      'm.new_content': { msgtype: 'm.text', body: 'replace' },
    },
  });
  expect(collectEventAttachments([root, foreign])).toHaveLength(1);
  expect(collectEventAttachments([root, foreign])[0].attachments[0].mxcUri).toBe(
    'mxc://test/protected'
  );
  expect(collectEventAttachments([foreign])).toEqual([]);
});

it.each([false, true])(
  'counts mixed optional/essential shared bytes after all validation (reverse=%s)',
  async (reverse) => {
    const body = event('$body', {
      msgtype: 'm.text',
      body: 'preview',
      url: 'mxc://test/shared',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    });
    const file = event('$file', {
      msgtype: 'm.file',
      url: 'mxc://test/shared',
      info: { size: 12 },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('invalid json'))
    );
    const events = reverse ? [body, file] : [file, body];
    expect(await saveAndReadCoverage(mx, events)).toMatchObject({ saved: 0, missing: 1 });
    expect(await readRoomAttachmentStorage(sessionId, '!room')).toMatchObject({
      bytes: 12,
      missingEssential: 1,
    });
  }
);
