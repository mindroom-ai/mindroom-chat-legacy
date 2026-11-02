import 'fake-indexeddb/auto';
import { encryptAttachment } from 'browser-encrypt-attachment';
import { IDBFactory } from 'fake-indexeddb';
import { createClient, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLegacyMediaClient,
  saveAttachmentOwner,
} from '../threads/__tests__/attachmentFixtures';
import { writeCachedSpecVersions } from '../../state/cachedSpecVersions';
import { createSessionId } from '../../state/sessions';
import type { IEncryptedFile } from '../../../types/matrix/common';
import {
  deleteCacheStoreDb,
  loadCachedAttachment,
  openCacheStore,
  resetCacheStoreForTesting,
} from '../threads/cacheStore';
import {
  clearMindroomLongTextHydrationCache,
  hydrateMindroomLongTextSource,
  type MindroomLongTextSource,
} from './longText';
import { downloadMindroomLongTextSidecarText } from './longTextDownload';
import { downloadMindroomSidecarBlob } from './sidecarDownload';
import {
  clearAttachmentRepositoryMemory,
  downloadCachedAttachment,
  getCachedAttachmentCacheMetadata,
  hydrateCachedMindroomLongText,
  type CachedAttachmentSource,
} from './attachmentRepository';

const BASE_URL = 'https://matrix.example.org';
const SOURCE: MindroomLongTextSource = {
  owner: { roomId: '!room:matrix.example.org', eventId: '$body', revisionTs: 1 },
  previewContent: {
    body: 'Preview response',
    msgtype: 'm.text',
    url: 'mxc://matrix.example.org/complete-response',
    'io.mindroom.long_text': {
      version: 2,
      encoding: 'matrix_event_content_json',
    },
  },
  mxcUri: 'mxc://matrix.example.org/complete-response',
  isV2ContentJson: true,
};

const createAccountClient = (userId: string): MatrixClient =>
  createLegacyMediaClient({ baseUrl: BASE_URL, userId });

const admitSource = async <T extends CachedAttachmentSource>(
  mx: MatrixClient,
  source: T,
  essential = false
) => {
  const owner = source.owner ?? { ...SOURCE.owner!, eventId: '$' + source.mxcUri };
  await saveAttachmentOwner(
    createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId()),
    owner.roomId,
    owner.eventId,
    owner.revisionTs,
    [{ mxcUri: source.mxcUri, essential }],
    undefined,
    owner
  );
  return { ...source, owner };
};

const hydrate = (mx: MatrixClient) =>
  hydrateMindroomLongTextSource(
    SOURCE,
    (source) => downloadMindroomLongTextSidecarText(mx, source),
    mx
  );

const pauseAttachmentLookup = (mxcUri: string) => {
  const originalGet = IDBObjectStore.prototype.get;
  let request: IDBRequest | undefined;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, 'get')
    .mockImplementation(function pausedGet(query) {
      if (query !== mxcUri) return originalGet.call(this, query);
      request = {
        error: null,
        onerror: null,
        onsuccess: null,
        result: undefined,
      } as unknown as IDBRequest;
      return request;
    });

  return {
    waitUntilStarted: (timeout = 1000) =>
      vi.waitFor(
        () => {
          expect(request).toBeDefined();
        },
        { timeout }
      ),
    finish: () => {
      spy.mockRestore();
      expect(request).toBeDefined();
      request?.onsuccess?.call(request, new Event('success'));
    },
  };
};

describe('persistent attachment repository', () => {
  beforeEach(async () => {
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    resetCacheStoreForTesting();
    clearMindroomLongTextHydrationCache();
    clearAttachmentRepositoryMemory();
    await admitSource(createAccountClient('@alice:matrix.example.org'), SOURCE, true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetCacheStoreForTesting();
    clearMindroomLongTextHydrationCache();
    clearAttachmentRepositoryMemory();
  });

  it('hydrates a complete long-text body offline after restart without leaking it to another account', async () => {
    let transportOffline = false;
    const fetchMock = vi.fn(async () => {
      if (transportOffline) throw new TypeError('network offline');
      return new Response(
        JSON.stringify({
          body: 'Complete response from the sidecar',
          msgtype: 'm.text',
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await hydrate(createAccountClient('@alice:matrix.example.org'));
    expect(first.body).toBe('Complete response from the sidecar');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      (
        await getCachedAttachmentCacheMetadata(
          createAccountClient('@alice:matrix.example.org'),
          SOURCE.mxcUri
        )
      )?.essential
    ).toBe(true);

    clearMindroomLongTextHydrationCache();
    transportOffline = true;

    const restarted = await hydrate(createAccountClient('@alice:matrix.example.org'));
    expect(restarted.body).toBe('Complete response from the sidecar');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clearMindroomLongTextHydrationCache();
    const otherAccount = await hydrate(createAccountClient('@bob:matrix.example.org'));
    expect(otherAccount.body).toBe('Preview response');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('persists encrypted attachments as cipher bytes and decrypts only the consumer blob', async () => {
    vi.stubGlobal('window', {
      atob: globalThis.atob,
      btoa: globalThis.btoa,
      crypto: globalThis.crypto,
      location: { protocol: 'https:' },
    });
    const plaintext = new TextEncoder().encode('private attachment body');
    const encrypted = await encryptAttachment(plaintext);
    const encryptedFile: IEncryptedFile = {
      ...encrypted.info,
      url: 'mxc://matrix.example.org/encrypted-body',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(encrypted.data, {
            headers: { 'Content-Type': 'application/octet-stream' },
            status: 200,
          })
      )
    );
    const alice = createAccountClient('@alice:matrix.example.org');

    await admitSource(alice, { owner: SOURCE.owner, mxcUri: encryptedFile.url }, true);
    const consumerBlob = await downloadCachedAttachment(
      alice,
      {
        owner: SOURCE.owner,
        mxcUri: encryptedFile.url,
        encryptedFile,
        mimeType: 'text/plain',
      },
      { essential: true, roomId: '!room:matrix.example.org' }
    );

    expect(await consumerBlob.text()).toBe('private attachment body');
    const sessionId = createSessionId(BASE_URL, '@alice:matrix.example.org');
    const stored = await loadCachedAttachment(sessionId, encryptedFile.url);
    expect(new Uint8Array(stored?.bytes ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array(encrypted.data)
    );
    expect(new TextDecoder().decode(stored?.bytes)).not.toContain('private attachment body');
  });

  it('retries transport after a failed download', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network offline'))
      .mockResolvedValueOnce(new Response('available again', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = { mxcUri: 'mxc://matrix.example.org/retry', mimeType: 'text/plain' };

    await expect(downloadCachedAttachment(alice, source)).rejects.toThrow('network offline');
    await expect((await downloadCachedAttachment(alice, source)).text()).resolves.toBe(
      'available again'
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one fetch across concurrent callers and preserves essential room promotion', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = { mxcUri: 'mxc://matrix.example.org/shared', mimeType: 'text/plain' };

    await admitSource(
      alice,
      {
        ...source,
        owner: { roomId: '!essential:matrix.example.org', eventId: '$essential', revisionTs: 1 },
      },
      true
    );
    const ordinarySource = await admitSource(alice, {
      ...source,
      owner: { roomId: '!ordinary:matrix.example.org', eventId: '$ordinary', revisionTs: 1 },
    });
    const essential = downloadCachedAttachment(
      alice,
      {
        ...source,
        owner: { roomId: '!essential:matrix.example.org', eventId: '$essential', revisionTs: 1 },
      },
      {
        essential: true,
        roomId: '!essential:matrix.example.org',
      }
    );
    const ordinary = downloadCachedAttachment(alice, ordinarySource, {
      roomId: '!ordinary:matrix.example.org',
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveFetch?.(new Response('shared body', { status: 200 }));

    await expect(Promise.all([essential, ordinary])).resolves.toHaveLength(2);
    const metadata = await getCachedAttachmentCacheMetadata(alice, source.mxcUri);
    expect(metadata?.essential).toBe(true);
    expect(metadata?.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roomId: '!essential:matrix.example.org',
          essential: true,
          status: 'cached',
        }),
        expect.objectContaining({ roomId: '!ordinary:matrix.example.org' }),
      ])
    );
  });

  it('hydrates a long text from authenticated media without a service worker', async () => {
    // Homeservers that enforce authenticated media answer the legacy endpoint with 403.
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/_matrix/client/versions')) {
        return Response.json({ versions: ['v1.11'] });
      }
      if (!String(url).includes('/_matrix/client/v1/media/download/')) {
        return new Response('Unauthenticated media is disabled.', { status: 403 });
      }
      expect(init?.headers).toEqual({ Authorization: 'Bearer test-token' });
      return Response.json({ body: 'Complete response from the sidecar', msgtype: 'm.text' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const alice = createClient({
      baseUrl: BASE_URL,
      userId: '@alice:matrix.example.org',
      accessToken: 'test-token',
    });

    const content = await hydrateCachedMindroomLongText(alice, SOURCE);

    expect(content.body).toBe('Complete response from the sidecar');
  });

  it('downloads from the legacy endpoint without the access token when authenticated media is unsupported', async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) => new Response('bytes')
    );
    vi.stubGlobal('fetch', fetchMock);
    const alice = createLegacyMediaClient({
      baseUrl: BASE_URL,
      userId: '@alice:matrix.example.org',
      accessToken: 'test-token',
    });

    await downloadCachedAttachment(alice, { mxcUri: 'mxc://matrix.example.org/legacy' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/_matrix/media/v3/download/');
    expect(init?.headers).toBeUndefined();
  });

  it('uses the cached server versions when /versions fails', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/_matrix/client/versions')) {
        return new Response('Bad gateway', { status: 502 });
      }
      if (!String(url).includes('/_matrix/client/v1/media/download/')) {
        return new Response('Unauthenticated media is disabled.', { status: 403 });
      }
      expect(init?.headers).toEqual({ Authorization: 'Bearer test-token' });
      return Response.json({ body: 'Complete response from the sidecar', msgtype: 'm.text' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });
    writeCachedSpecVersions(BASE_URL, '@alice:matrix.example.org', { versions: ['v1.11'] });
    const alice = createClient({
      baseUrl: BASE_URL,
      userId: '@alice:matrix.example.org',
      accessToken: 'test-token',
    });

    const content = await hydrateCachedMindroomLongText(alice, SOURCE);

    expect(content.body).toBe('Complete response from the sidecar');
  });

  it('aborts active transport on memory cleanup and allows a shared fresh download', async () => {
    let signal!: AbortSignal;
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          finish = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = { mxcUri: 'mxc://matrix.example.org/cleanup' };
    const pending = downloadCachedAttachment(alice, source).catch((error) => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    clearAttachmentRepositoryMemory();
    try {
      expect(signal.aborted).toBe(true);
    } finally {
      finish(new Response('stale body'));
      await pending;
    }
    expect(await pending).toMatchObject({ name: 'AbortError' });
    expect(await getCachedAttachmentCacheMetadata(alice, source.mxcUri)).toBeUndefined();
    const fresh = Promise.all([
      downloadCachedAttachment(alice, source),
      downloadCachedAttachment(alice, source),
    ]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    finish(new Response('fresh body'));
    await expect(
      fresh.then((blobs) => Promise.all(blobs.map((blob) => blob.text())))
    ).resolves.toEqual(['fresh body', 'fresh body']);
  });

  it('shares lookup and transport when a concurrent fetch resolves immediately', async () => {
    const fetchMock = vi.fn(async () => new Response('shared body', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = {
      mxcUri: 'mxc://matrix.example.org/immediate-shared',
      mimeType: 'text/plain',
    };

    const blobs = await Promise.all(
      Array.from({ length: 10 }, () => downloadCachedAttachment(alice, source))
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(Promise.all(blobs.map((blob) => blob.text()))).resolves.toEqual(
      Array.from({ length: 10 }, () => 'shared body')
    );
  });

  it('promotes an existing cached attachment to essential without another fetch', async () => {
    const fetchMock = vi.fn(async () => new Response('cached body', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = await admitSource(alice, {
      owner: SOURCE.owner,
      mxcUri: 'mxc://matrix.example.org/promote',
      mimeType: 'text/plain',
    });

    await downloadCachedAttachment(alice, source);
    expect((await getCachedAttachmentCacheMetadata(alice, source.mxcUri))?.essential).toBe(false);

    await admitSource(alice, source, true);
    await downloadCachedAttachment(
      alice,
      { ...source, owner: SOURCE.owner },
      {
        essential: true,
        roomId: '!room:matrix.example.org',
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const promoted = await getCachedAttachmentCacheMetadata(alice, source.mxcUri);
    expect(promoted?.essential).toBe(true);
    expect(promoted?.references).toEqual([
      expect.objectContaining({ roomId: '!room:matrix.example.org', essential: true }),
    ]);
  });

  it('renders generic sidecars without creating durable ownership', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
    const alice = createAccountClient('@alice:matrix.example.org');
    const mxcUri = 'mxc://matrix.example.org/ordinary-sidecar';

    await downloadMindroomSidecarBlob(alice, { mxcUri });

    expect(await getCachedAttachmentCacheMetadata(alice, mxcUri)).toBeUndefined();
  });

  it('returns a downloaded blob without claiming persistence when storage is unavailable', async () => {
    Reflect.deleteProperty(globalThis, 'indexedDB');
    resetCacheStoreForTesting();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('interactive body', { status: 200 }))
    );
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = { mxcUri: 'mxc://matrix.example.org/no-storage', mimeType: 'text/plain' };

    expect(await (await downloadCachedAttachment(alice, source)).text()).toBe('interactive body');
    expect(await getCachedAttachmentCacheMetadata(alice, source.mxcUri)).toBeUndefined();
  });

  it('revokes a late write when logout deletes the session cache during transport', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = { mxcUri: 'mxc://matrix.example.org/late', mimeType: 'text/plain' };
    const sessionId = createSessionId(BASE_URL, '@alice:matrix.example.org');

    const pending = downloadCachedAttachment(alice, source, { essential: true });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await deleteCacheStoreDb(sessionId);
    resolveFetch?.(new Response('late body', { status: 200 }));

    expect(await (await pending).text()).toBe('late body');
    expect(await getCachedAttachmentCacheMetadata(alice, source.mxcUri)).toBeUndefined();
  });

  it('does not persist a caller-aborted transport after its shared fetch settles', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          })
      )
    );
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = { mxcUri: 'mxc://matrix.example.org/aborted', mimeType: 'text/plain' };
    const controller = new AbortController();
    const pending = downloadCachedAttachment(alice, source, {
      essential: true,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(resolveFetch).toBeTypeOf('function'));

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    resolveFetch?.(new Response('unused body', { status: 200 }));
    await vi.waitFor(async () => {
      expect(await getCachedAttachmentCacheMetadata(alice, source.mxcUri)).toBeUndefined();
    });
  });

  it('lets an independent consumer persist after another shared caller aborts', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = await admitSource(alice, {
      owner: { ...SOURCE.owner!, roomId: '!remaining:matrix.example.org' },
      mxcUri: 'mxc://matrix.example.org/partially-aborted',
      mimeType: 'text/plain',
    });
    const controller = new AbortController();
    const canceled = downloadCachedAttachment(alice, source, {
      essential: true,
      roomId: '!canceled:matrix.example.org',
      signal: controller.signal,
    });
    const remaining = downloadCachedAttachment(alice, source, {
      roomId: '!remaining:matrix.example.org',
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
    resolveFetch?.(new Response('shared survivor body', { status: 200 }));

    await expect((await remaining).text()).resolves.toBe('shared survivor body');
    const metadata = await getCachedAttachmentCacheMetadata(alice, source.mxcUri);
    expect(metadata?.essential).toBe(false);
    expect(metadata?.references).toEqual([
      expect.objectContaining({
        roomId: '!remaining:matrix.example.org',
        essential: false,
        status: 'cached',
      }),
    ]);
  });

  it('aborts persistence when cancellation follows transport completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unused body', { status: 200 }))
    );
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = await admitSource(alice, {
      mxcUri: 'mxc://matrix.example.org/abort-persistence',
      mimeType: 'text/plain',
    });
    const sessionId = createSessionId(BASE_URL, '@alice:matrix.example.org');
    const db = await openCacheStore(sessionId);
    const controller = new AbortController();
    const transaction = db?.transaction.bind(db);
    expect(transaction).toBeTypeOf('function');
    vi.spyOn(db as IDBDatabase, 'transaction').mockImplementation(
      (...args: Parameters<IDBDatabase['transaction']>) => {
        const result = transaction?.(...args) as IDBTransaction;
        if (args[1] === 'readwrite') controller.abort();
        return result;
      }
    );

    await expect(
      downloadCachedAttachment(alice, source, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await getCachedAttachmentCacheMetadata(alice, source.mxcUri)).toBeUndefined();
  });

  it('honors an already-aborted caller even when the bytes are cached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('cached body', { status: 200 }))
    );
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = await admitSource(alice, {
      mxcUri: 'mxc://matrix.example.org/abort-cached',
      mimeType: 'text/plain',
    });
    await downloadCachedAttachment(alice, source);
    const controller = new AbortController();
    controller.abort();

    await expect(
      downloadCachedAttachment(alice, source, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not start lookup or transport for an already-aborted uncached request', async () => {
    const fetchMock = vi.fn(async () => new Response('unused body', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = {
      mxcUri: 'mxc://matrix.example.org/pre-aborted-uncached',
      mimeType: 'text/plain',
    };
    const sessionId = createSessionId(BASE_URL, '@alice:matrix.example.org');
    await openCacheStore(sessionId);
    const lookup = pauseAttachmentLookup(source.mxcUri);
    const controller = new AbortController();
    controller.abort();

    await expect(
      downloadCachedAttachment(alice, source, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(lookup.waitUntilStarted(30)).rejects.toThrow();
  });

  it('does not start transport after its only consumer aborts during cache lookup', async () => {
    const fetchMock = vi.fn(async () => new Response('unused body', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = {
      mxcUri: 'mxc://matrix.example.org/abort-during-lookup',
      mimeType: 'text/plain',
    };
    const sessionId = createSessionId(BASE_URL, '@alice:matrix.example.org');
    await openCacheStore(sessionId);
    const lookup = pauseAttachmentLookup(source.mxcUri);
    const controller = new AbortController();
    const pending = downloadCachedAttachment(alice, source, {
      signal: controller.signal,
    });
    await lookup.waitUntilStarted();

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    lookup.finish();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts transport after cache lookup when another shared consumer remains', async () => {
    const fetchMock = vi.fn(async () => new Response('surviving body', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = await admitSource(alice, {
      mxcUri: 'mxc://matrix.example.org/survive-lookup-abort',
      mimeType: 'text/plain',
    });
    const sessionId = createSessionId(BASE_URL, '@alice:matrix.example.org');
    await openCacheStore(sessionId);
    const lookup = pauseAttachmentLookup(source.mxcUri);
    const controller = new AbortController();
    const canceled = downloadCachedAttachment(alice, source, {
      signal: controller.signal,
    });
    await lookup.waitUntilStarted();
    const remaining = downloadCachedAttachment(alice, source);

    controller.abort();
    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
    lookup.finish();

    await expect((await remaining).text()).resolves.toBe('surviving body');
    expect(await getCachedAttachmentCacheMetadata(alice, source.mxcUri)).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('bounded attachment transport', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetCacheStoreForTesting();
    clearAttachmentRepositoryMemory();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stops reading an unknown-size response once the only consumer exceeds its limit', async () => {
    let reads = 0;
    const cancel = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                reads += 1;
                if (reads <= 20) controller.enqueue(new Uint8Array(1024));
                else controller.close();
              },
              cancel,
            })
          )
      )
    );
    await expect(
      downloadCachedAttachment(
        createAccountClient('@alice:matrix.example.org'),
        { mxcUri: 'mxc://test/bounded' },
        { maxBytes: 2048 }
      )
    ).rejects.toThrow('limit');
    expect(reads).toBeLessThan(20);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('keeps an explicit reader alive when a bounded reader shares a larger attachment', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(4096)));
    vi.stubGlobal('fetch', fetchMock);
    const mx = createAccountClient('@alice:matrix.example.org');
    const source = { mxcUri: 'mxc://test/shared-limit' };
    const [automatic, explicit] = await Promise.allSettled([
      downloadCachedAttachment(mx, source, { maxBytes: 2048 }),
      downloadCachedAttachment(mx, source),
    ]);
    expect(automatic.status).toBe('rejected');
    expect(explicit.status === 'fulfilled' && explicit.value.size).toBe(4096);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

it('cancels shared HTTP transport when its last consumer leaves', async () => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  clearAttachmentRepositoryMemory();
  let transportSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url, init) => {
      transportSignal = init.signal;
      return new Promise<Response>((_resolve, reject) => {
        transportSignal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
      });
    })
  );
  const first = new AbortController();
  const second = new AbortController();
  const mx = createAccountClient('@alice:matrix.example.org');
  const source = { mxcUri: 'mxc://test/all-canceled' };
  const one = downloadCachedAttachment(mx, source, { signal: first.signal });
  const two = downloadCachedAttachment(mx, source, { signal: second.signal });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  first.abort();
  await expect(one).rejects.toMatchObject({ name: 'AbortError' });
  expect(transportSignal?.aborted).toBe(false);
  second.abort();
  await expect(two).rejects.toMatchObject({ name: 'AbortError' });
  expect(transportSignal?.aborted).toBe(true);
  vi.unstubAllGlobals();
});

it('validates a second admitted warm-memory owner and keeps its body after clearing the first room', async () => {
  const repository = await import('./attachmentRepository');
  const { clearRoomCachedContent, readRoomAttachmentStorage } = await import(
    '../threads/cacheStore'
  );
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  clearAttachmentRepositoryMemory();
  clearMindroomLongTextHydrationCache();
  const mx = createAccountClient('@alice:matrix.example.org');
  const session = createSessionId(BASE_URL, '@alice:matrix.example.org');
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'shared complete body' }))
    )
  );
  const first = { ...SOURCE, owner: { roomId: 'room-a', eventId: '$a', revisionTs: 1 } };
  const second = { ...SOURCE, owner: { roomId: 'room-b', eventId: '$b', revisionTs: 1 } };
  await admitSource(mx, first, true);
  await admitSource(mx, second, true);
  await repository.hydrateCachedMindroomLongText(mx, first);
  await repository.hydrateCachedMindroomLongText(mx, second);
  expect(await readRoomAttachmentStorage(session, 'room-b')).toMatchObject({
    saved: 1,
    missingEssential: 0,
  });
  await clearRoomCachedContent(session, 'room-a');
  clearAttachmentRepositoryMemory();
  clearMindroomLongTextHydrationCache();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  expect(await repository.hydrateCachedMindroomLongText(mx, second)).toMatchObject({
    body: 'shared complete body',
  });
  vi.unstubAllGlobals();
});

it('does not resurrect a retired interactive long-text body after delayed transport', async () => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  clearAttachmentRepositoryMemory();
  const mx = createAccountClient('@alice:matrix.example.org');
  const session = createSessionId(BASE_URL, '@alice:matrix.example.org');
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    )
  );
  const initial = await admitSource(
    mx,
    { ...SOURCE, owner: { roomId: 'room-a', eventId: '$stream', revisionTs: 1 } },
    true
  );
  const pending = downloadMindroomLongTextSidecarText(mx, initial);
  await vi.waitFor(() => expect(finish).toBeDefined());
  await saveAttachmentOwner(session, 'room-a', '$stream', 2, []);
  finish(new Response(JSON.stringify({ msgtype: 'm.text', body: 'obsolete' })));
  await pending;
  expect(await getCachedAttachmentCacheMetadata(mx, SOURCE.mxcUri)).toBeUndefined();
  vi.unstubAllGlobals();
});

it('persists for a surviving shared hydration owner after the first room is cleared', async () => {
  const { hydrateCachedMindroomLongText } = await import('./attachmentRepository');
  const { clearRoomCachedContent, readRoomAttachmentStorage } = await import(
    '../threads/cacheStore'
  );
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  clearAttachmentRepositoryMemory();
  clearMindroomLongTextHydrationCache();
  const mx = createAccountClient('@alice:matrix.example.org');
  const session = createSessionId(BASE_URL, '@alice:matrix.example.org');
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    )
  );
  await admitSource(
    mx,
    { ...SOURCE, owner: { roomId: 'room-a', eventId: '$a', revisionTs: 1 } },
    true
  );
  await admitSource(
    mx,
    { ...SOURCE, owner: { roomId: 'room-b', eventId: '$b', revisionTs: 1 } },
    true
  );
  const first = hydrateCachedMindroomLongText(mx, {
    ...SOURCE,
    owner: { roomId: 'room-a', eventId: '$a', revisionTs: 1 },
  });
  await vi.waitFor(() => expect(finish).toBeDefined());
  const second = hydrateCachedMindroomLongText(mx, {
    ...SOURCE,
    owner: { roomId: 'room-b', eventId: '$b', revisionTs: 1 },
  });
  await vi.waitFor(async () =>
    expect(await readRoomAttachmentStorage(session, 'room-b')).toMatchObject({
      missingEssential: 1,
    })
  );
  await clearRoomCachedContent(session, 'room-a');
  finish(new Response(JSON.stringify({ msgtype: 'm.text', body: 'surviving body' })));
  expect(await first).toEqual(SOURCE.previewContent);
  expect(await second).toMatchObject({ body: 'surviving body' });
  const { getCachedMindroomLongTextContent } = await import('./longText');
  expect(getCachedMindroomLongTextContent(SOURCE, mx)).toMatchObject({ body: 'surviving body' });
  expect(await readRoomAttachmentStorage(session, 'room-b')).toMatchObject({
    saved: 1,
    missingEssential: 0,
  });
  vi.unstubAllGlobals();
});

it('renders unadmitted media and thumbnails without creating ownership', async () => {
  const { readRoomAttachmentStorage } = await import('../threads/cacheStore');
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  clearAttachmentRepositoryMemory();
  const mx = createAccountClient('@alice:matrix.example.org');
  const session = createSessionId(BASE_URL, '@alice:matrix.example.org');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('image bytes'))
  );
  const owner = { roomId: 'room-a', eventId: '$image', revisionTs: 1 };
  await Promise.all([
    downloadCachedAttachment(mx, { owner, mxcUri: 'mxc://test/image' }),
    downloadCachedAttachment(mx, { owner, mxcUri: 'mxc://test/thumb' }),
  ]);
  expect(await readRoomAttachmentStorage(session, 'room-a')).toMatchObject({
    saved: 0,
    missing: 0,
  });
  vi.unstubAllGlobals();
});

it('keeps an original sidecar file incomplete until body validation even without a batch', async () => {
  const { readRoomAttachmentStorage } = await import('../threads/cacheStore');
  const { downloadMindroomLongTextSidecarBlob } = await import('./longTextDownload');
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  const mx = createAccountClient('@alice:matrix.example.org');
  const session = createSessionId(BASE_URL, '@alice:matrix.example.org');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('invalid json'))
  );
  const source = { ...SOURCE, owner: { roomId: 'room-a', eventId: '$body', revisionTs: 1 } };
  await admitSource(mx, source, true);
  expect(await (await downloadMindroomLongTextSidecarBlob(mx, source, true)).text()).toBe(
    'invalid json'
  );
  expect(await readRoomAttachmentStorage(session, 'room-a')).toMatchObject({
    saved: 0,
    missingEssential: 1,
  });
  vi.unstubAllGlobals();
});

it('ownerless essential hydration renders without protected persistent bytes', async () => {
  const { hydrateCachedMindroomLongText } = await import('./attachmentRepository');
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'unowned full body' }))
    )
  );
  const mx = createAccountClient('@unowned:test');
  const source = { ...SOURCE, owner: undefined, mxcUri: 'mxc://matrix.example.org/unowned' };
  expect((await hydrateCachedMindroomLongText(mx, source)).body).toBe('unowned full body');
  expect(
    await loadCachedAttachment(
      createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId()),
      source.mxcUri
    )
  ).toBeUndefined();
  vi.unstubAllGlobals();
});

it('validated owned cache hits do not rewrite attachment payloads', async () => {
  const { hydrateCachedMindroomLongText } = await import('./attachmentRepository');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'owned body' })))
  );
  const mx = createAccountClient('@cache-hit:test');
  const source = {
    ...SOURCE,
    mxcUri: 'mxc://matrix.example.org/cache-hit',
    owner: { roomId: '!hit:test', eventId: '$hit', revisionTs: 1, revisionId: '' },
  };
  await admitSource(mx, source, true);
  await hydrateCachedMindroomLongText(mx, source);
  clearMindroomLongTextHydrationCache();
  const writes: string[] = [];
  const original = IDBObjectStore.prototype.put;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementation(function countWrites(value, key) {
      writes.push(this.name);
      return original.call(this, value, key);
    });
  try {
    expect((await hydrateCachedMindroomLongText(mx, source)).body).toBe('owned body');
    expect(writes.filter((name) => name === 'attachments')).toHaveLength(0);
  } finally {
    spy.mockRestore();
    vi.unstubAllGlobals();
  }
});
