import React, { MouseEventHandler, forwardRef, useState } from 'react';
import { MatrixClient, Room } from 'matrix-js-sdk';
import {
  Avatar,
  Box,
  Icon,
  IconButton,
  Icons,
  Text,
  config,
  PopOut,
  toRem,
  Line,
  RectCords,
  Badge,
  Spinner,
} from 'folds';
import { useFocusWithin, useHover } from 'react-aria';
import FocusTrap from 'focus-trap-react';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { ArchiveRoomMenuItem } from '../../mindroom/rooms/ArchiveRoomMenuItem';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import { NavItem, NavItemContent, NavItemOptions, NavLink } from '../../components/nav';
import { UnreadBadge, UnreadBadgeCenter } from '../../components/unread-badge';
import { RoomAvatar, RoomIcon } from '../../components/room-avatar';
import { getRoomAvatarUrl, getStateEvent } from '../../utils/room';
import { nameInitials } from '../../utils/common';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomUnread } from '../../state/hooks/unread';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { getPowersLevelFromMatrixEvent, usePowerLevels } from '../../hooks/usePowerLevels';
import { copyToClipboard } from '../../utils/dom';
import { MindroomMarkRoomReadMenuItem } from '../../mindroom/notifications/MindroomMarkRoomReadMenuItem';
import { UseStateProvider } from '../../components/UseStateProvider';
import { LeaveRoomPrompt } from '../../components/leave-room-prompt';
import { useRoomTypingMember } from '../../hooks/useRoomTypingMembers';
import { TypingIndicator } from '../../components/typing-indicator';
import { stopPropagation } from '../../utils/keyboard';
import { getMatrixToRoom } from '../../plugins/matrix-to';
import { getCanonicalAliasOrRoomId, isRoomAlias, mxcUrlToHttp } from '../../utils/matrix';
import { getViaServers } from '../../plugins/via-servers';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useOpenRoomSettings } from '../../state/hooks/roomSettings';
import { useSpaceOptionally } from '../../hooks/useSpace';
import {
  getRoomNotificationModeIcon,
  RoomNotificationMode,
} from '../../hooks/useRoomsNotificationPreferences';
import { RoomNotificationModeSwitcher } from '../../components/RoomNotificationSwitcher';
import { getRoomCreatorsForRoomId, useRoomCreators } from '../../hooks/useRoomCreators';
import { getRoomPermissionsAPI, useRoomPermissions } from '../../hooks/useRoomPermissions';
import { InviteUserPrompt } from '../../components/invite-user-prompt';
import { useRoomAvatar, useRoomName } from '../../hooks/useRoomMeta';
import { useCallMembers, useCallSession } from '../../hooks/useCall';
import { useCallEmbed, useCallStart } from '../../hooks/useCallEmbed';
import { callChatAtom } from '../../state/callEmbed';
import { useCallPreferencesAtom } from '../../state/hooks/callPreferences';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import { livekitSupport } from '../../hooks/useLivekitSupport';
import { StateEvent } from '../../../types/matrix/room';
import { webRTCSupported } from '../../utils/rtc';
import { IconTooltip } from '../../mindroom/tooltip/IconTooltip';
import { useRoomBackgroundJobs } from '../../mindroom/background-jobs/useRoomBackgroundJobs';

type RoomNavItemMenuProps = {
  room: Room;
  requestClose: () => void;
  notificationMode?: RoomNotificationMode;
};
const RoomNavItemMenu = forwardRef<HTMLDivElement, RoomNavItemMenuProps>(
  ({ room, requestClose, notificationMode }, ref) => {
    const { t } = useTranslation();
    const mx = useMatrixClient();
    const powerLevels = usePowerLevels(room);
    const creators = useRoomCreators(room);

    const permissions = useRoomPermissions(creators, powerLevels);
    const canInvite = permissions.action('invite', mx.getSafeUserId());
    const openRoomSettings = useOpenRoomSettings();
    const space = useSpaceOptionally();

    const [invitePrompt, setInvitePrompt] = useState(false);

    const handleInvite = () => {
      setInvitePrompt(true);
    };

    const handleCopyLink = () => {
      const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, room.roomId);
      const viaServers = isRoomAlias(roomIdOrAlias) ? undefined : getViaServers(room);
      copyToClipboard(getMatrixToRoom(roomIdOrAlias, viaServers));
      requestClose();
    };

    const handleRoomSettings = () => {
      openRoomSettings(room.roomId, space?.roomId);
      requestClose();
    };

    return (
      <Menu ref={ref} style={{ maxWidth: toRem(160), width: '100vw' }}>
        {invitePrompt && room && (
          <InviteUserPrompt
            room={room}
            requestClose={() => {
              setInvitePrompt(false);
              requestClose();
            }}
          />
        )}
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          <MindroomMarkRoomReadMenuItem room={room} onClose={requestClose} />
          <RoomNotificationModeSwitcher roomId={room.roomId} value={notificationMode}>
            {(handleOpen, opened, changing) => (
              <MenuItem
                size="300"
                after={
                  changing ? (
                    <Spinner size="100" variant="Secondary" />
                  ) : (
                    <Icon size="100" src={getRoomNotificationModeIcon(notificationMode)} />
                  )
                }
                radii="300"
                aria-pressed={opened}
                onClick={handleOpen}
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  {t('featureUi.roomNav.roomNavItem.notifications')}
                </Text>
              </MenuItem>
            )}
          </RoomNotificationModeSwitcher>
        </Box>
        <Line variant="Surface" size="300" />
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          <MenuItem
            onClick={handleInvite}
            variant="Primary"
            fill="None"
            size="300"
            after={<Icon size="100" src={Icons.UserPlus} />}
            radii="300"
            aria-pressed={invitePrompt}
            disabled={!canInvite}
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              {t('featureUi.roomNav.roomNavItem.invite')}
            </Text>
          </MenuItem>
          <MenuItem
            onClick={handleCopyLink}
            size="300"
            after={<Icon size="100" src={Icons.Link} />}
            radii="300"
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              {t('featureUi.roomNav.roomNavItem.copyLink')}
            </Text>
          </MenuItem>
          <MenuItem
            onClick={handleRoomSettings}
            size="300"
            after={<Icon size="100" src={Icons.Setting} />}
            radii="300"
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              {t('featureUi.roomNav.roomNavItem.roomSettings')}
            </Text>
          </MenuItem>
        </Box>
        <Line variant="Surface" size="300" />
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          <ArchiveRoomMenuItem roomId={room.roomId} onClose={requestClose} />
          <UseStateProvider initial={false}>
            {(promptLeave, setPromptLeave) => (
              <>
                <MenuItem
                  onClick={() => setPromptLeave(true)}
                  variant="Critical"
                  fill="None"
                  size="300"
                  after={<Icon size="100" src={Icons.ArrowGoLeft} />}
                  radii="300"
                  aria-pressed={promptLeave}
                >
                  <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                    {t('featureUi.roomNav.roomNavItem.leaveRoom')}
                  </Text>
                </MenuItem>
                {promptLeave && (
                  <LeaveRoomPrompt
                    roomId={room.roomId}
                    onDone={requestClose}
                    onCancel={() => setPromptLeave(false)}
                  />
                )}
              </>
            )}
          </UseStateProvider>
        </Box>
      </Menu>
    );
  }
);

function CallChatToggle() {
  const { t } = useTranslation();
  const [chat, setChat] = useAtom(callChatAtom);

  return (
    <IconTooltip label={t('featureUi.roomNav.roomNavItem.toggleChat')} position="Top">
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          onClick={() => setChat(!chat)}
          aria-pressed={chat}
          aria-label={t('featureUi.roomNav.roomNavItem.toggleChat')}
          variant="Background"
          fill="None"
          size="300"
          radii="300"
        >
          <Icon size="50" src={Icons.Message} filled={chat} />
        </IconButton>
      )}
    </IconTooltip>
  );
}

type RoomNavItemProps = {
  room: Room;
  selected: boolean;
  linkPath: string;
  notificationMode?: RoomNotificationMode;
  showAvatar?: boolean;
  direct?: boolean;
};

const getRoomNavAvatarUrl = (
  mx: MatrixClient,
  room: Room,
  avatarMxc: string | undefined,
  direct: boolean | undefined,
  useAuthentication: boolean
): string | undefined => {
  if (avatarMxc) {
    return mxcUrlToHttp(mx, avatarMxc, useAuthentication, 96, 96, 'crop') ?? undefined;
  }
  return direct ? getRoomAvatarUrl(mx, room, 96, useAuthentication) : undefined;
};

export function RoomNavItem({
  room,
  selected,
  showAvatar,
  direct,
  notificationMode,
  linkPath,
}: RoomNavItemProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [hover, setHover] = useState(false);
  const { hoverProps } = useHover({ onHoverChange: setHover });
  const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: setHover });
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);
  const hasBackgroundJobs = useRoomBackgroundJobs(room).length > 0;
  const typingMember = useRoomTypingMember(room.roomId).filter(
    (receipt) => receipt.userId !== mx.getUserId()
  );

  const roomName = useRoomName(room);
  const roomAvatarMxc = useRoomAvatar(room, direct);
  const roomAvatarUrl = getRoomNavAvatarUrl(mx, room, roomAvatarMxc, direct, useAuthentication);

  const handleContextMenu: MouseEventHandler<HTMLElement> = (evt) => {
    evt.preventDefault();
    setMenuAnchor({
      x: evt.clientX,
      y: evt.clientY,
      width: 0,
      height: 0,
    });
  };

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuAnchor(evt.currentTarget.getBoundingClientRect());
  };

  const optionsVisible = hover || !!menuAnchor;
  const callSession = useCallSession(room);
  const callMembers = useCallMembers(callSession);
  const startCall = useCallStart(direct);
  const callEmbed = useCallEmbed();
  const callPref = useAtomValue(useCallPreferencesAtom());
  const autoDiscoveryInfo = useAutoDiscoveryInfo();

  const handleStartCall: MouseEventHandler<HTMLAnchorElement> = (evt) => {
    const powerLevelsEvent = getStateEvent(room, StateEvent.RoomPowerLevels);
    const powerLevels = getPowersLevelFromMatrixEvent(powerLevelsEvent);
    const creators = getRoomCreatorsForRoomId(mx, room.roomId);
    const permissions = getRoomPermissionsAPI(creators, powerLevels);

    const hasCallPermission = permissions.stateEvent(
      StateEvent.GroupCallMemberPrefix,
      mx.getSafeUserId()
    );

    // Do not join if missing permissions or no livekit support or no webRTC support
    if (!hasCallPermission || !livekitSupport(autoDiscoveryInfo) || !webRTCSupported()) {
      return;
    }

    // Do not join if already in call
    if (callEmbed) {
      return;
    }
    // Start call in second click
    if (selected) {
      evt.preventDefault();
      startCall(room, callPref);
    }
  };

  const roomIcon = (
    <RoomIcon
      style={{
        opacity: unread ? config.opacity.P500 : config.opacity.P300,
      }}
      filled={selected}
      size="100"
      joinRule={room.getJoinRule()}
      roomType={room.getType()}
    />
  );
  const roomAvatar =
    roomAvatarUrl || showAvatar ? (
      <RoomAvatar
        roomId={room.roomId}
        src={roomAvatarUrl}
        alt={roomName}
        renderFallback={() =>
          showAvatar ? (
            <Text as="span" size="H6">
              {nameInitials(roomName)}
            </Text>
          ) : (
            roomIcon
          )
        }
      />
    ) : (
      roomIcon
    );

  return (
    <NavItem
      variant="Background"
      radii="400"
      highlight={unread !== undefined}
      aria-selected={selected}
      data-hover={!!menuAnchor}
      onContextMenu={handleContextMenu}
      {...hoverProps}
      {...focusWithinProps}
    >
      <NavLink to={linkPath} onClick={room.isCallRoom() ? handleStartCall : undefined}>
        <NavItemContent>
          <Box as="span" grow="Yes" alignItems="Center" gap="200">
            <Avatar size="200" radii="400">
              {roomAvatar}
            </Avatar>
            <Box as="span" grow="Yes">
              <Text priority={unread ? '500' : '300'} as="span" size="Inherit" truncate>
                {roomName}
              </Text>
            </Box>
            {!optionsVisible && !unread && !selected && typingMember.length > 0 && (
              <Badge size="300" variant="Secondary" fill="Soft" radii="Pill" outlined>
                <TypingIndicator size="300" disableAnimation />
              </Badge>
            )}
            {!optionsVisible && unread && (
              <UnreadBadgeCenter>
                <UnreadBadge
                  highlight={unread.highlight > 0}
                  count={unread.total}
                  selected={selected}
                />
              </UnreadBadgeCenter>
            )}
            {!optionsVisible && notificationMode !== RoomNotificationMode.Unset && (
              <Icon
                size="50"
                src={getRoomNotificationModeIcon(notificationMode)}
                aria-label={notificationMode}
              />
            )}
            {hasBackgroundJobs && (
              // The clock also marks schedules, so it stays while the row is hovered, where its tooltip names it.
              <IconTooltip label={t('mindroomUi.backgroundJobs.inRoom')} position="Top">
                {(triggerRef) => (
                  <span ref={triggerRef} style={{ display: 'inline-flex' }}>
                    <Icon
                      size="50"
                      src={Icons.Clock}
                      aria-label={t('mindroomUi.backgroundJobs.inRoom')}
                    />
                  </span>
                )}
              </IconTooltip>
            )}
            {callMembers.length > 0 && (
              <Badge variant="Critical" fill="Solid" size="400">
                <Text as="span" size="L400" truncate>
                  {t('featureUi.roomNav.liveCount', { count: callMembers.length })}
                </Text>
              </Badge>
            )}
          </Box>
        </NavItemContent>
      </NavLink>
      {optionsVisible && (
        <NavItemOptions>
          {selected && (callEmbed?.roomId === room.roomId || room.isCallRoom()) && (
            <CallChatToggle />
          )}
          <PopOut
            id={`menu-${room.roomId}`}
            aria-expanded={!!menuAnchor}
            anchor={menuAnchor}
            offset={menuAnchor?.width === 0 ? 0 : undefined}
            alignOffset={menuAnchor?.width === 0 ? 0 : -5}
            position="Bottom"
            align={menuAnchor?.width === 0 ? 'Start' : 'End'}
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
                <RoomNavItemMenu
                  room={room}
                  requestClose={() => setMenuAnchor(undefined)}
                  notificationMode={notificationMode}
                />
              </FocusTrap>
            }
          >
            <IconTooltip label={t('featureUi.roomNav.roomNavItem.moreOptions')} position="Top">
              {(triggerRef) => (
                <IconButton
                  ref={triggerRef}
                  onClick={handleOpenMenu}
                  aria-pressed={!!menuAnchor}
                  aria-controls={`menu-${room.roomId}`}
                  aria-label={t('featureUi.roomNav.roomNavItem.moreOptions')}
                  variant="Background"
                  fill="None"
                  size="300"
                  radii="300"
                >
                  <Icon size="50" src={Icons.VerticalDots} />
                </IconButton>
              )}
            </IconTooltip>
          </PopOut>
        </NavItemOptions>
      )}
    </NavItem>
  );
}
