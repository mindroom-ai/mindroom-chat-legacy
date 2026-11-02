// @vitest-environment jsdom
import React from 'react';
import { act, create, ReactTestRenderer, ReactTestRendererJSON } from 'react-test-renderer';
import { Capacitor } from '@capacitor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudflareAccessLoginGate } from './CloudflareAccessGate';
import { authenticateInNativeBrowser, isNativeIOS } from './nativeSso';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isPluginAvailable: vi.fn() },
}));

vi.mock('./nativeSso', () => ({
  authenticateInNativeBrowser: vi.fn(),
  isNativeIOS: vi.fn(),
}));

const BASE_URL = 'https://hs.example';
const base64Url = (value: string): string =>
  btoa(value).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const token = [
  base64Url('{}'),
  base64Url(JSON.stringify({ exp: Date.now() / 1000 + 3600 })),
  'sig',
].join('.');

const textOf = (node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string => {
  if (node === null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  return (node.children ?? []).map(textOf).join('');
};

describe('CloudflareAccessLoginGate', () => {
  let renderer: ReactTestRenderer | undefined;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.mocked(isNativeIOS).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
    localStorage.clear();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    vi.mocked(authenticateInNativeBrowser).mockReset();
  });

  const render = async () => {
    await act(async () => {
      renderer = create(
        <CloudflareAccessLoginGate baseUrl={BASE_URL} fallback={() => 'loading'}>
          login form
        </CloudflareAccessLoginGate>
      );
    });
    return () => textOf(renderer!.toJSON());
  };

  const clickContinue = () =>
    act(async () => {
      renderer!.root.findByType('button').props.onClick();
    });

  const advertise = () =>
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ handoff_url: `${BASE_URL}/native/cloudflare-access` }))
    );

  it('shows the login form without looking for an advert outside the iOS app', async () => {
    vi.mocked(isNativeIOS).mockReturnValue(false);

    const text = await render();

    expect(text()).toBe('login form');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the login form when the server publishes no advert', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }));

    const text = await render();

    expect(text()).toBe('login form');
  });

  it('asks for the organization sign-in before the login form of a server behind Access', async () => {
    advertise();

    const text = await render();

    expect(text()).toContain("hs.example requires your organization's sign-in.");
    expect(text()).not.toContain('login form');
  });

  it('shows the login form once the organization sign-in returns a token', async () => {
    advertise();
    vi.mocked(authenticateInNativeBrowser).mockResolvedValue(
      `mindroom://cloudflare-access#origin=${BASE_URL}&token=${token}`
    );
    const text = await render();

    await clickContinue();

    expect(text()).toBe('login form');
  });

  it('asks again when the token expires while the app is open, not before', async () => {
    vi.useFakeTimers();
    advertise();
    const shortToken = [
      base64Url('{}'),
      base64Url(JSON.stringify({ exp: Date.now() / 1000 + 120 })),
      'sig',
    ].join('.');
    vi.mocked(authenticateInNativeBrowser).mockResolvedValue(
      `mindroom://cloudflare-access#origin=${BASE_URL}&token=${shortToken}`
    );
    const text = await render();
    await clickContinue();
    expect(text()).toBe('login form');

    // Safari still holds the same Access session until it expires, so asking earlier
    // would hand the same token back.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(119_000);
    });
    expect(text()).toBe('login form');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(text()).toContain("hs.example requires your organization's sign-in.");
    // An expired token has no deadline left to wait for.
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('asks again when a session longer than the longest timer expires', async () => {
    vi.useFakeTimers();
    advertise();
    const day = 24 * 3600_000;
    const monthToken = [
      base64Url('{}'),
      base64Url(JSON.stringify({ exp: (Date.now() + 30 * day) / 1000 })),
      'sig',
    ].join('.');
    vi.mocked(authenticateInNativeBrowser).mockResolvedValue(
      `mindroom://cloudflare-access#origin=${BASE_URL}&token=${monthToken}`
    );
    const text = await render();
    await clickContinue();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29 * day);
    });
    expect(text()).toBe('login form');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(day);
    });

    expect(text()).toContain("hs.example requires your organization's sign-in.");
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('checks the token again when the app returns to the foreground', async () => {
    advertise();
    vi.mocked(authenticateInNativeBrowser).mockResolvedValue(
      `mindroom://cloudflare-access#origin=${BASE_URL}&token=${token}`
    );
    const text = await render();
    await clickContinue();
    // A suspended app runs no timers, so only the clock moves.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3600_000);

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(text()).toContain("hs.example requires your organization's sign-in.");
    vi.mocked(Date.now).mockRestore();
  });

  it('says so when the organization sign-in does not finish', async () => {
    advertise();
    vi.mocked(authenticateInNativeBrowser).mockRejectedValue(new Error('Authentication cancelled'));
    const text = await render();

    await clickContinue();

    expect(text()).toContain("Sign-in didn't finish. Try again.");
  });
});
