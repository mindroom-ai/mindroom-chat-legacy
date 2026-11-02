import 'fake-indexeddb/auto';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MindroomNativeIOSPushOpenFeature } from './MindroomClientNonUIFeatures';

type ActionListener = (action: { notification: { data: unknown } }) => void;

const state = vi.hoisted(() => ({
  hasCompletedInitialSync: true,
  onAction: undefined as ActionListener | undefined,
  navigateRoom: vi.fn(),
  mx: {
    getRoom: (roomId: string) => {
      if (roomId === '!joined:example') return { getMyMembership: () => 'join' };
      if (roomId === '!left:example') return { getMyMembership: () => 'leave' };
      return null;
    },
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: vi.fn(async (event: string, listener: ActionListener) => {
      if (event === 'pushNotificationActionPerformed') state.onAction = listener;
      return { remove: vi.fn(async () => undefined) };
    }),
  },
}));

vi.mock('../native/iosPush', () => ({ isNativeIOSPlatform: () => true }));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => state.mx }));
vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: state.navigateRoom }),
}));
vi.mock('../../pages/client/ClientStartupContext', () => ({
  useClientStartupContext: () => ({ hasCompletedInitialSync: state.hasCompletedInitialSync }),
}));

const tap = (data: unknown) => act(async () => state.onAction?.({ notification: { data } }));

describe('MindroomNativeIOSPushOpenFeature', () => {
  afterEach(() => {
    state.hasCompletedInitialSync = true;
    state.onAction = undefined;
    vi.clearAllMocks();
  });

  it('opens the event of a tapped push, once the first sync is done', async () => {
    state.hasCompletedInitialSync = false;
    const renderer = await act(async () =>
      create(React.createElement(MindroomNativeIOSPushOpenFeature))
    );
    await tap({ aps: {}, room_id: '!joined:example', event_id: '$reply' });
    expect(state.navigateRoom).not.toHaveBeenCalled();

    state.hasCompletedInitialSync = true;
    await act(async () => renderer.update(React.createElement(MindroomNativeIOSPushOpenFeature)));

    expect(state.navigateRoom).toHaveBeenCalledTimes(1);
    expect(state.navigateRoom).toHaveBeenCalledWith('!joined:example', '$reply');
    renderer.unmount();
  });

  it("leaves another account's push, a left room and a push without a room alone", async () => {
    const renderer = await act(async () =>
      create(React.createElement(MindroomNativeIOSPushOpenFeature))
    );
    await tap({ aps: {}, room_id: '!elsewhere:example', event_id: '$event' });
    await tap({ aps: {}, room_id: '!left:example', event_id: '$event' });
    await tap({ aps: {} });

    expect(state.navigateRoom).not.toHaveBeenCalled();
    renderer.unmount();
  });
});
