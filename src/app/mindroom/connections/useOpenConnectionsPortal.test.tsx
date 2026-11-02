// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import type { IOpenIDToken } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { useConnectionsHandoff } from './useOpenConnectionsPortal';

const TOKEN: IOpenIDToken = {
  access_token: 'openid-token',
  token_type: 'Bearer',
  matrix_server_name: 'example.org',
  expires_in: 3600,
};

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
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
  openConnectionsPortal: vi.fn(),
  submitConnectionsHandoff: mocks.submit,
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
