import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  config,
  Icon,
  IconButton,
  Icons,
  PopOut,
  RectCords,
  Spinner,
  Text,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import React, { MouseEventHandler, ReactNode, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { HttpApiEvent } from 'matrix-js-sdk/lib/http-api/interface';
import type { HttpApiEventHandlerMap } from 'matrix-js-sdk/lib/http-api/interface';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Menu, Dialog, MenuItem } from '../../components/glass/GlassPrimitives';
import {
  ClientBootstrapSession,
  clearAllCacheAndReload,
  initClient,
  logoutClient,
  removeCurrentClientSessionAndReload,
  removeSessionAndReload,
  startClient,
} from '../../../client/initMatrix';
import { clearSecretStorageKeys } from '../../../client/secretStorageKeys';
import { MindRoomSplashScreen, SplashScreen } from '../../components/splash-screen';
import { ServerConfigsLoader } from '../../components/ServerConfigsLoader';
import { CapabilitiesProvider } from '../../hooks/useCapabilities';
import { MediaConfigProvider } from '../../hooks/useMediaConfig';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { SpecVersions } from './SpecVersions';
import { stopPropagation } from '../../utils/keyboard';
import { SyncStatus } from './SyncStatus';
import { AuthMetadataProvider } from '../../hooks/useAuthMetadata';
import { StoredSession } from '../../state/sessions';
import { useActiveSession } from '../../hooks/useSessionStore';
import { useClientConfig } from '../../hooks/useClientConfig';
import { getLoginPath } from '../pathUtils';
import { ClientStartupProvider } from './ClientStartupContext';
import { AutoDiscovery } from './AutoDiscovery';
import {
  isInitialClientCatchupInProgress,
  useClientSyncStateData,
} from '../../hooks/useInitialClientCatchup';
import {
  createMindroomSyncEngine,
  MindroomSyncEngineProvider,
  type MindroomSyncEngine,
} from '../../mindroom/engine';
import {
  useLivePrefetchConfig,
  usePrefetchConfigSubscription,
} from '../../mindroom/settings/useLivePrefetchConfig';

type ClientMatrixClient = Awaited<ReturnType<typeof initClient>> & {
  on: (
    event: HttpApiEvent.SessionLoggedOut,
    listener: HttpApiEventHandlerMap[HttpApiEvent.SessionLoggedOut]
  ) => unknown;
  removeListener: (
    event: HttpApiEvent.SessionLoggedOut,
    listener: HttpApiEventHandlerMap[HttpApiEvent.SessionLoggedOut]
  ) => unknown;
};

export const hasCachedClientShell = (mx: ClientMatrixClient): boolean => {
  return mx.getRooms().length > 0;
};

function ClientRootLoading({ loadingMessages }: { loadingMessages?: readonly string[] }) {
  return <MindRoomSplashScreen loadingMessages={loadingMessages} />;
}

function ClientRootSyncingStatus() {
  const { t } = useTranslation();
  return (
    <Box
      data-testid="client-sync-status"
      direction="Row"
      shrink="No"
      alignItems="Center"
      justifyContent="Center"
      gap="100"
      style={{ padding: config.space.S100 }}
    >
      <Spinner variant="Secondary" size="100" />
      <Text size="T300">{t('sharedUi.clientRoot.catchingUp')}</Text>
    </Box>
  );
}

function ClientRootOptions({
  mx,
  activeSession,
}: {
  mx?: ClientMatrixClient;
  activeSession: StoredSession;
}) {
  const { t } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [clearing, setClearing] = useState(false);

  const handleToggle: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((currentState) => {
      if (currentState) return undefined;
      return cords;
    });
  };

  const handleClearCache = async () => {
    if (!mx || clearing) return;
    setClearing(true);
    try {
      await clearAllCacheAndReload(mx);
    } catch {
      setClearing(false);
    }
  };

  return (
    <IconButton
      aria-label={t('sharedUi.clientRoot.startupRecoveryOptions')}
      style={{
        position: 'absolute',
        top: config.space.S100,
        right: config.space.S100,
      }}
      variant="Background"
      fill="None"
      onClick={handleToggle}
    >
      <Icon size="200" src={Icons.VerticalDots} />
      <PopOut
        anchor={menuAnchor}
        position="Bottom"
        align="End"
        offset={6}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: () => setMenuAnchor(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
              isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                {mx && (
                  <MenuItem
                    onClick={handleClearCache}
                    size="300"
                    radii="300"
                    disabled={clearing}
                    before={clearing && <Spinner size="100" variant="Secondary" />}
                  >
                    <Text as="span" size="T300" truncate>
                      {clearing
                        ? t('sharedUi.clientRoot.clearing')
                        : t('sharedUi.clientRoot.clearCacheAndReload')}
                    </Text>
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    if (mx) {
                      logoutClient(mx).catch(() => undefined);
                      return;
                    }
                    removeSessionAndReload(activeSession).catch(() => undefined);
                  }}
                  size="300"
                  radii="300"
                  variant="Critical"
                  fill="None"
                >
                  <Text as="span" size="T300" truncate>
                    {t('sharedUi.clientRoot.logout')}
                  </Text>
                </MenuItem>
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </IconButton>
  );
}

const useLogoutListener = (
  mx: ClientMatrixClient | undefined,
  activeSession: StoredSession | undefined
) => {
  useEffect(() => {
    const handleLogout: HttpApiEventHandlerMap[HttpApiEvent.SessionLoggedOut] = async () => {
      if (!mx) return;
      await removeCurrentClientSessionAndReload(mx, activeSession);
    };

    mx?.on(HttpApiEvent.SessionLoggedOut, handleLogout);
    return () => {
      mx?.removeListener(HttpApiEvent.SessionLoggedOut, handleLogout);
    };
  }, [activeSession, mx]);
};

type ClientState =
  | {
      status: 'loading' | 'starting';
      session: ClientBootstrapSession;
      mx?: ClientMatrixClient;
    }
  | {
      status: 'success';
      session: ClientBootstrapSession;
      mx: ClientMatrixClient;
    }
  | {
      status: 'error';
      session: ClientBootstrapSession;
      error: Error;
      mx?: ClientMatrixClient;
    };

type ClientRootProps = {
  children: ReactNode;
};

type ClientSessionRootProps = ClientRootProps & {
  activeSession: StoredSession;
  loadingMessages?: readonly string[];
};

const toClientBootstrapSession = (session: StoredSession): ClientBootstrapSession => ({
  sessionId: session.sessionId,
  baseUrl: session.baseUrl,
  userId: session.userId,
  deviceId: session.deviceId,
  accessToken: session.accessToken,
  refreshToken: session.refreshToken,
});

function ClientSessionRoot({ children, activeSession, loadingMessages }: ClientSessionRootProps) {
  const { t } = useTranslation();
  const getPrefetchConfig = useLivePrefetchConfig();
  const subscribePrefetchConfig = usePrefetchConfigSubscription();
  const [queryClient] = useState(() => new QueryClient());
  // This component is keyed by account + device below. Capture the credentials
  // used to create that runtime once: SDK token rotation updates the session
  // store, but must not tear down the client that performed the rotation.
  const [clientBootstrapSession, setClientBootstrapSession] = useState<ClientBootstrapSession>(() =>
    toClientBootstrapSession(activeSession)
  );
  const [clientState, setClientState] = useState<ClientState>(() => ({
    status: 'loading',
    session: clientBootstrapSession,
  }));
  // Failed clients remain on the error state only for recovery cleanup. Do
  // not leave them mounted in providers, listeners, or the sync engine.
  const mx = clientState.status !== 'error' && 'mx' in clientState ? clientState.mx : undefined;

  useEffect(
    () => () => {
      clearSecretStorageKeys();
    },
    []
  );

  useLogoutListener(mx, activeSession);

  // CINNY-207 P3.1: MindroomSyncEngine is the client-level owner of
  // Tier-1 cache writes (D2). It is created alongside the Matrix client
  // and torn down on logout / client swap, independent of which room is
  // mounted. Attaching listeners here — BEFORE the startClient effect
  // below — is deliberate: React runs effects in declaration order at
  // commit, so this effect binds mx.on(RoomEvent.*) before startClient
  // begins delivering sync events. Missing an event because the engine
  // wasn't listening yet is the exact regression class this ordering
  // guards against.
  const [syncEngine, setSyncEngine] = useState<MindroomSyncEngine | undefined>(undefined);
  useEffect(() => {
    if (!mx) {
      setSyncEngine(undefined);
      return undefined;
    }
    const engine = createMindroomSyncEngine({
      mx,
      getPrefetchConfig,
      subscribePrefetchConfig,
    });
    engine.start();
    setSyncEngine(engine);
    return () => {
      engine.stop();
      setSyncEngine((current) => (current === engine ? undefined : current));
    };
  }, [getPrefetchConfig, mx, subscribePrefetchConfig]);

  const [hasCachedShell, setHasCachedShell] = useState(false);
  const syncStateData = useClientSyncStateData(mx);
  useEffect(() => {
    let disposed = false;
    let nextClient: ClientMatrixClient | undefined;

    setClientState({
      status: 'loading',
      session: clientBootstrapSession,
    });
    setHasCachedShell(false);

    const loadClient = async () => {
      try {
        nextClient = (await initClient(clientBootstrapSession)) as ClientMatrixClient;
        if (disposed) {
          nextClient.stopClient();
          return;
        }

        setClientState({
          status: 'starting',
          session: clientBootstrapSession,
          mx: nextClient,
        });
      } catch (error) {
        if (nextClient) {
          nextClient.stopClient();
        }
        if (disposed) return;

        setClientState({
          status: 'error',
          session: clientBootstrapSession,
          error: error instanceof Error ? error : new Error('Failed to initialize Matrix client.'),
          mx: nextClient,
        });
      }
    };

    loadClient().catch(() => undefined);

    return () => {
      disposed = true;
      nextClient?.stopClient();
    };
  }, [clientBootstrapSession]);

  useEffect(() => {
    if (clientState.status !== 'starting' || !clientState.mx) return undefined;

    let disposed = false;
    const { mx: nextClient, session } = clientState;

    const startInitializedClient = async () => {
      try {
        await startClient(nextClient);
        if (disposed) return;

        setHasCachedShell(hasCachedClientShell(nextClient));

        setClientState((currentState) => {
          if (
            currentState.status !== 'starting' ||
            currentState.mx !== nextClient ||
            currentState.session.sessionId !== session.sessionId
          ) {
            return currentState;
          }

          return {
            status: 'success',
            session,
            mx: nextClient,
          };
        });
      } catch (error) {
        nextClient.stopClient();
        if (disposed) return;

        setClientState({
          status: 'error',
          session,
          error: error instanceof Error ? error : new Error('Failed to initialize Matrix client.'),
          mx: nextClient,
        });
      }
    };

    startInitializedClient().catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [clientState]);

  const hasSeenSyncActivity = syncStateData.current !== null;
  const hasCompletedInitialCatchup = !isInitialClientCatchupInProgress(syncStateData);
  const canRenderReadyContent = Boolean(mx) && (hasSeenSyncActivity || hasCachedShell);

  const readyContent = mx ? (
    <ClientStartupProvider hasCompletedInitialSync={hasCompletedInitialCatchup}>
      <MatrixClientProvider value={mx as never}>
        {syncEngine ? (
          <MindroomSyncEngineProvider engine={syncEngine}>
            <ServerConfigsLoader mx={mx}>
              {(serverConfigs) => (
                <CapabilitiesProvider value={serverConfigs.capabilities ?? {}}>
                  <MediaConfigProvider value={serverConfigs.mediaConfig ?? {}}>
                    <AuthMetadataProvider value={serverConfigs.authMetadata}>
                      <AutoDiscovery userId={activeSession.userId} baseUrl={activeSession.baseUrl}>
                        {children}
                      </AutoDiscovery>
                    </AuthMetadataProvider>
                  </MediaConfigProvider>
                </CapabilitiesProvider>
              )}
            </ServerConfigsLoader>
          </MindroomSyncEngineProvider>
        ) : null}
      </MatrixClientProvider>
    </ClientStartupProvider>
  ) : null;

  return (
    <QueryClientProvider client={queryClient}>
      <SpecVersions
        baseUrl={activeSession.baseUrl}
        allowCachedContent={Boolean(mx && hasCachedClientShell(mx))}
      >
        {clientState.status !== 'error' &&
          canRenderReadyContent &&
          mx &&
          (!hasSeenSyncActivity ? <ClientRootSyncingStatus /> : <SyncStatus mx={mx} />)}
        {clientState.status !== 'error' && !canRenderReadyContent && (
          <ClientRootOptions mx={mx} activeSession={activeSession} />
        )}
        {clientState.status === 'error' && (
          <SplashScreen>
            <Box
              direction="Column"
              grow="Yes"
              alignItems="Center"
              justifyContent="Center"
              gap="400"
            >
              <Dialog>
                <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
                  <Text>
                    {t('sharedUi.clientRoot.failedToStartAccountValue1Value2', {
                      value1: clientState.session.userId,
                      value2: clientState.error.message,
                    })}
                  </Text>
                  <Button
                    variant="Primary"
                    onClick={() =>
                      setClientBootstrapSession(toClientBootstrapSession(activeSession))
                    }
                    fill="Soft"
                    outlined
                    radii="300"
                  >
                    <Text as="span" size="B400">
                      {t('sharedUi.clientRoot.retry')}
                    </Text>
                  </Button>
                  <Button
                    variant="Secondary"
                    fill="Soft"
                    onClick={() => {
                      // Works without a client (initClient itself failed —
                      // the ordinary corrupted-store case): cleanup targets
                      // come from the stored session registry.
                      clearAllCacheAndReload(clientState.mx).catch(() => undefined);
                    }}
                    outlined
                    radii="300"
                  >
                    <Text as="span" size="B400">
                      {t('sharedUi.clientRoot.clearCacheAndReload')}
                    </Text>
                  </Button>
                  <Button
                    variant="Critical"
                    fill="Soft"
                    onClick={() => {
                      removeSessionAndReload(clientState.session, clientState.mx).catch(
                        () => undefined
                      );
                    }}
                    outlined
                    radii="300"
                  >
                    <Text as="span" size="B400">
                      {t('sharedUi.clientRoot.removeAccount')}
                    </Text>
                  </Button>
                </Box>
              </Dialog>
            </Box>
          </SplashScreen>
        )}
        {clientState.status !== 'error' && !canRenderReadyContent ? (
          <ClientRootLoading loadingMessages={loadingMessages} />
        ) : (
          readyContent
        )}
      </SpecVersions>
    </QueryClientProvider>
  );
}

export function ClientRoot({ children }: ClientRootProps) {
  const clientConfig = useClientConfig();
  const activeSession = useActiveSession();

  if (!activeSession) {
    return <Navigate to={getLoginPath()} replace />;
  }

  return (
    <ClientSessionRoot
      key={`${activeSession.sessionId}:${activeSession.deviceId}`}
      activeSession={activeSession}
      loadingMessages={clientConfig.splash?.loadingMessages}
    >
      {children}
    </ClientSessionRoot>
  );
}
