import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ClientEvent, SyncState } from 'matrix-js-sdk';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { ClientRoot, hasCachedClientShell } from './ClientRoot';
import { SpecVersions } from './SpecVersions';
import { useActiveSession } from '../../hooks/useSessionStore';
import { useClientConfig } from '../../hooks/useClientConfig';
import { StoredSession } from '../../state/sessions';
import {
  clearAllCacheAndReload,
  initClient,
  removeCurrentClientSessionAndReload,
  startClient,
} from '../../../client/initMatrix';
import { clearSecretStorageKeys } from '../../../client/secretStorageKeys';

const { passthrough } = vi.hoisted(() => ({
  passthrough: 'div',
}));

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  return {
    ...actual,
    Box: passthrough,
    Button: passthrough,
    Dialog: passthrough,
    Icon: passthrough,
    IconButton: passthrough,
    Icons: {
      VerticalDots: 'VerticalDots',
    },
    Menu: passthrough,
    MenuItem: passthrough,
    PopOut: passthrough,
    Spinner: passthrough,
    Text: passthrough,
    config: {
      ...actual.config,
      space: {
        ...actual.config.space,
        S100: '4px',
        S400: '16px',
      },
    },
  };
});

vi.mock('matrix-js-sdk/lib/http-api/interface', () => ({
  HttpApiEvent: {
    SessionLoggedOut: 'Session.logged_out',
  },
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../../client/initMatrix', () => ({
  clearAllCacheAndReload: vi.fn().mockResolvedValue(undefined),
  initClient: vi.fn(),
  logoutClient: vi.fn().mockResolvedValue(undefined),
  removeCurrentClientSessionAndReload: vi.fn().mockResolvedValue(undefined),
  removeSessionAndReload: vi.fn().mockResolvedValue(undefined),
  startClient: vi.fn(),
}));

vi.mock('../../../client/secretStorageKeys', () => ({
  clearSecretStorageKeys: vi.fn(),
}));

vi.mock('../../components/splash-screen', () => ({
  SplashScreen: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  MindRoomSplashScreen: ({
    children,
    loadingMessages,
  }: {
    children?: React.ReactNode;
    loadingMessages?: string[];
  }) => React.createElement('div', null, loadingMessages?.[0] ?? 'Loading MindRoom Chat', children),
}));

vi.mock('../../components/ServerConfigsLoader', () => ({
  ServerConfigsLoader: ({
    mx,
    children,
  }: {
    mx?: unknown;
    children: (config: unknown) => React.ReactNode;
  }) => {
    if (!mx) {
      throw new Error('ServerConfigsLoader missing mx prop');
    }

    return React.createElement(
      'div',
      null,
      children({ capabilities: {}, mediaConfig: {}, authMetadata: undefined })
    );
  },
}));

vi.mock('../../hooks/useCapabilities', () => ({
  CapabilitiesProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../hooks/useMediaConfig', () => ({
  MediaConfigProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  MatrixClientProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('./SpecVersions', () => ({
  SpecVersions: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('./SyncStatus', () => ({
  SyncStatus: () => React.createElement('div', null, 'sync'),
}));

vi.mock('../../hooks/useAuthMetadata', () => ({
  AuthMetadataProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../hooks/useSessionStore', () => ({
  useActiveSession: vi.fn(),
}));

vi.mock('../../hooks/useClientConfig', () => ({
  useClientConfig: vi.fn(() => ({})),
}));

let currentSession: StoredSession | undefined;

type MockClient = {
  stopClient: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  getRooms: ReturnType<typeof vi.fn>;
  getSyncState: ReturnType<typeof vi.fn>;
  // MindroomSyncEngine (CINNY-207 P3.1) reads these to derive its
  // session id at construction time.
  getHomeserverUrl: ReturnType<typeof vi.fn>;
  getSafeUserId: ReturnType<typeof vi.fn>;
  store: {
    getSyncToken: ReturnType<typeof vi.fn>;
  };
  emitSync: (current?: SyncState | null, previous?: SyncState | null | undefined) => void;
};

const createMockClient = (
  options: { cachedRooms?: number; syncToken?: string | null } = {}
): MockClient => {
  let syncHandler:
    | ((current?: SyncState | null, previous?: SyncState | null | undefined) => void)
    | undefined;
  const cachedRooms = options.cachedRooms ?? 0;
  const syncToken = options.syncToken ?? null;
  let syncState: SyncState | null = null;

  return {
    stopClient: vi.fn(),
    on: vi.fn(
      (
        event: string,
        handler: (current?: SyncState | null, previous?: SyncState | null | undefined) => void
      ) => {
        if (event === ClientEvent.Sync) syncHandler = handler;
      }
    ),
    once: vi.fn(),
    removeListener: vi.fn((event: string, handler: () => void) => {
      if (event === ClientEvent.Sync && syncHandler === handler) {
        syncHandler = undefined;
      }
    }),
    getRooms: vi.fn(() =>
      Array.from({ length: cachedRooms }, (_, index) => ({ roomId: `!room${index}` }))
    ),
    getSyncState: vi.fn(() => syncState),
    getHomeserverUrl: vi.fn(() => 'https://example.test'),
    getSafeUserId: vi.fn(() => '@alice:example.test'),
    store: {
      getSyncToken: vi.fn(() => syncToken),
    },
    emitSync: (current = SyncState.Syncing, previous = SyncState.Prepared) => {
      syncState = current;
      syncHandler?.(current, previous);
    },
  };
};

const flushEffects = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const toBootstrapSession = (session: {
  sessionId: string;
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken?: string;
}) => ({
  sessionId: session.sessionId,
  baseUrl: session.baseUrl,
  userId: session.userId,
  deviceId: session.deviceId,
  accessToken: session.accessToken,
  refreshToken: session.refreshToken,
});

const renderClientRoot = (children: React.ReactNode = React.createElement('div', null, 'child')) =>
  React.createElement(
    MemoryRouter,
    {
      initialEntries: ['/home/'],
    },
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: '/login/*',
        element: React.createElement(React.Fragment, null, 'login page'),
      }),
      React.createElement(Route, {
        path: '*',
        element: React.createElement(ClientRoot, null, children),
      })
    )
  );

const hasRenderedText = (renderer: ReactTestRenderer | undefined, text: string): boolean =>
  !!renderer?.root.findAll((node) => typeof node.type === 'string' && node.children.includes(text))
    .length;

describe('ClientRoot', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
    currentSession = undefined;
    vi.restoreAllMocks();
    vi.mocked(useClientConfig).mockReturnValue({});
  });

  it('switches clients when the active session changes', async () => {
    vi.mocked(clearSecretStorageKeys).mockClear();
    const clientA = createMockClient();
    const clientB = createMockClient();

    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
    };

    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockImplementation(async (session) =>
      session.sessionId === 'session-a' ? (clientA as never) : (clientB as never)
    );
    vi.mocked(startClient).mockResolvedValue(undefined);

    await act(async () => {
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    expect(vi.mocked(initClient)).toHaveBeenCalledWith(toBootstrapSession(currentSession));
    expect(vi.mocked(startClient)).toHaveBeenCalledTimes(1);

    currentSession = {
      sessionId: 'session-b',
      baseUrl: 'https://matrix.org',
      userId: '@bob:matrix.org',
      deviceId: 'DEVICE_B',
      accessToken: 'token-b',
      lastUsedAt: 2,
    };

    await act(async () => {
      renderer?.update(renderClientRoot());
      await flushEffects();
    });

    expect(vi.mocked(initClient)).toHaveBeenLastCalledWith(toBootstrapSession(currentSession));
    expect(vi.mocked(startClient)).toHaveBeenCalledTimes(2);
    expect(clientA.stopClient).toHaveBeenCalledTimes(1);
    expect(clientB.stopClient).not.toHaveBeenCalled();
    expect(vi.mocked(clearSecretStorageKeys)).toHaveBeenCalledTimes(1);
  });

  it('unmounts the old account shell in the same render that switches sessions', async () => {
    const clientA = createMockClient({ cachedRooms: 1 });
    let resolveClientB: ((client: MockClient) => void) | undefined;
    const clientBPromise = new Promise<MockClient>((resolve) => {
      resolveClientB = resolve;
    });

    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
    };
    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockImplementation(async (session) =>
      session.sessionId === 'session-a' ? (clientA as never) : (clientBPromise as never)
    );
    vi.mocked(startClient).mockResolvedValue(undefined);

    await act(async () => {
      renderer = create(renderClientRoot());
      await flushEffects();
    });
    expect(hasRenderedText(renderer, 'child')).toBe(true);

    currentSession = {
      sessionId: 'session-b',
      baseUrl: 'https://matrix.org',
      userId: '@bob:matrix.org',
      deviceId: 'DEVICE_B',
      accessToken: 'token-b',
      lastUsedAt: 2,
    };

    act(() => {
      renderer?.update(renderClientRoot());
    });

    expect(hasRenderedText(renderer, 'child')).toBe(false);
    expect(hasRenderedText(renderer, 'Loading MindRoom Chat')).toBe(true);

    resolveClientB?.(createMockClient());
    await act(flushEffects);
  });

  it('uses a fresh authenticated query cache when the active account changes', async () => {
    const clientA = createMockClient({ cachedRooms: 1 });
    const clientB = createMockClient({ cachedRooms: 1 });
    const observations: Array<{
      sessionId: string;
      queryClient: QueryClient;
      cachedOwner: string | undefined;
    }> = [];

    const AccountQuery = () => {
      const renderedSession = currentSession;
      const accountQueryClient = useQueryClient();
      React.useEffect(() => {
        if (renderedSession?.sessionId === 'session-a') {
          accountQueryClient.setQueryData(['shared-account-query'], renderedSession.userId);
        }
      }, [accountQueryClient, renderedSession]);
      if (renderedSession) {
        observations.push({
          sessionId: renderedSession.sessionId,
          queryClient: accountQueryClient,
          cachedOwner: accountQueryClient.getQueryData(['shared-account-query']),
        });
      }
      return null;
    };

    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
    };
    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockImplementation(async (session) =>
      session.sessionId === 'session-a' ? (clientA as never) : (clientB as never)
    );
    vi.mocked(startClient).mockResolvedValue(undefined);

    await act(async () => {
      renderer = create(renderClientRoot(React.createElement(AccountQuery)));
      await flushEffects();
    });

    currentSession = {
      sessionId: 'session-b',
      baseUrl: 'https://matrix.org',
      userId: '@bob:matrix.org',
      deviceId: 'DEVICE_B',
      accessToken: 'token-b',
      lastUsedAt: 2,
    };

    await act(async () => {
      renderer?.update(renderClientRoot(React.createElement(AccountQuery)));
      await flushEffects();
    });

    const accountAObservation = observations.find(({ sessionId }) => sessionId === 'session-a');
    const accountBObservation = observations.find(({ sessionId }) => sessionId === 'session-b');
    expect(accountAObservation).toBeDefined();
    expect(accountBObservation).toBeDefined();
    expect(accountBObservation?.queryClient).not.toBe(accountAObservation?.queryClient);
    expect(accountBObservation?.cachedOwner).toBeUndefined();
  });

  it('does not restart the client when session metadata or rotated credentials change', async () => {
    const client = createMockClient();

    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
      lastKnownPath: '/home/',
      lastKnownDisplayName: 'Alice',
    };

    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockResolvedValue(client as never);
    vi.mocked(startClient).mockResolvedValue(undefined);

    await act(async () => {
      renderer = create(renderClientRoot());
      await flushEffects();
    });
    vi.mocked(clearSecretStorageKeys).mockClear();

    currentSession = {
      ...currentSession,
      lastUsedAt: 2,
      lastKnownPath: '/home/create/',
      lastKnownDisplayName: 'Alice Updated',
      accessToken: 'token-b',
      refreshToken: 'refresh-b',
    };

    await act(async () => {
      renderer?.update(renderClientRoot());
      await flushEffects();
    });

    expect(vi.mocked(initClient)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startClient)).toHaveBeenCalledTimes(1);
    expect(client.stopClient).not.toHaveBeenCalled();
    expect(vi.mocked(clearSecretStorageKeys)).not.toHaveBeenCalled();
  });

  it('does not initialize a client when there is no active session', async () => {
    vi.mocked(useActiveSession).mockReturnValue(undefined);

    await act(async () => {
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    expect(vi.mocked(initClient)).not.toHaveBeenCalled();
    expect(vi.mocked(startClient)).not.toHaveBeenCalled();
    expect(renderer?.toJSON()).toEqual('login page');
  });

  it('offers cache recovery when a created client fails to start', async () => {
    const client = createMockClient();
    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
    };
    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockResolvedValue(client as never);
    vi.mocked(startClient).mockRejectedValue(new Error('startup failed'));
    vi.mocked(clearAllCacheAndReload).mockResolvedValue(undefined);

    await act(async () => {
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    expect(hasRenderedText(renderer, 'Clear Cache and Reload')).toBe(true);
    const recoveryButton = renderer?.root.findAll(
      (node) =>
        typeof node.props.onClick === 'function' &&
        node.findAll((child) => child.children.includes('Clear Cache and Reload')).length > 0
    )[0];
    await act(async () => {
      await recoveryButton?.props.onClick();
    });

    expect(vi.mocked(clearAllCacheAndReload)).toHaveBeenCalledWith(client);
  });

  it('retries startup with the latest rotated session credentials', async () => {
    const firstClient = createMockClient();
    const retryClient = createMockClient();
    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      refreshToken: 'refresh-a',
      lastUsedAt: 1,
    };
    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient)
      .mockResolvedValueOnce(firstClient as never)
      .mockResolvedValueOnce(retryClient as never);
    vi.mocked(startClient)
      .mockRejectedValueOnce(new Error('temporary startup failure'))
      .mockResolvedValueOnce(undefined);

    await act(async () => {
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    currentSession = {
      ...currentSession,
      accessToken: 'token-b',
      refreshToken: 'refresh-b',
    };
    await act(async () => {
      renderer?.update(renderClientRoot());
      await flushEffects();
    });
    expect(vi.mocked(initClient)).toHaveBeenCalledTimes(1);

    const retryButton = renderer?.root.findAll(
      (node) =>
        typeof node.props.onClick === 'function' &&
        node.findAll((child) => child.children.includes('Retry')).length > 0
    )[0];
    await act(async () => {
      retryButton?.props.onClick();
      await flushEffects();
    });

    expect(vi.mocked(initClient)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(initClient)).toHaveBeenLastCalledWith(toBootstrapSession(currentSession));
  });

  it('uses the session-aware cleanup helper when the server logs the client out', async () => {
    let logoutHandler: (() => Promise<void>) | undefined;
    const client = {
      stopClient: vi.fn(),
      on: vi.fn((event: string, handler: () => Promise<void>) => {
        if (event === 'Session.logged_out') {
          logoutHandler = handler;
        }
      }),
      once: vi.fn(),
      removeListener: vi.fn(),
      // Needed by MindroomSyncEngine (CINNY-207 P3.1) to derive its
      // session id when ClientRoot's engine effect creates it.
      getHomeserverUrl: vi.fn(() => 'https://example.com'),
      getSafeUserId: vi.fn(() => '@alice:example.com'),
      getSyncState: vi.fn(() => null),
      getRooms: vi.fn(() => []),
    };

    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
    };

    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockResolvedValue(client as never);
    vi.mocked(startClient).mockResolvedValue(undefined);

    await act(async () => {
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    expect(logoutHandler).toBeTypeOf('function');

    await act(async () => {
      await logoutHandler?.();
    });

    expect(vi.mocked(removeCurrentClientSessionAndReload)).toHaveBeenCalledWith(
      client,
      currentSession
    );
  });

  it('redirects to login if the active session disappears after startup', async () => {
    const client = createMockClient();

    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
    };

    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockResolvedValue(client as never);
    vi.mocked(startClient).mockResolvedValue(undefined);

    await act(async () => {
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    currentSession = undefined;

    await act(async () => {
      renderer?.update(renderClientRoot());
      await flushEffects();
    });

    expect(renderer?.toJSON()).toEqual('login page');
  });

  it('keeps the loading screen unobstructed until the first sync arrives', async () => {
    const client = createMockClient();

    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
    };

    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockResolvedValue(client as never);
    let resolveStartClient: (() => void) | undefined;
    vi.mocked(startClient).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStartClient = resolve;
        })
    );

    await act(async () => {
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    expect(hasRenderedText(renderer, 'child')).toBe(false);
    expect(hasRenderedText(renderer, 'Catching up...')).toBe(false);
    expect(hasRenderedText(renderer, 'sync')).toBe(false);
    expect(
      renderer?.root.findAll((node) => node.props['aria-label'] === 'Startup recovery options')
    ).toHaveLength(1);

    await act(async () => {
      resolveStartClient?.();
      await flushEffects();
    });

    expect(hasRenderedText(renderer, 'child')).toBe(false);
    expect(hasRenderedText(renderer, 'Catching up...')).toBe(false);
  });

  it('uses deployment-configured loading messages on the startup splash', async () => {
    const client = createMockClient();

    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
    };

    vi.mocked(useClientConfig).mockReturnValue({
      splash: {
        loadingMessages: ['Warming the agents'],
      },
    });
    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockResolvedValue(client as never);
    vi.mocked(startClient).mockResolvedValue(undefined);

    await act(async () => {
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    expect(hasRenderedText(renderer, 'Warming the agents')).toBe(true);
  });

  it('renders cached UI immediately after startup when cached rooms are restored from the store', async () => {
    const client = createMockClient({ cachedRooms: 1 });

    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
    };

    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockResolvedValue(client as never);
    vi.mocked(startClient).mockResolvedValue(undefined);

    await act(async () => {
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    expect(hasRenderedText(renderer, 'child')).toBe(true);
    expect(hasRenderedText(renderer, 'Catching up...')).toBe(true);
    expect(hasRenderedText(renderer, 'Loading MindRoom Chat')).toBe(false);
    expect(
      renderer?.root.findAll((node) => node.props['aria-label'] === 'Startup recovery options')
    ).toHaveLength(0);
  });

  it.each([
    {
      label: 'an empty store after a sync error',
      cachedRooms: 0,
      state: SyncState.Error,
      allow: false,
    },
    {
      label: 'an empty newly synced account',
      cachedRooms: 0,
      state: SyncState.Prepared,
      allow: false,
    },
    {
      label: 'restored rooms before startup completes',
      cachedRooms: 1,
      state: SyncState.Prepared,
      allow: true,
    },
  ])(
    'only bypasses the versions gate for usable rooms: $label',
    async ({ cachedRooms, state, allow }) => {
      const client = createMockClient({ cachedRooms });
      currentSession = {
        sessionId: 'session-a',
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
        lastUsedAt: 1,
      };
      vi.mocked(useActiveSession).mockImplementation(() => currentSession);
      vi.mocked(initClient).mockResolvedValue(client as never);
      vi.mocked(startClient).mockReturnValue(new Promise(() => {}));

      await act(async () => {
        renderer = create(renderClientRoot());
        await flushEffects();
      });
      await act(async () => {
        client.emitSync(state, null);
        await flushEffects();
      });

      expect(renderer?.root.findByType(SpecVersions).props.allowCachedContent).toBe(allow);
    }
  );

  it('keeps the particle loading screen when only a saved sync token is restored', async () => {
    const client = createMockClient({ syncToken: 's123' });

    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
    };

    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockResolvedValue(client as never);
    vi.mocked(startClient).mockResolvedValue(undefined);

    await act(async () => {
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    expect(hasRenderedText(renderer, 'child')).toBe(false);
    expect(hasRenderedText(renderer, 'Catching up...')).toBe(false);
    expect(hasRenderedText(renderer, 'Loading MindRoom Chat')).toBe(true);
  });

  it('does not treat a saved sync token as a renderable cached shell without loaded rooms', () => {
    const client = createMockClient({ syncToken: 's123' });

    expect(hasCachedClientShell(client as never)).toBe(false);
  });

  it('renders cached UI after the first sync event arrives', async () => {
    const client = createMockClient();

    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
    };

    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockResolvedValue(client as never);
    vi.mocked(startClient).mockResolvedValue(undefined);

    await act(async () => {
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    expect(hasRenderedText(renderer, 'child')).toBe(false);
    expect(hasRenderedText(renderer, 'Catching up...')).toBe(false);

    await act(async () => {
      client.emitSync();
      await flushEffects();
    });

    expect(hasRenderedText(renderer, 'child')).toBe(true);
    expect(hasRenderedText(renderer, 'sync')).toBe(true);
  });

  it('keeps cached UI rendered after startClient resolves once the client has synced', async () => {
    const client = createMockClient();

    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
    };

    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockResolvedValue(client as never);
    vi.mocked(startClient).mockResolvedValue(undefined);

    await act(async () => {
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    await act(async () => {
      client.emitSync();
      await flushEffects();
    });

    expect(hasRenderedText(renderer, 'child')).toBe(true);
    expect(hasRenderedText(renderer, 'sync')).toBe(true);
  });
});
