import { EventEmitter } from 'events';
import React from 'react';
import { act, create, ReactTestRenderer, ReactTestRendererJSON } from 'react-test-renderer';
import { ClientEvent, MatrixClient, SyncState } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncStatus } from './SyncStatus';
import {
  bindHomeserverReachability,
  createHomeserverReachability,
  HOMESERVER_CHECK_TIMEOUT_MS,
} from '../../mindroom/matrix/homeserverReachability';

vi.mock('../../styles/ContainerColor.css', () => ({
  ContainerColor: () => 'container-color',
}));

const access = vi.hoisted(() => ({ signInRequired: false }));

vi.mock('../../mindroom/native/cloudflareAccess', () => ({
  discoverCloudflareAccess: vi.fn(),
  isCloudflareAccessSupported: () => true,
  signInToCloudflareAccess: vi.fn(),
  useCloudflareAccessSignInRequired: (baseUrl: string) =>
    access.signInRequired && baseUrl === 'https://matrix.example',
}));

const textOf = (node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string => {
  if (node === null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  return (node.children ?? []).map(textOf).join('');
};

const createClient = () => {
  const mx = Object.assign(new EventEmitter(), {
    getHomeserverUrl: () => 'https://matrix.example',
  }) as unknown as MatrixClient;
  let online = false;
  const reachability = createHomeserverReachability(async () => {
    if (!online) throw new TypeError('Load failed');
    return new Response('{}');
  }, 'https://matrix.example');
  bindHomeserverReachability(mx, reachability);
  const request = ({ reachable }: { reachable: boolean }) =>
    act(async () => {
      online = reachable;
      await reachability
        .fetchFn('https://matrix.example/_matrix/client/v3/rooms/!a/send')
        .catch(() => undefined);
      await vi.advanceTimersByTimeAsync(HOMESERVER_CHECK_TIMEOUT_MS);
    });
  const emitSync = (state: SyncState, previous: SyncState | null, catchingUp?: boolean) =>
    act(() => {
      mx.emit(ClientEvent.Sync, state, previous, { catchingUp });
    });
  return { mx, request, emitSync };
};

describe('SyncStatus', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
    vi.useRealTimers();
  });

  const render = (mx: MatrixClient) => {
    act(() => {
      renderer = create(<SyncStatus mx={mx} />);
    });
    return () => textOf(renderer!.toJSON());
  };

  it('shows that the connection is lost when a request cannot reach the homeserver before /sync fails', async () => {
    const { mx, request } = createClient();
    const text = render(mx);
    expect(text()).toBe('');

    await request({ reachable: false });
    expect(text()).toBe('Connection Lost!');

    await request({ reachable: true });
    expect(text()).toBe('');
  });

  it('asks for the organization sign-in instead of a lost connection once the Access token expired', async () => {
    access.signInRequired = true;
    try {
      const { mx, emitSync } = createClient();
      const text = render(mx);

      // A server that left Access keeps syncing; the stale record then prompts nothing.
      emitSync(SyncState.Syncing, SyncState.Prepared);
      expect(text()).not.toContain('requires your organization');

      emitSync(SyncState.Error, SyncState.Syncing);

      expect(text()).toContain("matrix.example requires your organization's sign-in.");
      expect(text()).not.toContain('Connection Lost!');
    } finally {
      access.signInRequired = false;
    }
  });

  it('shows the lost connection instead of catching up', async () => {
    const { mx, request, emitSync } = createClient();
    const text = render(mx);
    emitSync(SyncState.Prepared, null);
    expect(text()).toBe('Catching up...');

    await request({ reachable: false });
    expect(text()).toBe('Connection Lost!');

    await request({ reachable: true });
    expect(text()).toBe('Catching up...');
  });

  it('stops catching up on the first sync after startup that has caught up', () => {
    const { mx, emitSync } = createClient();
    const text = render(mx);
    emitSync(SyncState.Prepared, null);
    expect(text()).toBe('Catching up...');

    emitSync(SyncState.Syncing, SyncState.Prepared, false);
    expect(text()).toBe('');
  });

  it('stops catching up once the SDK has caught up, without waiting for another sync', () => {
    const { mx, emitSync } = createClient();
    const text = render(mx);
    emitSync(SyncState.Prepared, null);
    expect(text()).toBe('Catching up...');

    // The server still had to-device messages queued: the SDK polls again at once.
    emitSync(SyncState.Syncing, SyncState.Prepared, true);
    expect(text()).toBe('Catching up...');

    emitSync(SyncState.Syncing, SyncState.Syncing, false);
    expect(text()).toBe('');

    // After a reconnect, the first sync that catches up ends it.
    emitSync(SyncState.Catchup, SyncState.Error);
    expect(text()).toBe('Catching up...');
    emitSync(SyncState.Syncing, SyncState.Catchup, false);
    expect(text()).toBe('');
  });

  it('shows the sync state the client is already in when it mounts', () => {
    const { mx } = createClient();
    Object.assign(mx, {
      getSyncState: () => SyncState.Prepared,
      getSyncStateData: () => ({ catchingUp: false }),
    });
    expect(render(mx)()).toBe('Catching up...');
  });

  it('keeps the reconnecting banner while the /sync loop reconnects', async () => {
    const { mx, request, emitSync } = createClient();
    const text = render(mx);
    emitSync(SyncState.Reconnecting, SyncState.Syncing);

    await request({ reachable: false });
    expect(text()).toBe('Connection Lost! Reconnecting...');
  });
});
