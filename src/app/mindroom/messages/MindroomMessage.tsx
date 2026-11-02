import { useTranslation } from 'react-i18next';
import { Avatar, Box, Icon, IconButton, Icons, Line, PopOut, RectCords, Text, as } from 'folds';
import React, { MouseEventHandler, ReactNode, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { useHover, useFocusWithin } from 'react-aria';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { Relations } from 'matrix-js-sdk/lib/models/relations';
import classNames from 'classnames';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import { IconTooltip } from '../tooltip/IconTooltip';
import {
  AvatarBase,
  BubbleLayout,
  CompactLayout,
  MessageBase,
  ModernLayout,
  Time,
  Username,
  UsernameBold,
} from '../../components/message';
import { MESSAGE_AVATAR_SIZE } from '../../components/message/layout/config';
import { canEditEvent, getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { MessageLayout, MessageSpacing } from '../../state/settings';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import * as css from '../../features/room/message/styles.css';
import { EmojiBoard } from '../../components/emoji-board';
import { MessageEditor } from '../../features/room/message/MessageEditor';
import { UserAvatar } from '../../components/user-avatar';
import { stopPropagation } from '../../utils/keyboard';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { MemberPowerTag } from '../../../types/matrix/room';
import { PowerIcon } from '../../components/power';
import colorMXID from '../../../util/colorMXID';
import { getPowerTagIconSrc } from '../../hooks/useMemberPowerTag';
import {
  getMindroomMessageCopyTextState,
  isCopyTextMessageContent,
  MindroomMessageExtensionControls,
  MindroomMessageExtensionShell,
  MindroomMessageHeaderExtensions,
  MindroomMessageMenuExtensions,
  useMindroomMessageExtensionState,
} from './messageExtensions';
import { MindroomModelBadge } from './MindroomModelBadge';
import { isConfirmedMatrixEventId } from '../threads/threadRouteUtils';

import { MessageAllReactionItem, MessageQuickReactions } from './MessageReactionActions';
import { MessageReadReceiptItem, MessageSourceCodeItem } from './MessageInspectionActions';
import {
  getMenuMessageContent,
  MessageCopyLinkItem,
  MessageCopyTextItem,
} from './MessageCopyActions';
import { MessageDeleteItem, MessagePinItem, MessageReportItem } from './MessageModerationActions';
import { MessageBugReportItem } from '../bug-reports/MessageBugReportItem';

export type { ReactionHandler } from './MessageReactionActions';
export { MessageQuickReactions, MessageAllReactionItem } from './MessageReactionActions';
export { MessageReadReceiptItem, MessageSourceCodeItem } from './MessageInspectionActions';
export { MessageCopyTextItem } from './MessageCopyActions';
export { MessagePinItem, MessageDeleteItem, MessageReportItem } from './MessageModerationActions';
export { Event } from './MindroomTimelineEvent';
export type { EventProps } from './MindroomTimelineEvent';
export type MessageProps = {
  room: Room;
  mEvent: MatrixEvent;
  resolvedMessageContent?: Record<string, unknown>;
  collapse: boolean;
  highlight: boolean;
  edit?: boolean;
  canDelete?: boolean;
  canSendReaction?: boolean;
  canPinEvent?: boolean;
  imagePackRooms?: Room[];
  relations?: Relations;
  messageLayout: MessageLayout;
  messageSpacing: MessageSpacing;
  onUserClick: MouseEventHandler<HTMLButtonElement>;
  onUsernameClick: MouseEventHandler<HTMLButtonElement>;
  onReplyClick: (
    ev: Parameters<MouseEventHandler<HTMLButtonElement>>[0],
    startThread?: boolean
  ) => void;
  onEditId?: (eventId?: string) => void;
  onReactionToggle: (
    targetEventId: string,
    key: string,
    shortcode?: string,
    relations?: Relations
  ) => void;
  reply?: ReactNode;
  reactions?: ReactNode;
  hideReadReceipts?: boolean;
  showDeveloperTools?: boolean;
  memberPowerTag?: MemberPowerTag;
  accessibleTagColors?: Map<string, string>;
  legacyUsernameColor?: boolean;
  hour24Clock: boolean;
  dateFormatString: string;
};
export const Message = as<'div', MessageProps>(
  (
    {
      className,
      room,
      mEvent,
      resolvedMessageContent,
      collapse,
      highlight,
      edit,
      canDelete,
      canSendReaction,
      canPinEvent,
      imagePackRooms,
      relations,
      messageLayout,
      messageSpacing,
      onUserClick,
      onUsernameClick,
      onReplyClick,
      onReactionToggle,
      onEditId,
      reply,
      reactions,
      hideReadReceipts,
      showDeveloperTools,
      memberPowerTag,
      accessibleTagColors,
      legacyUsernameColor,
      hour24Clock,
      dateFormatString,
      children,
      ...props
    },
    ref
  ) => {
    const { t } = useTranslation();
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const senderId = mEvent.getSender() ?? '';

    const [hover, setHover] = useState(false);
    const { hoverProps } = useHover({ onHoverChange: setHover });
    const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: setHover });
    const [menuAnchor, setMenuAnchor] = useState<RectCords>();
    const [emojiBoardAnchor, setEmojiBoardAnchor] = useState<RectCords>();
    const serverEventActionsAllowed = isConfirmedMatrixEventId(mEvent.getId());
    const menuMessageContent = resolvedMessageContent ?? getMenuMessageContent(room, mEvent);
    const showCopyText = isCopyTextMessageContent(menuMessageContent as Record<string, unknown>);
    const mindroomMessageExtensions = useMindroomMessageExtensionState(
      menuMessageContent,
      menuAnchor !== undefined,
      mEvent
    );
    const mindroomCopyText = getMindroomMessageCopyTextState(mindroomMessageExtensions);

    const senderDisplayName =
      getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
    const senderAvatarMxc = getMemberAvatarMxc(room, senderId);

    const tagColor = memberPowerTag?.color
      ? accessibleTagColors?.get(memberPowerTag.color)
      : undefined;
    const tagIconSrc = memberPowerTag?.icon
      ? getPowerTagIconSrc(mx, useAuthentication, memberPowerTag.icon)
      : undefined;

    const usernameColor = legacyUsernameColor ? colorMXID(senderId) : tagColor;

    const closeMenu = () => {
      setMenuAnchor(undefined);
    };

    const aiRunInfo = mindroomMessageExtensions.aiRunInfo;
    const avatarJSX = (!collapse || aiRunInfo) && messageLayout !== MessageLayout.Compact && (
      <AvatarBase
        className={classNames(
          messageLayout === MessageLayout.Bubble ? css.BubbleAvatarBase : undefined,
          aiRunInfo ? css.MessageAvatarWithModel : undefined
        )}
      >
        <Avatar
          className={css.MessageAvatar}
          as="button"
          size={MESSAGE_AVATAR_SIZE}
          data-user-id={senderId}
          onClick={onUserClick}
        >
          <UserAvatar
            userId={senderId}
            src={
              senderAvatarMxc
                ? mxcUrlToHttp(mx, senderAvatarMxc, useAuthentication, 48, 48, 'crop') ?? undefined
                : undefined
            }
            alt={senderDisplayName}
            renderFallback={() => <Icon size="200" src={Icons.User} filled />}
          />
        </Avatar>
        {aiRunInfo && <MindroomModelBadge info={aiRunInfo} />}
      </AvatarBase>
    );

    const msgContentJSX = (
      <Box
        direction="Column"
        alignSelf="Start"
        className={
          messageLayout === MessageLayout.Bubble ? undefined : css.MessageContentWithDisclosure
        }
        style={{ maxWidth: '100%' }}
      >
        {reply}
        {serverEventActionsAllowed && edit && onEditId ? (
          <MessageEditor
            style={{
              maxWidth: '100%',
              width: '100vw',
            }}
            roomId={room.roomId}
            room={room}
            mEvent={mEvent}
            imagePackRooms={imagePackRooms}
            onCancel={() => onEditId()}
          />
        ) : (
          children
        )}
        {reactions}
      </Box>
    );

    const handleContextMenu: MouseEventHandler<HTMLDivElement> = (evt) => {
      if (evt.altKey || !window.getSelection()?.isCollapsed || edit) return;
      const tag = (evt.target as any).tagName;
      if (typeof tag === 'string' && tag.toLowerCase() === 'a') return;
      evt.preventDefault();
      setMenuAnchor({
        x: evt.clientX,
        y: evt.clientY,
        width: 0,
        height: 0,
      });
    };

    const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
      const target = evt.currentTarget.parentElement?.parentElement ?? evt.currentTarget;
      setMenuAnchor(target.getBoundingClientRect());
    };

    const handleOpenEmojiBoard: MouseEventHandler<HTMLButtonElement> = (evt) => {
      const target = evt.currentTarget.parentElement?.parentElement ?? evt.currentTarget;
      setEmojiBoardAnchor(target.getBoundingClientRect());
    };
    const handleAddReactions: MouseEventHandler<HTMLButtonElement> = () => {
      const rect = menuAnchor;
      closeMenu();
      // open it with timeout because closeMenu
      // FocusTrap will return focus from emojiBoard

      setTimeout(() => {
        setEmojiBoardAnchor(rect);
      }, 100);
    };

    const isThreadedMessage = mEvent.threadRootId !== undefined;

    const renderMessageBase = (mindroomAiRunControls?: MindroomMessageExtensionControls) => {
      const handleOpenMindroomAiRun = () => {
        closeMenu();
        mindroomAiRunControls?.onOpen();
      };

      const headerJSX = !collapse && (
        <Box
          gap="300"
          direction={messageLayout === MessageLayout.Compact ? 'RowReverse' : 'Row'}
          justifyContent="SpaceBetween"
          alignItems="Baseline"
          grow="Yes"
        >
          <Box alignItems="Center" gap="200">
            <Username
              as="button"
              style={{ color: usernameColor }}
              data-user-id={senderId}
              onContextMenu={onUserClick}
              onClick={onUsernameClick}
            >
              <Text
                as="span"
                size={messageLayout === MessageLayout.Bubble ? 'T300' : 'T400'}
                truncate
              >
                <UsernameBold>{senderDisplayName}</UsernameBold>
              </Text>
            </Username>
            {tagIconSrc && <PowerIcon size="100" iconSrc={tagIconSrc} />}
          </Box>
          <Box shrink="No" gap="100">
            {messageLayout === MessageLayout.Modern && hover && (
              <>
                <Text as="span" size="T200" priority="300">
                  {senderId}
                </Text>
                <Text as="span" size="T200" priority="300">
                  |
                </Text>
              </>
            )}
            <MindroomMessageHeaderExtensions
              controls={mindroomAiRunControls}
              onOpenAiRun={handleOpenMindroomAiRun}
            />
            <Time
              ts={mEvent.getTs()}
              compact={messageLayout === MessageLayout.Compact}
              hour24Clock={hour24Clock}
              dateFormatString={dateFormatString}
            />
          </Box>
        </Box>
      );

      return (
        <MessageBase
          className={classNames(css.MessageBase, className, {
            [css.MessageBaseBubbleCollapsed]: messageLayout === MessageLayout.Bubble && collapse,
          })}
          tabIndex={0}
          space={messageSpacing}
          collapse={collapse}
          highlight={highlight}
          selected={!!menuAnchor || !!emojiBoardAnchor}
          {...props}
          {...hoverProps}
          {...focusWithinProps}
          ref={mindroomAiRunControls?.messageBaseRef ?? ref}
        >
          {mindroomAiRunControls?.dialog}
          {!edit && (hover || !!menuAnchor || !!emojiBoardAnchor) && (
            <div className={css.MessageOptionsBase}>
              <Menu className={css.MessageOptionsBar} variant="SurfaceVariant">
                <Box gap="100">
                  {canSendReaction && serverEventActionsAllowed && (
                    <PopOut
                      position="Bottom"
                      align={emojiBoardAnchor?.width === 0 ? 'Start' : 'End'}
                      offset={emojiBoardAnchor?.width === 0 ? 0 : undefined}
                      anchor={emojiBoardAnchor}
                      content={
                        <EmojiBoard
                          imagePackRooms={imagePackRooms ?? []}
                          returnFocusOnDeactivate={false}
                          allowTextCustomEmoji
                          onEmojiSelect={(key) => {
                            onReactionToggle(mEvent.getId()!, key);
                            setEmojiBoardAnchor(undefined);
                          }}
                          onCustomEmojiSelect={(mxc, shortcode) => {
                            onReactionToggle(mEvent.getId()!, mxc, shortcode);
                            setEmojiBoardAnchor(undefined);
                          }}
                          requestClose={() => {
                            setEmojiBoardAnchor(undefined);
                          }}
                        />
                      }
                    >
                      <IconTooltip
                        label={t('mindroomUi.messages.mindroomMessage.addReaction')}
                        position="Top"
                      >
                        {(triggerRef) => (
                          <IconButton
                            ref={triggerRef}
                            aria-label={t('mindroomUi.messages.mindroomMessage.addReaction')}
                            onClick={handleOpenEmojiBoard}
                            variant="SurfaceVariant"
                            size="300"
                            radii="300"
                            aria-pressed={!!emojiBoardAnchor}
                          >
                            <Icon src={Icons.SmilePlus} size="100" />
                          </IconButton>
                        )}
                      </IconTooltip>
                    </PopOut>
                  )}
                  {serverEventActionsAllowed && (
                    <IconTooltip
                      label={t('mindroomUi.messages.mindroomMessage.reply')}
                      position="Top"
                    >
                      {(triggerRef) => (
                        <IconButton
                          ref={triggerRef}
                          aria-label={t('mindroomUi.messages.mindroomMessage.reply')}
                          onClick={(ev: React.MouseEvent<HTMLButtonElement>) =>
                            onReplyClick(ev, isThreadedMessage)
                          }
                          data-event-id={mEvent.getId()}
                          variant="SurfaceVariant"
                          size="300"
                          radii="300"
                        >
                          <Icon src={Icons.ReplyArrow} size="100" />
                        </IconButton>
                      )}
                    </IconTooltip>
                  )}
                  {serverEventActionsAllowed && !isThreadedMessage && (
                    <IconTooltip
                      label={t('mindroomUi.messages.mindroomMessage.replyInThread')}
                      position="Top"
                    >
                      {(triggerRef) => (
                        <IconButton
                          ref={triggerRef}
                          aria-label={t('mindroomUi.messages.mindroomMessage.replyInThread')}
                          onClick={(ev: React.MouseEvent<HTMLButtonElement>) =>
                            onReplyClick(ev, true)
                          }
                          data-event-id={mEvent.getId()}
                          variant="SurfaceVariant"
                          size="300"
                          radii="300"
                        >
                          <Icon src={Icons.ThreadPlus} size="100" />
                        </IconButton>
                      )}
                    </IconTooltip>
                  )}
                  {serverEventActionsAllowed && canEditEvent(mx, mEvent) && onEditId && (
                    <IconTooltip
                      label={t('mindroomUi.messages.mindroomMessage.editMessage')}
                      position="Top"
                    >
                      {(triggerRef) => (
                        <IconButton
                          ref={triggerRef}
                          aria-label={t('mindroomUi.messages.mindroomMessage.editMessage')}
                          onClick={() => onEditId(mEvent.getId())}
                          variant="SurfaceVariant"
                          size="300"
                          radii="300"
                        >
                          <Icon src={Icons.Pencil} size="100" />
                        </IconButton>
                      )}
                    </IconTooltip>
                  )}
                  <PopOut
                    anchor={menuAnchor}
                    position="Bottom"
                    align={menuAnchor?.width === 0 ? 'Start' : 'End'}
                    offset={menuAnchor?.width === 0 ? 0 : undefined}
                    content={
                      <FocusTrap
                        focusTrapOptions={{
                          initialFocus: false,
                          onDeactivate: () => setMenuAnchor(undefined),
                          clickOutsideDeactivates: true,
                          isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                          isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                          escapeDeactivates: stopPropagation,
                        }}
                      >
                        <Menu>
                          {canSendReaction && serverEventActionsAllowed && (
                            <MessageQuickReactions
                              imagePackRooms={imagePackRooms}
                              onReaction={(key, shortcode) => {
                                onReactionToggle(mEvent.getId()!, key, shortcode);
                                closeMenu();
                              }}
                            />
                          )}
                          <Box direction="Column" gap="100" className={css.MessageMenuGroup}>
                            {canSendReaction && serverEventActionsAllowed && (
                              <MenuItem
                                size="300"
                                after={<Icon size="100" src={Icons.SmilePlus} />}
                                radii="300"
                                onClick={handleAddReactions}
                              >
                                <Text
                                  className={css.MessageMenuItemText}
                                  as="span"
                                  size="T300"
                                  truncate
                                >
                                  {t('mindroomUi.messages.mindroomMessage.addReaction')}
                                </Text>
                              </MenuItem>
                            )}
                            {relations && (
                              <MessageAllReactionItem
                                room={room}
                                relations={relations}
                                onClose={closeMenu}
                              />
                            )}
                            {serverEventActionsAllowed && (
                              <MenuItem
                                size="300"
                                after={<Icon size="100" src={Icons.ReplyArrow} />}
                                radii="300"
                                data-event-id={mEvent.getId()}
                                onClick={(evt: any) => {
                                  onReplyClick(evt, isThreadedMessage);
                                  closeMenu();
                                }}
                              >
                                <Text
                                  className={css.MessageMenuItemText}
                                  as="span"
                                  size="T300"
                                  truncate
                                >
                                  {t('mindroomUi.messages.mindroomMessage.reply')}
                                </Text>
                              </MenuItem>
                            )}
                            {serverEventActionsAllowed && !isThreadedMessage && (
                              <MenuItem
                                size="300"
                                after={<Icon src={Icons.ThreadPlus} size="100" />}
                                radii="300"
                                data-event-id={mEvent.getId()}
                                onClick={(evt: any) => {
                                  onReplyClick(evt, true);
                                  closeMenu();
                                }}
                              >
                                <Text
                                  className={css.MessageMenuItemText}
                                  as="span"
                                  size="T300"
                                  truncate
                                >
                                  {t('mindroomUi.messages.mindroomMessage.replyInThread')}
                                </Text>
                              </MenuItem>
                            )}
                            {serverEventActionsAllowed && canEditEvent(mx, mEvent) && onEditId && (
                              <MenuItem
                                size="300"
                                after={<Icon size="100" src={Icons.Pencil} />}
                                radii="300"
                                data-event-id={mEvent.getId()}
                                onClick={() => {
                                  onEditId(mEvent.getId());
                                  closeMenu();
                                }}
                              >
                                <Text
                                  className={css.MessageMenuItemText}
                                  as="span"
                                  size="T300"
                                  truncate
                                >
                                  {t('mindroomUi.messages.mindroomMessage.editMessage')}
                                </Text>
                              </MenuItem>
                            )}
                            {!hideReadReceipts && (
                              <MessageReadReceiptItem
                                room={room}
                                eventId={mEvent.getId() ?? ''}
                                onClose={closeMenu}
                              />
                            )}
                            <MindroomMessageMenuExtensions
                              controls={mindroomAiRunControls}
                              state={mindroomMessageExtensions}
                              onClose={closeMenu}
                              onOpenAiRun={handleOpenMindroomAiRun}
                            />
                            {showDeveloperTools && (
                              <MessageSourceCodeItem
                                room={room}
                                mEvent={mEvent}
                                onClose={closeMenu}
                              />
                            )}
                            {!mEvent.isRedacted() && (showCopyText || mindroomCopyText.visible) && (
                              <MessageCopyTextItem
                                content={menuMessageContent}
                                mEvent={mEvent}
                                onClose={closeMenu}
                                resolvedLongTextContent={mindroomCopyText.resolvedContent}
                                loading={mindroomCopyText.loading}
                              />
                            )}
                            {serverEventActionsAllowed && (
                              <MessageCopyLinkItem
                                room={room}
                                mEvent={mEvent}
                                onClose={closeMenu}
                              />
                            )}
                            {serverEventActionsAllowed && canPinEvent && (
                              <MessagePinItem room={room} mEvent={mEvent} onClose={closeMenu} />
                            )}
                            <MessageBugReportItem room={room} mEvent={mEvent} onClose={closeMenu} />
                          </Box>
                          {serverEventActionsAllowed &&
                            ((!mEvent.isRedacted() && canDelete) ||
                              mEvent.getSender() !== mx.getUserId()) && (
                              <>
                                <Line size="300" />
                                <Box direction="Column" gap="100" className={css.MessageMenuGroup}>
                                  {!mEvent.isRedacted() && canDelete && (
                                    <MessageDeleteItem
                                      room={room}
                                      mEvent={mEvent}
                                      onClose={closeMenu}
                                    />
                                  )}
                                  {mEvent.getSender() !== mx.getUserId() && (
                                    <MessageReportItem
                                      room={room}
                                      mEvent={mEvent}
                                      onClose={closeMenu}
                                    />
                                  )}
                                </Box>
                              </>
                            )}
                        </Menu>
                      </FocusTrap>
                    }
                  >
                    <IconTooltip
                      label={t('mindroomUi.messages.mindroomMessage.moreOptions')}
                      position="Top"
                    >
                      {(triggerRef) => (
                        <IconButton
                          ref={triggerRef}
                          aria-label={t('mindroomUi.messages.mindroomMessage.moreOptions')}
                          variant="SurfaceVariant"
                          size="300"
                          radii="300"
                          onClick={handleOpenMenu}
                          aria-pressed={!!menuAnchor}
                        >
                          <Icon src={Icons.VerticalDots} size="100" />
                        </IconButton>
                      )}
                    </IconTooltip>
                  </PopOut>
                </Box>
              </Menu>
            </div>
          )}
          {messageLayout === MessageLayout.Compact && (
            <CompactLayout before={headerJSX} onContextMenu={handleContextMenu}>
              {msgContentJSX}
            </CompactLayout>
          )}
          {messageLayout === MessageLayout.Bubble && (
            <BubbleLayout before={avatarJSX} header={headerJSX} onContextMenu={handleContextMenu}>
              {msgContentJSX}
            </BubbleLayout>
          )}
          {messageLayout !== MessageLayout.Compact && messageLayout !== MessageLayout.Bubble && (
            <ModernLayout before={avatarJSX} onContextMenu={handleContextMenu}>
              {headerJSX}
              {msgContentJSX}
            </ModernLayout>
          )}
        </MessageBase>
      );
    };

    return (
      <MindroomMessageExtensionShell state={mindroomMessageExtensions} forwardedRef={ref}>
        {renderMessageBase}
      </MindroomMessageExtensionShell>
    );
  }
);
