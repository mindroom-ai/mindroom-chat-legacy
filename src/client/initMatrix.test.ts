import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createClient as createSdkClient } from 'matrix-js-sdk';
import { Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { IndexedDBCryptoStore } from 'matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';
import {
  clearAllCacheAndReload,
  DeviceIdentityVerificationError,
  initClient,
  LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT,
  logoutClient,
  MissingCryptoStoreError,
  removeCurrentClientSessionAndReload,
  removeStoredSession,
  STARTUP_SYNC_TIMELINE_LIMIT,
  startClient,
} from './initMatrix';
import { createMatrixClient } from '../app/mindroom/matrix/matrixClientFactory';
import { TOKEN_REFRESH_TIMEOUT_MS } from './sessionTokenRefresh';
import { clearSecretStorageKeys } from './secretStorageKeys';
import { MINDROOM_EDIT_DEBUG_STORAGE_KEY } from '../app/mindroom/messages/editDebug';
import { clearMindroomLongTextHydrationCache } from '../app/mindroom/messages/longText';
import {
  LEGACY_SESSION_STORAGE_KEYS,
  SESSION_STORE_KEY,
  SessionStoreWriteError,
  createSessionId,
  getSessionIndexedDbStoreName,
  getLegacySessionRustCryptoStoreNames,
  getSessionRustCryptoStoreNames,
  getSessionRustCryptoStorePrefix,
  getSessionStore,
  markCryptoStoreInitialized,
  putSession,
} from '../app/state/sessions';
// CINNY-207 P2.3: cache module APIs now come directly from `./cacheStore`.
// The three legacy shim files are gone; the legacy per-session DB name
// accessors are re-exported by the store's `legacyCacheDbNames` barrel
// so logout cleanup keeps working for rolled-back installs.
import {
  deleteCacheStoreDb,
  getLegacyRoomEventCacheDbName as getRoomEventCacheDbName,
  getLegacyThreadEventCacheDbName as getThreadEventCacheDbName,
  getLegacyThreadSummaryCacheDbName as getThreadSummaryCacheDbName,
} from '../app/mindroom/threads/cacheStore';
import { getCanvasStateDbName } from '../app/mindroom/canvas/canvasStateStore';
import { clearIOSPushState } from '../app/mindroom/native/iosPush';
import { clearRecentThreadsStore } from '../app/mindroom/recent-threads/recentThreads';
import { clearRecentThreadViewModelSharedState } from '../app/mindroom/threads/recentThreadViewModel';
import { readCachedSpecVersions, writeCachedSpecVersions } from '../app/state/cachedSpecVersions';

vi.mock('matrix-js-sdk/lib/store/indexeddb', () => ({
  IndexedDBStore: vi.fn(),
}));

vi.mock('matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store', () => ({
  IndexedDBCryptoStore: vi.fn(),
}));

vi.mock('./secretStorageKeys', () => ({
  clearSecretStorageKeys: vi.fn(),
  cryptoCallbacks: {},
}));

vi.mock('../app/mindroom/messages/longText', () => ({
  clearMindroomLongTextHydrationCache: vi.fn(),
}));

vi.mock('../app/mindroom/messages/attachmentRepository', () => ({
  clearAttachmentRepositoryMemory: vi.fn(),
}));

vi.mock('../app/mindroom/matrix/matrixClientFactory', () => ({
  createMatrixClient: vi.fn(),
}));

vi.mock('../app/mindroom/engine/mindroomSyncEngine', () => ({
  stopMindroomSyncEngineForClient: vi.fn(),
}));

vi.mock('../app/state/navToActivePath', () => ({
  clearNavToActivePathStore: vi.fn(),
}));

vi.mock('../app/mindroom/recent-threads/recentThreads', () => ({
  clearRecentThreadsStore: vi.fn(),
}));

vi.mock('../app/mindroom/threads/recentThreadViewModel', () => ({
  clearRecentThreadViewModelSharedState: vi.fn(),
}));

vi.mock('../app/mindroom/threads/roomThreadFilterState', () => ({
  clearRoomThreadFiltersStore: vi.fn(),
}));

// CINNY-207 P2.3: single mock covers every cache-module accessor
// initMatrix (or the sessionCleanup facade it consumes) needs. Legacy
// name accessors are STILL exported by the store — rolled-back installs
// must keep getting their per-session legacy DBs deleted on logout.
vi.mock('../app/mindroom/threads/cacheStore', () => ({
  LEGACY_MINDROOM_ROOM_EVENT_CACHE_DB_NAME: 'mindroom-room-event-cache',
  LEGACY_MINDROOM_THREAD_EVENT_CACHE_DB_NAME: 'mindroom-thread-event-cache',
  LEGACY_MINDROOM_THREAD_SUMMARY_CACHE_DB_NAME: 'mindroom-thread-summary-cache',
  MINDROOM_CACHE_DB_BASE_NAME: 'mindroom-cache',
  deleteCacheStoreDb: vi.fn().mockResolvedValue(undefined),
  getCacheStoreDbName: vi.fn((sessionId: string) => `mindroom-cache::${sessionId}`),
  getLegacyRoomEventCacheDbName: vi.fn(
    (sessionId: string) => `mindroom-room-event-cache::${sessionId}`
  ),
  getLegacyThreadEventCacheDbName: vi.fn(
    (sessionId: string) => `mindroom-thread-event-cache::${sessionId}`
  ),
  getLegacyThreadSummaryCacheDbName: vi.fn(
    (sessionId: string) => `mindroom-thread-summary-cache::${sessionId}`
  ),
  getLegacySessionScopedCacheDbNames: vi.fn((sessionId: string) => [
    `mindroom-room-event-cache::${sessionId}`,
    `mindroom-thread-event-cache::${sessionId}`,
    `mindroom-thread-summary-cache::${sessionId}`,
  ]),
  revokeAllCacheStoreWrites: vi.fn(),
}));

vi.mock('../app/mindroom/native/iosPush', () => ({
  IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX: 'mindroom_ios_push_',
  clearIOSPushState: vi.fn(),
}));

const createStorageMock = (initialEntries: Record<string, string> = {}) => {
  const state = new Map<string, string>(Object.entries(initialEntries));
  const storage = {
    get length() {
      return state.size;
    },
    key: vi.fn((index: number) => Array.from(state.keys())[index] ?? null),
    getItem: vi.fn((key: string) => state.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      state.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      state.delete(key);
    }),
    clear: vi.fn(() => {
      state.clear();
    }),
  } as unknown as Storage;

  return { state, storage };
};

const createDeleteDatabaseMock = ({
  blockedNames = new Set<string>(),
  errorNames = new Map<string, Error>(),
}: {
  blockedNames?: Set<string>;
  errorNames?: Map<string, Error>;
} = {}) =>
  vi.fn((name: string) => {
    const request = {} as IDBOpenDBRequest;

    queueMicrotask(() => {
      const error = errorNames.get(name);
      if (error) {
        Object.defineProperty(request, 'error', {
          value: error,
          configurable: true,
        });
        request.onerror?.call(request, new Event('error'));
        return;
      }

      if (blockedNames.has(name)) {
        request.onblocked?.call(request, new Event('blocked') as IDBVersionChangeEvent);
        return;
      }

      request.onsuccess?.call(request, new Event('success'));
    });

    return request;
  });

const createExistingDatabaseOpenMock = () =>
  vi.fn(() => {
    const request = {} as IDBOpenDBRequest;
    queueMicrotask(() => {
      Object.defineProperty(request, 'result', {
        configurable: true,
        value: { close: vi.fn() },
      });
      request.onsuccess?.call(request, new Event('success'));
    });
    return request;
  });

const createDatabase = async (factory: IDBFactory, name: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(name);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
};

describe('initClient', () => {
  beforeEach(() => {
    // Most initClient tests exercise behavior after an existing crypto store
    // is opened. Tests for first-login and missing-store paths override this.
    vi.stubGlobal('indexedDB', { open: createExistingDatabaseOpenMock() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('raises the saved sync archive timeline limit for the IndexedDB store', async () => {
    const sessionId = createSessionId('https://example.com', '@user:example.com');
    const startup = vi.fn().mockResolvedValue(undefined);
    const syncAccumulator = {
      opts: {
        maxTimelineEntries: 50,
      },
    };
    vi.mocked(IndexedDBStore).mockImplementation(
      () =>
        ({
          backend: {
            syncAccumulator,
          },
          startup,
        } as unknown as IndexedDBStore)
    );
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({} as unknown as IndexedDBCryptoStore)
    );

    const initRustCrypto = vi.fn().mockResolvedValue(undefined);
    const setMaxListeners = vi.fn();
    vi.mocked(createMatrixClient).mockReturnValue({
      initRustCrypto,
      http: { authedRequest: vi.fn().mockResolvedValue({ device_keys: {} }) },
      setMaxListeners,
    } as never);

    await initClient({
      sessionId,
      baseUrl: 'https://example.com',
      accessToken: 'token',
      userId: '@user:example.com',
      deviceId: 'DEVICE',
    });

    expect(vi.mocked(IndexedDBStore)).toHaveBeenCalledWith(
      expect.objectContaining({
        dbName: `web-sync-store::${sessionId}`,
      })
    );
    expect(vi.mocked(IndexedDBCryptoStore)).toHaveBeenCalledWith(
      global.indexedDB,
      `crypto-store::${sessionId}`
    );
    expect(vi.mocked(createMatrixClient)).toHaveBeenCalledWith(
      expect.objectContaining({
        timelineSupport: true,
        threadSupport: true,
      })
    );
    expect(LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT).toBe(500);
    expect(syncAccumulator.opts.maxTimelineEntries).toBe(LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT);
    expect(startup).toHaveBeenCalledTimes(1);
    expect(initRustCrypto).toHaveBeenCalledWith({
      cryptoDatabasePrefix: getSessionRustCryptoStorePrefix({
        sessionId,
        deviceId: 'DEVICE',
      }),
    });
    expect(setMaxListeners).toHaveBeenCalledWith(50);
  });

  it('refuses to recreate a missing main Rust store even if optional metadata remains', async () => {
    const originalLocalStorage = globalThis.localStorage;
    const originalIndexedDB = globalThis.indexedDB;
    const { storage } = createStorageMock();
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@user:example.com',
        deviceId: 'DEVICE',
        accessToken: 'token',
      },
      undefined,
      storage
    );
    markCryptoStoreInitialized(session.sessionId, storage);
    const [, optionalMetaStoreName] = getSessionRustCryptoStoreNames(session);
    const databases = vi.fn().mockResolvedValue([{ name: optionalMetaStoreName }]);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { databases },
    });

    try {
      await expect(initClient(session)).rejects.toBeInstanceOf(MissingCryptoStoreError);
      expect(databases).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createMatrixClient)).not.toHaveBeenCalled();
      expect(vi.mocked(IndexedDBStore)).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalLocalStorage,
      });
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        value: originalIndexedDB,
      });
    }
  });

  it('opens the passwordless Rust store without a homeserver request while offline', async () => {
    const { storage } = createStorageMock();
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@user:example.com',
        deviceId: 'DEVICE',
        accessToken: 'token',
      },
      undefined,
      storage
    );
    markCryptoStoreInitialized(session.sessionId, storage);
    const [cryptoStoreName] = getSessionRustCryptoStoreNames(session);
    const databases = vi.fn().mockResolvedValue([{ name: cryptoStoreName }]);
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('indexedDB', { databases });
    vi.stubGlobal('navigator', { onLine: false });
    vi.mocked(IndexedDBStore).mockImplementation(
      () => ({ startup: vi.fn().mockResolvedValue(undefined) } as unknown as IndexedDBStore)
    );
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({} as unknown as IndexedDBCryptoStore)
    );
    const setMaxListeners = vi.fn();
    const authedRequest = vi.fn().mockRejectedValue(new Error('network unavailable'));
    vi.mocked(createMatrixClient).mockReturnValue({
      initRustCrypto: vi.fn().mockResolvedValue(undefined),
      http: { authedRequest },
      setMaxListeners,
    } as never);

    await initClient(session);

    expect(databases).toHaveBeenCalledTimes(1);
    expect(authedRequest).not.toHaveBeenCalled();
    expect(setMaxListeners).toHaveBeenCalledWith(50);
  });

  it('falls back to opening the main database when enumeration is unavailable', async () => {
    const factory = new IDBFactory();
    const sessionId = createSessionId('https://example.com', '@user:example.com');
    const session = {
      sessionId,
      baseUrl: 'https://example.com',
      accessToken: 'token',
      userId: '@user:example.com',
      deviceId: 'DEVICE',
    };
    const [cryptoStoreName] = getSessionRustCryptoStoreNames(session);
    await createDatabase(factory, cryptoStoreName);
    Object.defineProperty(factory, 'databases', { configurable: true, value: undefined });
    vi.stubGlobal('indexedDB', factory);
    vi.mocked(IndexedDBStore).mockImplementation(
      () => ({ startup: vi.fn().mockResolvedValue(undefined) } as unknown as IndexedDBStore)
    );
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({} as unknown as IndexedDBCryptoStore)
    );
    const authedRequest = vi.fn();
    vi.mocked(createMatrixClient).mockReturnValue({
      initRustCrypto: vi.fn().mockResolvedValue(undefined),
      http: { authedRequest },
      setMaxListeners: vi.fn(),
    } as never);

    await initClient(session);

    expect(authedRequest).not.toHaveBeenCalled();
  });

  it('does not leave a database behind when the fallback probe finds it absent', async () => {
    const factory = new IDBFactory();
    const listDatabases = factory.databases.bind(factory);
    Object.defineProperty(factory, 'databases', { configurable: true, value: undefined });
    const { storage } = createStorageMock();
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@user:example.com',
        deviceId: 'DEVICE',
        accessToken: 'token',
      },
      undefined,
      storage
    );
    markCryptoStoreInitialized(session.sessionId, storage);
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('indexedDB', factory);

    await expect(initClient(session)).rejects.toBeInstanceOf(MissingCryptoStoreError);

    expect(vi.mocked(createMatrixClient)).not.toHaveBeenCalled();
    await expect(listDatabases()).resolves.toEqual([]);
  });

  it('initializes a new device only after confirming the homeserver has no identity', async () => {
    const { storage } = createStorageMock();
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@user:example.com',
        deviceId: 'DEVICE',
        accessToken: 'token',
      },
      undefined,
      storage
    );
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('indexedDB', { databases: vi.fn().mockResolvedValue([]) });
    const startup = vi.fn().mockResolvedValue(undefined);
    vi.mocked(IndexedDBStore).mockImplementation(() => ({ startup } as unknown as IndexedDBStore));
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({} as unknown as IndexedDBCryptoStore)
    );
    const authedRequest = vi.fn().mockResolvedValue({ device_keys: {} });
    const initRustCrypto = vi.fn().mockResolvedValue(undefined);
    const setMaxListeners = vi.fn();
    vi.mocked(createMatrixClient).mockReturnValue({
      initRustCrypto,
      http: { authedRequest },
      setMaxListeners,
    } as never);

    await initClient(session);

    expect(authedRequest).toHaveBeenCalledWith('POST', '/keys/query', undefined, {
      device_keys: { '@user:example.com': ['DEVICE'] },
    });
    expect(initRustCrypto).toHaveBeenCalledTimes(1);
    expect(startup).toHaveBeenCalledTimes(1);
    expect(setMaxListeners).toHaveBeenCalledWith(50);
    expect(getSessionStore(storage).sessions[0].cryptoStoreInitialized).toBe(true);
  });

  it('rejects a missing local store before Rust initialization when server keys already exist', async () => {
    const sessionId = createSessionId('https://example.com', '@user:example.com');
    const session = {
      sessionId,
      baseUrl: 'https://example.com',
      accessToken: 'token',
      userId: '@user:example.com',
      deviceId: 'DEVICE',
    };
    vi.stubGlobal('indexedDB', {
      databases: vi.fn().mockResolvedValue([]),
    });
    const startup = vi.fn().mockResolvedValue(undefined);
    vi.mocked(IndexedDBStore).mockImplementation(() => ({ startup } as unknown as IndexedDBStore));
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({} as unknown as IndexedDBCryptoStore)
    );
    const authedRequest = vi.fn().mockResolvedValue({
      device_keys: {
        '@user:example.com': {
          DEVICE: {
            keys: {
              'ed25519:DEVICE': 'server-ed-key',
              'curve25519:DEVICE': 'server-curve-key',
            },
          },
        },
      },
    });

    const initRustCrypto = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createMatrixClient).mockReturnValue({
      initRustCrypto,
      http: { authedRequest },
    } as never);

    await expect(initClient(session)).rejects.toThrow('Remove this account, then sign in again');

    expect(initRustCrypto).not.toHaveBeenCalled();
    expect(startup).not.toHaveBeenCalled();
  });

  it('treats incomplete homeserver device keys as a retryable verification failure', async () => {
    const sessionId = createSessionId('https://example.com', '@user:example.com');
    const session = {
      sessionId,
      baseUrl: 'https://example.com',
      accessToken: 'token',
      userId: '@user:example.com',
      deviceId: 'DEVICE',
    };
    vi.stubGlobal('indexedDB', {
      databases: vi.fn().mockResolvedValue([]),
    });
    const startup = vi.fn().mockResolvedValue(undefined);
    vi.mocked(IndexedDBStore).mockImplementation(() => ({ startup } as unknown as IndexedDBStore));
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({} as unknown as IndexedDBCryptoStore)
    );
    const initRustCrypto = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createMatrixClient).mockReturnValue({
      initRustCrypto,
      http: {
        authedRequest: vi.fn().mockResolvedValue({
          device_keys: {
            '@user:example.com': {
              DEVICE: {
                keys: {
                  'ed25519:DEVICE': 'server-ed-key',
                },
              },
            },
          },
        }),
      },
    } as never);

    await expect(initClient(session)).rejects.toBeInstanceOf(DeviceIdentityVerificationError);
    expect(initRustCrypto).not.toHaveBeenCalled();
    expect(startup).not.toHaveBeenCalled();
  });

  it('fails before creating keys when the homeserver identity check is unavailable', async () => {
    const sessionId = createSessionId('https://example.com', '@user:example.com');
    vi.stubGlobal('indexedDB', { databases: vi.fn().mockResolvedValue([]) });
    const startup = vi.fn().mockResolvedValue(undefined);
    vi.mocked(IndexedDBStore).mockImplementation(() => ({ startup } as unknown as IndexedDBStore));
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({} as unknown as IndexedDBCryptoStore)
    );
    const authedRequest = vi.fn().mockRejectedValue(new Error('offline'));

    const initRustCrypto = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createMatrixClient).mockReturnValue({
      initRustCrypto,
      http: { authedRequest },
    } as never);

    await expect(
      initClient({
        sessionId,
        baseUrl: 'https://example.com',
        accessToken: 'token',
        userId: '@user:example.com',
        deviceId: 'DEVICE',
      })
    ).rejects.toThrow('could not safely verify the encryption storage and device identity');

    expect(initRustCrypto).not.toHaveBeenCalled();
    expect(startup).not.toHaveBeenCalled();
  });

  it('fails before creating a client when local crypto-store inspection is indeterminate', async () => {
    const databases = vi.fn().mockRejectedValue(new Error('enumeration denied'));
    const open = vi.fn(() => {
      throw new Error('storage denied');
    });
    vi.stubGlobal('indexedDB', { databases, open });

    await expect(
      initClient({
        sessionId: createSessionId('https://example.com', '@user:example.com'),
        baseUrl: 'https://example.com',
        accessToken: 'token',
        userId: '@user:example.com',
        deviceId: 'DEVICE',
      })
    ).rejects.toBeInstanceOf(DeviceIdentityVerificationError);

    expect(databases).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createMatrixClient)).not.toHaveBeenCalled();
    expect(vi.mocked(IndexedDBStore)).not.toHaveBeenCalled();
  });

  it('starts IndexedDB store startup and Rust crypto initialization in parallel', async () => {
    const sessionId = createSessionId('https://example.com', '@user:example.com');
    let resolveStartup: (() => void) | undefined;
    let resolveRustCrypto: (() => void) | undefined;
    const startup = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveStartup = resolve;
        })
    );
    vi.mocked(IndexedDBStore).mockImplementation(
      () =>
        ({
          startup,
        } as unknown as IndexedDBStore)
    );
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({} as unknown as IndexedDBCryptoStore)
    );

    const initRustCrypto = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRustCrypto = resolve;
        })
    );
    vi.mocked(createMatrixClient).mockReturnValue({
      initRustCrypto,
      http: { authedRequest: vi.fn().mockResolvedValue({ device_keys: {} }) },
      setMaxListeners: vi.fn(),
    } as never);

    let settled = false;
    const initPromise = initClient({
      sessionId,
      baseUrl: 'https://example.com',
      accessToken: 'token',
      userId: '@user:example.com',
      deviceId: 'DEVICE',
    }).then(() => {
      settled = true;
    });

    await vi.waitFor(() => {
      expect(startup).toHaveBeenCalledTimes(1);
      expect(initRustCrypto).toHaveBeenCalledTimes(1);
    });
    expect(settled).toBe(false);

    resolveStartup?.();
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveRustCrypto?.();
    await initPromise;
    expect(settled).toBe(true);
  });

  it.each([
    {
      name: 'waits for late Rust initialization before disposing a failed sync runtime',
      failedInitializer: 'sync' as const,
    },
    {
      name: 'waits for late sync startup before disposing a failed Rust runtime',
      failedInitializer: 'rust' as const,
    },
  ])('$name', async ({ failedInitializer }) => {
    const sessionId = createSessionId('https://example.com', '@user:example.com');
    const initializationFailure = new Error(`${failedInitializer} initialization failed`);
    let resolveSibling: (() => void) | undefined;
    const pendingInitializer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSibling = resolve;
        })
    );
    const destroy = vi.fn().mockResolvedValue(undefined);
    const startup =
      failedInitializer === 'sync'
        ? vi.fn().mockRejectedValue(initializationFailure)
        : pendingInitializer;
    const initRustCrypto =
      failedInitializer === 'rust'
        ? vi.fn().mockRejectedValue(initializationFailure)
        : pendingInitializer;
    vi.mocked(IndexedDBStore).mockImplementation(
      () =>
        ({
          startup,
          destroy,
        } as unknown as IndexedDBStore)
    );
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({} as unknown as IndexedDBCryptoStore)
    );

    const stopClient = vi.fn();
    const setMaxListeners = vi.fn();
    vi.mocked(createMatrixClient).mockReturnValue({
      initRustCrypto,
      setMaxListeners,
      stopClient,
    } as never);

    let rejected = false;
    const initPromise = initClient({
      sessionId,
      baseUrl: 'https://example.com',
      accessToken: 'token',
      userId: '@user:example.com',
      deviceId: 'DEVICE',
    }).catch((error) => {
      rejected = true;
      throw error;
    });

    await vi.waitFor(() => {
      expect(startup).toHaveBeenCalledTimes(1);
      expect(initRustCrypto).toHaveBeenCalledTimes(1);
    });
    expect(rejected).toBe(false);
    expect(stopClient).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();

    resolveSibling?.();
    await expect(initPromise).rejects.toBe(initializationFailure);
    expect(stopClient).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(setMaxListeners).not.toHaveBeenCalled();
  });

  it('does not lower a larger existing sync archive limit', async () => {
    const sessionId = createSessionId('https://example.com', '@user:example.com');
    const startup = vi.fn().mockResolvedValue(undefined);
    const syncAccumulator = {
      opts: {
        maxTimelineEntries: 9000,
      },
    };
    vi.mocked(IndexedDBStore).mockImplementation(
      () =>
        ({
          backend: {
            syncAccumulator,
          },
          startup,
        } as unknown as IndexedDBStore)
    );
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({} as unknown as IndexedDBCryptoStore)
    );
    vi.mocked(createMatrixClient).mockReturnValue({
      initRustCrypto: vi.fn().mockResolvedValue(undefined),
      http: { authedRequest: vi.fn().mockResolvedValue({ device_keys: {} }) },
      setMaxListeners: vi.fn(),
    } as never);

    await initClient({
      sessionId,
      baseUrl: 'https://example.com',
      accessToken: 'token',
      userId: '@user:example.com',
      deviceId: 'DEVICE',
    });

    expect(syncAccumulator.opts.maxTimelineEntries).toBe(9000);
  });

  it('refreshes and persists rotated access credentials', async () => {
    const originalLocalStorage = globalThis.localStorage;
    const { storage } = createStorageMock();
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@user:example.com',
        deviceId: 'DEVICE',
        accessToken: 'access-a',
        refreshToken: 'refresh-a',
      },
      undefined,
      storage
    );
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    });

    try {
      vi.mocked(IndexedDBStore).mockImplementation(
        () => ({ startup: vi.fn().mockResolvedValue(undefined) } as unknown as IndexedDBStore)
      );
      vi.mocked(IndexedDBCryptoStore).mockImplementation(
        () => ({} as unknown as IndexedDBCryptoStore)
      );

      const refreshToken = vi.fn().mockResolvedValue({
        access_token: 'access-b',
        refresh_token: 'refresh-b',
        expires_in_ms: 60_000,
      });
      const refreshClient = { refreshToken };
      const matrixClient = {
        initRustCrypto: vi.fn().mockResolvedValue(undefined),
        http: { authedRequest: vi.fn().mockResolvedValue({ device_keys: {} }) },
        setMaxListeners: vi.fn(),
      };
      vi.mocked(createMatrixClient)
        .mockReturnValueOnce(refreshClient as never)
        .mockReturnValueOnce(matrixClient as never);

      await initClient(session);

      expect(vi.mocked(createMatrixClient)).toHaveBeenNthCalledWith(1, {
        baseUrl: session.baseUrl,
        localTimeoutMs: TOKEN_REFRESH_TIMEOUT_MS,
      });
      const clientOptions = vi.mocked(createMatrixClient).mock.calls[1]?.[0];
      expect(clientOptions).toEqual(
        expect.objectContaining({
          accessToken: 'access-a',
          refreshToken: 'refresh-a',
          tokenRefreshFunction: expect.any(Function),
        })
      );

      const tokens = await clientOptions?.tokenRefreshFunction?.('refresh-a');

      expect(refreshToken).toHaveBeenCalledWith('refresh-a');
      expect(tokens).toEqual(
        expect.objectContaining({
          accessToken: 'access-b',
          refreshToken: 'refresh-b',
          expiry: expect.any(Date),
        })
      );
      expect(getSessionStore(storage).sessions[0]).toEqual(
        expect.objectContaining({
          accessToken: 'access-b',
          refreshToken: 'refresh-b',
          expiresInMs: 60_000,
        })
      );

      vi.mocked(storage.setItem).mockImplementationOnce(() => {
        throw new Error('blocked storage');
      });
      refreshToken.mockResolvedValueOnce({
        access_token: 'access-c',
        refresh_token: 'refresh-c',
      });
      const tokensWhileStorageBlocked = await clientOptions?.tokenRefreshFunction?.('refresh-b');

      expect(tokensWhileStorageBlocked).toEqual({
        accessToken: 'access-c',
        refreshToken: 'refresh-c',
        expiry: undefined,
      });
      expect(getSessionStore(storage).sessions[0]).toEqual(
        expect.objectContaining({
          accessToken: 'access-b',
          refreshToken: 'refresh-b',
        })
      );

      refreshToken.mockResolvedValueOnce({ access_token: 'access-d' });
      const tokensAfterStorageRecovery = await clientOptions?.tokenRefreshFunction?.('refresh-c');

      expect(tokensAfterStorageRecovery).toEqual({
        accessToken: 'access-d',
        refreshToken: 'refresh-c',
        expiry: undefined,
      });
      expect(getSessionStore(storage).sessions[0]).toEqual(
        expect.objectContaining({
          accessToken: 'access-d',
          refreshToken: 'refresh-c',
          expiresInMs: undefined,
        })
      );
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalLocalStorage,
      });
    }
  });
});

describe('startClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('seeds SDK versions and feature support without requesting /versions', async () => {
    const { storage } = createStorageMock();
    vi.stubGlobal('localStorage', storage);
    writeCachedSpecVersions('https://example.com', '@user:example.com', {
      versions: ['v1.4'],
      unstable_features: {},
    });
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>(() => {
          // Keep unrelated startup requests pending until the client stops.
        })
    );
    const mx = createSdkClient({
      baseUrl: 'https://example.com',
      accessToken: 'token',
      userId: '@user:example.com',
      fetchFn: fetchFn as typeof fetch,
    });

    try {
      await startClient(mx);

      expect(
        fetchFn.mock.calls.some(([input]) => String(input).includes('/_matrix/client/versions'))
      ).toBe(false);
      expect(mx.canSupport.get(Feature.ThreadUnreadNotifications)).toBe(ServerSupport.Stable);
    } finally {
      mx.stopClient();
    }
  });

  it('starts syncing with a bounded timeline, lazy-loaded members and live reply frames', async () => {
    const matrixStartClient = vi.fn().mockResolvedValue(undefined);
    const mx = {
      baseUrl: 'https://example.com',
      canSupport: new Map([[Feature.ThreadUnreadNotifications, ServerSupport.Stable]]),
      getUserId: vi.fn(() => '@user:example.com'),
      startClient: matrixStartClient,
    } as unknown as Parameters<typeof startClient>[0];

    await startClient(mx);

    expect(matrixStartClient).toHaveBeenCalledTimes(1);
    const startOptions = matrixStartClient.mock.calls[0][0];

    expect(startOptions).toMatchObject({
      lazyLoadMembers: true,
      threadSupport: true,
    });
    expect(startOptions.filter.getDefinition()).toMatchObject({
      room: {
        timeline: {
          limit: STARTUP_SYNC_TIMELINE_LIMIT,
        },
        state: {
          lazy_load_members: true,
        },
        ephemeral: {
          types: ['m.typing', 'm.receipt', 'io.mindroom.live'],
        },
      },
    });
  });

  it('does not seed another account versions on the same homeserver', async () => {
    const { storage } = createStorageMock();
    vi.stubGlobal('localStorage', storage);
    writeCachedSpecVersions('https://example.com', '@alice:example.com', {
      versions: ['v1.4'],
    });
    const matrixStartClient = vi.fn().mockResolvedValue(undefined);
    const existingSupport = new Map([
      [Feature.ThreadUnreadNotifications, ServerSupport.Unsupported],
    ]);
    const mx = {
      baseUrl: 'https://example.com',
      canSupport: existingSupport,
      getUserId: vi.fn(() => '@bob:example.com'),
      startClient: matrixStartClient,
    } as unknown as Parameters<typeof startClient>[0];

    await startClient(mx);

    expect(mx.canSupport).toBe(existingSupport);
    expect(matrixStartClient).toHaveBeenCalledTimes(1);
    expect(
      (mx as unknown as { serverVersionsPromise?: Promise<unknown> }).serverVersionsPromise
    ).toBeUndefined();
  });
});

describe('clearAllCacheAndReload', () => {
  const originalIndexedDB = globalThis.indexedDB;
  const originalLocalStorage = globalThis.localStorage;
  const originalNavigator = globalThis.navigator;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalWindow = globalThis.window;
  const originalBasePath = (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__;

  it.each([true, false])(
    'preserves encryption databases and their contents while clearing caches (enumeration: %s)',
    async (canEnumerate) => {
      const idb = new IDBFactory();
      const { storage } = createStorageMock();
      const active = putSession(
        {
          baseUrl: 'https://example.com',
          userId: '@alice:example.com',
          deviceId: 'A',
          accessToken: 'a',
        },
        undefined,
        storage
      );
      const inactive = putSession(
        {
          baseUrl: 'https://example.com',
          userId: '@bob:example.com',
          deviceId: 'B',
          accessToken: 'b',
        },
        { setActive: false },
        storage
      );
      const cryptoNames = [active, inactive].flatMap((session) => [
        ...getSessionRustCryptoStoreNames(session),
        ...getLegacySessionRustCryptoStoreNames(session),
        getSessionIndexedDbStoreName(session).crypto,
      ]);
      const cacheNames = [
        getSessionIndexedDbStoreName(active).sync,
        getSessionIndexedDbStoreName(inactive).sync,
        getRoomEventCacheDbName(active.sessionId),
      ];
      await Promise.all(
        [...cryptoNames, ...cacheNames].map(
          (name) =>
            new Promise<void>((resolve, reject) => {
              const request = idb.open(name, 1);
              request.onupgradeneeded = () => {
                request.result.createObjectStore('data').put(`original-${name}`, 'identity');
              };
              request.onsuccess = () => {
                request.result.close();
                resolve();
              };
              request.onerror = () => reject(request.error);
            })
        )
      );
      const listDatabases = idb.databases.bind(idb);
      if (!canEnumerate) Object.defineProperty(idb, 'databases', { value: undefined });
      Object.defineProperty(globalThis, 'indexedDB', { value: idb, configurable: true });
      Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: createStorageMock().storage,
        configurable: true,
      });
      Object.defineProperty(globalThis, 'window', {
        value: { location: { origin: 'https://example.com', replace: vi.fn() } },
        configurable: true,
      });

      await clearAllCacheAndReload();

      expect((await listDatabases()).map(({ name }) => name).sort()).toEqual(
        [...cryptoNames].sort()
      );
      await Promise.all(
        cryptoNames.map(
          (name) =>
            new Promise<void>((resolve, reject) => {
              const request = idb.open(name);
              request.onsuccess = () => {
                const db = request.result;
                const read = db.transaction('data').objectStore('data').get('identity');
                read.onsuccess = () => {
                  try {
                    expect(read.result).toBe(`original-${name}`);
                    resolve();
                  } catch (error) {
                    reject(error);
                  }
                  db.close();
                };
                read.onerror = () => {
                  db.close();
                  reject(read.error);
                };
              };
              request.onerror = () => reject(request.error);
            })
        )
      );
      expect(getSessionStore(storage).sessions.map(({ deviceId }) => deviceId)).toEqual(['A', 'B']);
    }
  );

  afterEach(() => {
    vi.restoreAllMocks();
    (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__ = originalBasePath;

    if (originalIndexedDB === undefined) {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    } else {
      Object.defineProperty(globalThis, 'indexedDB', {
        value: originalIndexedDB,
        configurable: true,
      });
    }

    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      });
    }

    if (originalNavigator === undefined) {
      Reflect.deleteProperty(globalThis, 'navigator');
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }

    if (originalSessionStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'sessionStorage');
    } else {
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: originalSessionStorage,
        configurable: true,
      });
    }

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }
  });

  it('clears app-owned localStorage while preserving sessions and unrelated origin data', async () => {
    (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__ = '/mindroom';
    vi.spyOn(Date, 'now').mockReturnValue(1234);

    const { state: localStorageState, storage: localStorageMock } = createStorageMock();
    const { state: sessionStorageState, storage: sessionStorageMock } = createStorageMock({
      transient: 'value',
    });
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      localStorageMock
    );
    const preservedSessionStore = localStorageMock.getItem(SESSION_STORE_KEY);

    localStorageMock.setItem('settings', 'settings');
    localStorageMock.setItem('after_login_redirect_url', '/room');
    localStorageMock.setItem(MINDROOM_EDIT_DEBUG_STORAGE_KEY, '1');
    localStorageMock.setItem('i18nextLng', 'en');
    localStorageMock.setItem('kb-color-mode', 'dark');
    localStorageMock.setItem('cinny_access_token', 'legacy-token');
    localStorageMock.setItem(`navToActivePath${session.userId}`, '/room');
    localStorageMock.setItem(`mindroom_ios_push_token::${session.sessionId}`, 'push-token');
    localStorageMock.setItem('mx_pending_events_!room:example.com', 'pending');
    localStorageMock.setItem('mxjssdk_memory_filter_sync', 'filter');
    localStorageMock.setItem('crypto.account', 'crypto');
    localStorageMock.setItem('third_party_key', 'keep');

    const unregisterApp = vi.fn().mockResolvedValue(true);
    const unregisterOther = vi.fn().mockResolvedValue(true);
    const getRegistrations = vi.fn().mockResolvedValue([
      {
        scope: 'https://example.com/mindroom/',
        active: { scriptURL: 'https://example.com/mindroom/sw.js' },
        installing: null,
        waiting: null,
        unregister: unregisterApp,
      },
      {
        scope: 'https://example.com/other/',
        active: { scriptURL: 'https://example.com/other/sw.js' },
        installing: null,
        waiting: null,
        unregister: unregisterOther,
      },
    ] as unknown as ServiceWorkerRegistration[]);

    const appRequest = { url: 'https://example.com/mindroom/assets/index.js' } as Request;
    const otherRequest = { url: 'https://example.com/other/assets/index.js' } as Request;
    const appCache = {
      keys: vi
        .fn()
        .mockResolvedValueOnce([appRequest, otherRequest])
        .mockResolvedValueOnce([otherRequest]),
      delete: vi.fn().mockResolvedValue(true),
    };
    const otherCache = {
      keys: vi.fn().mockResolvedValueOnce([otherRequest]).mockResolvedValueOnce([otherRequest]),
      delete: vi.fn().mockResolvedValue(false),
    };
    const cacheStorage = {
      keys: vi.fn().mockResolvedValue(['cache-a', 'cache-b']),
      open: vi.fn().mockImplementation((cacheName: string) => {
        if (cacheName === 'cache-a') return Promise.resolve(appCache as unknown as Cache);
        return Promise.resolve(otherCache as unknown as Cache);
      }),
      delete: vi.fn().mockResolvedValue(true),
    };
    const replace = vi.fn();
    const deleteDatabase = createDeleteDatabaseMock();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: sessionStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          getRegistrations,
        },
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        databases: vi.fn().mockResolvedValue([]),
        deleteDatabase,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://example.com',
          replace,
        },
        caches: cacheStorage,
      },
      configurable: true,
    });

    const stopClient = vi.fn();

    await clearAllCacheAndReload({
      getDeviceId: vi.fn().mockReturnValue(undefined),
      getHomeserverUrl: vi.fn().mockReturnValue(session.baseUrl),
      getSafeUserId: vi.fn().mockReturnValue(session.userId),
      stopClient,
    } as never);

    expect(stopClient).toHaveBeenCalledTimes(1);
    expect(vi.mocked(clearSecretStorageKeys)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(clearMindroomLongTextHydrationCache)).toHaveBeenCalledTimes(1);
    expect(unregisterApp).toHaveBeenCalledTimes(1);
    expect(unregisterOther).not.toHaveBeenCalled();
    expect(appCache.delete).toHaveBeenCalledWith(appRequest);
    expect(otherCache.delete).not.toHaveBeenCalled();
    expect(cacheStorage.delete).not.toHaveBeenCalled();
    expect(localStorageMock.clear).not.toHaveBeenCalled();
    expect(sessionStorageMock.clear).toHaveBeenCalledTimes(1);
    expect(sessionStorageState.size).toBe(0);
    expect(localStorageState.get(SESSION_STORE_KEY)).toBe(preservedSessionStore);
    expect(localStorageState.get('third_party_key')).toBe('keep');
    expect(localStorageState.get('settings')).toBe('settings');
    expect(localStorageState.get('after_login_redirect_url')).toBe('/room');
    expect(localStorageState.get(MINDROOM_EDIT_DEBUG_STORAGE_KEY)).toBe('1');
    expect(localStorageState.get('i18nextLng')).toBe('en');
    expect(localStorageState.get('kb-color-mode')).toBe('dark');
    expect(localStorageState.has('cinny_access_token')).toBe(false);
    expect(localStorageState.get(`navToActivePath${session.userId}`)).toBe('/room');
    expect(localStorageState.get(`mindroom_ios_push_token::${session.sessionId}`)).toBe(
      'push-token'
    );
    expect(localStorageState.has('mx_pending_events_!room:example.com')).toBe(false);
    expect(localStorageState.has('mxjssdk_memory_filter_sync')).toBe(false);
    expect(localStorageState.get('crypto.account')).toBe('crypto');
    expect(replace).toHaveBeenCalledWith('/mindroom/?clear_cache=1234');
  });

  it('collects session and event caches without deleting encryption stores from indexedDB.databases()', async () => {
    const { storage: localStorageMock } = createStorageMock();
    const { storage: sessionStorageMock } = createStorageMock();

    const activeSession = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      localStorageMock
    );
    const inactiveSession = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@bob:example.com',
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
      },
      { setActive: false },
      localStorageMock
    );
    localStorageMock.setItem(LEGACY_SESSION_STORAGE_KEYS[0], 'legacy-token');

    const liveSession = {
      sessionId: createSessionId('https://example.com', '@carol:example.com'),
      userId: '@carol:example.com',
      deviceId: 'DEVICE_C',
    };

    const deleteDatabase = createDeleteDatabaseMock();
    const indexedDbMock = {
      databases: vi.fn().mockResolvedValue([
        { name: getSessionIndexedDbStoreName(activeSession).sync },
        { name: getSessionIndexedDbStoreName(inactiveSession).crypto },
        { name: getSessionRustCryptoStoreNames(inactiveSession)[0] },
        { name: getLegacySessionRustCryptoStoreNames(activeSession)[1] },
        { name: getThreadEventCacheDbName(activeSession.sessionId) },
        { name: getRoomEventCacheDbName(inactiveSession.sessionId) },
        { name: getSessionIndexedDbStoreName(liveSession).sync },
        { name: getThreadEventCacheDbName(liveSession.sessionId) },
        // Saved canvas state is the user's data, so clearing caches keeps it.
        { name: getCanvasStateDbName(activeSession.sessionId) },
        { name: 'matrix-js-sdk:web-sync-store' },
        { name: 'crypto-store' },
        { name: 'matrix-js-sdk::matrix-sdk-crypto' },
        { name: 'matrix-js-sdk::matrix-sdk-crypto-meta' },
        { name: 'unrelated-db' },
      ]),
      deleteDatabase,
    };
    const replace = vi.fn();
    vi.spyOn(Date, 'now').mockReturnValue(5678);

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: sessionStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: indexedDbMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://example.com',
          replace,
        },
      },
      configurable: true,
    });

    await clearAllCacheAndReload({
      getDeviceId: vi.fn().mockReturnValue(liveSession.deviceId),
      getHomeserverUrl: vi.fn().mockReturnValue('https://example.com'),
      getSafeUserId: vi.fn().mockReturnValue(liveSession.userId),
      stopClient: vi.fn(),
    } as never);

    expect(deleteDatabase.mock.calls.map(([name]) => name)).toEqual([
      getSessionIndexedDbStoreName(activeSession).sync,
      getThreadEventCacheDbName(activeSession.sessionId),
      getRoomEventCacheDbName(inactiveSession.sessionId),
      getSessionIndexedDbStoreName(liveSession).sync,
      getThreadEventCacheDbName(liveSession.sessionId),
      'matrix-js-sdk:web-sync-store',
    ]);
    expect(replace).toHaveBeenCalledWith('/?clear_cache=5678');
  });

  it('falls back to known app-owned IndexedDB names when indexedDB.databases() is unavailable', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(6789);
    const { storage: localStorageMock } = createStorageMock();
    const { storage: sessionStorageMock } = createStorageMock();
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      localStorageMock
    );
    localStorageMock.setItem(LEGACY_SESSION_STORAGE_KEYS[0], 'legacy-token');

    const deleteDatabase = createDeleteDatabaseMock();
    const replace = vi.fn();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: sessionStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        deleteDatabase,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://example.com',
          replace,
        },
      },
      configurable: true,
    });

    await clearAllCacheAndReload();

    expect(deleteDatabase.mock.calls.map(([name]) => name)).toEqual([
      'mindroom-room-event-cache',
      'mindroom-thread-event-cache',
      // CINNY-207 P2.1 (D8): unified `mindroom-cache` singleton +
      // session-scoped name are also listed in the fallback.
      'mindroom-cache',
      'matrix-js-sdk:web-sync-store',
      getSessionIndexedDbStoreName(session).sync,
      getThreadEventCacheDbName(session.sessionId),
      getRoomEventCacheDbName(session.sessionId),
      getThreadSummaryCacheDbName(session.sessionId),
      `mindroom-cache::${session.sessionId}`,
    ]);
    expect(replace).toHaveBeenCalledWith('/?clear_cache=6789');
  });

  it('preserves existing app-base query params when adding the cache-busting query', async () => {
    (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__ = '/mindroom?client=web';
    vi.spyOn(Date, 'now').mockReturnValue(7890);

    const { storage: localStorageMock } = createStorageMock();
    const { storage: sessionStorageMock } = createStorageMock();
    const replace = vi.fn();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: sessionStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://example.com',
          replace,
        },
      },
      configurable: true,
    });

    await clearAllCacheAndReload();

    expect(replace).toHaveBeenCalledWith('/mindroom/?client=web&clear_cache=7890');
  });

  it('does not hang when IndexedDB delete requests are blocked', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(8901);
    const { storage: localStorageMock } = createStorageMock();
    const { storage: sessionStorageMock } = createStorageMock();
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      localStorageMock
    );

    const blockedName = getSessionIndexedDbStoreName(session).sync;
    const deleteDatabase = createDeleteDatabaseMock({
      blockedNames: new Set([blockedName]),
    });
    const replace = vi.fn();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: sessionStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        databases: vi.fn().mockResolvedValue([{ name: blockedName }]),
        deleteDatabase,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://example.com',
          replace,
        },
      },
      configurable: true,
    });

    await clearAllCacheAndReload();

    expect(deleteDatabase).toHaveBeenCalledWith(blockedName);
    expect(replace).toHaveBeenCalledWith('/?clear_cache=8901');
  });

  it('continues to later cleanup steps when earlier steps fail', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(9012);
    const { storage: localStorageMock } = createStorageMock({
      settings: 'settings',
    });
    const { storage: sessionStorageMock } = createStorageMock({
      transient: 'value',
    });
    localStorageMock.setItem(LEGACY_SESSION_STORAGE_KEYS[0], 'legacy-token');

    vi.mocked(clearSecretStorageKeys).mockImplementation(() => {
      throw new Error('secret storage failure');
    });

    localStorageMock.removeItem = vi.fn(() => {
      throw new Error('localStorage failure');
    }) as Storage['removeItem'];

    const deleteDatabase = createDeleteDatabaseMock({
      errorNames: new Map([['mindroom-room-event-cache', new Error('delete failure')]]),
    });
    const replace = vi.fn();
    const getRegistrations = vi.fn().mockRejectedValue(new Error('service worker failure'));
    const cacheStorage = {
      keys: vi.fn().mockRejectedValue(new Error('cache failure')),
    };
    const stopClient = vi.fn(() => {
      throw new Error('stop failure');
    });

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: sessionStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          getRegistrations,
        },
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        deleteDatabase,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://example.com',
          replace,
        },
        caches: cacheStorage,
      },
      configurable: true,
    });

    await clearAllCacheAndReload({
      getDeviceId: vi.fn().mockReturnValue(undefined),
      getHomeserverUrl: vi.fn().mockReturnValue('https://example.com'),
      getSafeUserId: vi.fn().mockReturnValue('@alice:example.com'),
      stopClient,
    } as never);

    expect(getRegistrations).toHaveBeenCalledTimes(1);
    expect(cacheStorage.keys).toHaveBeenCalledTimes(1);
    expect(deleteDatabase).toHaveBeenCalledWith('mindroom-room-event-cache');
    expect(localStorageMock.clear).not.toHaveBeenCalled();
    expect(sessionStorageMock.clear).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/?clear_cache=9012');
  });
});

describe('logoutClient', () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalIndexedDB = globalThis.indexedDB;
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      });
    }

    if (originalIndexedDB === undefined) {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    } else {
      Object.defineProperty(globalThis, 'indexedDB', {
        value: originalIndexedDB,
        configurable: true,
      });
    }

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }
  });

  it('clears the current session-scoped rust crypto store when the stored session is unavailable', async () => {
    const storageState = new Map<string, string>(
      LEGACY_SESSION_STORAGE_KEYS.map((key) => [key, `legacy-${key}`])
    );
    const localStorageMock = {
      getItem: vi.fn((key: string) => storageState.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storageState.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storageState.delete(key);
      }),
    };
    const deleteDatabase = vi.fn(() => {
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        request.onsuccess?.({} as Event);
      });
      return request;
    });
    const reload = vi.fn();
    const userId = '@alice:example.com';
    const deviceId = 'DEVICE_A';
    const sessionId = createSessionId('https://example.com', userId);

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        deleteDatabase,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: {
          reload,
        },
      },
      configurable: true,
    });

    const stopClient = vi.fn();
    const logout = vi.fn().mockResolvedValue(undefined);
    const clearStores = vi.fn().mockResolvedValue(undefined);
    const getSafeUserId = vi.fn().mockReturnValue(userId);
    const getHomeserverUrl = vi.fn().mockReturnValue('https://example.com');
    const getDeviceId = vi.fn().mockReturnValue(deviceId);

    await logoutClient({
      clearStores,
      getDeviceId,
      getHomeserverUrl,
      getSafeUserId,
      logout,
      stopClient,
    } as never);

    expect(logout).toHaveBeenCalledTimes(1);
    expect(clearStores).toHaveBeenCalledWith({
      cryptoDatabasePrefix: getSessionRustCryptoStorePrefix({
        sessionId,
        deviceId,
      }),
    });
    const legacyRustCryptoStoreNames = getLegacySessionRustCryptoStoreNames({ sessionId });
    expect(deleteDatabase).toHaveBeenCalledWith(legacyRustCryptoStoreNames[0]);
    expect(deleteDatabase).toHaveBeenCalledWith(legacyRustCryptoStoreNames[1]);
    // CINNY-207 P2.3: the three legacy delete-cache functions collapsed
    // to a single deleteCacheStoreDb call inside sessionCleanup; the
    // legacy per-session DB names are also deleted via
    // indexedDB.deleteDatabase directly (see the deleteDatabase mock).
    expect(vi.mocked(deleteCacheStoreDb)).toHaveBeenCalledWith(sessionId);
    expect(vi.mocked(clearRecentThreadsStore)).toHaveBeenCalledWith(userId);
    expect(vi.mocked(clearRecentThreadViewModelSharedState)).not.toHaveBeenCalled();
    expect(vi.mocked(clearIOSPushState)).toHaveBeenCalledWith(sessionId);
    LEGACY_SESSION_STORAGE_KEYS.forEach((key) => {
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(key);
      expect(storageState.has(key)).toBe(false);
    });
    expect(stopClient).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("deletes the account's saved canvas state when the client has no device ID", async () => {
    const { storage: localStorageMock } = createStorageMock();
    const deleteDatabase = createDeleteDatabaseMock();
    const reload = vi.fn();
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: { deleteDatabase },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: { reload },
      },
      configurable: true,
    });

    await removeCurrentClientSessionAndReload({
      clearStores: vi.fn().mockResolvedValue(undefined),
      getDeviceId: vi.fn().mockReturnValue(undefined),
      getHomeserverUrl: vi.fn().mockReturnValue('https://example.com'),
      getSafeUserId: vi.fn().mockReturnValue('@alice:example.com'),
      stopClient: vi.fn(),
    } as never);

    expect(deleteDatabase).toHaveBeenCalledWith(
      getCanvasStateDbName(createSessionId('https://example.com', '@alice:example.com'))
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('cleans the mounted client account without removing a different active account', async () => {
    const { storage: localStorageMock } = createStorageMock();
    const mountedSession = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      localStorageMock
    );
    const activeSession = putSession(
      {
        baseUrl: 'https://matrix.org',
        userId: mountedSession.userId,
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
      },
      undefined,
      localStorageMock
    );
    const deleteDatabase = createDeleteDatabaseMock();
    const reload = vi.fn();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    writeCachedSpecVersions(mountedSession.baseUrl, mountedSession.userId, {
      versions: ['v1.10'],
    });
    writeCachedSpecVersions(activeSession.baseUrl, activeSession.userId, {
      versions: ['v1.11'],
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        databases: vi.fn().mockResolvedValue([]),
        deleteDatabase,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: { reload },
      },
      configurable: true,
    });

    const clearStores = vi.fn().mockResolvedValue(undefined);
    await logoutClient({
      clearStores,
      getDeviceId: vi.fn(() => mountedSession.deviceId),
      getHomeserverUrl: vi.fn(() => mountedSession.baseUrl),
      getSafeUserId: vi.fn(() => mountedSession.userId),
      logout: vi.fn().mockResolvedValue(undefined),
      stopClient: vi.fn(),
    } as never);

    expect(clearStores).toHaveBeenCalledWith({
      cryptoDatabasePrefix: getSessionRustCryptoStorePrefix(mountedSession),
    });
    expect(vi.mocked(deleteCacheStoreDb)).toHaveBeenCalledWith(mountedSession.sessionId);
    expect(vi.mocked(deleteCacheStoreDb)).not.toHaveBeenCalledWith(activeSession.sessionId);
    expect(getSessionStore(localStorageMock).sessions.map(({ sessionId }) => sessionId)).toEqual([
      activeSession.sessionId,
    ]);
    expect(getSessionStore(localStorageMock).activeSessionId).toBe(activeSession.sessionId);
    expect(readCachedSpecVersions(mountedSession.baseUrl, mountedSession.userId)).toBeUndefined();
    expect(readCachedSpecVersions(activeSession.baseUrl, activeSession.userId)).toEqual({
      versions: ['v1.11'],
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps a same-account re-login on a newer device when the replaced device is logged out', async () => {
    vi.mocked(deleteCacheStoreDb).mockClear();
    const { storage: localStorageMock } = createStorageMock();
    const replacedSession = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_OLD',
        accessToken: 'token-old',
      },
      undefined,
      localStorageMock
    );
    const reloggedSession = putSession(
      {
        baseUrl: replacedSession.baseUrl,
        userId: replacedSession.userId,
        deviceId: 'DEVICE_NEW',
        accessToken: 'token-new',
      },
      undefined,
      localStorageMock
    );
    const reload = vi.fn();
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        databases: vi.fn().mockResolvedValue([]),
        deleteDatabase: createDeleteDatabaseMock(),
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: { reload },
      },
      configurable: true,
    });
    const clearStores = vi.fn().mockResolvedValue(undefined);
    const stopClient = vi.fn();

    await removeCurrentClientSessionAndReload({
      clearStores,
      getDeviceId: vi.fn(() => 'DEVICE_OLD'),
      getHomeserverUrl: vi.fn(() => replacedSession.baseUrl),
      getSafeUserId: vi.fn(() => replacedSession.userId),
      stopClient,
    } as never);

    expect(stopClient).toHaveBeenCalledTimes(1);
    expect(clearStores).not.toHaveBeenCalled();
    expect(vi.mocked(deleteCacheStoreDb)).not.toHaveBeenCalled();
    expect(getSessionStore(localStorageMock).sessions).toEqual([
      expect.objectContaining({ sessionId: reloggedSession.sessionId, deviceId: 'DEVICE_NEW' }),
    ]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('finishes logout cleanup when legacy localStorage removals are blocked', async () => {
    const { storage: localStorageMock } = createStorageMock();
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      localStorageMock
    );
    localStorageMock.removeItem = vi.fn(() => {
      throw new Error('blocked remove');
    });

    const deleteDatabase = createDeleteDatabaseMock();
    const reload = vi.fn();
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: { deleteDatabase },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: { reload },
      },
      configurable: true,
    });

    const stopClient = vi.fn();
    const clearStores = vi.fn().mockResolvedValue(undefined);
    await logoutClient({
      clearStores,
      getDeviceId: vi.fn(() => session.deviceId),
      getHomeserverUrl: vi.fn(() => session.baseUrl),
      getSafeUserId: vi.fn(() => session.userId),
      logout: vi.fn().mockResolvedValue(undefined),
      stopClient,
    } as never);

    expect(stopClient).toHaveBeenCalled();
    expect(clearStores).toHaveBeenCalled();
    expect(vi.mocked(deleteCacheStoreDb)).toHaveBeenCalledWith(session.sessionId);
    expect(vi.mocked(clearRecentThreadsStore)).toHaveBeenCalledWith(session.userId);
    expect(vi.mocked(clearIOSPushState)).toHaveBeenCalledWith(session.sessionId);
    expect(localStorageMock.removeItem).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps local account data intact when credential removal cannot be committed', async () => {
    const { storage: localStorageMock } = createStorageMock();
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      localStorageMock
    );
    localStorageMock.setItem = vi.fn(() => {
      throw new Error('blocked write');
    });

    const reload = vi.fn();
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: { deleteDatabase: createDeleteDatabaseMock() },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: { reload },
      },
      configurable: true,
    });

    const stopClient = vi.fn();
    const clearStores = vi.fn().mockResolvedValue(undefined);
    await expect(
      logoutClient({
        clearStores,
        getDeviceId: vi.fn(() => session.deviceId),
        getHomeserverUrl: vi.fn(() => session.baseUrl),
        getSafeUserId: vi.fn(() => session.userId),
        logout: vi.fn().mockResolvedValue(undefined),
        stopClient,
      } as never)
    ).rejects.toBeInstanceOf(SessionStoreWriteError);

    expect(stopClient).toHaveBeenCalled();
    expect(clearStores).not.toHaveBeenCalled();
    expect(vi.mocked(deleteCacheStoreDb)).not.toHaveBeenCalled();
    expect(vi.mocked(clearRecentThreadsStore)).not.toHaveBeenCalled();
    expect(vi.mocked(clearIOSPushState)).not.toHaveBeenCalled();
    expect(getSessionStore(localStorageMock).sessions).toEqual([session]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('continues logout when one cache database cannot be deleted', async () => {
    const { storage: localStorageMock } = createStorageMock();
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      localStorageMock
    );
    vi.mocked(deleteCacheStoreDb).mockRejectedValueOnce(new Error('blocked cache database'));

    const reload = vi.fn();
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: { deleteDatabase: createDeleteDatabaseMock() },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: { reload },
      },
      configurable: true,
    });

    const clearStores = vi.fn().mockResolvedValue(undefined);
    await logoutClient({
      clearStores,
      getDeviceId: vi.fn(() => session.deviceId),
      getHomeserverUrl: vi.fn(() => session.baseUrl),
      getSafeUserId: vi.fn(() => session.userId),
      logout: vi.fn().mockResolvedValue(undefined),
      stopClient: vi.fn(),
    } as never);

    expect(clearStores).toHaveBeenCalled();
    expect(vi.mocked(clearRecentThreadsStore)).toHaveBeenCalledWith(session.userId);
    expect(vi.mocked(clearIOSPushState)).toHaveBeenCalledWith(session.sessionId);
    expect(getSessionStore(localStorageMock).sessions).toHaveLength(0);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('removeStoredSession', () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalIndexedDB = globalThis.indexedDB;
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      });
    }

    if (originalIndexedDB === undefined) {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    } else {
      Object.defineProperty(globalThis, 'indexedDB', {
        value: originalIndexedDB,
        configurable: true,
      });
    }

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }
  });

  it('keeps an inactive account intact when its registry removal is blocked', async () => {
    vi.clearAllMocks();
    const { storage: localStorageMock } = createStorageMock();
    const activeSession = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      localStorageMock
    );
    const inactiveSession = putSession(
      {
        baseUrl: 'https://matrix.org',
        userId: '@bob:matrix.org',
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
      },
      { setActive: false },
      localStorageMock
    );
    localStorageMock.setItem = vi.fn(() => {
      throw new Error('blocked write');
    });
    const deleteDatabase = createDeleteDatabaseMock();
    const reload = vi.fn();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: { databases: vi.fn().mockResolvedValue([]), deleteDatabase },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: { reload },
      },
      configurable: true,
    });

    await expect(removeStoredSession(inactiveSession)).rejects.toBeInstanceOf(
      SessionStoreWriteError
    );

    expect(deleteDatabase).not.toHaveBeenCalled();
    expect(vi.mocked(deleteCacheStoreDb)).not.toHaveBeenCalled();
    expect(vi.mocked(clearRecentThreadsStore)).not.toHaveBeenCalled();
    expect(vi.mocked(clearIOSPushState)).not.toHaveBeenCalled();
    expect(getSessionStore(localStorageMock).sessions).toEqual([activeSession, inactiveSession]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('removes an inactive account without reloading the active one', async () => {
    const storageState = new Map<string, string>();
    const localStorageMock = {
      getItem: vi.fn((key: string) => storageState.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storageState.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storageState.delete(key);
      }),
    };
    const deleteDatabase = vi.fn(() => {
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        request.onsuccess?.({} as Event);
      });
      return request;
    });
    const databases = vi.fn().mockResolvedValue([]);
    const reload = vi.fn();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        databases,
        deleteDatabase,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: {
          reload,
        },
      },
      configurable: true,
    });

    const activeSession = putSession({
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
    });
    const inactiveSession = putSession(
      {
        baseUrl: 'https://matrix.org',
        userId: '@bob:matrix.org',
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
      },
      { setActive: false }
    );

    const previousDeviceRustCryptoStoreNames = getSessionRustCryptoStoreNames({
      ...inactiveSession,
      deviceId: 'DEVICE_OLD',
    });
    databases.mockResolvedValue(previousDeviceRustCryptoStoreNames.map((name) => ({ name })));

    await removeStoredSession(inactiveSession);

    const indexedDbStoreNames = getSessionIndexedDbStoreName(inactiveSession);
    expect(deleteDatabase).toHaveBeenCalledWith(indexedDbStoreNames.sync);
    expect(deleteDatabase).toHaveBeenCalledWith(indexedDbStoreNames.crypto);
    const rustCryptoStoreNames = getSessionRustCryptoStoreNames(inactiveSession);
    expect(deleteDatabase).toHaveBeenCalledWith(rustCryptoStoreNames[0]);
    expect(deleteDatabase).toHaveBeenCalledWith(rustCryptoStoreNames[1]);
    const legacyRustCryptoStoreNames = getLegacySessionRustCryptoStoreNames(inactiveSession);
    expect(deleteDatabase).toHaveBeenCalledWith(legacyRustCryptoStoreNames[0]);
    expect(deleteDatabase).toHaveBeenCalledWith(legacyRustCryptoStoreNames[1]);
    expect(deleteDatabase).toHaveBeenCalledWith(previousDeviceRustCryptoStoreNames[0]);
    expect(deleteDatabase).toHaveBeenCalledWith(previousDeviceRustCryptoStoreNames[1]);
    expect(deleteDatabase).toHaveBeenCalledWith(getCanvasStateDbName(inactiveSession.sessionId));
    // CINNY-207 P2.3: the three legacy delete-cache functions collapsed
    // to a single deleteCacheStoreDb call inside sessionCleanup; the
    // legacy per-session DB names are also deleted via
    // indexedDB.deleteDatabase directly (see the deleteDatabase mock).
    expect(vi.mocked(deleteCacheStoreDb)).toHaveBeenCalledWith(inactiveSession.sessionId);
    expect(vi.mocked(clearRecentThreadsStore)).toHaveBeenCalledWith(inactiveSession.userId);
    expect(vi.mocked(clearRecentThreadViewModelSharedState)).not.toHaveBeenCalled();
    expect(vi.mocked(clearIOSPushState)).toHaveBeenCalledWith(inactiveSession.sessionId);
    expect(getSessionStore().sessions.map((session) => session.sessionId)).toEqual([
      activeSession.sessionId,
    ]);
    expect(getSessionStore().activeSessionId).toBe(activeSession.sessionId);
    expect(reload).not.toHaveBeenCalled();
  });

  it('preserves user-scoped UI state when the same MXID remains on another base URL', async () => {
    vi.clearAllMocks();
    const { storage: localStorageMock } = createStorageMock();
    const deleteDatabase = createDeleteDatabaseMock();
    const reload = vi.fn();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: { databases: vi.fn().mockResolvedValue([]), deleteDatabase },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: { reload },
      },
      configurable: true,
    });

    const activeSession = putSession({
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
    });
    const oldProxySession = putSession(
      {
        baseUrl: 'https://proxy.example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
      },
      { setActive: false }
    );

    await removeStoredSession(oldProxySession);

    expect(vi.mocked(deleteCacheStoreDb)).toHaveBeenCalledWith(oldProxySession.sessionId);
    expect(vi.mocked(clearIOSPushState)).toHaveBeenCalledWith(oldProxySession.sessionId);
    expect(vi.mocked(clearRecentThreadsStore)).not.toHaveBeenCalled();
    expect(getSessionStore().sessions).toEqual([activeSession]);
    expect(getSessionStore().activeSessionId).toBe(activeSession.sessionId);
    expect(reload).not.toHaveBeenCalled();
  });
});
