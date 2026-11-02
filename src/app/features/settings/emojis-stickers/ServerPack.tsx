import React, { useMemo } from 'react';
import { Avatar, AvatarFallback, AvatarImage, Box, Button, Icon, Icons, Text } from 'folds';
import { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { StateEvent } from '../../../../types/matrix/room';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { useRoomImagePacks } from '../../../hooks/useImagePacks';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { usePowerLevels } from '../../../hooks/usePowerLevels';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { useServerEmojiRoom } from '../../../mindroom/server-emoji/useServerEmojiRoom';
import { ImagePack, ImageUsage } from '../../../plugins/custom-emoji';
import { useOpenRoomSettings } from '../../../state/hooks/roomSettings';
import { RoomSettingsPage } from '../../../state/roomSettings';
import { randomStr } from '../../../utils/common';
import { getMxIdServer, mxcUrlToHttp } from '../../../utils/matrix';
import { SequenceCardStyle } from '../styles.css';

type ServerPackProps = {
  onViewPack: (imagePack: ImagePack) => void;
};

function ServerPackSection({ room, onViewPack }: ServerPackProps & { room: Room }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const openRoomSettings = useOpenRoomSettings();

  const powerLevels = usePowerLevels(room);
  const creators = useRoomCreators(room);
  const permissions = useRoomPermissions(creators, powerLevels);
  const canChangePowers = permissions.stateEvent(StateEvent.RoomPowerLevels, mx.getSafeUserId());

  // With no live pack the section still offers the first one (state key ''); the pack view
  // opens it empty, as `RoomImagePack` does for an address without a pack.
  const firstPack = useMemo(
    () => new ImagePack(randomStr(4), {}, { roomId: room.roomId, stateKey: '' }),
    [room.roomId]
  );
  const roomPacks = useRoomImagePacks(room).filter((pack) => !pack.deleted);
  const packs = roomPacks.length > 0 ? roomPacks : [firstPack];

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('featureUi.settings.emojisStickers.serverPack.title')}</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          description={t('featureUi.settings.emojisStickers.serverPack.description', {
            server: getMxIdServer(mx.getSafeUserId()),
          })}
          after={
            canChangePowers && (
              <Button
                variant="Secondary"
                fill="Soft"
                size="300"
                radii="300"
                outlined
                onClick={() =>
                  openRoomSettings(room.roomId, undefined, RoomSettingsPage.PermissionsPage)
                }
              >
                <Text size="B300">
                  {t('featureUi.settings.emojisStickers.serverPack.permissions')}
                </Text>
              </Button>
            )
          }
        />
      </SequenceCard>
      {packs.map((pack) => {
        const avatarMxc = pack.getAvatarUrl(ImageUsage.Emoticon);
        const avatarUrl = avatarMxc ? mxcUrlToHttp(mx, avatarMxc, useAuthentication) : undefined;
        return (
          <SequenceCard
            key={pack.id}
            className={SequenceCardStyle}
            variant="SurfaceVariant"
            direction="Column"
            gap="400"
          >
            <SettingTile
              title={pack.meta.name ?? t('featureUi.settings.emojisStickers.globalPacks.unknown')}
              description={pack.meta.attribution}
              before={
                <Avatar size="300" radii="300">
                  {avatarUrl ? (
                    <AvatarImage style={{ objectFit: 'contain' }} src={avatarUrl} />
                  ) : (
                    <AvatarFallback>
                      <Icon size="400" src={Icons.Sticker} filled />
                    </AvatarFallback>
                  )}
                </Avatar>
              }
              after={
                <Button
                  variant="Secondary"
                  fill="Soft"
                  size="300"
                  radii="300"
                  outlined
                  onClick={() => onViewPack(pack)}
                >
                  <Text size="B300">{t('featureUi.settings.emojisStickers.globalPacks.view')}</Text>
                </Button>
              }
            />
          </SequenceCard>
        );
      })}
    </Box>
  );
}

// The server's shared emoji, once the user has joined its room.
export function ServerPack({ onViewPack }: ServerPackProps) {
  const room = useServerEmojiRoom();
  if (!room) return null;
  // Keyed by room: its pack hooks read state once, so a new server emoji room needs a new section.
  return <ServerPackSection key={room.roomId} room={room} onViewPack={onViewPack} />;
}
