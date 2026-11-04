// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import type { IOpenIDToken } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectionsHandoff, useOpenConnectionsPortal } from './useOpenConnectionsPortal';

const TOKEN: IOpenIDToken = {
  access_token: 'openid-token',
  token_type: 'Bearer',
  matrix_server_name: 'example.org',
  expires_in: 3600,
};

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  openPortal: vi.fn(),
  nativeSupported: vi.fn(() => false),
  openNative: vi.fn(),
  resolveToken: undefined as ((token: IOpenIDToken) => void) | undefined,
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ clientRunning: true }),
}));
vi.mock('../matrix/openidAudience', () => ({
  requestAudienceOpenIdToken: () =>
    new Promise<IOpenIDToken>((resolve) => {
      mocks.resolveToken = resolve;
    }),
}));
vi.mock('./openConnections', () => ({
  openConnectionsPortal: mocks.openPortal,
  submitConnectionsHandoff: mocks.submit,
}));
vi.mock('./nativeConnections', () => ({
  nativeConnectionsSupported: mocks.nativeSupported,
  openConnectionsPortalNative: mocks.openNative,
}));

const handOffOnce = async (abortFirst: boolean) => {
  let handOff: ReturnType<typeof useConnectionsHandoff> | undefined;
  function Harness() {
    handOff = useConnectionsHandoff(false);
    return null;
  }
  await act(async () => {
    create(<Harness />);
  });
  const controller = new AbortController();
  const pending = handOff!('https://backend.example.org', controller.signal, '/');
  if (abortFirst) controller.abort();
  mocks.resolveToken!(TOKEN);
  await pending;
};

describe('useConnectionsHandoff', () => {
  it('submits the token once it arrives', async () => {
    mocks.submit.mockClear();
    await handOffOnce(false);
    expect(mocks.submit).toHaveBeenCalledWith('https://backend.example.org', TOKEN, '/');
  });

  it('submits nothing when aborted before the token arrives', async () => {
    mocks.submit.mockClear();
    await handOffOnce(true);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});

describe('useOpenConnectionsPortal', () => {
  const renderHook = async () => {
    let open: ReturnType<typeof useOpenConnectionsPortal> | undefined;
    function Harness() {
      open = useOpenConnectionsPortal(false);
      return null;
    }
    await act(async () => {
      create(<Harness />);
    });
    return open!;
  };

  beforeEach(() => {
    mocks.openPortal.mockReset().mockReturnValue('opened');
    mocks.nativeSupported.mockReset().mockReturnValue(false);
    mocks.openNative.mockReset().mockResolvedValue(undefined);
  });

  it('opens the pop-up portal outside the iOS app and returns its answer', async () => {
    mocks.openPortal.mockReturnValue('blocked');
    const open = await renderHook();

    expect(open('https://backend.example.org', '/api/oauth/x/authorize?connect_token=t')).toBe(
      'blocked'
    );

    expect(mocks.openPortal).toHaveBeenCalledWith({
      backendUrl: 'https://backend.example.org',
      next: '/api/oauth/x/authorize?connect_token=t',
      getOpenIdToken: expect.any(Function),
    });
    expect(mocks.openNative).not.toHaveBeenCalled();
  });

  it('starts the native sign-in in the iOS app, with the link as its fallback, and says opened', async () => {
    mocks.nativeSupported.mockReturnValue(true);
    const open = await renderHook();

    expect(open('https://backend.example.org', '/api/oauth/x/authorize?connect_token=t')).toBe(
      'opened'
    );

    expect(mocks.openNative).toHaveBeenCalledTimes(1);
    expect(mocks.openNative).toHaveBeenCalledWith({
      backendUrl: 'https://backend.example.org',
      next: '/api/oauth/x/authorize?connect_token=t',
      getOpenIdToken: expect.any(Function),
      fallbackUrl: 'https://backend.example.org/api/oauth/x/authorize?connect_token=t',
    });
    expect(mocks.openPortal).not.toHaveBeenCalled();
  });

  it('has no fallback link when the iOS app opens the portal itself', async () => {
    mocks.nativeSupported.mockReturnValue(true);
    const open = await renderHook();

    open('https://backend.example.org');

    const options = mocks.openNative.mock.calls[0][0];
    expect(options.next).toBeUndefined();
    expect(options.fallbackUrl).toBeUndefined();
  });

  it('answers at once without waiting for the native sign-in', async () => {
    mocks.nativeSupported.mockReturnValue(true);
    mocks.openNative.mockReturnValue(new Promise<void>(() => {}));
    const open = await renderHook();

    expect(open('https://backend.example.org')).toBe('opened');
  });
});
