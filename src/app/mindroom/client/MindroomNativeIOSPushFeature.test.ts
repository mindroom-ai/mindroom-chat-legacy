import 'fake-indexeddb/auto';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  disableIOSPushPusher,
  registerIOSPush,
  setIOSPushEnabled,
  unregisterIOSPush,
  upsertIOSPushPusher,
} from '../native/iosPush';
import { MindroomNativeIOSPushFeature } from './MindroomClientNonUIFeatures';

const state = vi.hoisted(() => ({
  signInRequired: true,
  pushAllowed: true,
  onRegistration: undefined as ((token: { value: string }) => void) | undefined,
  mx: { clientRunning: true, getHomeserverUrl: () => 'https://private.example' },
  clientConfig: {},
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: vi.fn(async (event: string, listener: (token: { value: string }) => void) => {
      if (event === 'registration') state.onRegistration = listener;
      return { remove: vi.fn(async () => undefined) };
    }),
  },
}));

vi.mock('../native/iosPush', () => ({
  checkIOSPushPermission: vi.fn(async () => 'granted'),
  disableIOSPushPusher: vi.fn(async () => undefined),
  isNativeIOSPlatform: () => true,
  registerIOSPush: vi.fn(async () => undefined),
  resolveIOSPushConfig: () => ({ appId: 'chat.example', format: 'full' }),
  setIOSPushEnabled: vi.fn(),
  unregisterIOSPush: vi.fn(async () => undefined),
  upsertIOSPushPusher: vi.fn(async () => undefined),
}));

vi.mock('../native/useIOSPushEnabled', () => ({ useIOSPushEnabled: () => true }));
vi.mock('../native/cloudflareAccess', () => ({
  cloudflareAccessAllowsPush: () => state.pushAllowed,
  useCloudflareAccessSignInRequired: () => state.signInRequired,
}));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => state.mx }));
vi.mock('../../hooks/useClientConfig', () => ({ useClientConfig: () => state.clientConfig }));
vi.mock('../../hooks/useSessionStore', () => ({ useActiveSession: () => ({ sessionId: 's1' }) }));
vi.mock('../../hooks/useAppLanguageCode', () => ({ useAppLanguageCode: () => 'en' }));

const rerender = (renderer: ReturnType<typeof create>) =>
  act(async () => renderer.update(React.createElement(MindroomNativeIOSPushFeature)));

describe('MindroomNativeIOSPushFeature', () => {
  afterEach(() => {
    state.signInRequired = true;
    state.pushAllowed = true;
    state.onRegistration = undefined;
    vi.clearAllMocks();
  });

  it('waits for the Cloudflare Access sign-in instead of turning push off', async () => {
    const renderer = await act(async () =>
      create(React.createElement(MindroomNativeIOSPushFeature))
    );
    expect(registerIOSPush).not.toHaveBeenCalled();

    state.signInRequired = false;
    await rerender(renderer);
    await act(async () => state.onRegistration?.({ value: 'apns-token' }));

    expect(upsertIOSPushPusher).toHaveBeenCalledWith(
      state.mx,
      expect.anything(),
      'apns-token',
      's1'
    );
    expect(setIOSPushEnabled).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('keeps push on when a registration fails because the Access token expired meanwhile', async () => {
    state.signInRequired = false;
    let rejectUpsert: (error: Error) => void = () => undefined;
    vi.mocked(upsertIOSPushPusher).mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectUpsert = reject;
      })
    );
    const renderer = await act(async () =>
      create(React.createElement(MindroomNativeIOSPushFeature))
    );
    await act(async () => state.onRegistration?.({ value: 'apns-token' }));

    state.signInRequired = true;
    await rerender(renderer);
    await act(async () => rejectUpsert(new TypeError('Load failed')));

    expect(setIOSPushEnabled).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('only removes the pusher when the server turns push off', async () => {
    state.signInRequired = false;
    state.pushAllowed = false;
    vi.mocked(disableIOSPushPusher).mockRejectedValueOnce(new TypeError('Load failed'));
    const renderer = await act(async () =>
      create(React.createElement(MindroomNativeIOSPushFeature))
    );
    // A token from a registration started earlier, for instance by another account.
    await act(async () => state.onRegistration?.({ value: 'apns-token' }));

    expect(disableIOSPushPusher).toHaveBeenCalledWith(state.mx, expect.anything(), 's1');
    expect(registerIOSPush).not.toHaveBeenCalled();
    expect(upsertIOSPushPusher).not.toHaveBeenCalled();
    expect(unregisterIOSPush).not.toHaveBeenCalled();
    expect(setIOSPushEnabled).not.toHaveBeenCalled();
    renderer.unmount();
  });
});
