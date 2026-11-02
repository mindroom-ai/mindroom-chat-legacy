import { useTranslation } from 'react-i18next';
import React from 'react';
import {
  Outlet,
  Route,
  createBrowserRouter,
  createHashRouter,
  createRoutesFromElements,
  redirect,
} from 'react-router-dom';

import { ClientConfig } from '../hooks/useClientConfig';
import { AuthLayout, Login, Register, ResetPassword } from './auth';
import {
  DIRECT_PATH,
  EXPLORE_PATH,
  HOME_PATH,
  LOGIN_PATH,
  INBOX_PATH,
  REGISTER_PATH,
  RESET_PASSWORD_PATH,
  SPACE_PATH,
  THREADS_PATH,
  CANVASES_PATH,
  _CREATE_PATH,
  _FEATURED_PATH,
  _INVITES_PATH,
  _JOIN_PATH,
  _LOBBY_PATH,
  _NOTIFICATIONS_PATH,
  _ROOM_PATH,
  _SEARCH_PATH,
  _SERVER_PATH,
  CREATE_PATH,
  CONNECT_PATH,
  CONNECTIONS_PATH,
} from './paths';
import { getExploreFeaturedPath, getInboxNotificationsPath, getSpaceLobbyPath } from './pathUtils';
import { ClientBindAtoms, ClientLayout, ClientRoot } from './client';
import { Home, HomeRouteRoomProvider, HomeSearch } from './client/home';
import { Direct, DirectCreate, DirectRouteRoomProvider } from './client/direct';
import { RouteSpaceProvider, Space, SpaceRouteRoomProvider, SpaceSearch } from './client/space';
import { Explore, FeaturedRooms, PublicRooms } from './client/explore';
import { Notifications, Inbox, Invites } from './client/inbox';
import { Threads } from './client/threads';
import { Canvases } from './client/canvases';
import { ConnectionsPage } from '../mindroom/connections/ConnectionsPage';
import { setAfterLoginRedirectPath } from './afterLoginRedirectPath';
import { Lobby } from '../features/lobby';
import { WelcomePage } from './client/WelcomePage';
import { ScreenSize } from '../hooks/useScreenSize';
import { MindroomPageNav } from '../mindroom/sidebar/ResizablePageNav';
import { ClientInitStorageAtom } from './client/ClientInitStorageAtom';
import { ClientNonUIFeatures } from './client/ClientNonUIFeatures';
import { AuthRouteThemeManager, UnAuthRouteThemeManager } from './ThemeManager';
import { ReceiveSelfDeviceVerification } from '../components/DeviceVerification';
import { AutoRestoreBackupOnVerification } from '../components/BackupRestore';
import { RoomSettingsRenderer } from '../features/room-settings';
import { ClientRoomsNotificationPreferences } from './client/ClientRoomsNotificationPreferences';
import { SpaceSettingsRenderer } from '../features/space-settings';
import { UserRoomProfileRenderer } from '../components/UserRoomProfileRenderer';
import { CreateRoomModalRenderer } from '../features/create-room';
import { HomeCreateRoom } from './client/home/CreateRoom';
import { Create } from './client/create';
import { CreateSpaceModalRenderer } from '../features/create-space';
import { CommandPaletteRenderer } from '../mindroom/command-palette';
import { ConnectPage } from '../mindroom/local-mindroom/ConnectPage';
import { Room } from '../mindroom/threads/MindroomRoom';
import { SettingsModalRenderer } from '../features/settings';
import { CallStatusRenderer } from './CallStatusRenderer';
import { CallEmbedProvider } from '../components/CallEmbedProvider';
import { getAppBasePath } from '../utils/basePath';
import {
  resolveAuthRouteRedirect,
  resolveProtectedRouteRedirect,
  resolveRootRouteRedirect,
} from './routeSessionGuards';
import {
  MindroomPageRoot,
  MindroomSpacePageRoot,
  MindroomSidebarNav,
  MindroomNavigationProvider,
} from '../mindroom/sidebar/MindroomNavigation';

function RouteStatus({ status }: { status: 'join' | 'notFound' }) {
  const { t } = useTranslation();
  return <p>{status === 'join' ? t('sharedUi.router.join') : t('sharedUi.router.notFound')}</p>;
}

export const createRouter = (clientConfig: ClientConfig, screenSize: ScreenSize) => {
  const { hashRouter } = clientConfig;
  const mobile = screenSize === ScreenSize.Mobile;

  const routes = createRoutesFromElements(
    <Route>
      <Route
        index
        loader={() => {
          const decision = resolveRootRouteRedirect(window.location.href);
          if (decision.afterLoginPath) {
            setAfterLoginRedirectPath(decision.afterLoginPath);
          }
          return redirect(decision.redirectTo);
        }}
      />
      {/* Device pairing approves with any stored account, so it stays outside the
          active-account client layout and must be static to win over SPACE_PATH. */}
      <Route
        path={CONNECT_PATH}
        element={
          <>
            <ConnectPage />
            <UnAuthRouteThemeManager />
          </>
        }
      />
      <Route
        loader={({ request }) => {
          const redirectTo = resolveAuthRouteRedirect(request.url);
          if (redirectTo) {
            return redirect(redirectTo);
          }

          return null;
        }}
        element={
          <>
            <AuthLayout />
            <UnAuthRouteThemeManager />
          </>
        }
      >
        <Route path={LOGIN_PATH} element={<Login />} />
        <Route path={REGISTER_PATH} element={<Register />} />
        <Route path={RESET_PASSWORD_PATH} element={<ResetPassword />} />
      </Route>

      <Route
        loader={() => {
          const decision = resolveProtectedRouteRedirect(window.location.href, hashRouter);
          if (decision) {
            if (decision.afterLoginPath) {
              setAfterLoginRedirectPath(decision.afterLoginPath);
            }
            return redirect(decision.redirectTo);
          }

          return null;
        }}
        element={
          <AuthRouteThemeManager>
            <ClientRoot>
              <ClientInitStorageAtom>
                <ClientRoomsNotificationPreferences>
                  <ClientBindAtoms>
                    <ClientNonUIFeatures>
                      <CallEmbedProvider>
                        <MindroomNavigationProvider>
                          <ClientLayout nav={<MindroomSidebarNav />}>
                            <Outlet />
                          </ClientLayout>
                        </MindroomNavigationProvider>
                        <CallStatusRenderer />
                        <UserRoomProfileRenderer />
                      </CallEmbedProvider>
                      <CommandPaletteRenderer />
                      <SettingsModalRenderer />
                      <CreateRoomModalRenderer />
                      <CreateSpaceModalRenderer />
                      <RoomSettingsRenderer />
                      <SpaceSettingsRenderer />
                      <ReceiveSelfDeviceVerification />
                      <AutoRestoreBackupOnVerification />
                    </ClientNonUIFeatures>
                  </ClientBindAtoms>
                </ClientRoomsNotificationPreferences>
              </ClientInitStorageAtom>
            </ClientRoot>
          </AuthRouteThemeManager>
        }
      >
        <Route
          path={HOME_PATH}
          element={
            <MindroomPageRoot
              navId="home"
              nav={
                <MindroomPageNav path={HOME_PATH}>
                  <Home />
                </MindroomPageNav>
              }
            >
              <Outlet />
            </MindroomPageRoot>
          }
        >
          {mobile ? null : <Route index element={<WelcomePage />} />}
          <Route path={_CREATE_PATH} element={<HomeCreateRoom />} />
          <Route path={_JOIN_PATH} element={<RouteStatus status="join" />} />
          <Route path={_SEARCH_PATH} element={<HomeSearch />} />
          <Route
            path={_ROOM_PATH}
            element={
              <HomeRouteRoomProvider>
                <Room />
              </HomeRouteRoomProvider>
            }
          />
        </Route>
        <Route
          path={DIRECT_PATH}
          element={
            <MindroomPageRoot
              navId="direct"
              nav={
                <MindroomPageNav path={DIRECT_PATH}>
                  <Direct />
                </MindroomPageNav>
              }
            >
              <Outlet />
            </MindroomPageRoot>
          }
        >
          {mobile ? null : <Route index element={<WelcomePage />} />}
          <Route path={_CREATE_PATH} element={<DirectCreate />} />
          <Route
            path={_ROOM_PATH}
            element={
              <DirectRouteRoomProvider>
                <Room />
              </DirectRouteRoomProvider>
            }
          />
        </Route>
        <Route path={THREADS_PATH} element={<Threads />} />
        <Route path={CANVASES_PATH} element={<Canvases />} />
        <Route path={CONNECTIONS_PATH} element={<ConnectionsPage />} />
        <Route
          path={SPACE_PATH}
          element={
            <RouteSpaceProvider>
              <MindroomSpacePageRoot
                nav={
                  <MindroomPageNav path={SPACE_PATH}>
                    <Space />
                  </MindroomPageNav>
                }
              >
                <Outlet />
              </MindroomSpacePageRoot>
            </RouteSpaceProvider>
          }
        >
          {mobile ? null : (
            <Route
              index
              loader={({ params }) => {
                const { spaceIdOrAlias } = params;
                if (spaceIdOrAlias) {
                  return redirect(getSpaceLobbyPath(spaceIdOrAlias));
                }
                return null;
              }}
              element={<WelcomePage />}
            />
          )}
          <Route path={_LOBBY_PATH} element={<Lobby />} />
          <Route path={_SEARCH_PATH} element={<SpaceSearch />} />
          <Route
            path={_ROOM_PATH}
            element={
              <SpaceRouteRoomProvider>
                <Room />
              </SpaceRouteRoomProvider>
            }
          />
        </Route>
        <Route
          path={EXPLORE_PATH}
          element={
            <MindroomPageRoot
              nav={
                <MindroomPageNav path={EXPLORE_PATH}>
                  <Explore />
                </MindroomPageNav>
              }
            >
              <Outlet />
            </MindroomPageRoot>
          }
        >
          {mobile ? null : (
            <Route
              index
              loader={() => redirect(getExploreFeaturedPath())}
              element={<WelcomePage />}
            />
          )}
          <Route path={_FEATURED_PATH} element={<FeaturedRooms />} />
          <Route path={_SERVER_PATH} element={<PublicRooms />} />
        </Route>
        <Route path={CREATE_PATH} element={<Create />} />
        <Route
          path={INBOX_PATH}
          element={
            <MindroomPageRoot
              nav={
                <MindroomPageNav path={INBOX_PATH}>
                  <Inbox />
                </MindroomPageNav>
              }
            >
              <Outlet />
            </MindroomPageRoot>
          }
        >
          {mobile ? null : (
            <Route
              index
              loader={() => redirect(getInboxNotificationsPath())}
              element={<WelcomePage />}
            />
          )}
          <Route path={_NOTIFICATIONS_PATH} element={<Notifications />} />
          <Route path={_INVITES_PATH} element={<Invites />} />
        </Route>
      </Route>
      <Route path="/*" element={<RouteStatus status="notFound" />} />
    </Route>
  );

  if (hashRouter?.enabled) {
    return createHashRouter(routes, { basename: hashRouter.basename });
  }
  return createBrowserRouter(routes, {
    basename: getAppBasePath(),
  });
};
