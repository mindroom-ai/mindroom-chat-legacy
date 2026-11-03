import React from 'react';
import { Box, Icon, Icons, Text, as } from 'folds';
import { Room } from 'matrix-js-sdk';
import classNames from 'classnames';
import { useSetAtom } from 'jotai';
import { Trans, useTranslation } from 'react-i18next';
import { roomIdToTypingMembersAtom } from '../../state/typingMembers';
import { TypingIndicator } from '../../components/typing-indicator';
import { getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart } from '../../utils/matrix';
import * as css from './RoomViewTyping.css';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomTypingMember } from '../../hooks/useRoomTypingMembers';
import { IconButton } from '../../components/glass/GlassPrimitives';
import { IconTooltip } from '../../mindroom/tooltip/IconTooltip';

export type RoomViewTypingProps = {
  room: Room;
};
export const RoomViewTyping = as<'div', RoomViewTypingProps>(
  ({ className, room, ...props }, ref) => {
    const { t } = useTranslation();
    const setTypingMembers = useSetAtom(roomIdToTypingMembersAtom);
    const mx = useMatrixClient();
    const typingMembers = useRoomTypingMember(room.roomId);

    const typingNames = typingMembers
      .filter((receipt) => receipt.userId !== mx.getUserId())
      .map(
        (receipt) => getMemberDisplayName(room, receipt.userId) ?? getMxIdLocalPart(receipt.userId)
      )
      .reverse();

    if (typingNames.length === 0) {
      return null;
    }

    const handleDropAll = () => {
      // some homeserver does not timeout typing status
      // we have given option so user can drop their typing status
      typingMembers.forEach((receipt) =>
        setTypingMembers({
          type: 'DELETE',
          roomId: room.roomId,
          userId: receipt.userId,
        })
      );
    };

    return (
      <Box
        className={classNames(css.RoomViewTyping, className)}
        alignItems="Center"
        gap="300"
        {...props}
        ref={ref}
      >
        <TypingIndicator size="300" />
        <Text className={css.TypingText} size="T200" truncate>
          {typingNames.length === 1 && (
            <Trans
              i18nKey="featureUi.room.typing.one"
              t={t}
              shouldUnescape
              tOptions={{ interpolation: { escapeValue: true } }}
              values={{ name: typingNames[0] }}
              components={{ name: <b /> }}
            />
          )}
          {typingNames.length === 2 && (
            <Trans
              i18nKey="featureUi.room.typing.two"
              t={t}
              shouldUnescape
              tOptions={{ interpolation: { escapeValue: true } }}
              values={{ first: typingNames[0], second: typingNames[1] }}
              components={{ first: <b />, second: <b /> }}
            />
          )}
          {typingNames.length === 3 && (
            <Trans
              i18nKey="featureUi.room.typing.three"
              t={t}
              shouldUnescape
              tOptions={{ interpolation: { escapeValue: true } }}
              values={{ first: typingNames[0], second: typingNames[1], third: typingNames[2] }}
              components={{ first: <b />, second: <b />, third: <b /> }}
            />
          )}
          {typingNames.length > 3 && (
            <Trans
              i18nKey={
                typingNames.length === 4
                  ? 'featureUi.room.typing.four'
                  : 'featureUi.room.typing.many'
              }
              t={t}
              shouldUnescape
              tOptions={{ interpolation: { escapeValue: true } }}
              values={{
                first: typingNames[0],
                second: typingNames[1],
                third: typingNames[2],
                count: typingNames.length - 3,
              }}
              components={{ first: <b />, second: <b />, third: <b />, others: <b /> }}
            />
          )}
        </Text>
        <IconTooltip label={t('featureUi.room.typing.dropTypingStatus')} position="Top">
          {(triggerRef) => (
            <IconButton
              ref={triggerRef}
              aria-label={t('featureUi.room.typing.dropTypingStatus')}
              size="300"
              radii="Pill"
              onClick={handleDropAll}
            >
              <Icon size="50" src={Icons.Cross} />
            </IconButton>
          )}
        </IconTooltip>
      </Box>
    );
  }
);
