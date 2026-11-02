import { Trans, useTranslation } from 'react-i18next';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  color,
  config,
} from 'folds';
import { useAtomValue } from 'jotai';
import { RoomTopicEventContent } from 'matrix-js-sdk/lib/types';
import FocusTrap from 'focus-trap-react';
import { MatrixClient, MatrixError, Room } from 'matrix-js-sdk';
import {
  Page,
  PageContent,
  PageContentCenter,
  PageHeader,
  PageHero,
  PageHeroEmpty,
  PageHeroSection,
  PageScroll,
} from '../../../components/page';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { allInvitesAtom } from '../../../state/room-list/inviteList';
import { SequenceCard } from '../../../components/sequence-card';
import {
  bannedInRooms,
  getCommonRooms,
  getDirectRoomAvatarUrl,
  getMemberDisplayName,
  getRoomAvatarUrl,
  getStateEvent,
  isDirectInvite,
  isSpace,
} from '../../../utils/room';
import { nameInitials } from '../../../utils/common';
import { RoomAvatar } from '../../../components/room-avatar';
import { rateLimitedActions } from '../../../utils/matrix';
import { Time } from '../../../components/message';
import { useElementSizeObserver } from '../../../hooks/useElementSizeObserver';
import { onEnterOrSpace, stopPropagation } from '../../../utils/keyboard';
import { RoomTopicViewer } from '../../../components/room-topic-viewer';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { MindroomBackRouteHandler as BackRouteHandler } from '../../../mindroom/native/MindroomBackRouteHandler';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { StateEvent } from '../../../../types/matrix/room';
import { testBadWords } from '../../../plugins/bad-words';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { useIgnoredUsers } from '../../../hooks/useIgnoredUsers';
import { useReportRoomSupported } from '../../../hooks/useReportRoomSupported';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { acceptInvite, acceptInvites } from './acceptInvite';

const COMPACT_CARD_WIDTH = 548;
// Embedding, override and isolate controls, and paragraph separators (C0/C1
// controls such as NEL, and U+2029) that would end the isolates around the name.
const BIDI_CONTROLS = /[\p{Cc}\u2029\u202A-\u202E\u2066-\u2069]/gu;
// A longer name would push the real ID after it off-screen.
const MAX_SENDER_NAME_LENGTH = 64;

type InviteData = {
  room: Room;
  roomId: string;
  roomName: string;
  roomAvatar?: string;
  roomTopic?: string;
  roomAlias?: string;

  senderId: string;
  senderName: string;
  inviteTs?: number;
  reason?: string;

  isSpace: boolean;
  isDirect: boolean;
  isEncrypted: boolean;
};

export const makeInviteData = (
  mx: MatrixClient,
  room: Room,
  useAuthentication: boolean
): InviteData => {
  const userId = mx.getSafeUserId();
  const direct = isDirectInvite(room, userId);

  const roomAvatar = direct
    ? getDirectRoomAvatarUrl(mx, room, 96, useAuthentication)
    : getRoomAvatarUrl(mx, room, 96, useAuthentication);
  const roomName = room.name || room.getCanonicalAlias() || room.roomId;
  const roomTopic =
    getStateEvent(room, StateEvent.RoomTopic)?.getContent<RoomTopicEventContent>()?.topic ??
    undefined;

  const member = room.getMember(userId);
  const memberEvent = member?.events.member;

  const content = memberEvent?.getContent();
  const senderId = memberEvent?.getSender();

  const senderNameChars = Array.from(
    (senderId && getMemberDisplayName(room, senderId)?.replace(BIDI_CONTROLS, '')) || ''
  );
  const senderDisplayName =
    senderNameChars.slice(0, MAX_SENDER_NAME_LENGTH).join('') +
    (senderNameChars.length > MAX_SENDER_NAME_LENGTH ? '…' : '');
  const inviteTs = memberEvent?.getTs();
  const reason =
    content && 'reason' in content && typeof content.reason === 'string'
      ? content.reason
      : undefined;

  return {
    room,
    roomId: room.roomId,
    roomAvatar,
    roomName,
    roomTopic,
    roomAlias: room.getCanonicalAlias() ?? undefined,

    senderId: senderId ?? 'Unknown',
    // A display name can claim any name or ID, so the real ID always shows next to it.
    // The name is isolated (FSI...PDI) and the ID kept left-to-right (LRI...PDI), so neither
    // the name's direction nor an RTL locale can reorder the ID.
    senderName: senderDisplayName
      ? `\u2068${senderDisplayName}\u2069 (\u2066${senderId}\u2069)`
      : senderId ?? 'Unknown',
    inviteTs,
    reason,

    isSpace: isSpace(room),
    isDirect: direct,
    isEncrypted: !!getStateEvent(room, StateEvent.RoomEncryption),
  };
};

const hasBadWords = (invite: InviteData): boolean =>
  testBadWords(invite.roomName) ||
  testBadWords(invite.roomTopic ?? '') ||
  testBadWords(invite.senderName) ||
  testBadWords(invite.senderId) ||
  testBadWords(invite.reason || '');

type NavigateHandler = (roomId: string, space: boolean) => void;

type InviteCardProps = {
  invite: InviteData;
  compact?: boolean;
  hour24Clock: boolean;
  dateFormatString: string;
  onNavigate: NavigateHandler;
  hideAvatar: boolean;
  disabled?: boolean;
};
export function InviteCard({
  invite,
  compact,
  hour24Clock,
  dateFormatString,
  onNavigate,
  hideAvatar,
  disabled,
}: InviteCardProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();

  const [viewTopic, setViewTopic] = useState(false);
  const closeTopic = () => setViewTopic(false);
  const openTopic = () => setViewTopic(true);

  const [joinState, join] = useAsyncCallback<void, MatrixError, []>(
    useCallback(async () => {
      await acceptInvite(mx, invite.room);
      onNavigate(invite.roomId, invite.isSpace);
    }, [mx, invite, onNavigate])
  );
  const [leaveState, leave] = useAsyncCallback<Record<string, never>, MatrixError, []>(
    useCallback(() => mx.leave(invite.roomId), [mx, invite])
  );

  const joining =
    joinState.status === AsyncStatus.Loading || joinState.status === AsyncStatus.Success;
  const leaving =
    leaveState.status === AsyncStatus.Loading || leaveState.status === AsyncStatus.Success;

  return (
    <SequenceCard
      variant="SurfaceVariant"
      direction="Column"
      gap="300"
      style={{ padding: config.space.S400 }}
    >
      {(invite.isEncrypted || invite.isDirect || invite.isSpace) && (
        <Box gap="200" alignItems="Center">
          {invite.isEncrypted && (
            <Box shrink="No" alignItems="Center" justifyContent="Center">
              <Badge variant="Success" fill="Solid" size="400" radii="300">
                <Text size="L400">{t('sharedUi.invites.encrypted')}</Text>
              </Badge>
            </Box>
          )}
          {invite.isDirect && (
            <Box shrink="No" alignItems="Center" justifyContent="Center">
              <Badge variant="Primary" fill="Solid" size="400" radii="300">
                <Text size="L400">{t('sharedUi.invites.directMessage')}</Text>
              </Badge>
            </Box>
          )}
          {invite.isSpace && (
            <Box shrink="No" alignItems="Center" justifyContent="Center">
              <Badge variant="Secondary" fill="Soft" size="400" radii="300">
                <Text size="L400">{t('sharedUi.invites.space')}</Text>
              </Badge>
            </Box>
          )}
        </Box>
      )}
      <Box gap="300">
        <Avatar size="300">
          <RoomAvatar
            roomId={invite.roomId}
            src={hideAvatar ? undefined : invite.roomAvatar}
            alt={invite.roomName}
            renderFallback={() => (
              <Text as="span" size="H6">
                {nameInitials(hideAvatar && invite.roomAvatar ? undefined : invite.roomName)}
              </Text>
            )}
          />
        </Avatar>
        <Box direction={compact ? 'Column' : 'Row'} grow="Yes" gap="200">
          <Box grow="Yes" direction="Column" gap="200">
            <Box direction="Column">
              <Text size="T300" truncate>
                <b>{invite.roomName}</b>
              </Text>
              {invite.roomTopic && (
                <Text
                  size="T200"
                  onClick={openTopic}
                  onKeyDown={onEnterOrSpace(openTopic)}
                  tabIndex={0}
                  truncate
                >
                  {invite.roomTopic}
                </Text>
              )}
              <Overlay open={viewTopic} backdrop={<OverlayBackdrop />}>
                <OverlayCenter>
                  <FocusTrap
                    focusTrapOptions={{
                      initialFocus: false,
                      clickOutsideDeactivates: true,
                      onDeactivate: closeTopic,
                      escapeDeactivates: stopPropagation,
                    }}
                  >
                    <RoomTopicViewer
                      name={invite.roomName}
                      topic={invite.roomTopic ?? ''}
                      requestClose={closeTopic}
                    />
                  </FocusTrap>
                </OverlayCenter>
              </Overlay>
            </Box>
            {joinState.status === AsyncStatus.Error && (
              <Text size="T200" style={{ color: color.Critical.Main }}>
                {joinState.error.message}
              </Text>
            )}
            {leaveState.status === AsyncStatus.Error && (
              <Text size="T200" style={{ color: color.Critical.Main }}>
                {leaveState.error.message}
              </Text>
            )}
          </Box>
          <Box gap="200" shrink="No" alignItems="Center">
            <Button
              onClick={leave}
              size="300"
              variant="Secondary"
              radii="300"
              fill="Soft"
              disabled={disabled || joining || leaving}
              before={leaving ? <Spinner variant="Secondary" size="100" /> : undefined}
              outlined
            >
              <Text size="B300">{t('sharedUi.invites.decline')}</Text>
            </Button>
            <Button
              onClick={join}
              size="300"
              variant="Success"
              fill="Soft"
              radii="300"
              outlined
              disabled={disabled || joining || leaving}
              before={joining ? <Spinner variant="Success" fill="Soft" size="100" /> : undefined}
            >
              <Text size="B300">{t('sharedUi.invites.accept')}</Text>
            </Button>
          </Box>
        </Box>
      </Box>
      <Box direction="Column">
        <Box gap="200" alignItems="Baseline">
          <Box grow="Yes">
            <Text size="T200" priority="300">
              <Trans
                t={t}
                shouldUnescape
                tOptions={{ interpolation: { escapeValue: true } }}
                i18nKey="sharedUi.invites.from"
                values={{ sender: invite.senderName }}
                components={{ b: <b title={invite.senderId} /> }}
              />
            </Text>
          </Box>
          {typeof invite.inviteTs === 'number' && invite.inviteTs !== 0 && (
            <Box shrink="No">
              <Time
                size="T200"
                ts={invite.inviteTs}
                hour24Clock={hour24Clock}
                dateFormatString={dateFormatString}
                priority="300"
              />
            </Box>
          )}
        </Box>
        {invite.reason && (
          <Text size="T200" priority="300">
            {t('sharedUi.invites.reason', { reason: invite.reason })}
          </Text>
        )}
      </Box>
    </SequenceCard>
  );
}

enum InviteFilter {
  Known,
  Unknown,
  Spam,
}
type InviteFiltersProps = {
  filter: InviteFilter;
  onFilter: (filter: InviteFilter) => void;
  knownInvites: InviteData[];
  unknownInvites: InviteData[];
  spamInvites: InviteData[];
};
function InviteFilters({
  filter,
  onFilter,
  knownInvites,
  unknownInvites,
  spamInvites,
}: InviteFiltersProps) {
  const { t } = useTranslation();
  const isKnown = filter === InviteFilter.Known;
  const isUnknown = filter === InviteFilter.Unknown;
  const isSpam = filter === InviteFilter.Spam;

  return (
    <Box gap="200">
      <Chip
        variant={isKnown ? 'Success' : 'Surface'}
        aria-selected={isKnown}
        outlined={!isKnown}
        onClick={() => onFilter(InviteFilter.Known)}
        before={isKnown && <Icon size="100" src={Icons.Check} />}
        after={
          knownInvites.length > 0 && (
            <Badge variant={isKnown ? 'Success' : 'Secondary'} fill="Solid" radii="Pill">
              <Text size="L400">{knownInvites.length}</Text>
            </Badge>
          )
        }
      >
        <Text size="T200">{t('sharedUi.invites.primary')}</Text>
      </Chip>
      <Chip
        variant={isUnknown ? 'Warning' : 'Surface'}
        aria-selected={isUnknown}
        outlined={!isUnknown}
        onClick={() => onFilter(InviteFilter.Unknown)}
        before={isUnknown && <Icon size="100" src={Icons.Check} />}
        after={
          unknownInvites.length > 0 && (
            <Badge variant={isUnknown ? 'Warning' : 'Secondary'} fill="Solid" radii="Pill">
              <Text size="L400">{unknownInvites.length}</Text>
            </Badge>
          )
        }
      >
        <Text size="T200">{t('sharedUi.invites.public')}</Text>
      </Chip>
      <Chip
        variant={isSpam ? 'Critical' : 'Surface'}
        aria-selected={isSpam}
        outlined={!isSpam}
        onClick={() => onFilter(InviteFilter.Spam)}
        before={isSpam && <Icon size="100" src={Icons.Check} />}
        after={
          spamInvites.length > 0 && (
            <Badge variant={isSpam ? 'Critical' : 'Secondary'} fill="Solid" radii="Pill">
              <Text size="L400">{spamInvites.length}</Text>
            </Badge>
          )
        }
      >
        <Text size="T200">{t('sharedUi.invites.spam')}</Text>
      </Chip>
    </Box>
  );
}

type KnownInvitesProps = {
  invites: InviteData[];
  handleNavigate: NavigateHandler;
  compact: boolean;
  hour24Clock: boolean;
  dateFormatString: string;
};
function KnownInvites({
  invites,
  handleNavigate,
  compact,
  hour24Clock,
  dateFormatString,
}: KnownInvitesProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();

  const [acceptAllStatus, acceptAll] = useAsyncCallback(
    useCallback(
      () =>
        acceptInvites(
          mx,
          invites.map((invite) => invite.room)
        ),
      [mx, invites]
    )
  );

  const accepting = acceptAllStatus.status === AsyncStatus.Loading;

  return (
    <Box direction="Column" gap="200">
      <Box gap="200" justifyContent="SpaceBetween" alignItems="Center">
        <Text size="H4">{t('sharedUi.invites.primary')}</Text>
        <Box>
          {invites.length > 0 && (
            <Chip
              variant="SurfaceVariant"
              onClick={acceptAll}
              before={accepting && <Spinner size="50" variant="Secondary" fill="Soft" />}
              disabled={accepting}
              radii="Pill"
            >
              <Text size="T200">{t('sharedUi.invites.acceptAll')}</Text>
            </Chip>
          )}
        </Box>
      </Box>
      {invites.length > 0 ? (
        <Box direction="Column" gap="100">
          {invites.map((invite) => (
            <InviteCard
              key={invite.roomId}
              invite={invite}
              compact={compact}
              hour24Clock={hour24Clock}
              dateFormatString={dateFormatString}
              onNavigate={handleNavigate}
              hideAvatar={false}
              disabled={accepting}
            />
          ))}
        </Box>
      ) : (
        <PageHeroEmpty>
          <PageHeroSection>
            <PageHero
              icon={<Icon size="600" src={Icons.Mail} />}
              title={t('sharedUi.invites.noInvites')}
              subTitle={t('sharedUi.invites.whenSomeoneYouShareARoomWithSendsYouAnInviteIt')}
            />
          </PageHeroSection>
        </PageHeroEmpty>
      )}
    </Box>
  );
}

type UnknownInvitesProps = {
  invites: InviteData[];
  handleNavigate: NavigateHandler;
  compact: boolean;
  hour24Clock: boolean;
  dateFormatString: string;
};
function UnknownInvites({
  invites,
  handleNavigate,
  compact,
  hour24Clock,
  dateFormatString,
}: UnknownInvitesProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();

  const [declineAllStatus, declineAll] = useAsyncCallback(
    useCallback(async () => {
      const roomIds = invites.map((invite) => invite.roomId);

      await rateLimitedActions(roomIds, (roomId) => mx.leave(roomId));
    }, [mx, invites])
  );

  const declining = declineAllStatus.status === AsyncStatus.Loading;

  return (
    <Box direction="Column" gap="200">
      <Box gap="200" justifyContent="SpaceBetween" alignItems="Center">
        <Text size="H4">{t('sharedUi.invites.public')}</Text>
        <Box>
          {invites.length > 0 && (
            <Chip
              variant="SurfaceVariant"
              onClick={declineAll}
              before={declining && <Spinner size="50" variant="Secondary" fill="Soft" />}
              disabled={declining}
              radii="Pill"
            >
              <Text size="T200">{t('sharedUi.invites.declineAll')}</Text>
            </Chip>
          )}
        </Box>
      </Box>
      {invites.length > 0 ? (
        <Box direction="Column" gap="100">
          {invites.map((invite) => (
            <InviteCard
              key={invite.roomId}
              invite={invite}
              compact={compact}
              hour24Clock={hour24Clock}
              dateFormatString={dateFormatString}
              onNavigate={handleNavigate}
              hideAvatar
            />
          ))}
        </Box>
      ) : (
        <PageHeroEmpty>
          <PageHeroSection>
            <PageHero
              icon={<Icon size="600" src={Icons.Info} />}
              title={t('sharedUi.invites.noInvites')}
              subTitle={t('sharedUi.invites.invitesFromPeopleOutsideYourRoomsWillAppearHere')}
            />
          </PageHeroSection>
        </PageHeroEmpty>
      )}
    </Box>
  );
}

type SpamInvitesProps = {
  invites: InviteData[];
  handleNavigate: NavigateHandler;
  compact: boolean;
  hour24Clock: boolean;
  dateFormatString: string;
};
function SpamInvites({
  invites,
  handleNavigate,
  compact,
  hour24Clock,
  dateFormatString,
}: SpamInvitesProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const [showInvites, setShowInvites] = useState(false);

  const reportRoomSupported = useReportRoomSupported();

  const [declineAllStatus, declineAll] = useAsyncCallback(
    useCallback(async () => {
      const roomIds = invites.map((invite) => invite.roomId);

      await rateLimitedActions(roomIds, (roomId) => mx.leave(roomId));
    }, [mx, invites])
  );

  const [reportAllStatus, reportAll] = useAsyncCallback(
    useCallback(async () => {
      const roomIds = invites.map((invite) => invite.roomId);

      await rateLimitedActions(roomIds, (roomId) => mx.reportRoom(roomId, 'Spam Invite'));
    }, [mx, invites])
  );

  const ignoredUsers = useIgnoredUsers();
  const unignoredUsers = Array.from(new Set(invites.map((invite) => invite.senderId))).filter(
    (user) => !ignoredUsers.includes(user)
  );
  const [blockAllStatus, blockAll] = useAsyncCallback(
    useCallback(
      () => mx.setIgnoredUsers([...ignoredUsers, ...unignoredUsers]),
      [mx, ignoredUsers, unignoredUsers]
    )
  );

  const declining = declineAllStatus.status === AsyncStatus.Loading;
  const reporting = reportAllStatus.status === AsyncStatus.Loading;
  const blocking = blockAllStatus.status === AsyncStatus.Loading;
  const loading = blocking || reporting || declining;

  return (
    <Box direction="Column" gap="200">
      <Text size="H4">{t('sharedUi.invites.spam')}</Text>
      {invites.length > 0 ? (
        <Box direction="Column" gap="100">
          <SequenceCard
            variant="SurfaceVariant"
            direction="Column"
            gap="300"
            style={{ padding: `${config.space.S400} ${config.space.S400} 0` }}
          >
            <PageHeroSection>
              <PageHero
                icon={<Icon size="600" src={Icons.Warning} />}
                title={t('sharedUi.invites.spamInvites', { count: invites.length })}
                subTitle={t(
                  'sharedUi.invites.someOfTheFollowingInvitesMayContainHarmfulContentOrHaveBeen'
                )}
              >
                <Box direction="Row" gap="200" justifyContent="Center" wrap="Wrap">
                  <Button
                    size="300"
                    variant="Critical"
                    fill="Soft"
                    radii="300"
                    onClick={declineAll}
                    before={declining && <Spinner size="100" variant="Critical" fill="Soft" />}
                    disabled={loading}
                    outlined
                  >
                    <Text size="B300" truncate>
                      {t('sharedUi.invites.declineAll')}
                    </Text>
                  </Button>
                  {reportRoomSupported && reportAllStatus.status !== AsyncStatus.Success && (
                    <Button
                      size="300"
                      variant="Secondary"
                      fill="Soft"
                      radii="300"
                      onClick={reportAll}
                      before={reporting && <Spinner size="100" variant="Secondary" fill="Soft" />}
                      disabled={loading}
                      outlined
                    >
                      <Text size="B300" truncate>
                        {t('sharedUi.invites.reportAll')}
                      </Text>
                    </Button>
                  )}
                  {unignoredUsers.length > 0 && (
                    <Button
                      size="300"
                      variant="Secondary"
                      fill="Soft"
                      radii="300"
                      disabled={loading}
                      onClick={blockAll}
                      before={blocking && <Spinner size="100" variant="Secondary" fill="Soft" />}
                      outlined
                    >
                      <Text size="B300" truncate>
                        {t('sharedUi.invites.blockAll')}
                      </Text>
                    </Button>
                  )}
                </Box>

                <span data-spacing-node />

                <Button
                  size="300"
                  variant="Secondary"
                  fill="Soft"
                  radii="Pill"
                  before={
                    <Icon size="100" src={showInvites ? Icons.ChevronTop : Icons.ChevronBottom} />
                  }
                  onClick={() => setShowInvites(!showInvites)}
                  outlined
                >
                  <Text size="B300">
                    {showInvites ? t('sharedUi.invites.hideAll') : t('sharedUi.invites.viewAll')}
                  </Text>
                </Button>
              </PageHero>
            </PageHeroSection>
          </SequenceCard>
          {showInvites &&
            invites.map((invite) => (
              <InviteCard
                key={invite.roomId}
                invite={invite}
                compact={compact}
                hour24Clock={hour24Clock}
                dateFormatString={dateFormatString}
                onNavigate={handleNavigate}
                hideAvatar
              />
            ))}
        </Box>
      ) : (
        <PageHeroEmpty>
          <PageHeroSection>
            <PageHero
              icon={<Icon size="600" src={Icons.Warning} />}
              title={t('sharedUi.invites.noSpamInvites')}
              subTitle={t('sharedUi.invites.invitesDetectedAsSpamAppearHere')}
            />
          </PageHeroSection>
        </PageHeroEmpty>
      )}
    </Box>
  );
}

export function Invites() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const { navigateRoom, navigateSpace } = useRoomNavigate();
  const allRooms = useAtomValue(allRoomsAtom);
  const allInviteIds = useAtomValue(allInvitesAtom);

  const [filter, setFilter] = useState(InviteFilter.Known);

  const invitesData = allInviteIds
    .map((inviteId) => mx.getRoom(inviteId))
    .filter((inviteRoom): inviteRoom is Room => !!inviteRoom)
    .map((inviteRoom) => makeInviteData(mx, inviteRoom, useAuthentication));

  const [knownInvites, unknownInvites, spamInvites] = useMemo(() => {
    const known: InviteData[] = [];
    const unknown: InviteData[] = [];
    const spam: InviteData[] = [];
    invitesData.forEach((invite) => {
      if (hasBadWords(invite) || bannedInRooms(mx, allRooms, invite.senderId)) {
        spam.push(invite);
        return;
      }

      if (getCommonRooms(mx, allRooms, invite.senderId).length === 0) {
        unknown.push(invite);
        return;
      }

      known.push(invite);
    });

    return [known, unknown, spam];
  }, [mx, allRooms, invitesData]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(document.body.clientWidth <= COMPACT_CARD_WIDTH);
  useElementSizeObserver(
    useCallback(() => containerRef.current, []),
    useCallback((width) => setCompact(width <= COMPACT_CARD_WIDTH), [])
  );
  const screenSize = useScreenSizeContext();

  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');

  const handleNavigate = (roomId: string, space: boolean) => {
    if (space) {
      navigateSpace(roomId);
      return;
    }
    navigateRoom(roomId);
  };

  return (
    <Page>
      <PageScroll
        header={
          <PageHeader flat balance>
            <Box grow="Yes" gap="200">
              <Box grow="Yes" basis="No">
                {screenSize === ScreenSize.Mobile && (
                  <BackRouteHandler>
                    {(onBack) => (
                      <IconButton onClick={onBack}>
                        <Icon data-directional src={Icons.ArrowLeft} />
                      </IconButton>
                    )}
                  </BackRouteHandler>
                )}
              </Box>
              <Box alignItems="Center" gap="200">
                {screenSize !== ScreenSize.Mobile && <Icon size="400" src={Icons.Mail} />}
                <Text size="H3" truncate>
                  {t('sharedUi.invites.invites')}
                </Text>
              </Box>
              <Box grow="Yes" basis="No" />
            </Box>
          </PageHeader>
        }
      >
        <PageContent>
          <PageContentCenter>
            <Box ref={containerRef} direction="Column" gap="600">
              <Box direction="Column" gap="100">
                <span data-spacing-node />
                <Text size="L400">{t('sharedUi.invites.filter')}</Text>
                <InviteFilters
                  filter={filter}
                  onFilter={setFilter}
                  knownInvites={knownInvites}
                  unknownInvites={unknownInvites}
                  spamInvites={spamInvites}
                />
              </Box>
              {filter === InviteFilter.Known && (
                <KnownInvites
                  invites={knownInvites}
                  compact={compact}
                  hour24Clock={hour24Clock}
                  dateFormatString={dateFormatString}
                  handleNavigate={handleNavigate}
                />
              )}

              {filter === InviteFilter.Unknown && (
                <UnknownInvites
                  invites={unknownInvites}
                  compact={compact}
                  hour24Clock={hour24Clock}
                  dateFormatString={dateFormatString}
                  handleNavigate={handleNavigate}
                />
              )}

              {filter === InviteFilter.Spam && (
                <SpamInvites
                  invites={spamInvites}
                  compact={compact}
                  hour24Clock={hour24Clock}
                  dateFormatString={dateFormatString}
                  handleNavigate={handleNavigate}
                />
              )}
            </Box>
          </PageContentCenter>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
