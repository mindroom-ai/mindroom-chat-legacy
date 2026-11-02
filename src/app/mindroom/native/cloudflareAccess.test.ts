// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import {
  cloudflareAccessAllowsPush,
  forgetCloudflareAccessToken,
  discoverCloudflareAccess,
  getCloudflareAccessToken,
  hasCloudflareAccess,
  parseCloudflareAccessCallback,
  renewExpiredCloudflareAccess,
  signInToCloudflareAccess,
} from './cloudflareAccess';
import { authenticateInNativeBrowser, isNativeIOS } from './nativeSso';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isPluginAvailable: vi.fn() },
}));

vi.mock('./nativeSso', () => ({
  authenticateInNativeBrowser: vi.fn(),
  isNativeIOS: vi.fn(),
}));

const NOW = 1_800_000_000_000;
const BASE_URL = 'https://hs.example';
const HANDOFF_URL = 'https://hs.example/native/cloudflare-access';

const base64Url = (value: string): string =>
  btoa(value).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

const jwt = (exp: unknown): string =>
  [base64Url('{"alg":"RS256"}'), base64Url(JSON.stringify({ exp })), 'signature'].join('.');

const validToken = jwt(NOW / 1000 + 3600);

const respond = (body: string, status = 200) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }));

const advert = (handoffUrl: string) => respond(JSON.stringify({ handoff_url: handoffUrl }));

const callback = (token: string, origin = BASE_URL): string =>
  `mindroom://cloudflare-access#origin=${origin}&token=${token}`;

describe('cloudflareAccess', () => {
  beforeEach(() => {
    vi.mocked(isNativeIOS).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.mocked(authenticateInNativeBrowser).mockReset();
  });

  it('discovers a same-origin https handoff url', async () => {
    const request = advert(HANDOFF_URL);

    await expect(discoverCloudflareAccess(`${BASE_URL}/`, request)).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith(
      'https://hs.example/.well-known/mindroom/cloudflare-access',
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(hasCloudflareAccess(BASE_URL)).toBe(true);
  });

  it('does not look for an advert outside the iOS app', async () => {
    vi.mocked(isNativeIOS).mockReturnValue(false);
    const request = advert(HANDOFF_URL);

    await expect(discoverCloudflareAccess(BASE_URL, request)).resolves.toBe(false);

    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['an html page', () => respond('<!doctype html><html></html>')],
    ['a 404', () => respond('{}', 404)],
    ['a handoff on another origin', () => advert('https://evil.example/native/cloudflare-access')],
    ['an http handoff', () => advert('http://hs.example/native/cloudflare-access')],
  ])('treats %s as no Access and forgets an earlier record', async (_, request) => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));

    await expect(discoverCloudflareAccess(BASE_URL, request())).resolves.toBe(false);

    expect(hasCloudflareAccess(BASE_URL)).toBe(false);
  });

  it('keeps an earlier record when the advert cannot be fetched', async () => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Load failed'));

    await expect(discoverCloudflareAccess(BASE_URL, offline)).resolves.toBe(true);

    expect(hasCloudflareAccess(BASE_URL)).toBe(true);
  });

  it.each([
    ['a server error', () => respond('{}', 503)],
    [
      'a body that breaks off',
      () =>
        vi.fn<typeof fetch>().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.reject(new TypeError('Load failed')),
          text: () => Promise.reject(new TypeError('Load failed')),
        } as Response),
    ],
  ])('keeps an earlier record after %s', async (_, request) => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));

    await expect(discoverCloudflareAccess(BASE_URL, request())).resolves.toBe(true);

    expect(hasCloudflareAccess(BASE_URL)).toBe(true);
  });

  it('treats an unreachable advert as no Access when nothing was recorded', async () => {
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Load failed'));

    await expect(discoverCloudflareAccess(BASE_URL, offline)).resolves.toBe(false);
  });

  it('keeps the token when discovery finds the same handoff url again', async () => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));
    vi.mocked(authenticateInNativeBrowser).mockResolvedValue(callback(validToken));
    await signInToCloudflareAccess(BASE_URL);

    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));

    expect(getCloudflareAccessToken(`${BASE_URL}/_matrix/client/v3/sync`)).toBe(validToken);
  });

  it('reads the token from the callback fragment of the expected origin', () => {
    expect(parseCloudflareAccessCallback(callback(validToken), BASE_URL)).toBe(validToken);
  });

  it.each([
    ['another callback host', `mindroom://auth/login#origin=${BASE_URL}&token=${validToken}`],
    ['another scheme', `https://cloudflare-access#origin=${BASE_URL}&token=${validToken}`],
    ['no origin', `mindroom://cloudflare-access#token=${validToken}`],
    ['another origin', callback(validToken, 'https://org.example')],
    ['no token', `mindroom://cloudflare-access#origin=${BASE_URL}&state=1`],
    ['a token that is not a JWT', callback('abc')],
    ['a token without exp', callback(jwt('soon'))],
    ['an expired token', callback(jwt(NOW / 1000))],
  ])('rejects a callback with %s', (_, url) => {
    expect(parseCloudflareAccessCallback(url, BASE_URL)).toBeUndefined();
  });

  it('signs in through the advertised handoff page and stores the token for that origin', async () => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));
    vi.mocked(authenticateInNativeBrowser).mockResolvedValue(callback(validToken));

    await signInToCloudflareAccess(BASE_URL);

    // Safari's shared cookies break the Access login, so the sign-in starts without them.
    expect(authenticateInNativeBrowser).toHaveBeenCalledWith(HANDOFF_URL, 'mindroom', true);
    expect(getCloudflareAccessToken('https://hs.example/_matrix/client/v3/sync')).toBe(validToken);
    expect(
      getCloudflareAccessToken('https://other.example/_matrix/client/v3/sync')
    ).toBeUndefined();
  });

  it("stores nothing when the handoff page leads to another server's", async () => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));
    vi.mocked(authenticateInNativeBrowser).mockResolvedValue(
      callback(validToken, 'https://org.example')
    );

    await expect(signInToCloudflareAccess(BASE_URL)).rejects.toThrow();

    expect(getCloudflareAccessToken(BASE_URL)).toBeUndefined();
  });

  it('stores nothing when the callback carries no valid token', async () => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));
    vi.mocked(authenticateInNativeBrowser).mockResolvedValue('mindroom://cloudflare-access#');

    await expect(signInToCloudflareAccess(BASE_URL)).rejects.toThrow();

    expect(getCloudflareAccessToken(BASE_URL)).toBeUndefined();
    expect(hasCloudflareAccess(BASE_URL)).toBe(true);
  });

  it('stops returning the token once it expires', async () => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));
    vi.mocked(authenticateInNativeBrowser).mockResolvedValue(callback(validToken));
    await signInToCloudflareAccess(BASE_URL);

    expect(getCloudflareAccessToken(BASE_URL, NOW + 3599_000)).toBe(validToken);
    expect(getCloudflareAccessToken(BASE_URL, NOW + 3600_000)).toBeUndefined();
  });

  it('asks for the Access sign-in again only once the token has expired', async () => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));
    vi.mocked(authenticateInNativeBrowser).mockResolvedValue(callback(validToken));

    await renewExpiredCloudflareAccess(BASE_URL);
    await renewExpiredCloudflareAccess(BASE_URL);

    expect(authenticateInNativeBrowser).toHaveBeenCalledTimes(1);
    expect(getCloudflareAccessToken(BASE_URL)).toBe(validToken);
  });

  it('ignores a failed renewal and servers without Access', async () => {
    vi.mocked(authenticateInNativeBrowser).mockRejectedValue(new Error('cancelled'));

    await renewExpiredCloudflareAccess(BASE_URL);
    expect(authenticateInNativeBrowser).not.toHaveBeenCalled();

    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));
    await expect(renewExpiredCloudflareAccess(BASE_URL)).resolves.toBeUndefined();
    expect(authenticateInNativeBrowser).toHaveBeenCalledTimes(1);
  });

  it('forgets the token but keeps the server marked as behind Access for its other accounts', async () => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));
    vi.mocked(authenticateInNativeBrowser).mockResolvedValue(callback(validToken));
    await signInToCloudflareAccess(BASE_URL);

    forgetCloudflareAccessToken(BASE_URL);

    expect(getCloudflareAccessToken(BASE_URL)).toBeUndefined();
    expect(hasCloudflareAccess(BASE_URL)).toBe(true);
  });

  it('keeps push off for a server whose advert turns it off until the advert changes', async () => {
    expect(cloudflareAccessAllowsPush(BASE_URL)).toBe(true);
    await discoverCloudflareAccess(
      BASE_URL,
      respond(JSON.stringify({ handoff_url: HANDOFF_URL, push: false }))
    );
    vi.mocked(authenticateInNativeBrowser).mockResolvedValue(callback(validToken));
    await signInToCloudflareAccess(BASE_URL);
    forgetCloudflareAccessToken(BASE_URL);
    await signInToCloudflareAccess(BASE_URL);

    expect(cloudflareAccessAllowsPush(BASE_URL)).toBe(false);

    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));

    expect(cloudflareAccessAllowsPush(BASE_URL)).toBe(true);
    expect(getCloudflareAccessToken(BASE_URL)).toBe(validToken);
  });
});
