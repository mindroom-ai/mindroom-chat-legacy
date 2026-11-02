/// <reference lib="WebWorker" />

import {
  cleanupOutdatedCaches,
  PrecacheController,
  PrecacheRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import type { RouteHandlerCallback } from 'workbox-core/types';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { looksLikeMediaRequest, validMediaRequest } from './swMediaAuth';
import { buildAuthenticatedMediaRequestInit } from './swMediaFetch';
import {
  fetchNavigationWithShellFallback,
  navigationFallbackExcludePathPattern,
  NON_DISRUPTIVE_UPDATE_PARAM,
  readNavigationFallbackExcludePaths,
  RUNTIME_NAVIGATION_PATHS,
} from './serviceWorkerNavigation';

export type {};
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

const precacheManifest = self.__WB_MANIFEST;
const precacheController = new PrecacheController();
precacheController.addToCacheList(precacheManifest);
cleanupOutdatedCaches();

const supportsNonDisruptiveUpdates =
  new URL(self.location.href).searchParams.get(NON_DISRUPTIVE_UPDATE_PARAM) === '1';

const navigationFallbackDenylist = [
  /^\/api(?:\/|$)/,
  /^\/(?:[^/]+\/)?_matrix(?:\/|$)/,
  /^\/(?:[^/]+\/)?_synapse(?:\/|$)/,
  /^\/(?:[^/]+\/)?\.well-known(?:\/|$)/,
  // Static documents (the embedded Element Call widget iframe navigates to
  // /public/element-call/index.html); serving the app shell instead leaves
  // calls stuck on "Joining" because the widget never boots. Workbox matches
  // the denylist against pathname + search, so "?" is a valid boundary too
  // (fragments never reach the service worker, so "#" is not).
  /^\/(?:[^/]+\/)?public(?:\/|\?|$)/,
  ...RUNTIME_NAVIGATION_PATHS.map(navigationFallbackExcludePathPattern),
  ...readNavigationFallbackExcludePaths(self.location.href).map(
    navigationFallbackExcludePathPattern
  ),
];

// Register the navigation fallback only when the manifest includes the shell.
// The media-auth fetch handler below works without it.
const precachesAppShell = precacheManifest.some(
  (entry) => (typeof entry === 'string' ? entry : entry.url) === 'index.html'
);
if (precachesAppShell) {
  const navigationHandler: RouteHandlerCallback = (options) =>
    fetchNavigationWithShellFallback(options.request, () =>
      precacheController.matchPrecache('index.html')
    );
  registerRoute(
    new NavigationRoute(navigationHandler, {
      denylist: navigationFallbackDenylist,
    })
  );
}
// Navigation must be registered first so app routes receive the cached shell
// and the explicit authentication marker can bypass it once.
registerRoute(new PrecacheRoute(precacheController));

type SessionInfo = {
  accessToken: string;
  baseUrl: string;
};

/**
 * Store session per client (tab)
 */
const sessions = new Map<string, SessionInfo>();
const pendingSessionRequests = new Map<
  string,
  {
    promise: Promise<SessionInfo | undefined>;
    resolve: (session?: SessionInfo) => void;
    waiters: number;
  }
>();

async function cleanupDeadClients() {
  const activeClients = await self.clients.matchAll();
  const activeIds = new Set(activeClients.map((c) => c.id));

  Array.from(sessions.keys()).forEach((id) => {
    if (!activeIds.has(id)) {
      sessions.delete(id);
    }
  });
  Array.from(pendingSessionRequests.keys()).forEach((id) => {
    if (!activeIds.has(id)) pendingSessionRequests.delete(id);
  });
}

function setSession(clientId: string, accessToken: unknown, baseUrl: unknown) {
  let validBaseUrl: string | undefined;
  if (typeof baseUrl === 'string') {
    try {
      const parsedBaseUrl = new URL(baseUrl);
      if (parsedBaseUrl.protocol === 'https:' || parsedBaseUrl.protocol === 'http:') {
        validBaseUrl = parsedBaseUrl.toString();
      }
    } catch {
      // Invalid base URLs clear the client session below.
    }
  }

  if (typeof accessToken === 'string' && accessToken.length > 0 && validBaseUrl) {
    sessions.set(clientId, { accessToken, baseUrl: validBaseUrl });
  } else {
    // Logout or invalid session
    sessions.delete(clientId);
  }

  const pending = pendingSessionRequests.get(clientId);
  if (pending) {
    pending.resolve(sessions.get(clientId));
    pendingSessionRequests.delete(clientId);
  }
}

const requestSession = async (
  clientId: string,
  timeoutMs = 3000
): Promise<SessionInfo | undefined> => {
  const client = await self.clients.get(clientId);
  if (!client) return undefined;

  let pending = pendingSessionRequests.get(clientId);
  if (!pending) {
    let resolve: (session?: SessionInfo) => void = () => undefined;
    const promise = new Promise<SessionInfo | undefined>((nextResolve) => {
      resolve = nextResolve;
    });
    pending = { promise, resolve, waiters: 0 };
    pendingSessionRequests.set(clientId, pending);
    client.postMessage({ type: 'requestSession' });
  }

  pending.waiters += 1;
  const session = await Promise.race([
    pending.promise,
    new Promise<undefined>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
  pending.waiters -= 1;
  if (!session && pending.waiters === 0 && pendingSessionRequests.get(clientId) === pending) {
    pendingSessionRequests.delete(clientId);
  }
  return session;
};

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      if (!supportsNonDisruptiveUpdates) {
        // The deployed predecessor monitor reloads as soon as the worker it
        // registered activates. Unregister instead: the current document
        // remains controlled until it unloads, while its next navigation goes
        // to the network and boots the new, marked registration.
        // unregister() is itself a queued service-worker job. Awaiting it from
        // this install event deadlocks that job behind the current update in
        // Chromium, so start it and let install settle first.
        void self.registration.unregister().catch(() => undefined);
        return;
      }

      await precacheController.install(event);

      if (!self.registration.active) await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      await precacheController.activate(event);
      await self.clients.claim();
      await cleanupDeadClients();
    })()
  );
});

/**
 * Receive session updates from clients
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const source = event.source;
  if (!source || !('id' in source) || !('url' in source)) return;
  if (typeof source.id !== 'string' || typeof source.url !== 'string') return;

  try {
    if (new URL(source.url).origin !== self.location.origin) return;
  } catch {
    return;
  }

  const { type, accessToken, baseUrl } = event.data || {};

  if (type === 'setSession') {
    setSession(source.id, accessToken, baseUrl);
    cleanupDeadClients();
  }
});

const fetchAuthenticatedMedia = async (request: Request, token: string): Promise<Response> => {
  const init = buildAuthenticatedMediaRequestInit(request, token);
  return request.mode === 'no-cors' ? fetch(request.url, init) : fetch(request, init);
};

const fetchAuthenticatedMediaWithFallback = async (
  request: Request,
  token: string
): Promise<Response> => {
  try {
    return await fetchAuthenticatedMedia(request, token);
  } catch {
    // If authenticated fetch fails unexpectedly, fall back to the original request.
    return fetch(request);
  }
};

/**
 * Legacy token request/response flow for tabs first controlled by updater
 * releases that claimed pages running the previous client bundle.
 * Those bundles answer `type: 'token'` but ignore `type: 'requestSession'`.
 * Delete once no pre-requestSession bundles remain in the wild.
 */
async function askForAccessToken(client: Client): Promise<string | undefined> {
  return new Promise((resolve) => {
    const responseKey = Math.random().toString(36);
    let listener: (messageEvent: ExtendableMessageEvent) => void = () => undefined;
    const timeoutId = setTimeout(() => {
      self.removeEventListener('message', listener);
      resolve(undefined);
    }, 1500);

    listener = (messageEvent: ExtendableMessageEvent) => {
      if (messageEvent.data?.responseKey !== responseKey) return;
      clearTimeout(timeoutId);
      self.removeEventListener('message', listener);
      resolve(typeof messageEvent.data?.token === 'string' ? messageEvent.data.token : undefined);
    };

    self.addEventListener('message', listener);
    client.postMessage({ responseKey, type: 'token' });
  });
}

self.addEventListener('fetch', (event: FetchEvent) => {
  const { url, method } = event.request;

  if (method !== 'GET') return;
  if (!looksLikeMediaRequest(url)) return;

  event.respondWith(
    (async (): Promise<Response> => {
      if (event.clientId) {
        const session = sessions.get(event.clientId);
        if (session && validMediaRequest(url, session.baseUrl)) {
          return fetchAuthenticatedMediaWithFallback(event.request, session.accessToken);
        }

        if (!session) {
          const requestedSession = await requestSession(event.clientId);
          if (requestedSession && validMediaRequest(url, requestedSession.baseUrl)) {
            return fetchAuthenticatedMediaWithFallback(event.request, requestedSession.accessToken);
          }

          // Pre-requestSession client bundle still in this tab (see
          // askForAccessToken doc).
          const client = await self.clients.get(event.clientId);
          if (client) {
            const token = await askForAccessToken(client);
            if (token) {
              return fetchAuthenticatedMediaWithFallback(event.request, token);
            }
          }
        }
      }

      return fetch(event.request);
    })()
  );
});
