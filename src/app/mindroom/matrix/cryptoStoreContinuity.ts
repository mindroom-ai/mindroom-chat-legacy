import type { MatrixClient } from 'matrix-js-sdk/lib/client';
import { Method } from 'matrix-js-sdk/lib/http-api';

import { StoredSession, getSessionRustCryptoStoreNames } from '../../state/sessions';

export type ClientBootstrapSession = Pick<
  StoredSession,
  'sessionId' | 'baseUrl' | 'userId' | 'deviceId' | 'accessToken' | 'refreshToken'
>;

export class MissingCryptoStoreError extends Error {
  constructor(userId: string) {
    super(
      `The encryption storage for ${userId} is missing while its existing Matrix device login is still present. ` +
        'Continuing would replace that device identity and make encrypted messages and calls unreadable to other devices. ' +
        'Remove this account, then sign in again to create a new Matrix device.'
    );
    this.name = 'MissingCryptoStoreError';
  }
}

export class DeviceIdentityVerificationError extends Error {
  constructor(userId: string) {
    super(
      `MindRoom Chat could not safely verify the encryption storage and device identity for ${userId}. ` +
        'Check your connection and browser storage access, then retry. No encryption keys were changed.'
    );
    this.name = 'DeviceIdentityVerificationError';
  }
}

const inspectDatabaseExistence = async (name: string): Promise<boolean | undefined> => {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.open !== 'function') return undefined;

  return new Promise<boolean | undefined>((resolve) => {
    let created = false;
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name);
    } catch {
      resolve(undefined);
      return;
    }
    request.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0) return;
      created = true;
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      request.result.close();
      resolve(!created);
    };
    request.onerror = () => {
      if (created || request.error?.name === 'AbortError') {
        // Aborting the initial versionchange transaction leaves no database.
        // Do not issue a racing delete against another tab starting crypto.
        resolve(false);
        return;
      }
      resolve(undefined);
    };
  });
};

export const inspectCryptoStoreContinuity = async (
  session: ClientBootstrapSession
): Promise<boolean | undefined> => {
  if (typeof indexedDB === 'undefined') return undefined;
  const [cryptoStoreName] = getSessionRustCryptoStoreNames(session);

  if (typeof indexedDB.databases === 'function') {
    try {
      const databases = await indexedDB.databases();
      const names = new Set(databases.flatMap(({ name }) => (name ? [name] : [])));
      // StoreHandle.open(prefix, undefined) uses the unencrypted Rust store,
      // which creates only ::matrix-sdk-crypto. The ::matrix-sdk-crypto-meta
      // database exists only when a password or storage key protects the
      // local store, so its absence says nothing about device continuity.
      return names.has(cryptoStoreName);
    } catch {
      // Safari privacy modes and older browsers may deny enumeration. Fall
      // back to non-destructively opening the required database.
    }
  }

  return inspectDatabaseExistence(cryptoStoreName);
};

type DeviceKeysQueryResponse = {
  device_keys?: Record<
    string,
    Record<
      string,
      {
        keys?: Record<string, string>;
      }
    >
  >;
};

export const serverHasDeviceIdentity = async (
  mx: MatrixClient,
  session: ClientBootstrapSession
): Promise<boolean> => {
  let body: DeviceKeysQueryResponse;
  try {
    body = await mx.http.authedRequest<DeviceKeysQueryResponse>(
      Method.Post,
      '/keys/query',
      undefined,
      {
        device_keys: {
          [session.userId]: [session.deviceId],
        },
      }
    );
  } catch {
    throw new DeviceIdentityVerificationError(session.userId);
  }

  const serverDevice = body.device_keys?.[session.userId]?.[session.deviceId];
  if (!serverDevice) return false;

  const serverKeys = serverDevice.keys;
  if (!serverKeys) throw new DeviceIdentityVerificationError(session.userId);
  const serverEd25519 = serverKeys[`ed25519:${session.deviceId}`];
  const serverCurve25519 = serverKeys[`curve25519:${session.deviceId}`];
  if (!serverEd25519 || !serverCurve25519) {
    throw new DeviceIdentityVerificationError(session.userId);
  }
  return true;
};
