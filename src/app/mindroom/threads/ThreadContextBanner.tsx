import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import classNames from 'classnames';
import { Box, Icon, IconButton, Icons, Text, type RectCords } from 'folds';
import { useTranslation } from 'react-i18next';
import { IconCalendarEvent } from '@tabler/icons-react';
import { Room } from 'matrix-js-sdk';
import { type Thread, ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import * as threadIndicatorCss from './ThreadIndicator.css';
import { useThreadHeaderInfo } from './useThreadHeaderInfo';
import { buildThreadHeaderViewModelFromRecord } from './threadHeaderViewModel';
import { buildThreadRecord } from './threadRecord';
import { useThreadRootEvent } from './useThreadRootEvent';
import { useThreadTags } from './useThreadTags';
import { useMutateThreadTags } from './useMutateThreadTags';
import { ThreadTagPill } from './ThreadTagPill';
import { ThreadTagPicker } from './ThreadTagPicker';
import { isConfirmedMatrixEventId } from './threadRouteUtils';
import { getThreadResolverDisplayName } from './threadResolutionAttribution';
import * as css from './ThreadContextBanner.css';
import { IconTooltip } from '../tooltip/IconTooltip';
import { ThreadApprovalPermissions } from '../messages/ThreadApprovalControls';
import { AutoApproveChip } from '../auto-approve/AutoApproveChip';
import { useThreadPinning } from './useThreadPinning';
import { useLiquidGlass } from '../../components/glass/liquid/useLiquidGlass';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';

const ThreadActionsMenu = lazy(() =>
  import('./ThreadActionsMenu').then((module) => ({ default: module.ThreadActionsMenu }))
);

type BannerMenuState = {
  roomId: string;
  threadId: string;
  rootId: string;
  anchor: RectCords;
  trigger: HTMLElement;
};

export interface ThreadContextBannerProps {
  room: Room;
  threadId: string;
  summaryInfo?: MindroomThreadSummaryInfo;
  onExitThread: () => void;
}

const DESKTOP_MAX_PILLS = 3;
const MOBILE_MAX_PILLS = 2;

function TagPills({
  tags,
  maxPills,
  allTags,
  canEdit,
  onRemove,
}: {
  tags: string[];
  maxPills: number;
  allTags: string[];
  canEdit: boolean;
  onRemove: (name: string) => void;
}) {
  const visible = tags.slice(0, maxPills);
  const overflowCount = tags.length - visible.length;

  return (
    <>
      {visible.map((tag) => (
        <ThreadTagPill key={tag} name={tag} onRemove={canEdit ? () => onRemove(tag) : undefined} />
      ))}
      {overflowCount > 0 && (
        <span className={css.OverflowChip} title={allTags.slice(maxPills).join(', ')}>
          +{overflowCount}
        </span>
      )}
    </>
  );
}

export function ThreadContextBanner({
  room,
  threadId,
  summaryInfo,
  onExitThread,
}: ThreadContextBannerProps) {
  const { t, i18n } = useTranslation();
  const bannerRef = useRef<HTMLDivElement>(null);
  const glassRef = useLiquidGlass<HTMLDivElement>(bannerRef);
  const [collapsed, setCollapsed] = useSetting(settingsAtom, 'threadBannerCollapsed');
  const rootEventId = useThreadRootEvent(room, threadId);
  const { scheduledTaskCount, nextScheduledTs, cronDescription, scheduledDisplayText } =
    useThreadHeaderInfo(room, threadId);
  const { tags, isResolved, canEdit, availableTags } = useThreadTags(room, rootEventId);
  const { addTag, removeTag, setResolved, updating, error } = useMutateThreadTags(room);
  const threadRootId = rootEventId ?? threadId;
  const canOpenMenu = isConfirmedMatrixEventId(threadRootId);
  const [menu, setMenu] = useState<BannerMenuState>();
  const menuRef = useRef<BannerMenuState>();
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const openMenu = (anchor: RectCords, trigger: HTMLElement) => {
    if (!canOpenMenu) return;
    const nextMenu = { roomId: room.roomId, threadId, rootId: threadRootId, anchor, trigger };
    menuRef.current = nextMenu;
    setMenu(nextMenu);
  };
  const closeMenu = (selectedMenu: BannerMenuState) => {
    if (menuRef.current !== selectedMenu) return;
    menuRef.current = undefined;
    setMenu(undefined);
    const trigger = selectedMenu.trigger.isConnected ? selectedMenu.trigger : moreButtonRef.current;
    // Focusing inside the sticky banner would otherwise scroll the thread to
    // the banner's place in the flow, its first message.
    trigger?.focus({ preventScroll: true });
  };
  // The button that toggled the banner unmounts with it, so focus moves to the
  // control that toggles it back: Show details, or More, which offers Hide
  // (or the banner while More waits for the thread root to be confirmed).
  const showDetailsRef = useRef<HTMLButtonElement | null>(null);
  const focusAfterToggle = useRef(false);
  const toggleCollapsed = (next: boolean) => {
    focusAfterToggle.current = true;
    setCollapsed(next);
  };
  useLayoutEffect(() => {
    if (!focusAfterToggle.current) return;
    focusAfterToggle.current = false;
    const target = (collapsed ? showDetailsRef : moreButtonRef).current;
    (target && !target.disabled ? target : bannerRef.current)?.focus({ preventScroll: true });
  }, [collapsed]);
  useLayoutEffect(() => {
    menuRef.current = undefined;
    setMenu(undefined);
    return () => {
      menuRef.current = undefined;
    };
  }, [room.roomId, threadId, threadRootId]);
  const activeMenu =
    menu?.roomId === room.roomId && menu.threadId === threadId && menu.rootId === threadRootId
      ? menu
      : undefined;
  const [, refreshThread] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    // After a redaction the SDK keeps an unredacted copy of the latest reply
    // until it re-fetches the root; re-render once it does.
    const handleThreadUpdate = (thread: Thread) => {
      if (thread.id === threadRootId) refreshThread();
    };
    room.on(ThreadEvent.Update, handleThreadUpdate);
    return () => {
      room.removeListener(ThreadEvent.Update, handleThreadUpdate);
    };
  }, [room, threadRootId]);
  const pinning = useThreadPinning(room);
  const isPinned = pinning.pinnedEventIds.includes(threadRootId);
  const mutableThreadRootId = isConfirmedMatrixEventId(rootEventId) ? rootEventId : undefined;
  const threadRootEvent =
    room.getThread(threadRootId)?.rootEvent ?? room.findEventById(threadRootId);
  const headerRecord = buildThreadRecord({
    room,
    threadRootId,
    threadRootEvent,
    summaryInfo,
    threadResolution: {
      isResolved,
      tags,
    },
    scheduledStatus: {
      scheduledTaskCount,
      nextScheduledTs,
      cronDescription,
    },
  });
  const pickerDisabled = !mutableThreadRootId || updating;
  const headerModel = buildThreadHeaderViewModelFromRecord({
    record: headerRecord,
    scheduledDisplayText,
    canEdit: canEdit && !!mutableThreadRootId,
    availableTags,
    pickerDisabled,
    t,
  });
  // A summary that changes while the thread is open tints once; opening a thread does not.
  // The collapsed pill shows no title, so it drops a pending tint rather than replay it later.
  const { summaryText } = headerModel;
  const [shownSummary, setShownSummary] = useState({ threadId, summaryText, changed: false });
  if (shownSummary.threadId !== threadId || shownSummary.summaryText !== summaryText) {
    setShownSummary({
      threadId,
      summaryText,
      changed:
        !collapsed &&
        shownSummary.threadId === threadId &&
        !!shownSummary.summaryText &&
        !!summaryText,
    });
  } else if (collapsed && shownSummary.changed) {
    setShownSummary({ ...shownSummary, changed: false });
  }
  const summaryChanged = shownSummary.changed;
  const resolvedByDisplayName = getThreadResolverDisplayName(
    room,
    headerRecord.status.resolvedByUserId
  );
  const resolvedByLabel =
    headerModel.isResolved && resolvedByDisplayName
      ? t('thread.resolvedBy', { name: resolvedByDisplayName })
      : undefined;

  useEffect(() => {
    if (error) {
      console.error('[ThreadContextBanner] Tag mutation failed:', error);
    }
  }, [error]);

  const handleAddTag = useCallback(
    (name: string) => {
      if (!mutableThreadRootId) return;
      addTag(mutableThreadRootId, name);
    },
    [mutableThreadRootId, addTag]
  );

  const handleRemoveTag = useCallback(
    (name: string) => {
      if (!mutableThreadRootId) return;
      removeTag(mutableThreadRootId, name);
    },
    [mutableThreadRootId, removeTag]
  );

  const handleToggleResolve = useCallback(() => {
    if (!mutableThreadRootId || isPinned) return;
    setResolved(mutableThreadRootId, !headerModel.isResolved);
  }, [mutableThreadRootId, headerModel.isResolved, setResolved, isPinned]);

  const hasTags = headerModel.displayTags.length > 0;
  const hasScheduled = !!(headerModel.bannerScheduledText && headerModel.scheduledLabel);
  const hasSubtitle = !!headerModel.summaryText || hasScheduled;
  // A pinned thread shows the pin instead of the resolve chip and its byline.
  const showResolver = !isPinned && !!resolvedByDisplayName;
  // The Resolved button is described by the byline, also on short screens,
  // which hide it.
  const resolverBylineId = useId();

  const backButton = (
    // At the banner's start, so its tooltip opens toward the banner, not past it.
    // folds aligns to physical edges, and right-to-left puts the button on the right.
    <IconTooltip label={t('thread.backToRoom')} align={i18n.dir() === 'rtl' ? 'End' : 'Start'}>
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          size="300"
          radii="300"
          aria-label={t('thread.backToRoom')}
          onClick={onExitThread}
        >
          <Icon data-directional src={Icons.ArrowLeft} />
        </IconButton>
      )}
    </IconTooltip>
  );

  return (
    <>
      <div
        ref={glassRef}
        className={classNames(
          headerModel.isResolved ? css.BannerResolved : css.Banner,
          collapsed && css.Collapsed
        )}
        data-thread-context-banner="true"
        tabIndex={-1}
        onContextMenu={(event) => {
          if (!canOpenMenu || !event.currentTarget.contains(event.target as Node)) return;
          event.preventDefault();
          event.stopPropagation();
          openMenu(
            { x: event.clientX, y: event.clientY, width: 0, height: 0 },
            event.currentTarget
          );
        }}
        onKeyDown={(event) => {
          if (!canOpenMenu || !event.currentTarget.contains(event.target as Node)) return;
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
          event.preventDefault();
          event.stopPropagation();
          openMenu(event.currentTarget.getBoundingClientRect(), event.target as HTMLElement);
        }}
      >
        {collapsed ? (
          // Collapsed to back and Show details; the tint still says resolved, and
          // auto-approval and an active permissions grant stay in view.
          <Box alignItems="Center" gap="100">
            {backButton}
            <AutoApproveChip room={room} threadId={threadId} />
            <ThreadApprovalPermissions />
            <IconTooltip label={t('thread.showDetails')}>
              {(triggerRef) => (
                <IconButton
                  ref={(node: HTMLButtonElement | null) => {
                    triggerRef(node);
                    showDetailsRef.current = node;
                  }}
                  size="300"
                  radii="300"
                  aria-label={t('thread.showDetails')}
                  onClick={() => toggleCollapsed(false)}
                >
                  <Icon src={Icons.ChevronBottom} size="100" />
                </IconButton>
              )}
            </IconTooltip>
          </Box>
        ) : (
          <div className={css.TitleRow}>
            {backButton}
            <div className={css.TitleColumn}>
              <Box className={css.EyebrowRow} direction="Row" alignItems="Center" gap="200">
                {!hasSubtitle && (
                  <Text className={css.ViewLabel} size="L400" priority="300">
                    {t('thread.view')}
                  </Text>
                )}
                <AutoApproveChip room={room} threadId={threadId} />
                <ThreadApprovalPermissions />
                {/* Desktop: tags inline on title row */}
                {/* More adds the first tag; + tag joins the ones already set. */}
                {hasTags && (
                  <div className={classNames(css.TagsRow, css.DesktopOnlyTags, css.CompactHidden)}>
                    <TagPills
                      tags={headerModel.displayTags}
                      maxPills={DESKTOP_MAX_PILLS}
                      allTags={headerModel.displayTags}
                      canEdit={headerModel.canEdit}
                      onRemove={handleRemoveTag}
                    />
                    {headerModel.canEdit && (
                      <ThreadTagPicker
                        availableTags={headerModel.availableTags}
                        onAddTag={handleAddTag}
                        disabled={headerModel.pickerDisabled}
                      />
                    )}
                  </div>
                )}
              </Box>
              {(hasSubtitle || showResolver) && (
                <div className={css.SubtitleRow}>
                  {headerModel.summaryText && (
                    <Text
                      // Remounting replays the tint for each new summary.
                      key={headerModel.summaryText}
                      as="span"
                      data-thread-context-summary="true"
                      className={classNames(
                        css.SummaryText,
                        summaryChanged && css.SummaryTextChanged
                      )}
                      onAnimationEnd={() =>
                        setShownSummary((shown) => ({ ...shown, changed: false }))
                      }
                      size="T300"
                      truncate
                      title={headerModel.summaryText}
                    >
                      {headerModel.summaryText}
                    </Text>
                  )}
                  {hasScheduled && (
                    <Box as="span" className={css.ScheduledWrap} alignItems="Center" gap="100">
                      {headerModel.summaryText && (
                        <Text
                          as="span"
                          className={css.MetadataDot}
                          size="T200"
                          priority="300"
                          aria-hidden="true"
                        >
                          ·
                        </Text>
                      )}
                      <Box
                        as="span"
                        className={`${css.ScheduledIndicator} ${threadIndicatorCss.ThreadScheduledIndicator}`}
                        alignItems="Center"
                        gap="100"
                        role="img"
                        aria-label={headerModel.scheduledLabel}
                        title={headerModel.scheduledLabel}
                      >
                        <IconCalendarEvent
                          size={12}
                          stroke={1.8}
                          className={threadIndicatorCss.ThreadScheduledIcon}
                          aria-hidden="true"
                        />
                        <Text as="span" size="T200" priority="300" truncate>
                          {headerModel.bannerScheduledText}
                        </Text>
                      </Box>
                    </Box>
                  )}
                  {showResolver && (
                    <Box
                      as="span"
                      className={classNames(css.ResolutionByline, css.CompactHidden)}
                      id={resolverBylineId}
                      data-thread-resolution-byline="true"
                      alignItems="Center"
                      gap="100"
                      role="img"
                      aria-label={resolvedByLabel}
                      title={resolvedByLabel}
                    >
                      {hasSubtitle && (
                        <Text
                          as="span"
                          className={classNames(css.MetadataDot, css.ResolutionBylineDot)}
                          size="T200"
                          priority="300"
                          aria-hidden="true"
                        >
                          ·
                        </Text>
                      )}
                      <Icon src={Icons.Check} size="50" aria-hidden="true" />
                      <Text
                        as="span"
                        className={css.ResolverName}
                        size="T200"
                        priority="300"
                        truncate
                      >
                        {t('thread.resolvedByShort', { name: resolvedByDisplayName })}
                      </Text>
                    </Box>
                  )}
                </div>
              )}
            </div>
            <Box alignItems="Center" gap="100" shrink="No">
              <IconTooltip label={t('threadActions.more')}>
                {(triggerRef) => (
                  <IconButton
                    ref={(node: HTMLButtonElement | null) => {
                      triggerRef(node);
                      moreButtonRef.current = node;
                    }}
                    size="300"
                    radii="300"
                    aria-label={t('threadActions.more')}
                    aria-haspopup="menu"
                    aria-expanded={!!activeMenu}
                    disabled={!canOpenMenu}
                    onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
                      openMenu(event.currentTarget.getBoundingClientRect(), event.currentTarget)
                    }
                  >
                    <Icon src={Icons.VerticalDots} size="100" />
                  </IconButton>
                )}
              </IconTooltip>
              {pinning.canPin && mutableThreadRootId ? (
                <IconTooltip label={t(isPinned ? 'threadNav.unpin' : 'threadNav.pin')}>
                  {(triggerRef) => (
                    <IconButton
                      ref={triggerRef}
                      className={isPinned ? undefined : css.CompactHidden}
                      size="300"
                      radii="300"
                      aria-label={t(isPinned ? 'threadNav.unpin' : 'threadNav.pin')}
                      aria-pressed={isPinned}
                      disabled={pinning.updating || updating}
                      onClick={() => pinning.setPinned(mutableThreadRootId, !isPinned)}
                    >
                      <Icon src={Icons.Pin} size="100" filled={isPinned} />
                    </IconButton>
                  )}
                </IconTooltip>
              ) : (
                isPinned && (
                  <Box
                    as="span"
                    role="img"
                    aria-label={t('threadNav.pinned')}
                    title={t('threadNav.pinned')}
                  >
                    <Icon src={Icons.Pin} size="100" filled />
                  </Box>
                )
              )}
              {!isPinned && (
                // Resolve is in More, but a resolved status stays visible for readers.
                <IconTooltip
                  label={
                    headerModel.isResolved
                      ? resolvedByLabel ?? t('thread.resolved')
                      : t('thread.resolve')
                  }
                  hint={
                    headerModel.isResolved && headerModel.canEdit
                      ? t('threadActions.reopen')
                      : undefined
                  }
                >
                  {(triggerRef) => (
                    <IconButton
                      ref={triggerRef}
                      className={headerModel.isResolved ? css.ResolvedButton : css.CompactHidden}
                      size="300"
                      radii="300"
                      aria-label={t(headerModel.isResolved ? 'thread.resolved' : 'thread.resolve')}
                      aria-describedby={showResolver ? resolverBylineId : undefined}
                      onClick={handleToggleResolve}
                      disabled={
                        !headerModel.canEdit || headerModel.pickerDisabled || pinning.updating
                      }
                    >
                      <Icon src={Icons.Check} size="100" />
                    </IconButton>
                  )}
                </IconTooltip>
              )}
            </Box>
            {/* Mobile: tags in a row of their own, under the title and the actions */}
            {hasTags && (
              <div className={classNames(css.MobileOnlyTags, css.CompactHidden)}>
                <TagPills
                  tags={headerModel.displayTags}
                  maxPills={MOBILE_MAX_PILLS}
                  allTags={headerModel.displayTags}
                  canEdit={headerModel.canEdit}
                  onRemove={handleRemoveTag}
                />
                {headerModel.canEdit && (
                  <ThreadTagPicker
                    availableTags={headerModel.availableTags}
                    onAddTag={handleAddTag}
                    disabled={headerModel.pickerDisabled}
                  />
                )}
              </div>
            )}
          </div>
        )}
        {!!pinning.error && (
          <Text role="alert" size="T200">
            {t('thread.pinFailed')}
          </Text>
        )}
      </div>
      {activeMenu && (
        <Suspense fallback={null}>
          <ThreadActionsMenu
            key={`${room.roomId}:${threadRootId}`}
            room={room}
            rootId={threadRootId}
            summaryText={headerModel.summaryText}
            onHideDetails={collapsed ? undefined : () => toggleCollapsed(true)}
            anchor={activeMenu.anchor}
            onClose={() => closeMenu(activeMenu)}
          />
        </Suspense>
      )}
    </>
  );
}
