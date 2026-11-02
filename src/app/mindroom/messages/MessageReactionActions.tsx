import { useTranslation } from 'react-i18next';
import {
  Box,
  Icon,
  IconButton,
  Icons,
  Line,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  as,
  config,
  toRem,
} from 'folds';
import React, { useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { Room } from 'matrix-js-sdk';
import { Relations } from 'matrix-js-sdk/lib/models/relations';
import { Modal, MenuItem } from '../../components/glass/GlassPrimitives';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRecentEmoji } from '../../hooks/useRecentEmoji';
import { useRelevantImagePacks } from '../../hooks/useImagePacks';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { ImageUsage } from '../../plugins/custom-emoji';
import { mxcUrlToHttp } from '../../utils/matrix';
import * as css from '../../features/room/message/styles.css';
import { ReactionViewer } from '../../features/room/reaction-viewer';
import { stopPropagation } from '../../utils/keyboard';
import { IconTooltip } from '../tooltip/IconTooltip';

export type ReactionHandler = (keyOrMxc: string, shortcode: string) => void;

type MessageQuickReactionsProps = {
  onReaction: ReactionHandler;
  imagePackRooms?: Room[];
};
export const MessageQuickReactions = as<'div', MessageQuickReactionsProps>(
  ({ onReaction, imagePackRooms, ...props }, ref) => {
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const imagePacks = useRelevantImagePacks(ImageUsage.Emoticon, imagePackRooms ?? []);
    const recentEmojis = useRecentEmoji(mx, 4, imagePacks);

    if (recentEmojis.length === 0) return <span />;
    return (
      <>
        <Box
          style={{ padding: config.space.S200 }}
          alignItems="Center"
          justifyContent="Center"
          gap="200"
          {...props}
          ref={ref}
        >
          {recentEmojis.map((emoji) => {
            const key = 'url' in emoji ? emoji.url : emoji.unicode;
            return (
              <IconTooltip key={key} label={emoji.shortcode} position="Top">
                {(triggerRef) => (
                  <IconButton
                    ref={triggerRef}
                    className={css.MessageQuickReaction}
                    size="300"
                    variant="SurfaceVariant"
                    radii="Pill"
                    aria-label={emoji.shortcode}
                    onClick={() => onReaction(key, emoji.shortcode)}
                  >
                    {'url' in emoji ? (
                      <img
                        src={mxcUrlToHttp(mx, emoji.url, useAuthentication) ?? ''}
                        alt={emoji.shortcode}
                        style={{ width: toRem(20), height: toRem(20), objectFit: 'contain' }}
                      />
                    ) : (
                      <Text size="T500">{emoji.unicode}</Text>
                    )}
                  </IconButton>
                )}
              </IconTooltip>
            );
          })}
        </Box>
        <Line size="300" />
      </>
    );
  }
);

export const MessageAllReactionItem = as<
  'button',
  {
    room: Room;
    relations: Relations;
    onClose?: () => void;
  }
>(({ room, relations, onClose, ...props }, ref) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <>
      <Overlay
        onContextMenu={(evt: any) => {
          evt.stopPropagation();
        }}
        open={open}
        backdrop={<OverlayBackdrop />}
      >
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: () => handleClose(),
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Modal variant="Surface" size="300">
              <ReactionViewer
                room={room}
                relations={relations}
                requestClose={() => setOpen(false)}
              />
            </Modal>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
      <MenuItem
        size="300"
        after={<Icon size="100" src={Icons.Smile} />}
        radii="300"
        onClick={() => setOpen(true)}
        {...props}
        ref={ref}
        aria-pressed={open}
      >
        <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
          {t('mindroomUi.messages.messageReactionActions.viewReactions')}
        </Text>
      </MenuItem>
    </>
  );
});
