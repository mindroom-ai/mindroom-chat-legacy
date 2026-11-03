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
  SignedOutDeviceError,
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
  SignedOutDeviceError,
} from '../app/mindroom/matrix/cryptoStoreContinuity';
export type { ClientBootstrapSession } from '../app/mindroom/matrix/cryptoStoreContinuity';
export {
  clearAllCacheAndReload,
  logoutClient,
  removeCurrentClientSessionAndReload,
  removeSessionAndReload,
  removeSignedOutSessionAndReload,
  removeStoredSession,
} from '../app/mindroom/matrix/sessionLifecycle';

export const initClient = async (session: ClientBootstrapSession): Promise<MatrixClient> => {
  const cryptoStoreExists = await inspectCryptoStoreContinuity(session);
  if (cryptoStoreExists === undefined) {
    throw new DeviceIdentityVerificationError(session.userId);
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
  // or this device already set up the store that is now gone, creating Rust
  // crypto would replace that identity. Decide before opening the Rust store
  // so no generated keys or cleanup paths are involved.
  if (cryptoStoreExists === false) {
    const storeWasSetUp = hasInitializedCryptoStore(session.sessionId);
    let serverKnowsDevice: boolean;
    try {
      serverKnowsDevice = await serverHasDeviceIdentity(mx, session);
    } catch (error) {
      // A login the server ended (SignedOutDeviceError) cannot continue on
      // this device, so the caller removes its record and a new device signs
      // in. Any other failure keeps refusing a store this device had set up.
      if (storeWasSetUp && !(error instanceof SignedOutDeviceError)) {
        throw new MissingCryptoStoreError(session.userId);
      }
      throw error;
    }
    if (serverKnowsDevice || storeWasSetUp) throw new MissingCryptoStoreError(session.userId);
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
