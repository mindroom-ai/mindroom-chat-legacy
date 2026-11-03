import {
  MINDROOM_SESSION_STORE_EVENT,
  MINDROOM_SESSION_STORE_KEY,
  MINDROOM_SIGNED_OUT_DEVICES_KEY,
} from '../mindroom/cache/sessionStoreConfig';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../utils/safeLocalStorage';

export type StoredSession = {
  sessionId: string;
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  expiresInMs?: number;
  refreshToken?: string;
  cryptoStoreInitialized?: boolean;
  lastUsedAt: number;
  lastKnownPath?: string;
  lastKnownDisplayName?: string;
  lastKnownAvatarUrl?: string;
  lastKnownAvatarDataUrl?: string;
};

export type SessionStore = {
  version: 1;
  activeSessionId?: string;
  sessions: StoredSession[];
};

export type SessionStoreName = {
  sync: string;
  crypto: string;
};

type PutSessionInput = {
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  expiresInMs?: number;
  refreshToken?: string;
  lastKnownPath?: string;
  lastKnownDisplayName?: string;
  lastKnownAvatarUrl?: string;
  lastKnownAvatarDataUrl?: string;
};

type SessionCredentialUpdate = {
  accessToken: string;
  refreshToken?: string;
  expiresInMs?: number;
};

type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type SessionStoreListener = () => void;
type SessionStoreSnapshot = {
  raw: string | null;
  signedOutRaw?: string | null;
  store: SessionStore;
  activeSession?: StoredSession;
  sessions: StoredSession[];
};

export const SESSION_STORE_KEY = MINDROOM_SESSION_STORE_KEY;
export const SIGNED_OUT_DEVICES_KEY = MINDROOM_SIGNED_OUT_DEVICES_KEY;
export const SESSION_STORE_EVENT = MINDROOM_SESSION_STORE_EVENT;
export const SESSION_STORE_VERSION = 1 as const;
export const LEGACY_SESSION_STORAGE_KEYS = [
  'cinny_access_token',
  'cinny_device_id',
  'cinny_user_id',
  'cinny_hs_base_url',
] as const;

const SESSION_DB_PREFIX = '::';
const EMPTY_SESSIONS: StoredSession[] = [];
const EMPTY_SESSION_STORE: SessionStore = {
  version: SESSION_STORE_VERSION,
  sessions: EMPTY_SESSIONS,
};
const EMPTY_SESSION_SNAPSHOT: SessionStoreSnapshot = {
  raw: null,
  store: EMPTY_SESSION_STORE,
  sessions: EMPTY_SESSIONS,
};
const sessionStoreSnapshotCache = new WeakMap<object, SessionStoreSnapshot>();

export class SessionStoreWriteError extends Error {
  constructor() {
    super('Unable to save account credentials on this device. Check browser storage permissions.');
    this.name = 'SessionStoreWriteError';
  }
}

const dispatchSessionStoreEvent = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SESSION_STORE_EVENT));
};

export const clearLegacySessionStorage = (
  storage: LocalStorageLike | undefined = getSafeLocalStorage()
): void => {
  if (!storage) return;

  LEGACY_SESSION_STORAGE_KEYS.forEach((key) => {
    removeStorageItemSafe(storage, key);
  });
};

export const normalizeSessionBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
};

const normalizeUserId = (userId: string): string => userId.trim();

export const createSessionId = (baseUrl: string, userId: string): string =>
  `${encodeURIComponent(normalizeSessionBaseUrl(baseUrl))}${SESSION_DB_PREFIX}${encodeURIComponent(
    normalizeUserId(userId)
  )}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toStoredSession = (value: unknown): StoredSession | undefined => {
  if (!isRecord(value)) return undefined;

  const baseUrl =
    typeof value.baseUrl === 'string' ? normalizeSessionBaseUrl(value.baseUrl) : undefined;
  const userId = typeof value.userId === 'string' ? normalizeUserId(value.userId) : undefined;
  const deviceId = typeof value.deviceId === 'string' ? value.deviceId : undefined;
  const accessToken = typeof value.accessToken === 'string' ? value.accessToken : undefined;
  if (!baseUrl || !userId || !deviceId || !accessToken) return undefined;

  const sessionId =
    typeof value.sessionId === 'string' && value.sessionId.length > 0
      ? value.sessionId
      : createSessionId(baseUrl, userId);

  return {
    sessionId,
    baseUrl,
    userId,
    deviceId,
    accessToken,
    expiresInMs: typeof value.expiresInMs === 'number' ? value.expiresInMs : undefined,
    refreshToken: typeof value.refreshToken === 'string' ? value.refreshToken : undefined,
    cryptoStoreInitialized:
      typeof value.cryptoStoreInitialized === 'boolean' ? value.cryptoStoreInitialized : undefined,
    lastUsedAt: typeof value.lastUsedAt === 'number' ? value.lastUsedAt : 0,
    lastKnownPath: typeof value.lastKnownPath === 'string' ? value.lastKnownPath : undefined,
    lastKnownDisplayName:
      typeof value.lastKnownDisplayName === 'string' ? value.lastKnownDisplayName : undefined,
    lastKnownAvatarUrl:
      typeof value.lastKnownAvatarUrl === 'string' ? value.lastKnownAvatarUrl : undefined,
    lastKnownAvatarDataUrl:
      typeof value.lastKnownAvatarDataUrl === 'string' ? value.lastKnownAvatarDataUrl : undefined,
  };
};

type SignedOutDevice = Pick<StoredSession, 'sessionId' | 'deviceId'>;

// Every writer rewrites the whole account list from its tab's copy, and a tab
// can still hold a copy from before another tab signed a device out. The
// signed-out devices live under their own key, which only sign-out and sign-in
// write, so readers drop a device such a stale write brings back.
const MAX_SIGNED_OUT_DEVICES = 20;

const readSignedOutDevices = (raw: string | null): SignedOutDevice[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) =>
      isRecord(item) && typeof item.sessionId === 'string' && typeof item.deviceId === 'string'
        ? [{ sessionId: item.sessionId, deviceId: item.deviceId }]
        : []
    );
  } catch {
    return [];
  }
};

const isSameDevice = (a: SignedOutDevice, b: SignedOutDevice): boolean =>
  a.sessionId === b.sessionId && a.deviceId === b.deviceId;

const writeSignedOutDevices = (
  update: (devices: SignedOutDevice[]) => SignedOutDevice[],
  storage: LocalStorageLike | undefined
): void => {
  const devices = readSignedOutDevices(getStorageItemSafe(storage, SIGNED_OUT_DEVICES_KEY));
  setStorageItemSafe(
    storage,
    SIGNED_OUT_DEVICES_KEY,
    JSON.stringify(update(devices).slice(-MAX_SIGNED_OUT_DEVICES))
  );
};

const sanitizeSessionStore = (
  value: unknown,
  signedOutDevices: SignedOutDevice[] = []
): SessionStore => {
  if (
    !isRecord(value) ||
    value.version !== SESSION_STORE_VERSION ||
    !Array.isArray(value.sessions)
  ) {
    return {
      version: SESSION_STORE_VERSION,
      sessions: [],
    };
  }

  const sessionMap = new Map<string, StoredSession>();
  value.sessions.forEach((item) => {
    const session = toStoredSession(item);
    if (!session || signedOutDevices.some((device) => isSameDevice(device, session))) return;
    sessionMap.set(session.sessionId, session);
  });

  const sessions = Array.from(sessionMap.values());
  const activeSessionId =
    typeof value.activeSessionId === 'string' &&
    sessions.some((session) => session.sessionId === value.activeSessionId)
      ? value.activeSessionId
      : undefined;

  return {
    version: SESSION_STORE_VERSION,
    activeSessionId,
    sessions,
  };
};

const writeSessionStore = (
  store: SessionStore,
  storage: LocalStorageLike | undefined = getSafeLocalStorage()
): boolean => {
  if (!storage) return false;

  clearLegacySessionStorage(storage);
  if (setStorageItemSafe(storage, SESSION_STORE_KEY, JSON.stringify(store))) {
    dispatchSessionStoreEvent();
    return true;
  }
  return false;
};

const writeSessionStoreOrThrow = (
  store: SessionStore,
  storage: LocalStorageLike | undefined
): void => {
  if (!writeSessionStore(store, storage)) throw new SessionStoreWriteError();
};

const createSessionStoreSnapshot = (
  raw: string | null,
  store: SessionStore,
  signedOutRaw?: string | null
): SessionStoreSnapshot => {
  const activeSession = store.activeSessionId
    ? store.sessions.find((session) => session.sessionId === store.activeSessionId)
    : undefined;
  const sessions =
    store.sessions.length > 0
      ? [...store.sessions].sort((a, b) => {
          const usedDiff = b.lastUsedAt - a.lastUsedAt;
          if (usedDiff !== 0) return usedDiff;
          return a.userId.localeCompare(b.userId);
        })
      : EMPTY_SESSIONS;

  return {
    raw,
    signedOutRaw,
    store,
    activeSession,
    sessions,
  };
};

const getSessionStoreSnapshot = (
  storage: LocalStorageLike | undefined = getSafeLocalStorage()
): SessionStoreSnapshot => {
  if (!storage) {
    return EMPTY_SESSION_SNAPSHOT;
  }

  try {
    const raw = storage.getItem(SESSION_STORE_KEY);
    const signedOutRaw = storage.getItem(SIGNED_OUT_DEVICES_KEY);
    const cachedSnapshot = sessionStoreSnapshotCache.get(storage);
    if (
      cachedSnapshot &&
      cachedSnapshot.raw === raw &&
      cachedSnapshot.signedOutRaw === signedOutRaw
    ) {
      return cachedSnapshot;
    }

    const store = raw
      ? sanitizeSessionStore(JSON.parse(raw), readSignedOutDevices(signedOutRaw))
      : EMPTY_SESSION_STORE;
    const snapshot = createSessionStoreSnapshot(raw, store, signedOutRaw);
    sessionStoreSnapshotCache.set(storage, snapshot);
    return snapshot;
  } catch {
    const snapshot = createSessionStoreSnapshot(null, EMPTY_SESSION_STORE);
    sessionStoreSnapshotCache.set(storage, snapshot);
    return snapshot;
  }
};

export const getSessionStore = (storage: LocalStorageLike | undefined = getSafeLocalStorage()) =>
  getSessionStoreSnapshot(storage).store;

export const listSessions = (
  storage: LocalStorageLike | undefined = getSafeLocalStorage()
): StoredSession[] => getSessionStoreSnapshot(storage).sessions;

export const hasStoredSessions = (
  storage: LocalStorageLike | undefined = getSafeLocalStorage()
): boolean => getSessionStore(storage).sessions.length > 0;

export const getActiveSession = (
  storage: LocalStorageLike | undefined = getSafeLocalStorage()
): StoredSession | undefined => getSessionStoreSnapshot(storage).activeSession;

const upsertSession = (sessions: StoredSession[], nextSession: StoredSession): StoredSession[] => {
  const nextSessions = [...sessions];
  const existingIndex = nextSessions.findIndex(
    (session) => session.sessionId === nextSession.sessionId
  );

  if (existingIndex >= 0) {
    nextSessions.splice(existingIndex, 1, nextSession);
    return nextSessions;
  }

  nextSessions.push(nextSession);
  return nextSessions;
};

const selectNextActiveSessionId = (sessions: StoredSession[]): string | undefined =>
  [...sessions].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0]?.sessionId;

export const putSession = (
  input: PutSessionInput,
  options: {
    setActive?: boolean;
  } = {},
  storage: LocalStorageLike | undefined = getSafeLocalStorage()
): StoredSession => {
  const baseUrl = normalizeSessionBaseUrl(input.baseUrl);
  const userId = normalizeUserId(input.userId);
  const sessionId = createSessionId(baseUrl, userId);

  const store = getSessionStore(storage);
  const existing = store.sessions.find((session) => session.sessionId === sessionId);
  const timestamp = Date.now();
  const nextSession: StoredSession = {
    sessionId,
    baseUrl,
    userId,
    deviceId: input.deviceId,
    accessToken: input.accessToken,
    expiresInMs: input.expiresInMs,
    refreshToken: input.refreshToken,
    cryptoStoreInitialized:
      existing?.deviceId === input.deviceId ? existing.cryptoStoreInitialized : undefined,
    lastUsedAt: timestamp,
    lastKnownPath: input.lastKnownPath ?? existing?.lastKnownPath,
    lastKnownDisplayName: input.lastKnownDisplayName ?? existing?.lastKnownDisplayName,
    lastKnownAvatarUrl: input.lastKnownAvatarUrl ?? existing?.lastKnownAvatarUrl,
    lastKnownAvatarDataUrl: input.lastKnownAvatarDataUrl ?? existing?.lastKnownAvatarDataUrl,
  };

  if (
    readSignedOutDevices(getStorageItemSafe(storage, SIGNED_OUT_DEVICES_KEY)).some((device) =>
      isSameDevice(device, nextSession)
    )
  ) {
    writeSignedOutDevices(
      (devices) => devices.filter((device) => !isSameDevice(device, nextSession)),
      storage
    );
  }

  writeSessionStoreOrThrow(
    {
      version: SESSION_STORE_VERSION,
      sessions: upsertSession(store.sessions, nextSession),
      activeSessionId: options.setActive === false ? store.activeSessionId : sessionId,
    },
    storage
  );

  return nextSession;
};

export const setActiveSession = (
  sessionId: string,
  storage: LocalStorageLike | undefined = getSafeLocalStorage()
): StoredSession | undefined => {
  const store = getSessionStore(storage);
  const session = store.sessions.find((item) => item.sessionId === sessionId);
  if (!session) return undefined;

  const nextSession = {
    ...session,
    lastUsedAt: Date.now(),
  };

  writeSessionStoreOrThrow(
    {
      version: SESSION_STORE_VERSION,
      sessions: upsertSession(store.sessions, nextSession),
      activeSessionId: sessionId,
    },
    storage
  );

  return nextSession;
};

export const updateSessionCredentials = (
  sessionId: string,
  credentials: SessionCredentialUpdate,
  storage: LocalStorageLike | undefined = getSafeLocalStorage()
): StoredSession | undefined => {
  const store = getSessionStore(storage);
  const session = store.sessions.find((item) => item.sessionId === sessionId);
  if (!session) return undefined;

  const nextSession: StoredSession = {
    ...session,
    accessToken: credentials.accessToken,
    refreshToken: credentials.refreshToken,
    expiresInMs: credentials.expiresInMs,
  };

  writeSessionStore(
    {
      ...store,
      sessions: upsertSession(store.sessions, nextSession),
    },
    storage
  );
  return nextSession;
};

export const hasInitializedCryptoStore = (
  sessionId: string,
  storage: LocalStorageLike | undefined = getSafeLocalStorage()
): boolean =>
  getSessionStore(storage).sessions.find((session) => session.sessionId === sessionId)
    ?.cryptoStoreInitialized === true;

export const markCryptoStoreInitialized = (
  { sessionId, deviceId }: Pick<StoredSession, 'sessionId' | 'deviceId'>,
  storage: LocalStorageLike | undefined = getSafeLocalStorage()
): StoredSession | undefined => {
  const store = getSessionStore(storage);
  const session = store.sessions.find((item) => item.sessionId === sessionId);
  // A newer login of this account may have replaced the record while this
  // device started; that login's own store does not exist yet.
  if (!session || session.deviceId !== deviceId) return undefined;
  if (session.cryptoStoreInitialized) return session;

  const nextSession: StoredSession = {
    ...session,
    cryptoStoreInitialized: true,
  };
  writeSessionStore(
    {
      ...store,
      sessions: upsertSession(store.sessions, nextSession),
    },
    storage
  );
  return nextSession;
};

export const updateSessionProfile = (
  sessionId: string,
  profile: {
    lastKnownDisplayName?: string;
    lastKnownAvatarUrl?: string;
    lastKnownAvatarDataUrl?: string;
  },
  storage: LocalStorageLike | undefined = getSafeLocalStorage()
): StoredSession | undefined => {
  const store = getSessionStore(storage);
  const session = store.sessions.find((item) => item.sessionId === sessionId);
  if (!session) return undefined;

  const hasOwnProfileValue = <K extends keyof typeof profile>(key: K): boolean =>
    Object.prototype.hasOwnProperty.call(profile, key);

  const nextSession: StoredSession = {
    ...session,
    lastKnownDisplayName: hasOwnProfileValue('lastKnownDisplayName')
      ? profile.lastKnownDisplayName
      : session.lastKnownDisplayName,
    lastKnownAvatarUrl: hasOwnProfileValue('lastKnownAvatarUrl')
      ? profile.lastKnownAvatarUrl
      : session.lastKnownAvatarUrl,
    lastKnownAvatarDataUrl: hasOwnProfileValue('lastKnownAvatarDataUrl')
      ? profile.lastKnownAvatarDataUrl
      : session.lastKnownAvatarDataUrl,
  };
  if (
    nextSession.lastKnownDisplayName === session.lastKnownDisplayName &&
    nextSession.lastKnownAvatarUrl === session.lastKnownAvatarUrl &&
    nextSession.lastKnownAvatarDataUrl === session.lastKnownAvatarDataUrl
  ) {
    return session;
  }

  writeSessionStore(
    {
      ...store,
      sessions: upsertSession(store.sessions, nextSession),
    },
    storage
  );

  return nextSession;
};

export const updateSessionLastPath = (
  sessionId: string,
  lastKnownPath: string,
  storage: LocalStorageLike | undefined = getSafeLocalStorage()
): StoredSession | undefined => {
  const store = getSessionStore(storage);
  const session = store.sessions.find((item) => item.sessionId === sessionId);
  if (!session) return undefined;
  if (session.lastKnownPath === lastKnownPath) return session;

  const nextSession: StoredSession = {
    ...session,
    lastKnownPath,
  };

  writeSessionStore(
    {
      ...store,
      sessions: upsertSession(store.sessions, nextSession),
    },
    storage
  );

  return nextSession;
};

export const removeSession = (
  sessionId: string,
  storage: LocalStorageLike | undefined = getSafeLocalStorage()
): SessionStore => {
  const store = getSessionStore(storage);
  const removed = store.sessions.find((session) => session.sessionId === sessionId);
  // Recorded before the list changes, so no tab can read the new list without it.
  if (removed) {
    writeSignedOutDevices(
      (devices) => [
        ...devices.filter((device) => !isSameDevice(device, removed)),
        // Only the identifiers: this list must never hold credentials.
        { sessionId: removed.sessionId, deviceId: removed.deviceId },
      ],
      storage
    );
  }
  const sessions = store.sessions.filter((session) => session.sessionId !== sessionId);
  const activeSessionId =
    store.activeSessionId === sessionId
      ? selectNextActiveSessionId(sessions)
      : store.activeSessionId;
  const nextStore = {
    version: SESSION_STORE_VERSION,
    sessions,
    activeSessionId,
  };

  writeSessionStoreOrThrow(nextStore, storage);
  return nextStore;
};

export const subscribeToSessionStore = (listener: SessionStoreListener): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;

  const handleWindowEvent = () => listener();
  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== SESSION_STORE_KEY && event.key !== SIGNED_OUT_DEVICES_KEY) {
      return;
    }
    listener();
  };

  window.addEventListener(SESSION_STORE_EVENT, handleWindowEvent);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(SESSION_STORE_EVENT, handleWindowEvent);
    window.removeEventListener('storage', handleStorage);
  };
};

export const getSessionStoreName = (
  session: Pick<StoredSession, 'sessionId'>
): SessionStoreName => ({
  sync: `web-sync-store${SESSION_DB_PREFIX}${session.sessionId}`,
  crypto: `crypto-store${SESSION_DB_PREFIX}${session.sessionId}`,
});

export const getSessionIndexedDbStoreName = (
  session: Pick<StoredSession, 'sessionId'>
): SessionStoreName => {
  const storeNames = getSessionStoreName(session);
  return {
    sync: `matrix-js-sdk:${storeNames.sync}`,
    crypto: storeNames.crypto,
  };
};

const getRustCryptoStoreNamesForPrefix = (prefix: string): [string, string] => [
  `${prefix}${SESSION_DB_PREFIX}matrix-sdk-crypto`,
  `${prefix}${SESSION_DB_PREFIX}matrix-sdk-crypto-meta`,
];

export const getLegacySessionRustCryptoStorePrefix = (
  session: Pick<StoredSession, 'sessionId'>
): string => `matrix-js-sdk${SESSION_DB_PREFIX}${session.sessionId}`;

export const getSessionRustCryptoStorePrefix = (
  session: Pick<StoredSession, 'sessionId' | 'deviceId'>
): string =>
  `matrix-js-sdk${SESSION_DB_PREFIX}${session.sessionId}${SESSION_DB_PREFIX}${encodeURIComponent(
    session.deviceId
  )}`;

export const getLegacySessionRustCryptoStoreNames = (
  session: Pick<StoredSession, 'sessionId'>
): [string, string] =>
  getRustCryptoStoreNamesForPrefix(getLegacySessionRustCryptoStorePrefix(session));

export const getSessionRustCryptoStoreNames = (
  session: Pick<StoredSession, 'sessionId' | 'deviceId'>
): [string, string] => getRustCryptoStoreNamesForPrefix(getSessionRustCryptoStorePrefix(session));

export const getSessionScopedStorageKey = (sessionId: string, key: string): string =>
  `${key}${SESSION_DB_PREFIX}${sessionId}`;
