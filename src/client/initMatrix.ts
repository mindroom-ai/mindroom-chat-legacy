import { IndexedDBCryptoStore } from 'matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store';
import type { CryptoCallbacks } from 'matrix-js-sdk/lib/crypto-api';
import type { MatrixClient } from 'matrix-js-sdk/lib/client';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';

import { cryptoCallbacks } from './secretStorageKeys';
import { createMatrixClient } from '../app/mindroom/matrix/matrixClientFactory';
import {
  ClientBootstrapSession,
  DeviceIdentityVerificationError,
  MissingCryptoStoreError,
  inspectCryptoStoreContinuity,
  serverHasDeviceIdentity,
} from '../app/mindroom/matrix/cryptoStoreContinuity';
import { configureLargeSyncArchive } from '../app/mindroom/matrix/clientSyncPolicy';
import {
  getSessionRustCryptoStorePrefix,
  getSessionStoreName,
  hasInitializedCryptoStore,
  markCryptoStoreInitialized,
} from '../app/state/sessions';
import { createStoredSessionTokenRefresh } from './sessionTokenRefresh';

export {
  LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT,
  STARTUP_SYNC_TIMELINE_LIMIT,
  configureLargeSyncArchive,
  startClient,
} from '../app/mindroom/matrix/clientSyncPolicy';
export {
  DeviceIdentityVerificationError,
  MissingCryptoStoreError,
} from '../app/mindroom/matrix/cryptoStoreContinuity';
export type { ClientBootstrapSession } from '../app/mindroom/matrix/cryptoStoreContinuity';
export {
  clearAllCacheAndReload,
  logoutClient,
  removeCurrentClientSessionAndReload,
  removeSessionAndReload,
  removeStoredSession,
} from '../app/mindroom/matrix/sessionLifecycle';

export const initClient = async (session: ClientBootstrapSession): Promise<MatrixClient> => {
  const cryptoStoreExists = await inspectCryptoStoreContinuity(session);
  if (cryptoStoreExists === undefined) {
    throw new DeviceIdentityVerificationError(session.userId);
  }
  if (cryptoStoreExists === false && hasInitializedCryptoStore(session.sessionId)) {
    throw new MissingCryptoStoreError(session.userId);
  }

  const storeNames = getSessionStoreName(session);
  const indexedDBStore = new IndexedDBStore({
    indexedDB: global.indexedDB,
    localStorage: global.localStorage as Storage,
    dbName: storeNames.sync,
  } as ConstructorParameters<typeof IndexedDBStore>[0]);
  configureLargeSyncArchive(indexedDBStore);

  const legacyCryptoStore = new IndexedDBCryptoStore(global.indexedDB, storeNames.crypto);

  const tokenRefreshFunction = createStoredSessionTokenRefresh(session);

  const mx = createMatrixClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    tokenRefreshFunction,
    userId: session.userId,
    store: indexedDBStore,
    cryptoStore: legacyCryptoStore,
    deviceId: session.deviceId,
    timelineSupport: true,
    threadSupport: true,
    cryptoCallbacks: cryptoCallbacks as unknown as CryptoCallbacks,
    verificationMethods: ['m.sas.v1'],
  });

  // A new Matrix login has no uploaded device keys yet. If the homeserver
  // already knows keys for this device ID while its local database is absent,
  // creating Rust crypto would replace that identity. Decide before opening
  // the Rust store so no generated keys or cleanup paths are involved.
  if (cryptoStoreExists === false && (await serverHasDeviceIdentity(mx, session))) {
    throw new MissingCryptoStoreError(session.userId);
  }

  const initializationResults = await Promise.allSettled([
    indexedDBStore.startup(),
    mx.initRustCrypto({
      cryptoDatabasePrefix: getSessionRustCryptoStorePrefix(session),
    }),
  ]);
  const initializationFailure = initializationResults.find(
    (result) => result.status === 'rejected'
  );
  if (initializationFailure?.status === 'rejected') {
    // Both initializers may open IndexedDB handles. Wait for the sibling to
    // settle before disposing the partial runtime so retry starts cleanly.
    await Promise.allSettled([
      Promise.resolve().then(() => mx.stopClient()),
      indexedDBStore.destroy(),
    ]);
    throw initializationFailure.reason;
  }

  markCryptoStoreInitialized(session);

  mx.setMaxListeners(50);

  return mx;
};
