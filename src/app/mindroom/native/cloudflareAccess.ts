import { useEffect, useReducer } from 'react';
import { Capacitor } from '@capacitor/core';
import { authenticateInNativeBrowser, isNativeIOS } from './nativeSso';

/**
 * Homeservers behind Cloudflare Access reject requests without an Access session, and the
 * app's web view never holds the Access cookie. A server opts in by publishing a handoff
 * page at this public path; the app opens it in the system browser, receives the Access
 * token, and sends it as `cf-access-token` with every Matrix request to that server.
 * `"push": false` in the advert keeps the app from registering push for that server.
 */
const DISCOVERY_PATH = '/.well-known/mindroom/cloudflare-access';
const CALLBACK_SCHEME = 'mindroom';
const CALLBACK_HOST = 'cloudflare-access';
const STORAGE_KEY_PREFIX = 'mindroom_cloudflare_access:';
const DISCOVERY_TIMEOUT_MS = 5_000;
// setTimeout runs at once for longer delays, so a longer session waits in steps.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

type AccessRecord = { handoffUrl: string; push?: false; token?: string };

const listeners = new Set<() => void>();

const originOf = (url: string | URL): string | undefined => {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

const readRecord = (url: string | URL): AccessRecord | undefined => {
  const origin = originOf(url);
  try {
    const stored = origin ? localStorage.getItem(STORAGE_KEY_PREFIX + origin) : null;
    return stored ? (JSON.parse(stored) as AccessRecord) : undefined;
  } catch {
    return undefined;
  }
};

const writeRecord = (origin: string, record: AccessRecord | undefined): void => {
  try {
    if (record) localStorage.setItem(STORAGE_KEY_PREFIX + origin, JSON.stringify(record));
    else localStorage.removeItem(STORAGE_KEY_PREFIX + origin);
  } catch {
    // Without storage the user signs in again on the next request.
  }
  listeners.forEach((listener) => listener());
};

const tokenExpiresAt = (token: string): number | undefined => {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const { exp } = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: unknown;
    };
    return typeof exp === 'number' ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
};

// The app uses a token until it expires; Access may revoke it sooner.
const isUsable = (token: string, now: number): boolean => {
  const expiresAt = tokenExpiresAt(token);
  return expiresAt !== undefined && expiresAt > now;
};

export const isCloudflareAccessSupported = (): boolean =>
  isNativeIOS() && Capacitor.isPluginAvailable('MindRoomAuth');

export const hasCloudflareAccess = (baseUrl: string): boolean => Boolean(readRecord(baseUrl));

/** False when the server's advert turns push off; read at the last discovery. */
export const cloudflareAccessAllowsPush = (baseUrl: string): boolean =>
  readRecord(baseUrl)?.push !== false;

/**
 * Looks for the server's handoff page and records it. A 404 or a response without a
 * valid same-origin HTTPS handoff URL clears the record; a failed request keeps it.
 */
export const discoverCloudflareAccess = async (
  baseUrl: string,
  request: typeof fetch = fetch
): Promise<boolean> => {
  const origin = originOf(baseUrl);
  if (!origin || !isCloudflareAccessSupported()) return false;

  let text: string;
  try {
    const response = await request(`${origin}${DISCOVERY_PATH}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    // Only a 404 or a complete answer shows whether the advert exists.
    if (!response.ok && response.status !== 404) return hasCloudflareAccess(origin);
    text = response.ok ? await response.text() : '';
  } catch {
    return hasCloudflareAccess(origin);
  }

  let body: { handoff_url?: unknown; push?: unknown } | undefined;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }

  const handoffUrl = typeof body?.handoff_url === 'string' ? body.handoff_url : undefined;
  const current = readRecord(origin);
  if (!handoffUrl || originOf(handoffUrl) !== origin || !origin.startsWith('https:')) {
    if (current) writeRecord(origin, undefined);
    return false;
  }
  const push = body?.push === false ? false : undefined;
  if (current?.handoffUrl !== handoffUrl) writeRecord(origin, { handoffUrl, push });
  else if (current.push !== push) writeRecord(origin, { ...current, push });
  return true;
};

export const getCloudflareAccessToken = (
  url: string | URL,
  now: number = Date.now()
): string | undefined => {
  const token = readRecord(url)?.token;
  return token && isUsable(token, now) ? token : undefined;
};

/**
 * Returns the token of a callback from `origin`'s handoff page. A handoff page can redirect to
 * another server's, so the callback names the origin of the page that issued the token.
 */
export const parseCloudflareAccessCallback = (
  url: string,
  origin: string,
  now: number = Date.now()
): string | undefined => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${CALLBACK_SCHEME}:` || parsed.host !== CALLBACK_HOST) {
      return undefined;
    }
    const params = new URLSearchParams(parsed.hash.slice(1));
    if (originOf(params.get('origin') ?? '') !== origin) return undefined;
    const token = params.get('token');
    return token && isUsable(token, now) ? token : undefined;
  } catch {
    return undefined;
  }
};

export const signInToCloudflareAccess = async (baseUrl: string): Promise<void> => {
  const origin = originOf(baseUrl);
  const record = readRecord(baseUrl);
  if (!origin || !record) throw new Error('This server does not use Cloudflare Access.');

  // Safari's cross-site tracking protection breaks the Access login in a session that
  // shares its cookies, so the sign-in runs in an ephemeral one.
  const callbackUrl = await authenticateInNativeBrowser(record.handoffUrl, CALLBACK_SCHEME, true);
  const token = callbackUrl ? parseCloudflareAccessCallback(callbackUrl, origin) : undefined;
  if (!token) throw new Error('Cloudflare Access sign-in returned no valid token.');
  writeRecord(origin, { ...record, token });
};

/** Asks for the Access sign-in again when its token has expired; a failed sign-in is ignored. */
export const renewExpiredCloudflareAccess = async (baseUrl: string): Promise<void> => {
  if (!hasCloudflareAccess(baseUrl) || getCloudflareAccessToken(baseUrl)) return;
  await signInToCloudflareAccess(baseUrl).catch(() => undefined);
};

/** Drops the token on sign-out; other accounts on the server can still sign in again. */
export const forgetCloudflareAccessToken = (baseUrl: string): void => {
  const origin = originOf(baseUrl);
  const record = readRecord(baseUrl);
  if (origin && record?.token) writeRecord(origin, { ...record, token: undefined });
};

/** True while a server behind Access has no usable token; updates when the token expires. */
export const useCloudflareAccessSignInRequired = (baseUrl: string | undefined): boolean => {
  const [, update] = useReducer((count: number) => count + 1, 0);
  const token = baseUrl ? readRecord(baseUrl)?.token : undefined;

  useEffect(() => {
    listeners.add(update);
    // Timers stall while iOS suspends the app, so check again when it returns.
    document.addEventListener('visibilitychange', update);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waitForExpiry = () => {
      const delay = token ? (tokenExpiresAt(token) ?? 0) - Date.now() : 0;
      if (delay <= 0) return;
      timer = setTimeout(() => {
        update();
        waitForExpiry();
      }, Math.min(delay, MAX_TIMER_DELAY_MS));
    };
    waitForExpiry();
    return () => {
      listeners.delete(update);
      document.removeEventListener('visibilitychange', update);
      clearTimeout(timer);
    };
  }, [token]);

  return Boolean(baseUrl && hasCloudflareAccess(baseUrl) && !getCloudflareAccessToken(baseUrl));
};
