import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  EventStatus,
  MatrixEvent,
  PendingEventOrdering,
  Room,
  type MatrixClient,
} from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMatrixClient, createMatrixFetchFn } from './matrixClientFactory';
import { useHomeserverUnreachable } from './homeserverReachability';

const mocks = vi.hoisted(() => ({
  traceDeepDiagnosticFetch: vi.fn(
    (baseFetch: typeof globalThis.fetch, input: RequestInfo | URL, init?: RequestInit) =>
      baseFetch(input, init)
  ),
  getCloudflareAccessToken: vi.fn<(url: string | URL) => string | undefined>(),
}));

vi.mock('../diagnostics/deepTrace', () => ({
  traceDeepDiagnosticFetch: mocks.traceDeepDiagnosticFetch,
}));

vi.mock('../native/cloudflareAccess', () => ({
  getCloudflareAccessToken: mocks.getCloudflareAccessToken,
}));

describe('createMatrixFetchFn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds credentials for same-origin requests', async () => {
    const baseFetch = vi.fn().mockResolvedValue({ ok: true });
    const originalLocation = (globalThis as { location?: Location }).location;

    try {
      (globalThis as { location?: Location }).location = {
        origin: 'https://example.com',
      } as Location;

      const fetchFn = createMatrixFetchFn(baseFetch as unknown as typeof fetch);
      await fetchFn('/_matrix/client', { method: 'GET' });
    } finally {
      (globalThis as { location?: Location }).location = originalLocation;
    }

    expect(baseFetch).toHaveBeenCalledWith('/_matrix/client', {
      method: 'GET',
      credentials: 'include',
    });
  });

  it('does not add credentials for cross-origin requests', async () => {
    const baseFetch = vi.fn().mockResolvedValue({ ok: true });
    const originalLocation = (globalThis as { location?: Location }).location;

    try {
      (globalThis as { location?: Location }).location = {
        origin: 'https://example.com',
      } as Location;

      const fetchFn = createMatrixFetchFn(baseFetch as unknown as typeof fetch);
      await fetchFn('https://other.example.com/_matrix/client', { method: 'GET' });
    } finally {
      (globalThis as { location?: Location }).location = originalLocation;
    }

    expect(baseFetch).toHaveBeenCalledWith('https://other.example.com/_matrix/client', {
      method: 'GET',
    });
  });

  it('sends the Cloudflare Access token only to the server it belongs to', async () => {
    mocks.getCloudflareAccessToken.mockImplementation((url) =>
      new URL(url).origin === 'https://hs.example' ? 'access-token' : undefined
    );
    const baseFetch = vi.fn().mockResolvedValue({ ok: true });
    const fetchFn = createMatrixFetchFn(baseFetch as unknown as typeof fetch);

    await fetchFn('https://hs.example/_matrix/client/v3/sync', {
      headers: { Authorization: 'Bearer matrix-token' },
    });
    await fetchFn('https://other.example/_matrix/client/v3/sync', { method: 'GET' });

    const headers = new Headers(baseFetch.mock.calls[0][1].headers);
    expect(headers.get('cf-access-token')).toBe('access-token');
    expect(headers.get('authorization')).toBe('Bearer matrix-token');
    expect(baseFetch.mock.calls[1][1]).toEqual({ method: 'GET' });
  });

  it('refuses redirects for requests carrying the Cloudflare Access token', async () => {
    // Fetch keeps custom headers across a cross-origin redirect.
    mocks.getCloudflareAccessToken.mockReturnValue('access-token');
    const baseFetch = vi.fn().mockResolvedValue({ ok: true });
    const fetchFn = createMatrixFetchFn(baseFetch as unknown as typeof fetch);

    await fetchFn('https://hs.example/_matrix/client/v3/sync');

    expect(baseFetch.mock.calls[0][1].redirect).toBe('error');
    mocks.getCloudflareAccessToken.mockReset();
  });

  it('keeps a captured Matrix delegate routed through dynamic tracing', async () => {
    const baseFetch = vi.fn().mockResolvedValue({ ok: true });
    const fetchFn = createMatrixFetchFn(baseFetch as unknown as typeof fetch);

    await fetchFn('https://matrix.example/_matrix/client/v3/sync');
    await fetchFn('https://matrix.example/_matrix/client/v3/sync');
    await fetchFn('https://matrix.example/_matrix/client/v3/sync');

    expect(mocks.traceDeepDiagnosticFetch).toHaveBeenCalledTimes(3);
    expect(baseFetch).toHaveBeenCalledTimes(3);
  });
});

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

const receiveFromSync = (room: Room, txnId: string, eventId: string) =>
  room.addLiveEvents(
    [
      new MatrixEvent({
        event_id: eventId,
        room_id: room.roomId,
        sender: '@alice:example.org',
        type: 'm.room.message',
        content: { msgtype: 'm.text', body: 'hello' },
        unsigned: { transaction_id: txnId },
      }),
    ],
    { addToState: false }
  );

describe('createMatrixClient message sends', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Each entry answers one send request: an event ID, an HTTP error status, or a dropped
  // connection, noticed at once, after 10 s ('slow'), after iOS suspended the app for two
  // hours ('suspended'), or when the test calls dropPending() ('pending').
  const setup = (responses: Array<string | number>) => {
    vi.useFakeTimers();
    let dropPending: () => void = () => undefined;
    const fetchFn = vi.fn(async () => {
      const response = responses.shift();
      if (response === undefined) throw new Error('Unexpected request');
      if (response === 'suspended') vi.setSystemTime(Date.now() + TWO_HOURS_MS);
      if (response === 'slow') {
        await new Promise((resolve) => {
          setTimeout(resolve, 10_000);
        });
      }
      if (response === 'pending') {
        await new Promise<void>((resolve) => {
          dropPending = resolve;
        });
      }
      if (['offline', 'suspended', 'slow', 'pending'].includes(String(response))) {
        throw new TypeError('Load failed');
      }
      if (typeof response === 'number') {
        return new Response(JSON.stringify({ errcode: 'M_FORBIDDEN', error: 'Forbidden' }), {
          status: response,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ event_id: response }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const mx = createMatrixClient({
      baseUrl: 'https://matrix.example',
      userId: '@alice:example.org',
      accessToken: 'token',
      // A dropped connection makes the client check /versions; keep that out of the sends.
      fetchFn: (input, init) =>
        String(input).endsWith('/_matrix/client/versions')
          ? Promise.reject(new TypeError('Load failed'))
          : (fetchFn as unknown as typeof fetch)(input, init),
    });
    const room = new Room('!room:example.org', mx, '@alice:example.org', {
      pendingEventOrdering: PendingEventOrdering.Chronological,
    });
    mx.store.storeRoom(room);
    const send = (txnId = 'txn-1') => {
      const sending = mx.sendMessage(room.roomId, { msgtype: 'm.text', body: 'hello' }, txnId);
      // Attach immediately: the send can reject while timers advance.
      const outcome = sending.catch((error: Error) => error);
      return { outcome, event: room.getEventForTxnId(txnId)! };
    };
    const requestPaths = () =>
      fetchFn.mock.calls.map((call) => new URL(String((call as unknown[])[0])).pathname);
    return { mx, room, send, fetchFn, requestPaths, dropPending: () => dropPending() };
  };

  it('retries a message after a dropped connection with the same transaction', async () => {
    const { send, requestPaths } = setup(['offline', '$sent']);
    const { outcome, event } = send();

    await vi.advanceTimersByTimeAsync(0);
    expect(event.status).toBe(EventStatus.SENDING);
    await vi.advanceTimersByTimeAsync(2000);

    expect(await outcome).toEqual({ event_id: '$sent' });
    expect(event.status).toBe(EventStatus.SENT);
    expect(requestPaths()).toEqual([
      '/_matrix/client/v3/rooms/!room%3Aexample.org/send/m.room.message/txn-1',
      '/_matrix/client/v3/rooms/!room%3Aexample.org/send/m.room.message/txn-1',
    ]);
  });

  it('gives up after the bounded backoff and resends with the same transaction', async () => {
    const { mx, room, send, fetchFn, requestPaths } = setup([
      'offline',
      'offline',
      'offline',
      'offline',
      'offline',
      '$resent',
    ]);
    const { outcome, event } = send();

    await vi.advanceTimersByTimeAsync(2000 + 4000 + 8000 + 16000 - 1);
    expect(event.status).toBe(EventStatus.SENDING);
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toMatchObject({ name: 'ConnectionError' });
    expect(event.status).toBe(EventStatus.NOT_SENT);
    expect(fetchFn).toHaveBeenCalledTimes(5);

    await expect(mx.resendEvent(event, room)).resolves.toEqual({ event_id: '$resent' });
    expect(event.status).toBe(EventStatus.SENT);
    expect(new Set(requestPaths())).toEqual(
      new Set(['/_matrix/client/v3/rooms/!room%3Aexample.org/send/m.room.message/txn-1'])
    );
  });

  it('replaces an unsent message with the copy the server did receive', async () => {
    const { room, send } = setup(['offline', 'offline', 'offline', 'offline', 'offline']);
    const { outcome, event } = send();
    await vi.advanceTimersByTimeAsync(30000);
    expect(await outcome).toMatchObject({ name: 'ConnectionError' });
    expect(event.status).toBe(EventStatus.NOT_SENT);

    await receiveFromSync(room, 'txn-1', '$received');

    expect(event.getId()).toBe('$received');
    expect(event.status).toBeNull();
    expect(room.getLiveTimeline().getEvents()).toEqual([event]);
  });

  it('keeps the queue going when /sync confirms a message while its retry waits', async () => {
    const { room, send, fetchFn } = setup(['offline', '$second']);
    const first = send('txn-1');
    const second = send('txn-2');
    await vi.advanceTimersByTimeAsync(0);
    expect(second.event.status).toBe(EventStatus.QUEUED);

    // The first attempt reached the server, but its response was lost.
    await receiveFromSync(room, 'txn-1', '$first');
    await vi.advanceTimersByTimeAsync(2000);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(second.event.status).toBe(EventStatus.SENT);
    expect(await first.outcome).toEqual({ event_id: '$first' });
    expect(await second.outcome).toEqual({ event_id: '$second' });
  });

  it.each([
    ['on its last attempt', ['offline', 'offline', 'offline', 'offline'], 30_000, 0],
    ['after the retry window', [], 0, TWO_HOURS_MS],
  ])(
    'counts a message as sent when /sync confirms it before its request fails %s',
    async (_when, failures, untilLastAttemptMs, suspendedMs) => {
      const { room, send, fetchFn, dropPending } = setup([...failures, 'pending', '$second']);
      const first = send('txn-1');
      await vi.advanceTimersByTimeAsync(untilLastAttemptMs);
      vi.setSystemTime(Date.now() + suspendedMs);
      const second = send('txn-2');

      // The request reached the server, then the connection dropped before its response.
      await receiveFromSync(room, 'txn-1', '$first');
      dropPending();
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchFn).toHaveBeenCalledTimes(failures.length + 2);
      expect(second.event.status).toBe(EventStatus.SENT);
      expect(await first.outcome).toEqual({ event_id: '$first' });
      expect(await second.outcome).toEqual({ event_id: '$second' });
    }
  );

  it('gives up within the window when each attempt takes 10 s to fail, as on the iPhone', async () => {
    const { send, fetchFn } = setup(['slow', 'slow', 'slow', 'slow', 'slow']);
    const { outcome, event } = send();

    // Attempts start at 0, 12, 26 and 44 s; a fifth would start at 70 s, past the window.
    await vi.advanceTimersByTimeAsync(54_000 - 1);
    expect(event.status).toBe(EventStatus.SENDING);
    await vi.advanceTimersByTimeAsync(1);

    expect(event.status).toBe(EventStatus.NOT_SENT);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
    expect(await outcome).toMatchObject({ name: 'ConnectionError' });
  });

  it.each([
    ['while a retry waits', ['offline'], TWO_HOURS_MS],
    ['during an attempt', ['suspended'], 0],
  ])('stops retrying when iOS suspends the app %s', async (_when, responses, suspendedMs) => {
    const { send, fetchFn } = setup([...responses]);
    const { outcome, event } = send();
    await vi.advanceTimersByTimeAsync(0);

    vi.setSystemTime(Date.now() + suspendedMs);
    await vi.advanceTimersByTimeAsync(2000);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(event.status).toBe(EventStatus.NOT_SENT);
    expect(await outcome).toBeInstanceOf(Error);
  });

  it('fails a queued message instead of sending it after iOS suspends the app', async () => {
    const { mx, room, send, fetchFn } = setup(['$resent']);
    let respond!: (response: Response) => void;
    fetchFn.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        })
    );
    const first = send('txn-1');
    const second = send('txn-2');
    await vi.advanceTimersByTimeAsync(0);

    vi.setSystemTime(Date.now() + TWO_HOURS_MS);
    respond(
      new Response(JSON.stringify({ event_id: '$first' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(second.event.status).toBe(EventStatus.NOT_SENT);
    expect(await first.outcome).toEqual({ event_id: '$first' });
    await expect(mx.resendEvent(second.event, room)).resolves.toEqual({ event_id: '$resent' });
  });

  it('does not retry a message the server rejected', async () => {
    const { send, fetchFn } = setup([403]);
    const { outcome, event } = send();

    await vi.advanceTimersByTimeAsync(0);

    expect(await outcome).toMatchObject({ errcode: 'M_FORBIDDEN' });
    expect(event.status).toBe(EventStatus.NOT_SENT);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('createMatrixClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks whether its requests reach the homeserver', async () => {
    vi.useFakeTimers();
    const baseFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const mx = createMatrixClient({
      baseUrl: 'https://matrix.example',
      accessToken: 'token',
      userId: '@alice:matrix.example',
      fetchFn: baseFetch as unknown as typeof fetch,
    });

    const seen = { unreachable: false };
    const Observer = ({ client }: { client: MatrixClient }) => {
      seen.unreachable = useHomeserverUnreachable(client);
      return null;
    };
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(Observer, { client: mx }));
    });

    await act(async () => {
      await expect(mx.sendTyping('!room:matrix.example', true, 1000)).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.unreachable).toBe(true);

    await act(async () => {
      await mx.sendTyping('!room:matrix.example', false, 0);
    });
    expect(seen.unreachable).toBe(false);
    act(() => renderer.unmount());
  });
});
