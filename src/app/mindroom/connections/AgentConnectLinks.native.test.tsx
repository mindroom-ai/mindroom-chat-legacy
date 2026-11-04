// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentConnectLinkFeature } from './AgentConnectLinks';

const mocks = vi.hoisted(() => ({
  openPortal: vi.fn(),
  openNative: vi.fn(),
  nativeSupported: vi.fn(() => true),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ clientRunning: true }),
}));
vi.mock('../matrix/openidAudience', () => ({ requestAudienceOpenIdToken: vi.fn() }));
vi.mock('../computer/useComputerApiUrl', () => ({
  useComputerApiUrls: () => ({ urls: ['https://app.example.org'], discovered: false }),
}));
vi.mock('./openConnections', () => ({
  openConnectionsPortal: mocks.openPortal,
  submitConnectionsHandoff: vi.fn(),
}));
vi.mock('./nativeConnections', () => ({
  nativeConnectionsSupported: mocks.nativeSupported,
  openConnectionsPortalNative: mocks.openNative,
}));

const CONNECT_PATH =
  '/api/oauth/slack/authorize?connect_token=t&agent_name=mind_alice&execution_scope=user';

// The whole chain on native iOS: the click, the hook and the native opener, with only the opener mocked.
describe('AgentConnectLinkFeature in the iOS app', () => {
  let renderer: ReactTestRenderer | undefined;
  let anchor: HTMLAnchorElement;

  beforeEach(() => {
    mocks.openPortal.mockReset();
    mocks.openNative.mockReset().mockResolvedValue(undefined);
    mocks.nativeSupported.mockReset().mockReturnValue(true);
    anchor = document.createElement('a');
    anchor.href = `https://app.example.org${CONNECT_PATH}`;
    anchor.target = '_blank';
    document.body.append(anchor);
    act(() => {
      renderer = create(<AgentConnectLinkFeature />);
    });
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    anchor.remove();
  });

  const click = () => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    anchor.dispatchEvent(event);
    return event;
  };

  it('prevents the browser and starts the native sign-in with the link path and the link as fallback', () => {
    expect(click().defaultPrevented).toBe(true);

    expect(mocks.openNative).toHaveBeenCalledTimes(1);
    expect(mocks.openNative).toHaveBeenCalledWith({
      backendUrl: 'https://app.example.org',
      next: CONNECT_PATH,
      getOpenIdToken: expect.any(Function),
      fallbackUrl: `https://app.example.org${CONNECT_PATH}`,
    });
    expect(mocks.openPortal).not.toHaveBeenCalled();
  });

  it('leaves the click to the browser when the plugin is missing, as on Android', () => {
    mocks.nativeSupported.mockReturnValue(false);
    act(() => renderer!.unmount());
    act(() => {
      renderer = create(<AgentConnectLinkFeature />);
    });

    expect(click().defaultPrevented).toBe(false);
    expect(mocks.openNative).not.toHaveBeenCalled();
  });
});
