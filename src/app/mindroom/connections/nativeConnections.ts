import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import type { IOpenIDToken } from 'matrix-js-sdk';
import { authenticateInNativeBrowser, isNativeIOS } from '../native/nativeSso';

const START_PATH = '/api/connections/session/native/start';
const CONFIRM_PATH = '/api/connections/session/native/confirm';
const CALLBACK_SCHEME = 'mindroom';
const CONFIRM_CALLBACK_HOST = 'connections';
const CONFIRM_CALLBACK_PATH = '/confirm';
const REQUEST_TIMEOUT_MS = 15_000;

export type OpenConnectionsPortalNativeOptions = {
  backendUrl: string;
  /** An agent's connect or reset link, as a path on the backend, that the portal opens once signed in. */
  next?: string;
  /** Requests a token bound to `audience`, the backend origin that answers both calls. */
  getOpenIdToken: (audience: string) => Promise<IOpenIDToken>;
  /** The original link, opened as before when the native sign-in cannot run (an old backend, a refusal, a network error). */
  fallbackUrl?: string;
  request?: typeof fetch;
  openFallback?: (url: string) => void | Promise<unknown>;
};

/** Whether this app can run the native sign-in: the iOS shell with its authentication-session plugin. */
export const nativeConnectionsSupported = (): boolean =>
  isNativeIOS() && Capacitor.isPluginAvailable('MindRoomAuth');

// The fallback runs after awaits, outside any user gesture, and WKWebView ignores `window.open` then.
const openInBrowser = (url: string): Promise<void> => Browser.open({ url });

// The user leaving a sheet, or a sheet already open, is a decision, not a failure.
const endsSilently = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'AUTH_CANCELLED' || code === 'AUTH_IN_PROGRESS';
};

/** The nonce of a `mindroom://connections/confirm?nonce=...` callback; anything else is not ours to confirm. */
const parseConfirmNonce = (callbackUrl: string | undefined): string | undefined => {
  if (!callbackUrl) return undefined;
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== `${CALLBACK_SCHEME}:` ||
    url.host !== CONFIRM_CALLBACK_HOST ||
    url.pathname !== CONFIRM_CALLBACK_PATH ||
    url.username ||
    url.password
  ) {
    return undefined;
  }
  const nonces = url.searchParams.getAll('nonce');
  return nonces.length === 1 && nonces[0] ? nonces[0] : undefined;
};

/** A URL the backend named for a browser sheet, accepted only on the origin that was asked. */
const sameOriginUrl = (value: unknown, origin: string): string => {
  if (typeof value !== 'string') throw new Error('Native sign-in answered no URL');
  const url = new URL(value);
  if (url.origin !== origin || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw new Error('Native sign-in answered a URL on another origin');
  }
  return url.toString();
};

/**
 * Opens the backend Connections portal signed in as the current Matrix user, from the iOS app.
 * Sheet one visits a one-time redeem URL and ends at `mindroom://connections/confirm?nonce=...`;
 * the app then confirms that nonce with its own token, and sheet two continues to `next` signed in.
 * The user closing sheet two after the provider's success page ends with `AUTH_CANCELLED`, which is normal.
 * Failures open `fallbackUrl` the way a bare link opens today; the user closing sheet one opens nothing.
 * Never rejects: a click handler starts this without awaiting it.
 */
export async function openConnectionsPortalNative({
  backendUrl,
  next,
  getOpenIdToken,
  fallbackUrl,
  request = fetch,
  openFallback = openInBrowser,
}: OpenConnectionsPortalNativeOptions): Promise<void> {
  const post = async (
    origin: string,
    path: string,
    body: unknown
  ): Promise<Record<string, unknown>> => {
    const response = await request(new URL(path, origin).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Native sign-in refused with HTTP ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  };

  const signIn = async (): Promise<void> => {
    const { origin } = new URL(backendUrl);
    const openidToken = await getOpenIdToken(origin);

    const started = await post(origin, START_PATH, {
      openid_token: openidToken,
      next: next ?? null,
    });
    const redeemUrl = sameOriginUrl(started.redeem_url, origin);

    let callbackUrl: string | undefined;
    try {
      callbackUrl = await authenticateInNativeBrowser(redeemUrl, CALLBACK_SCHEME, false);
    } catch (error) {
      if (endsSilently(error)) return;
      throw error;
    }
    const nonce = parseConfirmNonce(callbackUrl);
    if (!nonce) throw new Error('Native sign-in ended at an unexpected callback');

    const confirmed = await post(origin, CONFIRM_PATH, { openid_token: openidToken, nonce });
    const continueUrl = sameOriginUrl(confirmed.continue_url, origin);

    try {
      await authenticateInNativeBrowser(continueUrl, CALLBACK_SCHEME, false);
    } catch (error) {
      if (!endsSilently(error)) throw error;
    }
  };

  try {
    await signIn();
  } catch {
    // A fixed line only: errors can sit next to the token and the nonce, and URLs carry link tokens.
    // eslint-disable-next-line no-console
    console.warn(
      fallbackUrl
        ? '[MindRoom Chat] Native Connections sign-in failed; opening the link directly'
        : '[MindRoom Chat] Native Connections sign-in failed'
    );
    if (!fallbackUrl) return;
    try {
      await openFallback(fallbackUrl);
    } catch {
      // The link could not be opened either; there is nothing left to try, and the caller does not await this.
    }
  }
}
