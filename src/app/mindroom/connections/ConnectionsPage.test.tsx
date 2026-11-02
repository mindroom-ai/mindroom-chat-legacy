// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://chat.example.org/connections"}
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionsPage } from './ConnectionsPage';

const mocks = vi.hoisted(() => ({
  urls: [] as string[],
  native: false,
  handOff: vi.fn(async (_url: string, _signal: AbortSignal, _returnTo?: string) => undefined),
}));

vi.mock('react-router-dom', () => ({ useHref: (to: string) => `/base${to}` }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mocks.native } }));
vi.mock('../computer/useComputerApiUrl', () => ({
  useComputerApiUrls: () => ({ urls: mocks.urls, discovered: false }),
}));
vi.mock('./useOpenConnectionsPortal', () => ({ useConnectionsHandoff: () => mocks.handOff }));
vi.mock('../settings/MindroomConnectionsSettings', () => ({
  MindroomConnectionsSettings: () => <section>settings card</section>,
}));
vi.mock('../../components/page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => <main>{children}</main>,
  PageContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const render = async () => {
  let page: ReturnType<typeof create> | undefined;
  await act(async () => {
    page = create(<ConnectionsPage />);
  });
  return page!;
};

afterEach(() => {
  mocks.urls = [];
  mocks.native = false;
  mocks.handOff.mockClear();
});

describe('ConnectionsPage', () => {
  it('opens the portal of the only MindRoom server signed in, once', async () => {
    mocks.urls = ['https://backend.example.org'];
    await render();
    expect(mocks.handOff).toHaveBeenCalledOnce();
    expect(mocks.handOff.mock.calls[0][0]).toBe('https://backend.example.org');
    expect(mocks.handOff.mock.calls[0][1].aborted).toBe(false);
    expect(mocks.handOff.mock.calls[0][2]).toBe('/base/');
  });

  it('cancels the hand-off when the page goes away before the token arrives', async () => {
    mocks.urls = ['https://backend.example.org'];
    const page = await render();
    await act(async () => {
      page.unmount();
    });
    expect(mocks.handOff.mock.calls[0][1].aborted).toBe(true);
  });

  it.each([
    ['several servers', ['https://a.example.org', 'https://b.example.org'], false],
    ['no server', [], false],
    ['the native app', ['https://backend.example.org'], true],
    ['an HTTP server behind HTTPS Chat', ['http://localhost:8765'], false],
  ])('leaves %s to the Settings card', async (_case, urls, native) => {
    mocks.urls = urls;
    mocks.native = native;
    await render();
    expect(mocks.handOff).not.toHaveBeenCalled();
  });
});
