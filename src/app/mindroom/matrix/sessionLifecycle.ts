import type { MatrixClient } from 'matrix-js-sdk/lib/client';

import { clearSecretStorageKeys } from '../../../client/secretStorageKeys';
import { clearNavToActivePathStore } from '../../state/navToActivePath';
import {
  clearMindroomInMemoryCaches,
  clearMindroomSessionNativeState,
  clearMindroomSessionUiState,
  clearMindroomUserUiState,
  deleteMindroomSessionCaches,
} from '../cache/sessionCleanup';
import {
  StoredSession,
  clearLegacySessionStorage,
  createSessionId,
  getActiveSession,
  getSessionIndexedDbStoreName,
  getSessionRustCryptoStoreNames,
  getSessionRustCryptoStorePrefix,
  listSessions,
  removeSession,
} from '../../state/sessions';
import { clearAppOwnedCacheLocalStorage } from '../../utils/appOwnedStorage';
import { getAppBasePath } from '../../utils/basePath';
import { removeCachedSpecVersions } from '../../state/cachedSpecVersions';
import {
  forgetCloudflareAccessToken,
  renewExpiredCloudflareAccess,
} from '../native/cloudflareAccess';
import { stopMindroomSyncEngineForClient } from '../engine/mindroomSyncEngine';
import { getCanvasStateDbName } from '../canvas/canvasStateStore';
import { getCanvasIndexDbName } from '../canvas/canvasIndexStore';
import {
  SessionCleanupContext,
  clearAppScopedCacheStorage,
  clearAppScopedServiceWorkers,
  deleteNamedDatabase,
  deleteNamedDatabases,
  getAllSessionRustCryptoDbNames,
  getAppOwnedIndexedDbNames,
  getCacheBustedAppReloadTarget,
  getStoredSessionCleanupContexts,
  hasLegacySessionStorage,
  mergeSessionCleanupContexts,
} from './browserStorageCleanup';

const getMatrixClientSessionIdentity = (
  mx: Pick<MatrixClient, 'getHomeserverUrl' | 'getSafeUserId'>
): Pick<SessionCleanupContext, 'sessionId' | 'baseUrl' | 'userId'> => {
  const baseUrl = mx.getHomeserverUrl();
  const userId = mx.getSafeUserId();
  return {
    sessionId: createSessionId(baseUrl, userId),
    baseUrl,
    userId,
  };
};

const getMatrixClientSessionCleanupContext = (
  mx: Pick<MatrixClient, 'getDeviceId' | 'getHomeserverUrl' | 'getSafeUserId'>,
  candidate?: SessionCleanupContext
): SessionCleanupContext | undefined => {
  const identity = getMatrixClientSessionIdentity(mx);
  const deviceId = mx.getDeviceId();
  if (deviceId) return { ...identity, deviceId };
  if (candidate?.sessionId === identity.sessionId && candidate.userId === identity.userId) {
    return candidate;
  }

  return undefined;
};

const stopClientRuntime = (mx: MatrixClient): void => {
  try {
    stopMindroomSyncEngineForClient(mx);
  } catch {
    // Matrix cleanup must continue even if a trailing cache flush fails.
  }
  mx.stopClient();
};

const clearSessionScopedUiState = (
  session: Pick<SessionCleanupContext, 'sessionId' | 'baseUrl' | 'userId'>,
  clearUserScopedState = true
): void => {
  const { sessionId, baseUrl, userId } = session;
  removeCachedSpecVersions(baseUrl, userId);
  forgetCloudflareAccessToken(baseUrl);
  if (clearUserScopedState) {
    try {
      clearNavToActivePathStore(userId);
      clearMindroomUserUiState(userId);
    } catch {
      // Local UI cleanup is best effort and must not retain account credentials.
    }
  }
  try {
    clearMindroomSessionUiState(sessionId);
  } catch {
    // Continue with Matrix stores and credential removal.
  }
};

const clearSessionScopedNativeState = (sessionId: string): void => {
  try {
    clearMindroomSessionNativeState(sessionId);
  } catch {
    // Native preference cleanup is best effort during account removal.
  }
};

const clearMatrixClientStores = async (
  mx: MatrixClient,
  candidate?: SessionCleanupContext
): Promise<void> => {
  const session = getMatrixClientSessionCleanupContext(mx, candidate);
  const additionalRustStoreNames = session
    ? (await getAllSessionRustCryptoDbNames(session)).filter(
        (name) => !getSessionRustCryptoStoreNames(session).includes(name)
      )
    : [];
  await Promise.all([
    session
      ? mx.clearStores({
          cryptoDatabasePrefix: getSessionRustCryptoStorePrefix(session),
        })
      : mx.clearStores(),
    deleteNamedDatabases(additionalRustStoreNames),
  ]);
};

const deleteSessionLocalData = async (
  session: SessionCleanupContext,
  mx?: MatrixClient,
  clearUserScopedState = true
): Promise<void> => {
  clearSessionScopedUiState(session, clearUserScopedState);

  const indexedDbStoreNames = getSessionIndexedDbStoreName(session);
  const rustCryptoStoreNames = mx ? [] : await getAllSessionRustCryptoDbNames(session);

  // Teardown is best effort across independent stores. A blocked cache DB
  // must not prevent crypto, sync, native, and credential cleanup from
  // running; reloading will also release this tab's remaining DB handles.
  await Promise.allSettled([
    mx ? clearMatrixClientStores(mx, session) : deleteNamedDatabase(indexedDbStoreNames.sync),
    mx ? Promise.resolve() : deleteNamedDatabase(indexedDbStoreNames.crypto),
    mx ? Promise.resolve() : deleteNamedDatabases(rustCryptoStoreNames),
    deleteMindroomSessionCaches(session.sessionId),
    // Saved canvas state is the user's data rather than a cache, so only account removal deletes it.
    deleteNamedDatabase(getCanvasStateDbName(session.sessionId)),
    deleteNamedDatabase(getCanvasIndexDbName(session.sessionId)),
  ]);
  clearSessionScopedNativeState(session.sessionId);
};

// Removes the session from the registry then runs local-data teardown,
// wrapped in the legacy-storage finalizer the SDK expects after any
// credential-store mutation. Deriving `clearUserScopedState` from the
// post-removal registry keeps shared-MXID sessions (e.g. same account on a
// different base URL) from losing per-user UI state.
const removeSessionRecordAndLocalData = async (
  session: SessionCleanupContext,
  mx?: MatrixClient
): Promise<void> => {
  const nextStore = removeSession(session.sessionId);
  try {
    await deleteSessionLocalData(
      session,
      mx,
      !nextStore.sessions.some((storedSession) => storedSession.userId === session.userId)
    );
  } finally {
    clearLegacySessionStorage();
  }
};

export const removeSessionAndReload = async (
  session: SessionCleanupContext,
  mx?: MatrixClient
): Promise<void> => {
  if (mx) {
    await removeCurrentClientSessionAndReload(mx, session);
    return;
  }

  // Keep a recoverable account until its registry update succeeds. Orphaned
  // cache data is safe to clean up later; deleting crypto for an account that
  // remains selectable is not.
  await removeSessionRecordAndLocalData(session);
  window.location.reload();
};

export const removeCurrentClientSessionAndReload = async (
  mx: MatrixClient,
  candidate?: SessionCleanupContext
): Promise<void> => {
  const session = getMatrixClientSessionCleanupContext(mx, candidate);
  stopClientRuntime(mx);

  // Signing the same account in again (for example through Add account)
  // replaces this record with a newer device. Its registry entry, sync store,
  // and caches are keyed by account, so a logged-out older device must leave
  // them alone; reloading boots the newer device.
  const stored = listSessions().find((item) => item.sessionId === session?.sessionId);
  if (session && stored && stored.deviceId !== session.deviceId) {
    window.location.reload();
    return;
  }

  if (session) {
    await removeSessionRecordAndLocalData(session, mx);
    window.location.reload();
    return;
  }

  // Fallback when the client has no deviceId and no candidate matches: fall
  // back to the identity derived from the live client and skip the per-
  // session cache/native teardown that requires a full SessionCleanupContext.
  const identity = getMatrixClientSessionIdentity(mx);
  const nextStore = removeSession(identity.sessionId);
  const clearUserScopedState = !nextStore.sessions.some(
    (storedSession) => storedSession.userId === identity.userId
  );
  try {
    await Promise.all([
      clearMatrixClientStores(mx),
      // Saved canvas state and the canvas list need only the session ID, so they are deleted here too.
      deleteNamedDatabase(getCanvasStateDbName(identity.sessionId)).catch(() => undefined),
      deleteNamedDatabase(getCanvasIndexDbName(identity.sessionId)).catch(() => undefined),
    ]);
    clearSessionScopedUiState(identity, clearUserScopedState);
  } finally {
    clearLegacySessionStorage();
  }
  window.location.reload();
};

export const removeStoredSession = async (session: StoredSession): Promise<void> => {
  const activeSession = getActiveSession();
  if (activeSession?.sessionId === session.sessionId) {
    await removeSessionAndReload(session);
    return;
  }

  await removeSessionRecordAndLocalData(session);
};

export const clearAllCacheAndReload = async (mx?: MatrixClient): Promise<void> => {
  const liveSession = mx ? getMatrixClientSessionCleanupContext(mx) : undefined;
  const sessions = mergeSessionCleanupContexts([
    ...getStoredSessionCleanupContexts(),
    ...(liveSession ? [liveSession] : []),
  ]);
  const legacySessionStoragePresent = hasLegacySessionStorage();
  const appBasePath = getAppBasePath();

  try {
    if (mx) stopClientRuntime(mx);
  } catch {
    // ignore stop errors and continue clearing the rest of the app state
  }

  try {
    await clearAppScopedServiceWorkers(appBasePath);
  } catch {
    // ignore browser service worker cleanup errors
  }

  try {
    await clearAppScopedCacheStorage(appBasePath);
  } catch {
    // ignore browser cache storage cleanup errors
  }

  try {
    clearSecretStorageKeys();
  } catch {
    // ignore secret storage cleanup errors
  }

  try {
    clearMindroomInMemoryCaches();
  } catch {
    // ignore MindRoom in-memory cleanup errors
  }

  try {
    const appOwnedDbNames = await getAppOwnedIndexedDbNames(sessions, legacySessionStoragePresent);
    await deleteNamedDatabases(appOwnedDbNames);
  } catch {
    // ignore IndexedDB cleanup errors
  }

  try {
    clearAppOwnedCacheLocalStorage();
  } catch {
    // ignore localStorage cleanup errors
  }

  try {
    sessionStorage.clear();
  } catch {
    // ignore sessionStorage cleanup errors
  }

  window.location.replace(getCacheBustedAppReloadTarget(appBasePath));
};

export const logoutClient = async (mx: MatrixClient) => {
  const activeSession = getActiveSession();
  // A logout that cannot pass Cloudflare Access leaves this device and its pusher.
  await renewExpiredCloudflareAccess(mx.getHomeserverUrl());
  stopClientRuntime(mx);
  try {
    await mx.logout();
  } catch {
    // ignore if failed to logout
  }
  await removeCurrentClientSessionAndReload(mx, activeSession);
};
