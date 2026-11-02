import React, { useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  config,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import { General } from './general';
import { PageNav, PageNavContent, PageNavHeader, PageRoot } from '../../components/page';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { Account } from './account';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { UserAvatar } from '../../components/user-avatar';
import { nameInitials } from '../../utils/common';
import { Notifications } from './notifications';
import { Devices } from './devices';
import { EmojisStickers } from './emojis-stickers';
import { DeveloperTools } from './developer-tools';
import { About } from './about';
import { UseStateProvider } from '../../components/UseStateProvider';
import { stopPropagation } from '../../utils/keyboard';
import { LogoutDialog } from '../../components/LogoutDialog';
import {
  getSettingsMenuItems,
  resolveSettingsInitialPage,
  type SettingsMenuItem,
} from './settingsMenu';
import { SettingsPage, SettingsPages, SIMPLE_MODE_HIDDEN_SETTINGS_PAGES } from './settingsPages';
import { renderMindroomSettingsPage } from '../../mindroom/settings/settingsExtensions';
import { useSimpleMode } from '../../mindroom/settings/useMindroomAccountSettings';
import { useShowLocalMindroom } from '../../mindroom/local-mindroom/useShowLocalMindroom';

const useSettingsMenuItems = (
  showLocalMindRoom: boolean,
  simpleMode: boolean
): SettingsMenuItem[] => {
  const { t } = useTranslation();

  return useMemo(() => {
    const items = getSettingsMenuItems(showLocalMindRoom, t);
    return simpleMode
      ? items.filter((item) => !SIMPLE_MODE_HIDDEN_SETTINGS_PAGES.includes(item.page))
      : items;
  }, [showLocalMindRoom, simpleMode, t]);
};

type SettingsProps = {
  initialPage?: SettingsPage;
  requestClose: () => void;
};
export function Settings({ initialPage, requestClose }: SettingsProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const userId = mx.getUserId()!;
  const profile = useUserProfile(userId);
  const displayName = profile.displayName ?? getMxIdLocalPart(userId) ?? userId;
  const avatarUrl = profile.avatarUrl
    ? mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication, 96, 96, 'crop') ?? undefined
    : undefined;

  const screenSize = useScreenSizeContext();
  const simpleMode = useSimpleMode();
  // Local MindRoom stays visible in simple mode: it is where device pairing codes are entered.
  const showLocalMindRoom = useShowLocalMindroom();
  const [activePage, setActivePage] = useState<SettingsPage | undefined>(() =>
    resolveSettingsInitialPage(initialPage, screenSize, showLocalMindRoom)
  );
  const menuItems = useSettingsMenuItems(showLocalMindRoom, simpleMode);

  // If the mode flips while the window is open (e.g. simple mode synced from
  // another device), a page that just left the menu must not keep rendering
  // with no menu entry pointing at it.
  useEffect(() => {
    if (activePage === undefined) return;
    if (menuItems.some((item) => item.page === activePage)) return;
    setActivePage(screenSize === ScreenSize.Mobile ? undefined : SettingsPages.GeneralPage);
  }, [activePage, menuItems, screenSize]);

  const handlePageRequestClose = () => {
    if (screenSize === ScreenSize.Mobile) {
      setActivePage(undefined);
      return;
    }
    requestClose();
  };

  return (
    <PageRoot
      nav={
        screenSize === ScreenSize.Mobile && activePage !== undefined ? undefined : (
          <PageNav size="300">
            <Box grow="Yes" direction="Column">
              <PageNavContent
                header={
                  <PageNavHeader>
                    <Box grow="Yes" gap="200">
                      <Avatar size="200" radii="300">
                        <UserAvatar
                          userId={userId}
                          src={avatarUrl}
                          renderFallback={() => <Text size="H6">{nameInitials(displayName)}</Text>}
                        />
                      </Avatar>
                      <Text size="H4" truncate>
                        {t('settings.title')}
                      </Text>
                    </Box>
                    <Box shrink="No">
                      {screenSize === ScreenSize.Mobile && (
                        <IconButton onClick={requestClose} variant="Background">
                          <Icon src={Icons.Cross} />
                        </IconButton>
                      )}
                    </Box>
                  </PageNavHeader>
                }
              >
                <div style={{ flexGrow: 1 }}>
                  {menuItems.map((item) => (
                    <MenuItem
                      key={item.name}
                      variant="Background"
                      radii="400"
                      aria-pressed={activePage === item.page}
                      before={<Icon src={item.icon} size="100" filled={activePage === item.page} />}
                      onClick={() => setActivePage(item.page)}
                    >
                      <Text
                        style={{
                          fontWeight: activePage === item.page ? config.fontWeight.W600 : undefined,
                        }}
                        size="T300"
                        truncate
                      >
                        {item.name}
                      </Text>
                    </MenuItem>
                  ))}
                </div>
              </PageNavContent>
              <Box style={{ padding: config.space.S200 }} shrink="No" direction="Column">
                <UseStateProvider initial={false}>
                  {(logout, setLogout) => (
                    <>
                      <Button
                        size="300"
                        variant="Critical"
                        fill="None"
                        radii="Pill"
                        before={<Icon src={Icons.Power} size="100" />}
                        onClick={() => setLogout(true)}
                      >
                        <Text size="B400">{t('settings.logout')}</Text>
                      </Button>
                      {logout && (
                        <Overlay open backdrop={<OverlayBackdrop />}>
                          <OverlayCenter>
                            <FocusTrap
                              focusTrapOptions={{
                                onDeactivate: () => setLogout(false),
                                clickOutsideDeactivates: true,
                                escapeDeactivates: stopPropagation,
                              }}
                            >
                              <LogoutDialog handleClose={() => setLogout(false)} />
                            </FocusTrap>
                          </OverlayCenter>
                        </Overlay>
                      )}
                    </>
                  )}
                </UseStateProvider>
              </Box>
            </Box>
          </PageNav>
        )
      }
    >
      {activePage === SettingsPages.GeneralPage && (
        <General requestClose={handlePageRequestClose} />
      )}
      {activePage === SettingsPages.AccountPage && (
        <Account requestClose={handlePageRequestClose} />
      )}
      {activePage === SettingsPages.NotificationPage && (
        <Notifications requestClose={handlePageRequestClose} />
      )}
      {activePage === SettingsPages.DevicesPage && (
        <Devices requestClose={handlePageRequestClose} />
      )}
      {activePage === SettingsPages.EmojisStickersPage && (
        <EmojisStickers requestClose={handlePageRequestClose} />
      )}
      {renderMindroomSettingsPage(
        activePage,
        showLocalMindRoom,
        handlePageRequestClose,
        requestClose
      )}
      {activePage === SettingsPages.DeveloperToolsPage && (
        <DeveloperTools requestClose={handlePageRequestClose} />
      )}
      {activePage === SettingsPages.AboutPage && <About requestClose={handlePageRequestClose} />}
    </PageRoot>
  );
}
