import {
  calculateRetryBackoff,
  createClient,
  MatrixScheduler,
  type ICreateClientOpts,
  type ISendEventResponse,
  type MatrixEvent,
} from 'matrix-js-sdk';
import { traceDeepDiagnosticFetch } from '../diagnostics/deepTrace';
import { bindHomeserverReachability, createHomeserverReachability } from './homeserverReachability';
import { getCloudflareAccessToken } from '../native/cloudflareAccess';

type MindroomCreateClientOpts = ICreateClientOpts & {
  threadSupport?: boolean;
};

type RuntimeLocation = {
  origin: string;
};

const getRuntimeOrigin = (): string | undefined => {
  if (typeof globalThis === 'undefined') return undefined;
  const { location } = globalThis as { location?: RuntimeLocation };
  if (!location?.origin) return undefined;
  return location.origin;
};

const resolveRequestUrl = (input: Parameters<typeof fetch>[0]): URL | null => {
  try {
    if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
    if (input instanceof URL) return input;
    return new URL(String(input), getRuntimeOrigin());
  } catch {
    return null;
  }
};

const isSameOriginRequest = (input: Parameters<typeof fetch>[0]): boolean => {
  const origin = getRuntimeOrigin();
  if (!origin) return false;
  const url = resolveRequestUrl(input);
  if (!url) return false;
  return url.origin === origin;
};

// A server behind Cloudflare Access needs its Access token on every request. Fetch would
// carry this header across a redirect to another origin, so such requests do not follow one.
const withCloudflareAccessToken = (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit
): RequestInit | undefined => {
  const url = resolveRequestUrl(input);
  const token = url ? getCloudflareAccessToken(url) : undefined;
  if (!token) return init;
  const headers = new Headers(init?.headers);
  headers.set('cf-access-token', token);
  return { ...init, headers, redirect: 'error' };
};

export const createMatrixFetchFn =
  (baseFetch: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch =>
  (input, init) => {
    const requestInit = withCloudflareAccessToken(input, init);
    return !isSameOriginRequest(input)
      ? traceDeepDiagnosticFetch(baseFetch, input, requestInit)
      : traceDeepDiagnosticFetch(baseFetch, input, {
          ...requestInit,
          credentials: 'include',
        });
  };

const MESSAGE_RETRY_WINDOW_MS = 60_000;
const queuedAt = new WeakMap<MatrixEvent, number>();

const isPastRetryWindow = (event: MatrixEvent | null, delayMs = 0): boolean => {
  const startedAt = event ? queuedAt.get(event) : undefined;
  return startedAt !== undefined && Date.now() + delayMs - startedAt > MESSAGE_RETRY_WINDOW_MS;
};

const retryMessageSend: MatrixScheduler['retryAlgorithm'] = (event, attempts, err) => {
  const delayMs = calculateRetryBackoff(err, attempts, true);
  return delayMs >= 0 && !isPastRetryWindow(event, delayMs) ? delayMs : -1;
};

// Receiving the server's copy through /sync clears the local echo's status.
const isConfirmedBySync = (event: MatrixEvent): boolean => event.status === null;

/**
 * The SDK's default scheduler retries server errors but marks a message unsent on its
 * first network error, so a brief connection drop failed it for good. This one also retries
 * connection errors with the same backoff (2, 4, 8 and 16 s, same transaction ID), but a
 * message is only sent within a minute of being queued, also behind a slow message or when
 * iOS suspends the app: a message such as "stop" must not reach an agent long after it
 * was sent.
 */
class MessageSendScheduler extends MatrixScheduler {
  public constructor() {
    super(retryMessageSend);
  }

  // Runs once for each send and each user retry; automatic retries do not queue again.
  public queueEvent(event: MatrixEvent): Promise<ISendEventResponse> | null {
    const queued = super.queueEvent(event);
    if (queued) queuedAt.set(event, Date.now());
    return queued;
  }

  public setProcessFunction(send: (event: MatrixEvent) => Promise<ISendEventResponse>): void {
    super.setProcessFunction(async (event) => {
      // The server's copy can arrive through /sync while a retry waits or a request is in
      // flight, when an earlier attempt arrived but its response was lost. Treat the event as
      // sent: the SDK would otherwise fail to mark it as sending again, or give up on it and
      // reject the messages queued behind it.
      if (isConfirmedBySync(event)) return { event_id: event.getId()! };
      if (isPastRetryWindow(event)) throw new Error('The message retry window has passed.');
      try {
        return await send(event);
      } catch (error) {
        if (isConfirmedBySync(event)) return { event_id: event.getId()! };
        throw error;
      }
    });
  }
}

export const createMatrixClient = (options: MindroomCreateClientOpts) => {
  const reachability = createHomeserverReachability(
    createMatrixFetchFn(options.fetchFn ?? globalThis.fetch),
    options.baseUrl
  );
  const mx = createClient({
    ...options,
    fetchFn: reachability.fetchFn,
    scheduler: options.scheduler ?? new MessageSendScheduler(),
  } as ICreateClientOpts);
  bindHomeserverReachability(mx, reachability);
  return mx;
};
