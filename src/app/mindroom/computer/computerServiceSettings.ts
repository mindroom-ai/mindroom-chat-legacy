import { atom } from 'jotai';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  setStorageItemSafe,
} from '../../utils/safeLocalStorage';
import { resolveComputerApiUrl } from './api';

export const COMPUTER_SERVICE_STORAGE_KEY = 'mindroomComputerService.v1';

// null follows the deployment, or the server agents publish, an empty string disables computers, and an
// origin overrides it. Keep this preference on this device, rather than accepting endpoints from account data.
export type ComputerServicePreference = string | null;

export const loadComputerServicePreference = (
  storage: Storage | undefined = getSafeLocalStorage()
): ComputerServicePreference => {
  try {
    const value: unknown = JSON.parse(
      getStorageItemSafe(storage, COMPUTER_SERVICE_STORAGE_KEY) ?? 'null'
    );
    if (value === '') return '';
    return typeof value === 'string' ? resolveComputerApiUrl(value) ?? null : null;
  } catch {
    return null;
  }
};

export const resolveComputerServiceUrl = (
  preference: ComputerServicePreference,
  deploymentUrl?: string
): string | undefined => resolveComputerApiUrl(preference ?? deploymentUrl);

const preferenceAtom = atom<ComputerServicePreference>(loadComputerServicePreference());

export const computerServicePreferenceAtom = atom(
  (get) => get(preferenceAtom),
  (_get, set, value: ComputerServicePreference): boolean => {
    let next: ComputerServicePreference | undefined = value;
    if (value !== null) next = value.trim() === '' ? '' : resolveComputerApiUrl(value);
    if (next === undefined) return false;
    if (
      !setStorageItemSafe(getSafeLocalStorage(), COMPUTER_SERVICE_STORAGE_KEY, JSON.stringify(next))
    ) {
      return false;
    }
    set(preferenceAtom, next);
    return true;
  }
);
