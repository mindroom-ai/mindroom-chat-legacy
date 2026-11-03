import { describe, expect, it, vi } from 'vitest';
import {
  LEGACY_SESSION_STORAGE_KEYS,
  SessionStoreWriteError,
  clearLegacySessionStorage,
  createSessionId,
  getActiveSession,
  getSessionIndexedDbStoreName,
  getLegacySessionRustCryptoStorePrefix,
  getSessionRustCryptoStorePrefix,
  getSessionStore,
  getSessionStoreName,
  getSessionScopedStorageKey,
  hasInitializedCryptoStore,
  hasStoredSessions,
  listSessions,
  markCryptoStoreInitialized,
  putSession,
  removeSession,
  setActiveSession,
  updateSessionProfile,
  updateSessionCredentials,
} from './sessions';

const createStorage = (seed: Record<string, string> = {}) => {
  const state = new Map(Object.entries(seed));

  return {
    getItem: vi.fn((key: string) => state.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      state.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      state.delete(key);
    }),
  };
};

describe('sessions', () => {
  it('creates stable session ids from normalized baseUrl and userId', () => {
    expect(createSessionId('https://example.com/', '@alice:example.com')).toBe(
      createSessionId('https://example.com', '@alice:example.com')
    );
  });

  it('stores and resolves the active session', () => {
    const storage = createStorage();

    const stored = putSession(
      {
        baseUrl: 'https://example.com/',
        userId: '@alice:example.com',
        deviceId: 'DEVICE',
        accessToken: 'token',
      },
      undefined,
      storage
    );

    expect(getActiveSession(storage)).toEqual(stored);
    expect(hasStoredSessions(storage)).toBe(true);
  });

  it('updates an existing account instead of duplicating the same baseUrl + userId', () => {
    const storage = createStorage();

    putSession(
      {
        baseUrl: 'https://example.com/',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
        lastKnownDisplayName: 'Alice',
      },
      undefined,
      storage
    );

    const updated = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
      },
      undefined,
      storage
    );

    const store = getSessionStore(storage);
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]).toEqual(
      expect.objectContaining({
        sessionId: updated.sessionId,
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
        lastKnownDisplayName: 'Alice',
      })
    );
  });

  it('uses a device-scoped rust crypto prefix while keeping the account session id stable', () => {
    const storage = createStorage();

    const initial = putSession(
      {
        baseUrl: 'https://example.com/',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      storage
    );
    const updated = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
      },
      undefined,
      storage
    );

    expect(updated.sessionId).toBe(initial.sessionId);
    expect(getSessionRustCryptoStorePrefix(updated)).not.toBe(
      getSessionRustCryptoStorePrefix(initial)
    );
    expect(getLegacySessionRustCryptoStorePrefix(updated)).toBe(
      getLegacySessionRustCryptoStorePrefix(initial)
    );
  });

  it('marks crypto continuity and resets it when a new Matrix device replaces the login', () => {
    const storage = createStorage();
    const initial = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      storage
    );

    expect(hasInitializedCryptoStore(initial.sessionId, storage)).toBe(false);
    markCryptoStoreInitialized(initial, storage);
    expect(hasInitializedCryptoStore(initial.sessionId, storage)).toBe(true);

    putSession(
      {
        baseUrl: initial.baseUrl,
        userId: initial.userId,
        deviceId: initial.deviceId,
        accessToken: 'token-b',
      },
      undefined,
      storage
    );
    expect(hasInitializedCryptoStore(initial.sessionId, storage)).toBe(true);

    putSession(
      {
        baseUrl: initial.baseUrl,
        userId: initial.userId,
        deviceId: 'DEVICE_B',
        accessToken: 'token-c',
      },
      undefined,
      storage
    );
    expect(hasInitializedCryptoStore(initial.sessionId, storage)).toBe(false);
  });

  it('marks crypto continuity only for the device whose store was opened', () => {
    const storage = createStorage();
    const older = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      storage
    );
    // A newer login replaces the record while a tab still starts the older device.
    const newer = putSession(
      {
        baseUrl: older.baseUrl,
        userId: older.userId,
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
      },
      undefined,
      storage
    );

    markCryptoStoreInitialized(older, storage);
    expect(hasInitializedCryptoStore(newer.sessionId, storage)).toBe(false);

    markCryptoStoreInitialized(newer, storage);
    expect(hasInitializedCryptoStore(newer.sessionId, storage)).toBe(true);
  });

  it('can set a different session active and keeps the session list sorted by lastUsedAt', () => {
    const storage = createStorage();

    const alice = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      storage
    );
    const bob = putSession(
      {
        baseUrl: 'https://matrix.org',
        userId: '@bob:matrix.org',
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
      },
      undefined,
      storage
    );

    const active = setActiveSession(alice.sessionId, storage);

    expect(active?.sessionId).toBe(alice.sessionId);
    expect(getActiveSession(storage)?.sessionId).toBe(alice.sessionId);
    expect(listSessions(storage).map((session) => session.sessionId)).toEqual([
      alice.sessionId,
      bob.sessionId,
    ]);
  });

  it('promotes the most recently used remaining account when removing the active session', () => {
    const storage = createStorage();

    const alice = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      storage
    );
    const bob = putSession(
      {
        baseUrl: 'https://matrix.org',
        userId: '@bob:matrix.org',
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
      },
      undefined,
      storage
    );
    setActiveSession(alice.sessionId, storage);

    const nextStore = removeSession(alice.sessionId, storage);

    expect(nextStore.activeSessionId).toBe(bob.sessionId);
    expect(getActiveSession(storage)?.sessionId).toBe(bob.sessionId);
  });

  it('removes a non-active session without changing the current active session', () => {
    const storage = createStorage();

    const alice = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      storage
    );
    const bob = putSession(
      {
        baseUrl: 'https://matrix.org',
        userId: '@bob:matrix.org',
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
      },
      undefined,
      storage
    );

    setActiveSession(bob.sessionId, storage);
    const nextStore = removeSession(alice.sessionId, storage);

    expect(nextStore.activeSessionId).toBe(bob.sessionId);
    expect(getActiveSession(storage)?.sessionId).toBe(bob.sessionId);
  });

  it('updates cached profile metadata for an existing session', () => {
    const storage = createStorage();

    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      storage
    );

    updateSessionProfile(
      session.sessionId,
      {
        lastKnownDisplayName: 'Alice',
        lastKnownAvatarUrl: 'mxc://example/avatar',
        lastKnownAvatarDataUrl: 'data:image/png;base64,abc',
      },
      storage
    );

    expect(getActiveSession(storage)).toEqual(
      expect.objectContaining({
        lastKnownDisplayName: 'Alice',
        lastKnownAvatarUrl: 'mxc://example/avatar',
        lastKnownAvatarDataUrl: 'data:image/png;base64,abc',
      })
    );
  });

  it('persists a refresh-token rotation without changing account metadata', () => {
    const storage = createStorage();
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
        refreshToken: 'refresh-a',
        lastKnownDisplayName: 'Alice',
      },
      undefined,
      storage
    );

    const updated = updateSessionCredentials(
      session.sessionId,
      {
        accessToken: 'token-b',
        refreshToken: 'refresh-b',
        expiresInMs: 60_000,
      },
      storage
    );

    expect(updated).toEqual(
      expect.objectContaining({
        accessToken: 'token-b',
        refreshToken: 'refresh-b',
        expiresInMs: 60_000,
        lastKnownDisplayName: 'Alice',
        lastUsedAt: session.lastUsedAt,
      })
    );
  });

  it('allows cached profile metadata to be explicitly cleared', () => {
    const storage = createStorage();

    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      storage
    );

    updateSessionProfile(
      session.sessionId,
      {
        lastKnownDisplayName: 'Alice',
        lastKnownAvatarUrl: 'mxc://example/avatar',
        lastKnownAvatarDataUrl: 'data:image/png;base64,abc',
      },
      storage
    );
    updateSessionProfile(
      session.sessionId,
      {
        lastKnownDisplayName: undefined,
        lastKnownAvatarUrl: undefined,
        lastKnownAvatarDataUrl: undefined,
      },
      storage
    );

    expect(getActiveSession(storage)).toEqual(
      expect.objectContaining({
        lastKnownDisplayName: undefined,
        lastKnownAvatarUrl: undefined,
        lastKnownAvatarDataUrl: undefined,
      })
    );
  });

  it('isolates blocked session-storage operations', () => {
    const storage = createStorage();
    storage.setItem.mockImplementation(() => {
      throw new Error('blocked write');
    });

    expect(() =>
      putSession(
        {
          baseUrl: 'https://example.com',
          userId: '@alice:example.com',
          deviceId: 'DEVICE_A',
          accessToken: 'token-a',
        },
        undefined,
        storage
      )
    ).toThrow(SessionStoreWriteError);

    const removed: string[] = [];
    storage.removeItem.mockImplementation((key: string) => {
      if (key === LEGACY_SESSION_STORAGE_KEYS[0]) throw new Error('blocked remove');
      removed.push(key);
    });

    expect(() => clearLegacySessionStorage(storage)).not.toThrow();
    expect(removed).toEqual(LEGACY_SESSION_STORAGE_KEYS.slice(1));
  });

  it('returns session-scoped store names and storage keys', () => {
    const storage = createStorage();
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      storage
    );

    expect(getSessionStoreName(session)).toEqual({
      sync: `web-sync-store::${session.sessionId}`,
      crypto: `crypto-store::${session.sessionId}`,
    });
    expect(getSessionIndexedDbStoreName(session)).toEqual({
      sync: `matrix-js-sdk:web-sync-store::${session.sessionId}`,
      crypto: `crypto-store::${session.sessionId}`,
    });
    expect(getSessionScopedStorageKey(session.sessionId, 'mindroom_ios_push_token')).toBe(
      `mindroom_ios_push_token::${session.sessionId}`
    );
  });

  it('returns stable store snapshots while the backing storage is unchanged', () => {
    const storage = createStorage();

    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      storage
    );

    const storeA = getSessionStore(storage);
    const storeB = getSessionStore(storage);
    const activeA = getActiveSession(storage);
    const activeB = getActiveSession(storage);
    const sessionsA = listSessions(storage);
    const sessionsB = listSessions(storage);

    expect(storeA).toBe(storeB);
    expect(activeA).toBe(activeB);
    expect(activeA?.sessionId).toBe(session.sessionId);
    expect(sessionsA).toBe(sessionsB);
    expect(sessionsA[0].sessionId).toBe(session.sessionId);
  });
});
