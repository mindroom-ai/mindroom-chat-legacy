import type { MatrixClient } from 'matrix-js-sdk';
import type { SpecVersions } from '../cs-api';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../utils/safeLocalStorage';

const SPEC_VERSIONS_STORAGE_KEY_PREFIX = 'cinny_spec_versions::';

const getSpecVersionsStorageKey = (baseUrl: string, userId: string): string =>
  `${SPEC_VERSIONS_STORAGE_KEY_PREFIX}${baseUrl.replace(/\/+$/, '')}::${userId}`;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isBooleanRecord = (value: unknown): value is Record<string, boolean> =>
  isPlainObject(value) && Object.values(value).every((item) => typeof item === 'boolean');

const isCacheableSpecVersions = (value: unknown): value is SpecVersions =>
  isPlainObject(value) &&
  Array.isArray(value.versions) &&
  value.versions.length > 0 &&
  value.versions.every((version) => typeof version === 'string') &&
  (value.unstable_features === undefined || isBooleanRecord(value.unstable_features));

export const readCachedSpecVersions = (
  baseUrl: string,
  userId: string
): SpecVersions | undefined => {
  const storage = getSafeLocalStorage();
  const key = getSpecVersionsStorageKey(baseUrl, userId);
  const stored = getStorageItemSafe(storage, key);
  if (!stored) return undefined;

  try {
    const value: unknown = JSON.parse(stored);
    if (isCacheableSpecVersions(value)) return value;
  } catch {
    // Remove corrupt entries below.
  }

  removeStorageItemSafe(storage, key);
  return undefined;
};

/** The spec versions cached for the client's homeserver and user, if any. */
export const readClientCachedSpecVersions = (mx: MatrixClient): SpecVersions | undefined => {
  const userId = mx.getUserId();
  return userId ? readCachedSpecVersions(mx.baseUrl, userId) : undefined;
};

export const writeCachedSpecVersions = (
  baseUrl: string,
  userId: string,
  versions: SpecVersions
): void => {
  if (!isCacheableSpecVersions(versions)) return;
  setStorageItemSafe(
    getSafeLocalStorage(),
    getSpecVersionsStorageKey(baseUrl, userId),
    JSON.stringify(versions)
  );
};

export const removeCachedSpecVersions = (baseUrl: string, userId: string): void => {
  removeStorageItemSafe(getSafeLocalStorage(), getSpecVersionsStorageKey(baseUrl, userId));
};
