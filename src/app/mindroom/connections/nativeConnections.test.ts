// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import type { IOpenIDToken } from 'matrix-js-sdk';
import { authenticateInNativeBrowser, isNativeIOS } from '../native/nativeSso';
import { nativeConnectionsSupported, openConnectionsPortalNative } from './nativeConnections';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isPluginAvailable: vi.fn() },
}));

vi.mock('@capacitor/browser', () => ({
  Browser: { open: vi.fn() },
}));

vi.mock('../native/nativeSso', () => ({
  authenticateInNativeBrowser: vi.fn(),
  isNativeIOS: vi.fn(),
}));

const BACKEND = 'https://app.example';
const START_URL = `${BACKEND}/api/connections/session/native/start`;
const CONFIRM_URL = `${BACKEND}/api/connections/session/native/confirm`;
const REDEEM_URL = `${BACKEND}/api/connections/session/native/redeem?start=S1`;
const CONTINUE_URL = `${BACKEND}/api/connections/session/native/continue?confirmed=K1`;
const NEXT = '/api/oauth/notion/authorize?connect_token=t';
const FALLBACK_URL = `${BACKEND}${NEXT}`;
const NONCE = 'nonce-secret-1';
// The redeem page names the origin of the backend that issued the nonce, URL-encoded.
const ORIGIN_PARAM = `origin=${encodeURIComponent(BACKEND)}`;
const CONFIRM_CALLBACK = `mindroom://connections/confirm?nonce=${NONCE}&${ORIGIN_PARAM}`;

const TOKEN: IOpenIDToken = {
  access_token: 'openid-token-secret',
  token_type: 'Bearer',
  matrix_server_name: 'example.org',
  expires_in: 3600,
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const sheetError = (code: string): Error => Object.assign(new Error(code), { code });

type Responses = { start?: () => Response | Promise<Response>; confirm?: () => Response };

const makeRequest = ({ start, confirm }: Responses = {}) =>
  vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === START_URL) return start ? start() : json({ redeem_url: REDEEM_URL });
    if (url === CONFIRM_URL) return confirm ? confirm() : json({ continue_url: CONTINUE_URL });
    throw new Error(`unexpected request to ${url}`);
  });

const bodyOf = (request: ReturnType<typeof makeRequest>, index: number): unknown =>
  JSON.parse(String(request.mock.calls[index]?.[1]?.body));

const sheet = vi.mocked(authenticateInNativeBrowser);

describe('nativeConnectionsSupported', () => {
  beforeEach(() => {
    vi.mocked(isNativeIOS).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
  });

  afterEach(() => {
    vi.mocked(isNativeIOS).mockReset();
    vi.mocked(Capacitor.isPluginAvailable).mockReset();
  });

  it('is true on iOS when the auth plugin is available', () => {
    expect(nativeConnectionsSupported()).toBe(true);
    expect(Capacitor.isPluginAvailable).toHaveBeenCalledWith('MindRoomAuth');
  });

  it('is false on iOS without the auth plugin', () => {
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);

    expect(nativeConnectionsSupported()).toBe(false);
  });

  it('is false on the web and on Android, even if a plugin of that name were present', () => {
    // `isNativeIOS` is false on both; the plugin check must not make up for it.
    vi.mocked(isNativeIOS).mockReturnValue(false);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);

    expect(nativeConnectionsSupported()).toBe(false);
  });
});

describe('openConnectionsPortalNative', () => {
  const getOpenIdToken = vi.fn<(audience: string) => Promise<IOpenIDToken>>();
  const openFallback = vi.fn<(url: string) => void>();

  const open = (
    request: typeof fetch,
    overrides: { backendUrl?: string; fallbackUrl?: string; next?: string } = {}
  ) =>
    openConnectionsPortalNative({
      backendUrl: BACKEND,
      next: NEXT,
      fallbackUrl: FALLBACK_URL,
      getOpenIdToken,
      request,
      openFallback,
      ...overrides,
    });

  // The fallback logs one line; keep it out of the test output and let the logging tests read it.
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    getOpenIdToken.mockResolvedValue(TOKEN);
    sheet.mockImplementation(async (url) => (url === REDEEM_URL ? CONFIRM_CALLBACK : undefined));
  });

  afterEach(() => {
    getOpenIdToken.mockReset();
    openFallback.mockReset();
    sheet.mockReset();
    vi.mocked(Browser.open).mockReset();
    vi.restoreAllMocks();
  });

  it('runs start, sheet one, confirm and sheet two in order', async () => {
    const order: string[] = [];
    const request = makeRequest({
      start: () => {
        order.push('start');
        return json({ redeem_url: REDEEM_URL });
      },
      confirm: () => {
        order.push('confirm');
        return json({ continue_url: CONTINUE_URL });
      },
    });
    sheet.mockImplementation(async (url) => {
      order.push(url === REDEEM_URL ? 'sheet1' : 'sheet2');
      return url === REDEEM_URL ? CONFIRM_CALLBACK : undefined;
    });

    await open(request);

    expect(order).toEqual(['start', 'sheet1', 'confirm', 'sheet2']);
    // One token serves both calls, and it is bound to the backend origin.
    expect(getOpenIdToken).toHaveBeenCalledTimes(1);
    expect(getOpenIdToken).toHaveBeenCalledWith(BACKEND);
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(bodyOf(request, 0)).toEqual({ openid_token: TOKEN, next: NEXT });
    expect(request.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect(bodyOf(request, 1)).toEqual({ openid_token: TOKEN, nonce: NONCE });
    expect(sheet).toHaveBeenNthCalledWith(1, REDEEM_URL, 'mindroom', false);
    expect(sheet).toHaveBeenNthCalledWith(2, CONTINUE_URL, 'mindroom', false);
    expect(openFallback).not.toHaveBeenCalled();
  });

  it('resolves when the user closes sheet two after the provider page', async () => {
    const request = makeRequest();
    sheet.mockImplementation(async (url) => {
      if (url === REDEEM_URL) return CONFIRM_CALLBACK;
      throw sheetError('AUTH_CANCELLED');
    });

    await expect(open(request)).resolves.toBeUndefined();

    expect(sheet).toHaveBeenCalledTimes(2);
    expect(openFallback).not.toHaveBeenCalled();
  });

  it('sends a null next when no link is given', async () => {
    const request = makeRequest();

    await open(request, { next: undefined, fallbackUrl: undefined });

    expect(bodyOf(request, 0)).toEqual({ openid_token: TOKEN, next: null });
  });

  it('asks for the token of the backend origin even when the URL has a path', async () => {
    const request = makeRequest();

    await openConnectionsPortalNative({
      backendUrl: `${BACKEND}/some/prefix?x=1`,
      next: NEXT,
      getOpenIdToken,
      request,
      openFallback,
    });

    expect(getOpenIdToken).toHaveBeenCalledWith(BACKEND);
    expect(request.mock.calls[0]?.[0]).toBe(START_URL);
  });

  it('confirms a nonce whose callback names the origin of the backend it started with', async () => {
    const local = 'http://localhost:8765';
    const request = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === `${local}/api/connections/session/native/start`) {
        return json({ redeem_url: `${local}/api/connections/session/native/redeem?start=S1` });
      }
      if (url === `${local}/api/connections/session/native/confirm`) {
        return json({
          continue_url: `${local}/api/connections/session/native/continue?confirmed=K1`,
        });
      }
      throw new Error(`unexpected request to ${url}`);
    });
    sheet.mockImplementation(async (url) =>
      url.includes('/redeem?')
        ? `mindroom://connections/confirm?nonce=${NONCE}&origin=${encodeURIComponent(local)}`
        : undefined
    );

    await open(request, { backendUrl: `${local}/` });

    expect(request).toHaveBeenCalledTimes(2);
    expect(bodyOf(request, 1)).toEqual({ openid_token: TOKEN, nonce: NONCE });
    expect(sheet).toHaveBeenCalledTimes(2);
    expect(openFallback).not.toHaveBeenCalled();
  });

  it('never posts a nonce that another backend issued to the backend it started with', async () => {
    // A malicious backend answers start with a redeem URL of its own that redirects sheet one to an honest
    // backend's redeem URL holding the attacker's start state. The honest page names itself in the callback,
    // so the app refuses its nonce instead of handing it to the malicious backend, which could confirm it there.
    const request = makeRequest();
    sheet.mockResolvedValueOnce(
      `mindroom://connections/confirm?nonce=${NONCE}&origin=${encodeURIComponent(
        'https://honest.example'
      )}`
    );

    await open(request);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe(START_URL);
    expect(JSON.stringify(request.mock.calls)).not.toContain(NONCE);
    expect(sheet).toHaveBeenCalledTimes(1);
    expect(openFallback).toHaveBeenCalledTimes(1);
    expect(openFallback).toHaveBeenCalledWith(FALLBACK_URL);
  });

  describe('falls back to the original link', () => {
    it('on a 404 from an old backend, without opening a sheet', async () => {
      const request = makeRequest({ start: () => json({ detail: 'Not Found' }, 404) });

      await open(request);

      expect(openFallback).toHaveBeenCalledTimes(1);
      expect(openFallback).toHaveBeenCalledWith(FALLBACK_URL);
      expect(sheet).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledTimes(1);
    });

    it.each([401, 403, 500])('on a %i from start', async (status) => {
      const request = makeRequest({ start: () => json({ detail: 'no' }, status) });

      await open(request);

      expect(openFallback).toHaveBeenCalledTimes(1);
      expect(sheet).not.toHaveBeenCalled();
    });

    it('on a network error from start', async () => {
      const request = makeRequest({
        start: () => Promise.reject(new TypeError('Load failed')),
      });

      await open(request);

      expect(openFallback).toHaveBeenCalledTimes(1);
      expect(openFallback).toHaveBeenCalledWith(FALLBACK_URL);
      expect(sheet).not.toHaveBeenCalled();
    });

    it('when the token request fails', async () => {
      getOpenIdToken.mockRejectedValue(new Error('Matrix client stopped'));
      const request = makeRequest();

      await open(request);

      expect(openFallback).toHaveBeenCalledTimes(1);
      expect(request).not.toHaveBeenCalled();
      expect(sheet).not.toHaveBeenCalled();
    });

    it.each([
      ['no redeem_url', { ok: true }],
      ['a non-string redeem_url', { redeem_url: 7 }],
      ['a redeem_url on another origin', { redeem_url: 'https://evil.example/redeem?start=S1' }],
      ['a redeem_url that is not http(s)', { redeem_url: 'mindroom://connections/confirm' }],
    ])('when start answers %s', async (_label, body) => {
      const request = makeRequest({ start: () => json(body) });

      await open(request);

      expect(openFallback).toHaveBeenCalledTimes(1);
      expect(sheet).not.toHaveBeenCalled();
    });

    it('when start answers something that is not JSON', async () => {
      const request = makeRequest({ start: () => new Response('<html>', { status: 200 }) });

      await open(request);

      expect(openFallback).toHaveBeenCalledTimes(1);
      expect(sheet).not.toHaveBeenCalled();
    });

    it('on a 403 from confirm, without opening a second sheet', async () => {
      const request = makeRequest({ confirm: () => json({ detail: 'no' }, 403) });

      await open(request);

      expect(openFallback).toHaveBeenCalledTimes(1);
      expect(openFallback).toHaveBeenCalledWith(FALLBACK_URL);
      expect(sheet).toHaveBeenCalledTimes(1);
    });

    it('on a network error from confirm', async () => {
      const request = makeRequest({
        confirm: () => {
          throw new TypeError('Load failed');
        },
      });

      await open(request);

      expect(openFallback).toHaveBeenCalledTimes(1);
      expect(sheet).toHaveBeenCalledTimes(1);
    });

    it('when confirm answers a continue_url on another origin', async () => {
      const request = makeRequest({
        confirm: () => json({ continue_url: 'https://evil.example/continue?confirmed=K1' }),
      });

      await open(request);

      expect(openFallback).toHaveBeenCalledTimes(1);
      expect(sheet).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['another mindroom URL', `mindroom://auth/x?nonce=n&${ORIGIN_PARAM}`],
      ['an https URL with a nonce', `https://evil.example/?nonce=n&${ORIGIN_PARAM}`],
      [
        'the right URL on another host',
        `https://app.example/connections/confirm?nonce=n&${ORIGIN_PARAM}`,
      ],
      ['the confirm URL without a nonce', `mindroom://connections/confirm?${ORIGIN_PARAM}`],
      [
        'the confirm URL with an empty nonce',
        `mindroom://connections/confirm?nonce=&${ORIGIN_PARAM}`,
      ],
      [
        'the confirm URL with two nonces',
        `mindroom://connections/confirm?nonce=a&nonce=b&${ORIGIN_PARAM}`,
      ],
      ['the confirm URL without an origin', 'mindroom://connections/confirm?nonce=n'],
      ['the confirm URL with an empty origin', 'mindroom://connections/confirm?nonce=n&origin='],
      [
        'the confirm URL with two origins',
        `mindroom://connections/confirm?nonce=n&${ORIGIN_PARAM}&${ORIGIN_PARAM}`,
      ],
      [
        'the confirm URL naming another origin',
        `mindroom://connections/confirm?nonce=n&origin=${encodeURIComponent(
          'https://honest.example'
        )}`,
      ],
      [
        'the confirm URL naming the backend URL rather than its origin',
        `mindroom://connections/confirm?nonce=n&origin=${encodeURIComponent(`${BACKEND}/`)}`,
      ],
      ['another connections path', `mindroom://connections/other?nonce=n&${ORIGIN_PARAM}`],
      ['credentials in the URL', `mindroom://user@connections/confirm?nonce=n&${ORIGIN_PARAM}`],
      ['something that is not a URL', 'not a url'],
      ['no URL at all', undefined],
    ])('when sheet one ends at %s', async (_label, callback) => {
      const request = makeRequest();
      sheet.mockResolvedValueOnce(callback);

      await open(request);

      expect(request).toHaveBeenCalledTimes(1);
      expect(openFallback).toHaveBeenCalledTimes(1);
      expect(openFallback).toHaveBeenCalledWith(FALLBACK_URL);
      expect(sheet).toHaveBeenCalledTimes(1);
    });

    it.each(['AUTH_FAILED', 'AUTH_START_FAILED', 'INVALID_URL'])(
      'when sheet one rejects with %s',
      async (code) => {
        const request = makeRequest();
        sheet.mockRejectedValueOnce(sheetError(code));

        await open(request);

        expect(request).toHaveBeenCalledTimes(1);
        expect(openFallback).toHaveBeenCalledTimes(1);
        expect(sheet).toHaveBeenCalledTimes(1);
      }
    );

    it('when sheet two fails to run', async () => {
      const request = makeRequest();
      sheet.mockImplementation(async (url) => {
        if (url === REDEEM_URL) return CONFIRM_CALLBACK;
        throw sheetError('AUTH_START_FAILED');
      });

      await open(request);

      expect(openFallback).toHaveBeenCalledTimes(1);
      expect(sheet).toHaveBeenCalledTimes(2);
    });

    it('opens nothing and does not throw when there is no fallback URL', async () => {
      const request = makeRequest({ start: () => json({ detail: 'Not Found' }, 404) });

      await expect(open(request, { fallbackUrl: undefined })).resolves.toBeUndefined();

      expect(openFallback).not.toHaveBeenCalled();
    });

    it('opens the link in the in-app browser by default, which needs no user gesture', async () => {
      const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null);
      vi.mocked(Browser.open).mockResolvedValue(undefined);
      const request = makeRequest({ start: () => json({ detail: 'Not Found' }, 404) });

      await openConnectionsPortalNative({
        backendUrl: BACKEND,
        next: NEXT,
        fallbackUrl: FALLBACK_URL,
        getOpenIdToken,
        request,
      });

      expect(Browser.open).toHaveBeenCalledTimes(1);
      expect(Browser.open).toHaveBeenCalledWith({ url: FALLBACK_URL });
      // WKWebView ignores `window.open` after an await, so the old-backend case would do nothing.
      expect(windowOpen).not.toHaveBeenCalled();
    });

    it('resolves when the default in-app browser refuses to open', async () => {
      vi.mocked(Browser.open).mockRejectedValue(new Error('no browser'));
      const request = makeRequest({ start: () => json({ detail: 'Not Found' }, 404) });

      await expect(
        openConnectionsPortalNative({
          backendUrl: BACKEND,
          next: NEXT,
          fallbackUrl: FALLBACK_URL,
          getOpenIdToken,
          request,
        })
      ).resolves.toBeUndefined();

      expect(Browser.open).toHaveBeenCalledTimes(1);
    });

    it('resolves when the opener throws', async () => {
      openFallback.mockImplementation(() => {
        throw new Error('window.open blocked');
      });
      const request = makeRequest({ start: () => json({ detail: 'Not Found' }, 404) });

      await expect(open(request)).resolves.toBeUndefined();

      expect(openFallback).toHaveBeenCalledTimes(1);
    });

    it('resolves when the opener rejects', async () => {
      openFallback.mockRejectedValue(new Error('window.open blocked'));
      const request = makeRequest({ start: () => json({ detail: 'Not Found' }, 404) });

      await expect(open(request)).resolves.toBeUndefined();

      expect(openFallback).toHaveBeenCalledTimes(1);
    });

    it('opens the link when the backend URL cannot be parsed, with no request or sheet', async () => {
      const request = makeRequest();

      await expect(open(request, { backendUrl: 'not a url' })).resolves.toBeUndefined();

      expect(openFallback).toHaveBeenCalledTimes(1);
      expect(openFallback).toHaveBeenCalledWith(FALLBACK_URL);
      expect(getOpenIdToken).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
      expect(sheet).not.toHaveBeenCalled();
    });

    it('opens nothing when the backend URL cannot be parsed and there is no fallback URL', async () => {
      const request = makeRequest();

      await expect(
        open(request, { backendUrl: 'not a url', fallbackUrl: undefined })
      ).resolves.toBeUndefined();

      expect(openFallback).not.toHaveBeenCalled();
    });

    it.each([
      ['TimeoutError', 'start'],
      ['AbortError', 'start'],
      ['TimeoutError', 'confirm'],
      ['AbortError', 'confirm'],
    ] as const)('when a %s ends the %s request', async (errorName, stage) => {
      const aborted = Promise.reject(new DOMException('The operation timed out', errorName));
      aborted.catch(() => undefined);
      const request = makeRequest(
        stage === 'start'
          ? { start: () => aborted }
          : { confirm: () => aborted as unknown as Response }
      );

      await expect(open(request)).resolves.toBeUndefined();

      expect(openFallback).toHaveBeenCalledTimes(1);
      expect(openFallback).toHaveBeenCalledWith(FALLBACK_URL);
      // Confirm runs after sheet one; a start timeout never opens a sheet.
      expect(sheet).toHaveBeenCalledTimes(stage === 'start' ? 0 : 1);
    });
  });

  describe('request timeout', () => {
    it('gives start and confirm a 15 second abort signal', async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      const request = makeRequest();

      await open(request);

      expect(timeout).toHaveBeenCalledTimes(2);
      expect(timeout).toHaveBeenNthCalledWith(1, 15000);
      expect(timeout).toHaveBeenNthCalledWith(2, 15000);
      expect(request.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
      expect(request.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
      expect(openFallback).not.toHaveBeenCalled();
    });

    it('opens the link when a request that never answers is aborted by its signal', async () => {
      const controller = new AbortController();
      vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
      const request = vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation timed out', 'TimeoutError'))
            );
          })
      );

      const pending = open(request);
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      expect(openFallback).not.toHaveBeenCalled();
      controller.abort();
      await pending;

      expect(openFallback).toHaveBeenCalledTimes(1);
      expect(openFallback).toHaveBeenCalledWith(FALLBACK_URL);
      expect(sheet).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('logs one fixed line, with no error, token, nonce or URL, when it falls back', async () => {
      const request = makeRequest({ confirm: () => json({ detail: 'no' }, 403) });

      await open(request);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]).toEqual([
        '[MindRoom Chat] Native Connections sign-in failed; opening the link directly',
      ]);
    });

    it('logs one fixed line when there is no link to open instead', async () => {
      const request = makeRequest({ start: () => json({ detail: 'Not Found' }, 404) });

      await open(request, { fallbackUrl: undefined });

      expect(warn.mock.calls).toEqual([['[MindRoom Chat] Native Connections sign-in failed']]);
    });

    it('logs nothing on success or when the user leaves sheet one', async () => {
      await open(makeRequest());
      sheet.mockRejectedValueOnce(sheetError('AUTH_CANCELLED'));
      await open(makeRequest());

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('ends silently when the user leaves sheet one', () => {
    it.each(['AUTH_CANCELLED', 'AUTH_IN_PROGRESS'])('on %s', async (code) => {
      const request = makeRequest();
      sheet.mockRejectedValueOnce(sheetError(code));

      await expect(open(request)).resolves.toBeUndefined();

      // Only start ran: nothing is confirmed, no second sheet opens, the link is not opened bare.
      expect(request).toHaveBeenCalledTimes(1);
      expect(sheet).toHaveBeenCalledTimes(1);
      expect(openFallback).not.toHaveBeenCalled();
    });
  });

  it('never writes tokens or nonces to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined)
    );
    const confirmRefused = makeRequest({ confirm: () => json({ detail: 'no' }, 403) });
    const happy = makeRequest();

    await open(happy);
    await open(confirmRefused);

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain(TOKEN.access_token);
    expect(logged).not.toContain(NONCE);
  });
});
