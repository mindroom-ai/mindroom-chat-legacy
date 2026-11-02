import type { IOpenIDToken } from 'matrix-js-sdk';

const PORTAL_PATH = '/connections/';
const HANDOFF_PATH = '/api/connections/session/handoff';
const PORTAL_WINDOW_NAME = 'mindroom-connections';
const READY_MESSAGE_TYPE = 'mindroom:connections-ready';
const OPENID_MESSAGE_TYPE = 'mindroom:connections-openid';
const DEFAULT_POLL_MS = 1000;

export type OpenConnectionsPortalOptions = {
  backendUrl: string;
  /** Requests a token bound to `audience`, the backend origin the portal window is answered at. */
  getOpenIdToken: (audience: string) => Promise<IOpenIDToken>;
  /** An agent's connect or reset link, as a path on the backend, that the portal opens once signed in. */
  next?: string;
  win?: Window;
  pollMs?: number;
};

const isReadyMessage = (data: unknown): boolean =>
  typeof data === 'object' &&
  data !== null &&
  (data as { type?: unknown }).type === READY_MESSAGE_TYPE;

// A second click reuses the named window, so only one session may answer its ready messages.
let stopPreviousSession: (() => void) | undefined;

/**
 * Opens the backend Connections portal and answers its ready message with a Matrix OpenID token.
 * Call it synchronously from a click handler so popup blockers allow the window.
 * The token is requested per ready message, so a portal reload after session expiry gets a fresh one.
 */
export function openConnectionsPortal({
  backendUrl,
  getOpenIdToken,
  next,
  win = window,
  pollMs = DEFAULT_POLL_MS,
}: OpenConnectionsPortalOptions): 'opened' | 'blocked' {
  const backendOrigin = new URL(backendUrl).origin;
  const portal = new URL(PORTAL_PATH, backendUrl);
  if (next) portal.searchParams.set('next', next);
  const portalUrl = portal.toString();

  // No `noopener`: the portal needs `window.opener` to ask for the token.
  const target = win.open(portalUrl, PORTAL_WINDOW_NAME);
  if (!target) return 'blocked';

  stopPreviousSession?.();

  let stopped = false;
  const reply = async (): Promise<void> => {
    const openidToken = await getOpenIdToken(backendOrigin);
    // A token requested before the session ended must not reach a window another account may now own.
    if (stopped) return;
    // The backend origin as target origin makes the browser drop the token if the window navigated elsewhere.
    target.postMessage({ type: OPENID_MESSAGE_TYPE, openid_token: openidToken }, backendOrigin);
  };

  const onMessage = (event: MessageEvent): void => {
    if (event.source !== target || event.origin !== backendOrigin) return;
    if (!isReadyMessage(event.data)) return;
    // A failed token request sends nothing; the portal shows its own sign-in message.
    reply().catch(() => undefined);
  };

  let interval: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => {
    stopped = true;
    win.removeEventListener('message', onMessage);
    clearInterval(interval);
    if (stopPreviousSession === stop) stopPreviousSession = undefined;
  };

  win.addEventListener('message', onMessage);
  interval = setInterval(() => {
    if (target.closed) stop();
  }, pollMs);
  stopPreviousSession = stop;

  return 'opened';
}

/**
 * Whether this page can hand a token to `backendUrl` by form post: a post from an HTTPS page to an HTTP backend
 * carries `Origin: null`, which the backend refuses, while the pop-up handshake still works there.
 */
export const connectionsHandoffSupported = (
  backendUrl: string,
  pageProtocol: string = window.location.protocol
): boolean => !(pageProtocol === 'https:' && new URL(backendUrl).protocol === 'http:');

/**
 * Signs the browser in to the backend's Connections portal and opens it in this tab, by posting `openidToken` as a
 * form: the browser sets the request's Origin, which the backend checks against the Chat origins it allows.
 * The token travels in the request body, never in a URL.
 * `returnTo` replaces this page's history entry first, so Back from the portal lands there instead of here.
 */
export function submitConnectionsHandoff(
  backendUrl: string,
  openidToken: IOpenIDToken,
  returnTo?: string,
  win: Window = window
): void {
  const doc = win.document;
  const form = doc.createElement('form');
  form.method = 'POST';
  form.action = new URL(HANDOFF_PATH, backendUrl).toString();
  const field = doc.createElement('input');
  field.type = 'hidden';
  field.name = 'openid_token';
  field.value = JSON.stringify(openidToken);
  form.append(field);
  doc.body.append(form);
  if (returnTo) win.history.replaceState(null, '', returnTo);
  form.submit();
}
