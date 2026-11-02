import { useTranslation } from 'react-i18next';
/* eslint-disable react/destructuring-assignment */
import React, {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Direction, EventTimelineSet, MatrixEvent, Room } from 'matrix-js-sdk';
import classNames from 'classnames';
import { Editor } from 'slate';
import {
  Badge,
  Box,
  ContainerColor,
  Icon,
  Icons,
  Line,
  Scroll,
  Text,
  as,
  color,
  config,
  toRem,
} from 'folds';
import { Chip } from '../../components/glass/GlassPrimitives';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useVirtualPaginator } from '../../hooks/useVirtualPaginator';
import * as overlay from './RoomOverlay.css';
import { InsetScrollbar } from '../../components/inset-scrollbar/InsetScrollbar';
import { ThreadTimelineHeader } from './ThreadTimelineHeader';
import { useAlive } from '../../hooks/useAlive';
import { scrollToBottom } from '../../utils/dom';
import { DefaultPlaceholder, CompactPlaceholder, MessageBase } from '../../components/message';
import { getEditedEvent, getLatestMessageContent, reactionOrEditEvent } from '../../utils/room';
import { useSetting } from '../../state/hooks/settings';
import { MessageLayout, settingsAtom } from '../../state/settings';
import { RoomIntro } from '../../components/room-intro';
import { getResizeObserverEntry, useResizeObserver } from '../../hooks/useResizeObserver';
import * as css from '../../features/room/RoomTimeline.css';
import { inSameDay, minuteDifference, timeDayMonthYear, today, yesterday } from '../../utils/time';
import { VirtualTile } from '../../components/virtualizer';
import { useRoomUnread } from '../../state/hooks/unread';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useIgnoredUsers } from '../../hooks/useIgnoredUsers';
import { useInitialClientCatchup } from '../../hooks/useInitialClientCatchup';
import { createSessionId } from '../../state/sessions';
import type { MindroomThreadSummaryInfo } from './threadSummaryStore';
import {
  buildResolveConfirmedEventId,
  dedupeThreadRenderEventEntries,
  estimateThreadEventRowHeight,
  primeTimelineRenderContextBefore,
  shouldAutoPaginateThreadBack,
} from './threadRenderUtils';
import {
  useTimelineDebugRangeController,
  useTimelineDebugTraceIds,
} from './timelineDebugController';
import { CompactRoomView } from './CompactRoomView';
import type { ScrollAnchorMemory } from '../scroll/scrollAnchorMemory';
import { RoomThreadOverview } from './RoomThreadOverview';
import {
  getRenderableEventEntries,
  isRenderableEvent,
  mergeClassicRoomThreadReplyEntries,
} from './roomTimelineEvents';
import {
  getEmptyTimeline,
  getInitialTimeline,
  getLiveTimeline,
  getRoomUnreadInfo,
  getTimelinesEventsCount,
  type RecalibrateFilterOpts,
  type Timeline,
} from './timelinePagination';
import { useTimelinePagination } from './timelinePaginationController';
import { useThreadSummaryPublishController } from './threadSummaryPublishController';
import { useThreadOverviewRefreshCounter } from './threadOverviewRefreshCounter';
import { useThreadSortFreezeController } from './threadSortFreezeController';
import { useMindroomThreadIndex } from './useMindroomThreadIndex';
import type { ThreadFilterKey } from './RoomThreadOverview';
import {
  type ThreadFilterState,
  type ThreadSortFreezeState,
  type FilterPreset,
} from './roomThreadOverviewModel';
import type { RoomViewMode } from './roomViewMode';
import {
  isScrollNearBottom,
  isTimelineAtLiveEnd,
  shouldRenderUnreadDividerAt,
} from './timelineScrollUtils';
import {
  resolveRoomTimelineViewState,
  THREAD_OVERVIEW_METADATA_CACHE_LIMIT,
} from './roomTimelineViewState';
import { useRoomThreadResolutionMap } from './useRoomThreadTags';
// CINNY-207 P4.3: the eager preload hook was deleted. Deep-history
// sweep is now a band-4 job on the engine's BackfillScheduler (see
// engine/deepHistoryJob.ts) and never touches the SDK live timeline.
import {
  ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE,
  THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS,
} from './preloadSettings';
import { countCacheProbe } from './cacheProbe';
import { useThreadBackPaginationController } from './threadBackPaginationController';
import { useThreadSeedPrewarmController } from './threadSeedPrewarmController';
import { useThreadSession } from './session/useThreadSession';
import { useThreadDiagnosticSnapshot } from './useThreadDiagnosticSnapshot';
import { getKnownThreadReplyCount } from './threadRecord';
import { getThreadReplyEventsForRoot } from './threadUtils';
import type { ThreadOpenRuntime } from './session/threadSessionTypes';
import { useThreadAwareTimelineRefresh } from './useThreadAwareTimelineRefresh';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';
import { useRoomAutomaticFill } from './roomAutomaticFill';
import { useRoomTimelineResetRelink } from './roomTimelineResetRelink';
import { useThreadOverviewResumeController } from './threadOverviewResumeController';
import { scheduleReconcile as scheduleEngineReconcile, useMindroomSyncEngine } from '../engine';
import type { ScheduleReconcileFn } from './threadOpenCacheFirst';
import { useCompactRootEditBackfillController } from './compactRootEditBackfillController';
import { useCompactCoverageBackfillController } from './compactCoverageBackfillController';
import { useThreadPagination } from './session/useThreadPagination';
import { useThreadPrependViewport } from './useThreadPrependViewport';
import { useFollowContentGrowth } from './useFollowContentGrowth';
import { getLiveReplyStore } from '../live/liveReplyStore';
import { useThreadEditBackfillController } from './threadEditBackfillController';
import { useRoomPaginationCommandController } from './roomPaginationCommandController';
import { useRoomCachedBackState } from './useRoomCachedBackState';
import { useRoomCacheHydrationController } from './roomCacheHydrationController';
import { useRoomLiveRenderController } from './roomLiveRenderController';
import { useThreadOpenLifecycleController } from './threadOpenLifecycleController';
import { useRoomTimelineWindowController } from './roomTimelineWindowController';
import { useTimelineReadReceiptController } from './timelineReadReceiptController';
import { TimelineMinimap } from './TimelineMinimap';
import { useRoomTimelineMinimap } from './useRoomTimelineMinimap';
import { useTimelineMessageFeature } from './message-rendering/useTimelineMessageFeature';
import {
  useRoomEventOpenController,
  useRoomEventRouteOpenController,
} from './roomEventOpenController';
import {
  useRoomFocusScrollController,
  type RoomTimelineFocusItem,
} from './roomFocusScrollController';
import { useRoomTimelineNavigationController } from './roomTimelineNavigationController';
import { useThreadTimelineState } from './useThreadTimelineState';
import { useThreadGapRecovery } from './useThreadGapRecovery';
import {
  useThreadApprovalTimeline,
  useThreadApprovalRowMeasurements,
} from './useThreadApprovalTimeline';
import { useThreadSummaryTimeline } from './useThreadSummaryTimeline';
import {
  ThreadConversationCostProvider,
  useThreadConversationCostSummary,
} from './useThreadConversationCost';

const TimelineFloat = as<'div', css.TimelineFloatVariants>(
  ({ position, className, ...props }, ref) => (
    <Box
      className={classNames(css.TimelineFloat({ position }), className)}
      justifyContent="Center"
      alignItems="Center"
      gap="200"
      {...props}
      ref={ref}
    />
  )
);

const TimelineDivider = as<'div', { variant?: ContainerColor | 'Inherit' }>(
  ({ variant, children, ...props }, ref) => (
    <Box gap="100" justifyContent="Center" alignItems="Center" {...props} ref={ref}>
      <Line style={{ flexGrow: 1 }} variant={variant} size="300" />
      {children}
      <Line style={{ flexGrow: 1 }} variant={variant} size="300" />
    </Box>
  )
);

export type RoomTimelineProps = {
  room: Room;
  hasMindroomAgents?: boolean;
  eventId?: string;
  focusEventInRoom?: boolean;
  threadId?: string;
  threadHeader?: React.ReactNode;
  summaryMap: Map<string, MindroomThreadSummaryInfo>;
  onStoreThreadSummary: (threadRootId: string, info: MindroomThreadSummaryInfo | undefined) => void;
  threadFilterState: ThreadFilterState;
  threadSortFreezeState: ThreadSortFreezeState | null;
  onToggle: (key: ThreadFilterKey) => void;
  onSortDirectionChange: () => void;
  onToggleThreadSortFreeze: () => void;
  onToggleUnresolvedOnly: () => void;
  setThreadSortFreezeState: Dispatch<SetStateAction<ThreadSortFreezeState | null>>;
  onCycleTag: (tag: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onReset: () => void;
  onApplyPreset: (preset: FilterPreset) => void;
  onSearchQueryChange: (query: string) => void;
  viewMode?: RoomViewMode;
  onViewModeChange?: (viewMode: RoomViewMode) => void;
  onThreadLoadError?: (threadId: string) => void;
  roomInputRef: RefObject<HTMLElement>;
  roomFooterRef?: RefObject<HTMLElement>;
  compactRoomScrollStateRef: MutableRefObject<ScrollAnchorMemory>;
  editor: Editor;
};

export function RoomTimeline({
  room,
  hasMindroomAgents = true,
  eventId,
  focusEventInRoom,
  threadId,
  threadHeader,
  summaryMap,
  onStoreThreadSummary,
  threadFilterState,
  threadSortFreezeState,
  onToggle,
  onSortDirectionChange,
  onToggleThreadSortFreeze,
  onToggleUnresolvedOnly,
  setThreadSortFreezeState,
  onCycleTag,
  onAddTag,
  onRemoveTag,
  onReset,
  onApplyPreset,
  onSearchQueryChange,
  viewMode = 'threaded',
  onViewModeChange,
  onThreadLoadError,
  roomInputRef,
  roomFooterRef,
  compactRoomScrollStateRef,
  editor,
}: RoomTimelineProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const initialClientCatchupInProgress = useInitialClientCatchup(mx);
  const sessionId = useMemo(() => createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId()), [mx]);
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const [messageLayout] = useSetting(settingsAtom, 'messageLayout');
  const [messageSpacing] = useSetting(settingsAtom, 'messageSpacing');
  const {
    effectiveViewMode,
    focusedRoomOverviewRequested,
    requestedThreadFilterState,
    showRoomThreadOverviewControls,
  } = resolveRoomTimelineViewState({
    eventId,
    focusEventInRoom,
    threadFilterState,
    threadId,
    viewMode,
  });
  const showThreadRepliesInRoom = effectiveViewMode === 'classic';
  const [hideMembershipEvents] = useSetting(settingsAtom, 'hideMembershipEvents');
  const [hideNickAvatarEvents] = useSetting(settingsAtom, 'hideNickAvatarEvents');
  const [showHiddenEvents] = useSetting(settingsAtom, 'showHiddenEvents');
  const prefetchDepth = ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE;
  const interactivePaginationLimit = ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE;
  const prefetchDepthRef = useRef(prefetchDepth);
  prefetchDepthRef.current = prefetchDepth;

  const ignoredUsersList = useIgnoredUsers();
  const ignoredUsersSet = useMemo(() => new Set(ignoredUsersList), [ignoredUsersList]);

  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const [unreadInfo, setUnreadInfo] = useState(() => getRoomUnreadInfo(room, true));
  const readUptoEventIdRef = useRef<string>();
  if (unreadInfo) {
    readUptoEventIdRef.current = unreadInfo.readUptoEventId;
  }

  const atBottomAnchorRef = useRef<HTMLElement>(null);
  const [atBottom, setAtBottom] = useState<boolean>(true);
  const atBottomRef = useRef(atBottom);
  atBottomRef.current = atBottom;

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const overlayRootRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const messageFeature = useTimelineMessageFeature({
    room,
    editor,
    threadId,
    showThreadRepliesInRoom,
    scrollRef,
    messageLayout,
    messageSpacing,
    hideActivity,
    hideMembershipEvents,
    hideNickAvatarEvents,
    showHiddenEvents,
  });
  const scrollToBottomRef = useRef({
    count: 0,
    smooth: true,
  });

  const [focusItem, setFocusItem] = useState<RoomTimelineFocusItem | undefined>();
  const threadSession = useThreadSession({ roomId: room.roomId, threadId, eventId });
  const {
    commands: threadCommands,
    targets: threadTargets,
    snapshot: threadSnapshot,
  } = threadSession;
  const {
    loadError: threadLoadError,
    initialCacheHydrated: threadInitialCacheHydrated,
    sdkReady: threadInitialSdkLoaded,
    latestPending: threadLatestOpenPending,
    editResetEpoch,
  } = threadSnapshot.open;
  const { hasMoreCachedBack: threadHasMoreCachedBack, tailLoaded: threadTailLoaded } =
    threadSnapshot.history;
  const { timelineRevision: threadTimelineTick, targetRevision: pendingThreadOpenTick } =
    threadSnapshot;
  const [roomHasMoreCachedBack, setRoomHasMoreCachedBack] = useState(false);
  const [roomInitialCacheHydratedKey, setRoomInitialCacheHydratedKey] = useState<
    string | undefined
  >();
  const { pagination: threadPagination, bindRuntime: bindThreadPaginationRuntime } =
    useThreadPagination(threadCommands, { roomId: room.roomId, threadId, eventId });
  const { isPending: isThreadPaginationPending, reset: resetThreadPagination } = threadPagination;
  const threadPaginatingBack = threadPagination.snapshot.backward === 'pending';
  const threadPaginatingFront = threadPagination.snapshot.forward === 'pending';
  // First real scroll gesture in this thread view; also ends the
  // open-at-latest bottom pin (the reader owns the position from then on).
  const [threadUserScrolled, setThreadUserScrolled] = useState(false);
  // Latched once an open-at-latest began for this thread: hydration bands
  // land long after the open chain completes (background prefetch /
  // reconciler), and the pin must hold for them until the first gesture.
  // Render-time keying (greptile P1 on PR #83): the reset must happen in
  // the SAME render that switches room/thread — a useEffect reset runs
  // after the pin layout effect, letting one commit of the next thread
  // see the previous thread's latch. On the switch render itself the
  // stale threadLatestOpenPending (cleared only by the next open effect)
  // must not re-latch, hence the else.
  const threadOpenedAtLatestRef = useRef(false);
  const threadOpenLatchKeyRef = useRef(`${room.roomId}|${threadId ?? ''}`);
  if (threadOpenLatchKeyRef.current !== `${room.roomId}|${threadId ?? ''}`) {
    threadOpenLatchKeyRef.current = `${room.roomId}|${threadId ?? ''}`;
    threadOpenedAtLatestRef.current = false;
  } else if (threadLatestOpenPending) {
    threadOpenedAtLatestRef.current = true;
  }
  const threadBackViewport = useThreadBackPaginationController();
  const {
    reset: resetThreadBackPagination,
    isOpenBottomPinSuppressed: isThreadOpenBottomPinSuppressed,
  } = threadBackViewport;
  const requestThreadOpenBottomPin = useCallback(
    () => threadBackViewport.requestOpenBottomPin(scrollToBottomRef),
    [scrollToBottomRef, threadBackViewport]
  );
  const cancelThreadOpenBottomPin = useCallback(
    () => threadBackViewport.cancelOpenBottomPin(scrollToBottomRef.current.count),
    [scrollToBottomRef, threadBackViewport]
  );
  const roomIdRef = useRef(room.roomId);
  const roomPaginatingBackRef = useRef(false);
  const threadIdRef = useRef(threadId);
  const threadFilterStateRef = useRef(requestedThreadFilterState);
  const suppressFocusPaginationRef = useRef(false);
  const alive = useAlive();
  roomIdRef.current = room.roomId;
  threadIdRef.current = threadId;
  threadFilterStateRef.current = requestedThreadFilterState;
  const { roomDebugTraceId, threadDebugTraceId } = useTimelineDebugTraceIds({
    eventId,
    room,
    threadId,
  });

  const [timeline, setTimeline] = useState<Timeline>(() =>
    eventId
      ? getEmptyTimeline()
      : getInitialTimeline(room, prefetchDepth, {
          threadId,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
          showThreadRepliesInRoom,
        })
  );
  const prevShowThreadRepliesInRoomRef = useRef(showThreadRepliesInRoom);
  const eventsLength = getTimelinesEventsCount(timeline.linkedTimelines);
  const threadResolutionMap = useRoomThreadResolutionMap(room);
  // CINNY-207 P4.3: the eagerPreloading reset layout-effect is gone.
  // The band-4 deep-history job runs entirely in the engine and does
  // not gate any rendering signal — the skeleton logic below relies on
  // cache/live counts alone.
  useLayoutEffect(() => {
    if (prevShowThreadRepliesInRoomRef.current === showThreadRepliesInRoom) return;
    prevShowThreadRepliesInRoomRef.current = showThreadRepliesInRoom;
    if (eventId || threadId) return;

    setTimeline(
      getInitialTimeline(room, prefetchDepth, {
        threadId,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents,
        showThreadRepliesInRoom,
      })
    );
  }, [
    eventId,
    threadId,
    room,
    prefetchDepth,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    showThreadRepliesInRoom,
  ]);
  const rawRenderableEventEntries = useMemo(
    () =>
      getRenderableEventEntries(
        timeline.linkedTimelines,
        room,
        threadId,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents,
        showThreadRepliesInRoom
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      timeline.linkedTimelines,
      eventsLength,
      threadId,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      showThreadRepliesInRoom,
    ]
  );
  const resolveConfirmedRoomEventId = useMemo(
    () =>
      threadId
        ? undefined
        : buildResolveConfirmedEventId(
            room,
            rawRenderableEventEntries.map(({ event }) => event)
          ),
    [threadId, room, rawRenderableEventEntries]
  );
  const renderableEventEntries = useMemo(() => {
    if (threadId) return rawRenderableEventEntries;

    const classicRenderableEventEntries = showThreadRepliesInRoom
      ? mergeClassicRoomThreadReplyEntries({
          renderableEventEntries: rawRenderableEventEntries,
          room,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
        })
      : rawRenderableEventEntries;

    return dedupeThreadRenderEventEntries(
      classicRenderableEventEntries,
      resolveConfirmedRoomEventId
    );
  }, [
    threadId,
    rawRenderableEventEntries,
    showThreadRepliesInRoom,
    room,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    resolveConfirmedRoomEventId,
  ]);
  const renderableEvents = useMemo(
    () => renderableEventEntries.map(({ event }) => event),
    [renderableEventEntries]
  );

  const { overviewRefreshCounter, setOverviewRefreshCounter } = useThreadOverviewRefreshCounter(
    room,
    threadId
  );

  const compactViewRequested = !threadId && effectiveViewMode === 'compact';

  const {
    showCompactRoomView,
    roomSurfaceEventEntries,
    visibleThreadRootData,
    compactThreadRootData,
    hasZeroReplyRootCoverage,
    normalThreadRecordMap,
    threadRecordMap,
    threadReplyCountMap,
    threadParticipantMap,
    threadSummaryInfoMap,
    scheduledStatusMap,
    availableRoomTags,
    roomThreadListThreads,
    refreshRoomThreadList,
    effectiveThreadFilterState,
    roomThreadFilterActive,
    liveThreadFilterState,
    filteredThreadRootIds,
    compactFilteredThreadRootIds,
    roomOverviewOrderActive,
    activeLiveOverviewThreadRootIds,
    overviewThreadRootIds,
    statusCounts,
    tagCounts,
    searchQuery: threadIndexSearchQuery,
    threadSortControlSignature,
    applyThreadOverviewRelationEvents,
  } = useMindroomThreadIndex({
    room,
    threadId,
    eventId,
    focusedRoomOverviewRequested,
    compactViewRequested,
    effectiveViewMode,
    linkedTimelines: timeline.linkedTimelines,
    renderableEventEntries,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    summaryMap,
    threadResolutionMap,
    currentUserId: mx.getSafeUserId(),
    requestedThreadFilterState,
    threadSortFreezeState,
    overviewRefreshCounter,
    sessionId,
    mx,
    onStoreThreadSummary,
  });
  threadFilterStateRef.current = effectiveThreadFilterState;
  const roomInitialCacheHydrationKey = !threadId && !eventId ? room.roomId : undefined;
  const roomInitialCacheHydrated =
    !roomInitialCacheHydrationKey || roomInitialCacheHydratedKey === roomInitialCacheHydrationKey;
  const deferEmptyRoomOverview =
    !threadId &&
    (!roomInitialCacheHydrated || initialClientCatchupInProgress) &&
    visibleThreadRootData.ids.length === 0 &&
    compactThreadRootData.ids.length === 0;
  const shouldShowRoomThreadOverviewControls =
    showRoomThreadOverviewControls && !deferEmptyRoomOverview;

  useThreadSortFreezeController({
    activeLiveOverviewThreadRootIds,
    setThreadSortFreezeState,
    threadId,
    threadSortFreezeState,
    threadSortControlSignature,
  });

  const threadFilteredEventsRef = useRef<MatrixEvent[]>([]);
  const prevRoomThreadFilterActiveRef = useRef(roomThreadFilterActive);
  const liveTimelineLinked =
    timeline.linkedTimelines[timeline.linkedTimelines.length - 1] === getLiveTimeline(room);
  const canPaginateBack =
    typeof timeline.linkedTimelines[0]?.getPaginationToken(Direction.Backward) === 'string';
  const {
    canPaginateThreadBack,
    canPaginateThreadFront,
    roomTimelineSet,
    thread,
    threadBackwardPaginationToken,
    threadEventMap,
    threadEventIndexMap,
    threadEventIndexMapRef,
    threadEvents,
    threadInitialRenderMode,
    threadTimelineSet,
    setSupplementalThreadEvents,
    resetThreadRenderState,
  } = useThreadTimelineState({
    room,
    threadId,
    threadInitialCacheHydrated,
    threadInitialSdkLoaded,
    timelineRevision: threadTimelineTick,
    debugTraceId: threadDebugTraceId,
  });
  const approvalTimeline = useThreadApprovalTimeline(
    threadEvents,
    ignoredUsersSet,
    threadId,
    eventId,
    focusItem?.eventId
  );
  // A thread row resolves its event in the timeline set that holds it.
  const getThreadEventTimelineSet = useCallback(
    (mEventId: string) =>
      threadTimelineSet?.getTimelineForEvent(mEventId)?.getTimelineSet() ??
      roomTimelineSet.getTimelineForEvent(mEventId)?.getTimelineSet() ??
      threadTimelineSet ??
      roomTimelineSet,
    [threadTimelineSet, roomTimelineSet]
  );
  const getThreadEventContent = useCallback(
    (mEvent: MatrixEvent) => {
      const mEventId = mEvent.getId() ?? '';
      return getLatestMessageContent(
        mEvent,
        getEditedEvent(mEventId, mEvent, getThreadEventTimelineSet(mEventId))
      );
    },
    [getThreadEventTimelineSet]
  );
  const threadSummaryTimeline = useThreadSummaryTimeline(threadEvents, {
    history: {
      sdkLoaded: !!threadInitialSdkLoaded,
      canPaginateBack: canPaginateThreadBack,
      hasMoreCachedBack: threadHasMoreCachedBack,
    },
    getContent: getThreadEventContent,
    ignoredUserIds: ignoredUsersSet,
    routeId: eventId,
    focusId: focusItem?.eventId,
  });
  const threadConversationCost = useThreadConversationCostSummary(
    threadId ? threadEvents : undefined,
    {
      history: {
        sdkLoaded: !!threadInitialSdkLoaded,
        canPaginateBack: canPaginateThreadBack,
        hasMoreCachedBack: threadHasMoreCachedBack,
      },
      getContent: getThreadEventContent,
      ignoredUserIds: ignoredUsersSet,
      viewerId: mx.getUserId() ?? undefined,
    }
  );
  // Thread rows that stay in the virtualizer's index space but render nothing.
  const hiddenThreadEventIds = useMemo(
    () =>
      threadSummaryTimeline.hiddenEventIds.size === 0
        ? approvalTimeline.hiddenEventIds
        : new Set([...approvalTimeline.hiddenEventIds, ...threadSummaryTimeline.hiddenEventIds]),
    [approvalTimeline.hiddenEventIds, threadSummaryTimeline.hiddenEventIds]
  );
  // Pre-download every long-text sidecar of the open thread so replies render
  // their full Markdown without waiting for viewport entry or expansion (the
  // CollapsibleMessage IntersectionObserver gate still covers room-view rows).
  const {
    activeTimelineRange,
    filteredLength,
    priorityThreadSeedPrewarmRoots,
    readUptoAbsoluteIndex,
    showThreadLoadOlderMessages,
    threadFilteredEventEntries,
    threadFilteredEvents,
    unreadScrollAnchorIndex,
    useSurfacePreloadTarget,
  } = useRoomTimelineWindowController({
    canPaginateThreadBack,
    effectiveViewMode,
    filteredRoomOverviewOrderActive: roomOverviewOrderActive,
    filteredRoomThreadActive: roomThreadFilterActive,
    lastThreadBackwardPaginationToken: threadBackwardPaginationToken,
    overviewRefreshCounter,
    overviewThreadRootIds,
    renderableEventEntries,
    renderableEvents,
    room,
    roomSurfaceEventEntries,
    roomThreadListThreads,
    prefetchDepth,
    threadEventsLength: threadEvents.length,
    threadHasMoreCachedBack,
    threadId,
    threadReplyCountMap,
    threadResolutionMap,
    threadTailLoaded,
    timeline,
    unreadInfo,
  });
  threadFilteredEventsRef.current = threadFilteredEvents;
  const rangeAtStart = activeTimelineRange.start === 0;
  const rangeAtEnd = activeTimelineRange.end === filteredLength;

  useTimelineDebugRangeController({
    activeTimelineRange,
    canPaginateThreadBack,
    canPaginateThreadFront,
    eventsLength,
    filteredLength,
    renderableEventCount: renderableEventEntries.length,
    roomDebugTraceId,
    roomSurfaceEventCount: roomSurfaceEventEntries.length,
    threadDebugTraceId,
    threadEventCount: threadEvents.length,
    threadId,
    threadInitialCacheHydrated,
    threadInitialRenderMode,
    threadOverviewCount: threadFilteredEvents.length,
    threadTailLoaded,
    threadTimelineTick,
    useSurfacePreloadTarget,
  });

  useEffect(() => {
    const wasActive = prevRoomThreadFilterActiveRef.current;
    prevRoomThreadFilterActiveRef.current = roomThreadFilterActive;

    if (wasActive && !roomThreadFilterActive && !threadId) {
      setTimeline(
        getInitialTimeline(room, prefetchDepth, {
          threadId,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
          showThreadRepliesInRoom,
        })
      );
    }
  }, [
    roomThreadFilterActive,
    threadId,
    room,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    showThreadRepliesInRoom,
    prefetchDepth,
  ]);

  const timelineAtLiveEnd = isTimelineAtLiveEnd({
    threadId,
    liveTimelineLinked,
    rangeAtEnd,
    canPaginateThreadFront,
    threadTailLoaded,
  });
  const atLiveEndRef = useRef(timelineAtLiveEnd);
  atLiveEndRef.current = timelineAtLiveEnd;

  const recalibrateFilterOptsRef = useRef<RecalibrateFilterOpts | undefined>({
    room,
    threadId,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    showThreadRepliesInRoom,
  });
  recalibrateFilterOptsRef.current = {
    room,
    threadId,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    showThreadRepliesInRoom,
  };

  const handleTimelinePagination = useTimelinePagination(
    mx,
    timeline,
    setTimeline,
    interactivePaginationLimit,
    recalibrateFilterOptsRef
  );

  // CINNY-207 P3.3: persistence moved into the MindroomSyncEngine
  // write-through (client-level, all rooms). The component reads the
  // room-bound persist facade off the engine and hands the fns down
  // to the fetch controllers (same shapes as the pre-strip props).
  const syncEngine = useMindroomSyncEngine();
  const loadedThreadEventsRef = useRef(threadEvents);
  loadedThreadEventsRef.current = threadEvents;
  const getLoadedThreadEvents = useCallback(() => loadedThreadEventsRef.current, []);
  useThreadGapRecovery({
    engine: syncEngine,
    room,
    threadId,
    append: setSupplementalThreadEvents,
    getLoadedEvents: getLoadedThreadEvents,
    debugTraceId: threadDebugTraceId,
  });
  const beginRoomCacheWrite = useCallback(
    () => syncEngine.persist.forRoom(room).persistRoomEventCache,
    [syncEngine, room]
  );
  const beginThreadCacheWrite = useCallback(
    () => syncEngine.persist.forRoom(room).persistThreadEventCache,
    [syncEngine, room]
  );

  // CINNY-207 P4.2: whenever the mounted room (or the currently open
  // thread) changes, tell the engine so it can stamp the ledger
  // federation flag, protect this room from eviction, and bump the
  // meta lastOpenedTs for both the room and thread scopes. Idempotent
  // per-call — safe to fire on every render-relevant change.

  const handleRoomTimelinePagination = useRoomPaginationCommandController({
    alive,
    handleTimelinePagination,
    mx,
    beginRoomCacheWrite,
    recalibrateFilterOptsRef,
    room,
    roomIdRef,
    roomPaginatingBackRef,
    prefetchDepthRef,
    sessionId,
    setRoomHasMoreCachedBack,
    setTimeline,
    threadId,
    threadIdRef,
    timeline,
  });

  useRoomCachedBackState({
    alive,
    eventId,
    eventsLength,
    room,
    roomIdRef,
    sessionId,
    setRoomHasMoreCachedBack,
    setTimeline,
    threadId,
    threadIdRef,
    timeline,
  });

  useCompactRootEditBackfillController({
    enabled: !threadId && showCompactRoomView,
    mx,
    overviewThreadRootIds,
    beginRoomCacheWrite,
    room,
    roomSurfaceEventEntries,
    roomThreadListThreads,
    setOverviewRefreshCounter,
  });

  // Zero-reply standalone roots are discoverable ONLY from the locally
  // loaded main timeline (real threads come from the server-side thread
  // list). The compact view mounts no scroll paginator, so on a fresh
  // session (cold cache) nothing would ever deepen the timeline and
  // historical standalone roots stayed invisible until the next app open.
  // Gated on the initial cache hydration so the open-time cached page is
  // not raced with a redundant fetch.
  useCompactCoverageBackfillController({
    enabled:
      !threadId &&
      !eventId &&
      compactViewRequested &&
      roomInitialCacheHydrated &&
      liveTimelineLinked,
    loadedEventCount: eventsLength,
    hasZeroReplyRootCoverage,
    canPaginateBack,
    hasMoreCachedBack: roomHasMoreCachedBack,
    paginateBack: handleRoomTimelinePagination,
  });

  const { waitForExistingOrQueued } = useThreadSeedPrewarmController({
    room,
    mx,
    sessionId,
    prefetchDepthRef,
    activeThreadId: threadId,
    priorityTargets: priorityThreadSeedPrewarmRoots,
    debugTraceId: roomDebugTraceId,
  });

  const forceTimelineUpdate = useCallback(() => {
    setTimeline((ct) => ({ ...ct }));
  }, []);

  // CINNY-207 P5.1 (D7 / AC9): bound `scheduleReconcile` binding for
  // the thread-open flow. Every open (complete or partial coverage)
  // schedules exactly one reconcile against server truth — the
  // scheduler dedups so an open followed immediately by a re-focus
  // does not fire duplicate `/relations` fetches.
  const scheduleReconcile = useCallback<ScheduleReconcileFn>(
    (args) =>
      scheduleEngineReconcile({
        mx,
        sessionId: syncEngine.sessionId,
        scheduler: syncEngine.scheduler,
        debugTraceId: threadDebugTraceId,
        ...args,
      }),
    [mx, syncEngine, threadDebugTraceId]
  );
  const threadRender = useMemo(
    () => ({
      reset: resetThreadRenderState,
      append: setSupplementalThreadEvents,
      invalidateTimeline: forceTimelineUpdate,
    }),
    [resetThreadRenderState, setSupplementalThreadEvents, forceTimelineUpdate]
  );
  const threadViewport = useMemo(
    () => ({
      resetForOpen: () => {
        setFocusItem(undefined);
        if (!isThreadPaginationPending('backward')) resetThreadBackPagination();
      },
      resetAfterLeave: () => {
        resetThreadPagination();
        resetThreadBackPagination();
      },
      requestLatestPin: () => {
        if (!requestThreadOpenBottomPin()) return;
        setAtBottom(true);
      },
    }),
    [
      resetThreadBackPagination,
      isThreadPaginationPending,
      resetThreadPagination,
      requestThreadOpenBottomPin,
      setAtBottom,
    ]
  );
  const threadOpenRuntime = useMemo<ThreadOpenRuntime>(
    () => ({
      room,
      mx,
      sessionId,
      beginCacheWrite: beginThreadCacheWrite,
      reconcile: scheduleReconcile,
      seed: { waitForExistingOrQueued },
      render: threadRender,
      viewport: threadViewport,
      debugTraceId: threadDebugTraceId,
      onThreadLoadError,
    }),
    [
      room,
      mx,
      sessionId,
      beginThreadCacheWrite,
      scheduleReconcile,
      waitForExistingOrQueued,
      threadRender,
      threadViewport,
      threadDebugTraceId,
      onThreadLoadError,
    ]
  );
  const refreshLatestThreadSlice = useCallback(
    (expectedThreadId: string, options?: { allowWhenThreadClosed?: boolean }) =>
      threadCommands.refreshLatest(expectedThreadId, threadOpenRuntime, options),
    [threadCommands, threadOpenRuntime]
  );

  // Reattach viewport observers when cards are replaced by the message scroller.
  const getScrollElement = useCallback(
    () => (showCompactRoomView ? null : scrollRef.current),
    [showCompactRoomView]
  );
  // Live viewport-bottom reading for SCROLL-BEHAVIOR decisions. Deliberately
  // not the atBottom state: its false-transition is debounced ~1s for
  // read-receipt/UI stability, which is exactly wrong for anything that
  // moves the viewport — a user who just left the bottom must never be
  // treated as pinned (device round 5 / the ios-momentum-invariants e2e).
  // `slackPx` lets a caller allow for a layout change it KNOWS just
  // happened (e.g. the composer growing moves the bottom away by its own
  // delta for a user who was pinned).
  const isViewportAtBottomNow = useCallback(
    (slackPx = 0) => {
      const scrollElement = getScrollElement();
      if (!scrollElement) return false;
      return isScrollNearBottom({
        scrollHeight: scrollElement.scrollHeight,
        scrollTop: scrollElement.scrollTop,
        clientHeight: scrollElement.clientHeight,
        thresholdPx: 24 + slackPx,
      });
    },
    [getScrollElement]
  );
  const getTimelineItemElement = useCallback(
    (index: number) =>
      (scrollRef.current?.querySelector(`[data-message-item="${index}"]`) as HTMLElement) ??
      undefined,
    []
  );
  // Per-row estimates from event CONTENT (estimateThreadEventRowHeight).
  // Thread rows are bimodal — one-liners vs fold-capped long messages — so
  // any single learned mean mis-sizes every row by hundreds of px, and each
  // mount then corrects scrollHeight by that error mid-scroll: the shrink
  // bursts that let the browser clamp a scrolled-up reader back to the
  // bottom (traced by the ios-momentum-invariants e2e). Content-based
  // estimates are deterministic and stateless — no learned mean, no
  // adoption step, nothing to teleport.
  //
  // Mechanics on virtual-core 3.17.3: estimateSize is NOT a virtualizer
  // memo dependency; fresh estimates reach unmeasured rows because the
  // inline getItemKey arrow below invalidates memoOptions ->
  // getMeasurements every render — a full rebuild that consults
  // estimateSize for unmeasured items while measured heights persist in
  // itemSizeCache. Do NOT memoize getItemKey: a stable identity would stop
  // estimate updates from reaching the unvisited region above the viewport
  // (getMeasurements then only recomputes from the min measured index up).
  // The rebuild's per-render cost is one O(count) pass — microseconds at
  // current sizes.
  const defaultRowEstimate = messageLayout === MessageLayout.Compact ? 96 : 144;
  const compactRowLayout = messageLayout === MessageLayout.Compact;
  const estimateRoomTimelineItemSize = useCallback(
    (index?: number) => {
      if (!threadId) return defaultRowEstimate;
      const mEvent = index === undefined ? undefined : threadEvents[index];
      if (!mEvent) return defaultRowEstimate;
      if (hiddenThreadEventIds.has(mEvent.getId() ?? '')) return 0;
      return estimateThreadEventRowHeight(mEvent, { compact: compactRowLayout });
    },
    [compactRowLayout, defaultRowEstimate, threadEvents, threadId, hiddenThreadEventIds]
  );
  // The paginator runs before the ledger controller in hook order because
  // its returned items define the virtualizer's room surface. Record room
  // prepend debt here; the controller consumes it only with the render that
  // commits the matching range.
  const pendingRoomLedgerFoldPxRef = useRef(0);
  const roomAutomaticFill = useRoomAutomaticFill({
    viewKey: `${room.roomId}|${threadId ?? ''}`,
    enabled:
      !threadId &&
      !eventId &&
      !focusItem?.scrollTo &&
      (!unreadInfo?.scrollTo ||
        unreadInfo.readUptoEventId === threadFilteredEventEntries.at(-1)?.event.getId()) &&
      !roomOverviewOrderActive &&
      timelineAtLiveEnd,
    latestEventId: threadFilteredEventEntries.at(-1)?.event.getId(),
    contentKey: `${activeTimelineRange.start}:${activeTimelineRange.end}:${filteredLength}`,
    getScrollElement,
    isPaginating: () => roomPaginatingBackRef.current,
  });
  const roomLedgerFoldPriceRef = useRef((_key: string | number | bigint, index: number) =>
    estimateRoomTimelineItemSize(index)
  );

  const {
    getItems,
    scrollToItem,
    scrollToElement,
    retryPagination,
    observeBackAnchor,
    observeFrontAnchor,
  } = useVirtualPaginator({
    count: threadId ? 0 : filteredLength,
    limit: interactivePaginationLimit,
    range: activeTimelineRange,
    onRangeChange: useCallback(
      (r) => {
        if (threadId || roomThreadFilterActive) return;
        if (r.start < activeTimelineRange.start) {
          // ROOM LEDGER FOLD (port of the thread key-diff fold; replaces
          // the coarse-scrollTo + rAF rect-correction restore, whose two
          // writes raced virtual-core's reconcile loop). The paginator
          // hands us the exact prepended span, so ΔH is direct
          // arithmetic: measured cache by event-id key for rows seen
          // before, flat room estimate otherwise. The ref mutates BEFORE
          // setTimeline so the commit that renders the new range reads
          // the matching scrollMargin — margin, window math and tile
          // tops land in one paint, and the shared settle/boundary
          // machinery repays the debt at rest exactly as in threads.
          let foldPx = 0;
          for (let item = r.start; item < activeTimelineRange.start; item += 1) {
            const key = threadFilteredEventEntries[item]?.event.getId() ?? item;
            foldPx += roomLedgerFoldPriceRef.current(key, item);
          }
          if (foldPx > 0) pendingRoomLedgerFoldPxRef.current += foldPx;
        }
        setTimeline((cs) => ({ ...cs, range: r }));
      },
      [activeTimelineRange.start, roomThreadFilterActive, threadFilteredEventEntries, threadId]
    ),
    getScrollElement,
    getItemElement: getTimelineItemElement,
    onEnd: handleRoomTimelinePagination,
    deferAutomaticPagination: roomAutomaticFill.defer,
    shouldSuppressPagination: useCallback(() => suppressFocusPaginationRef.current, []),
    // The ledger fold above owns backward-prepend compensation; without
    // this the paginator's own restore scrollBy lands first in the same
    // commit (hook order), reads the pre-margin layout, and the prepend
    // compensates TWICE — a visible jump of exactly the folded height
    // (CodeRabbit on PR #91; invisible to unit tests because the
    // harness mocks this hook).
    externalBackwardScrollRestore: true,
  });
  const timelineItems = getItems();
  // (Estimator comment block retained below its hoisted declaration —
  // the room ledger fold inside the paginator's onRangeChange needs the
  // estimator in scope, so it is declared above useVirtualPaginator.)
  // Rows measure immediately (task #128); the momentum question is only
  // what happens to the compensating scrollTop write for an above-viewport
  // resize. virtual-core ≥3.17 would natively DEFER those on iOS and replay
  // them at quiescence — but repeated flicks block the flush, so the replay
  // accumulates the whole gesture's estimate error and lands as a half-page
  // lurch when momentum dies (device-tested). The hook below therefore
  // ledgers every fully-above iOS correction. On desktop it also ledgers
  // backward-scroll corrections, preserving virtual-core's safeguard when
  // a cached collapsed row remounts expanded; forward and quiet corrections
  // remain immediate.
  // Offset ledger for corrections dropped mid-scroll (device round 10):
  // estimate error for a fully-above row would otherwise shift the content
  // under the reader. The dropped delta is folded into the virtualizer's
  // OWN coordinate space: the inner container gets a real marginTop of
  // -px and options.scrollMargin tracks the same value, so the window
  // math and the painted positions move together — no scrollTop write to
  // kill iOS momentum, and no paint/window divergence at ANY accumulated
  // magnitude (the round-8 transform shifted paint only; the on-device
  // trace measured ±3000px of divergence rendering the viewport blank
  // for 30% of a 40s ride). The offset-ledger coherence contract in
  // virtualizerIOSScrollContract.test.ts pins this against the real
  // virtual-core. The ledger settles into one exactly-cancelling
  // scrollTop write ONLY at true rest — never via a timeout cap
  // mid-momentum (the trace's full-screen settle flash): an unsettled
  // ledger is coherent, so it can wait indefinitely.
  const {
    holdThreadBannerResize,
    ledgerPxAtRender,
    measureElement: measureTimelineElement,
    threadLeadingRef,
    virtualInnerRef,
    virtualizer: roomTimelineVirtualizer,
  } = useTimelineScrollLedgerController({
    alive,
    automaticFill: roomAutomaticFill,
    estimateSize: estimateRoomTimelineItemSize,
    // Keep this function fresh. virtual-core uses its identity to rebuild
    // unmeasured rows from the latest content-aware estimates.
    getItemKey: (index) => {
      if (threadId) return threadEvents[index]?.getId() ?? index;
      const item = timelineItems[index];
      return threadFilteredEventEntries[item]?.event.getId() ?? item ?? index;
    },
    getScrollElement,
    itemCount: threadId ? threadEvents.length : timelineItems.length,
    pendingRoomFoldPxRef: pendingRoomLedgerFoldPxRef,
    roomFoldPriceRef: roomLedgerFoldPriceRef,
    roomId: room.roomId,
    threadEventIndexMap,
    threadEvents,
    threadId,
    threadInitialRenderMode,
    threadLeadingKey: `${!!threadLoadError}|${showThreadLoadOlderMessages}`,
  });
  useThreadDiagnosticSnapshot({
    traceId: threadDebugTraceId,
    threadId,
    events: threadEvents,
    readModel: () => {
      const model = threadId ? room.getThread(threadId) : undefined;
      const root = model?.rootEvent ?? (threadId ? room.findEventById(threadId) : undefined);
      return {
        eventCount: model?.events.length ?? null,
        replyCount:
          model && threadId ? getThreadReplyEventsForRoot(model.events, threadId).length : null,
        expectedReplyCount: root ? getKnownThreadReplyCount(root) ?? null : null,
      };
    },
    getElement: () => virtualInnerRef.current,
    getVirtualItemCount: () => roomTimelineVirtualizer.getVirtualItems().length,
    isRenderableReply: (event) =>
      !hiddenThreadEventIds.has(event.getId() ?? '') &&
      isRenderableEvent(
        event,
        room,
        threadId,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents
      ),
    cacheHydrated: threadInitialCacheHydrated,
    sdkReady: threadInitialSdkLoaded,
    loading: threadLatestOpenPending,
    loadError: threadLoadError,
  });
  useThreadApprovalRowMeasurements(
    roomTimelineVirtualizer,
    threadEvents,
    hiddenThreadEventIds,
    estimateRoomTimelineItemSize
  );
  const roomTimelineLatestVirtualIndex = useMemo(() => {
    if (timelineItems.length === 0) return -1;
    if (!roomOverviewOrderActive) return timelineItems.length - 1;

    let latestVirtualIndex = 0;
    let latestAbsoluteIndex = Number.NEGATIVE_INFINITY;
    timelineItems.forEach((item, virtualIndex) => {
      const absoluteIndex = threadFilteredEventEntries[item]?.absoluteIndex ?? item;
      if (absoluteIndex >= latestAbsoluteIndex) {
        latestAbsoluteIndex = absoluteIndex;
        latestVirtualIndex = virtualIndex;
      }
    });

    return latestVirtualIndex;
  }, [roomOverviewOrderActive, threadFilteredEventEntries, timelineItems]);
  const roomScrollToBottomCount = scrollToBottomRef.current.count;
  // A request keeps the latest row in view while rows load around it, until
  // the reader scrolls; then only a new request moves them (rows loaded above
  // a reader at the top must not send them back to the bottom).
  const roomScrollToBottomLeftRef = useRef(0);
  // A new view starts from its latest rows again, as a fresh request would.
  // Reset on commit, before the effect below: an abandoned render must not.
  const roomScrollToBottomViewKey = `${showCompactRoomView}|${roomOverviewOrderActive}|${showThreadRepliesInRoom}|${roomThreadFilterActive}`;
  const roomScrollToBottomViewKeyRef = useRef(roomScrollToBottomViewKey);
  useLayoutEffect(() => {
    if (roomScrollToBottomViewKeyRef.current === roomScrollToBottomViewKey) return;
    roomScrollToBottomViewKeyRef.current = roomScrollToBottomViewKey;
    roomScrollToBottomLeftRef.current = 0;
  }, [roomScrollToBottomViewKey]);
  useEffect(() => {
    const scrollElement = getScrollElement();
    if (threadId || !scrollElement) return undefined;
    const leave = () => {
      roomScrollToBottomLeftRef.current = scrollToBottomRef.current.count;
    };
    const events = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const;
    events.forEach((event) => scrollElement.addEventListener(event, leave, { passive: true }));
    return () => events.forEach((event) => scrollElement.removeEventListener(event, leave));
  }, [getScrollElement, scrollToBottomRef, threadId]);
  useLayoutEffect(() => {
    if (threadId || roomScrollToBottomCount <= 0 || roomTimelineLatestVirtualIndex < 0) return;
    if (roomScrollToBottomLeftRef.current === roomScrollToBottomCount) return;

    // Smooth scrolling to an unmounted target is unsupported with dynamic row
    // measurement (it can stop short of the target); keep smooth only for the
    // near-bottom case where the target row is already mounted.
    const targetMounted = roomTimelineVirtualizer
      .getVirtualItems()
      .some((virtualItem) => virtualItem.index === roomTimelineLatestVirtualIndex);
    roomTimelineVirtualizer.scrollToIndex(roomTimelineLatestVirtualIndex, {
      align: roomOverviewOrderActive ? 'start' : 'end',
      behavior: scrollToBottomRef.current.smooth && targetMounted ? 'smooth' : 'auto',
    });
    setAtBottom(true);
  }, [
    roomOverviewOrderActive,
    roomScrollToBottomCount,
    roomTimelineLatestVirtualIndex,
    roomTimelineVirtualizer,
    scrollToBottomRef,
    setAtBottom,
    threadId,
  ]);
  // Active settle loop's stop function; programmatic in-thread jumps cancel
  // it so a streaming re-pin cannot yank a just-initiated jump back to the
  // bottom (jumps emit no user scroll-intent events).
  const threadSettleStopRef = useRef<(() => void) | undefined>(undefined);
  // Thread bottom-pin settling: under virtualization the scroll height is an
  // estimate until rows mount and measure, so a pin can land far off-bottom
  // while measurements keep growing the total size (opening a large thread can
  // need dozens of correction frames). Re-pin until the position is stably at
  // the bottom, and stop immediately on user scroll intent so streaming
  // re-pins cannot trap the user at the bottom.
  useLayoutEffect(() => {
    if (
      !threadId ||
      roomScrollToBottomCount <= 0 ||
      !threadBackViewport.shouldApplyBottomPin(roomScrollToBottomCount)
    ) {
      return undefined;
    }

    const scrollEl = scrollRef.current;
    if (!scrollEl) return undefined;

    const userScrollIntentEvents = [
      'wheel',
      'touchstart',
      'touchmove',
      'pointerdown',
      'keydown',
    ] as const;
    let rafId: number | undefined;
    let remainingTicks = 150;
    let stableTicks = 0;
    let lastScrollTop = Number.NaN;
    const removeListeners = () => {
      userScrollIntentEvents.forEach((eventType) => {
        scrollEl.removeEventListener(eventType, cancelOnUserScrollIntent);
      });
    };
    const stop = () => {
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      rafId = undefined;
      removeListeners();
      if (threadSettleStopRef.current === stop) {
        threadSettleStopRef.current = undefined;
      }
    };
    threadSettleStopRef.current = stop;
    function cancelOnUserScrollIntent() {
      stop();
    }
    const settle = () => {
      rafId = undefined;
      // While a smooth pin animation is still moving, observe without
      // correcting; once motion stops, instant-correct any leftover gap from
      // rows that measured during the ride (a far Jump to Latest can land
      // hundreds of px short of the true bottom otherwise).
      const scrollInMotion = scrollEl.scrollTop !== lastScrollTop;
      lastScrollTop = scrollEl.scrollTop;
      if (!scrollInMotion) {
        if (
          isScrollNearBottom({
            scrollHeight: scrollEl.scrollHeight,
            scrollTop: scrollEl.scrollTop,
            clientHeight: scrollEl.clientHeight,
          })
        ) {
          stableTicks += 1;
          if (stableTicks >= 2) {
            stop();
            return;
          }
        } else {
          stableTicks = 0;
          scrollToBottom(scrollEl, 'instant');
        }
      } else {
        stableTicks = 0;
      }
      remainingTicks -= 1;
      if (remainingTicks > 0) {
        rafId = requestAnimationFrame(settle);
      } else {
        stop();
      }
    };
    userScrollIntentEvents.forEach((eventType) => {
      scrollEl.addEventListener(eventType, cancelOnUserScrollIntent, { passive: true });
    });
    rafId = requestAnimationFrame(settle);
    return stop;
  }, [roomScrollToBottomCount, scrollRef, scrollToBottomRef, threadBackViewport, threadId]);
  const threadPrependViewport = useThreadPrependViewport({
    controller: threadBackViewport,
    scrollRef,
  });
  const scrollThreadEventIntoView = useCallback(
    (eventId: string) => {
      const eventIndex = threadEventIndexMapRef.current.get(eventId);
      if (typeof eventIndex !== 'number') return false;
      threadSettleStopRef.current?.();
      roomTimelineVirtualizer.scrollToIndex(eventIndex, { align: 'center' });
      return true;
    },
    [roomTimelineVirtualizer, threadEventIndexMapRef]
  );
  const cancelThreadBottomSettle = useCallback(() => {
    threadSettleStopRef.current?.();
  }, []);
  const cancelRoomAutomaticFill = roomAutomaticFill.cancel;
  const scrollToTimelineItem = useCallback(
    (index: number, opts?: Parameters<typeof scrollToItem>[1]) => {
      if (index !== filteredLength - 1) cancelRoomAutomaticFill();
      if (threadId || index < activeTimelineRange.start || index >= activeTimelineRange.end) {
        return scrollToItem(index, opts);
      }

      if (getTimelineItemElement(index)) {
        return scrollToItem(index, opts);
      }

      roomTimelineVirtualizer.scrollToIndex(index - activeTimelineRange.start, {
        align: opts?.align ?? 'start',
        behavior: opts?.behavior === 'smooth' ? 'smooth' : 'auto',
      });
      return true;
    },
    [
      activeTimelineRange.end,
      activeTimelineRange.start,
      filteredLength,
      getTimelineItemElement,
      roomTimelineVirtualizer,
      scrollToItem,
      cancelRoomAutomaticFill,
      threadId,
    ]
  );

  const { handleOpenEvent, openRoomEventRoute } = useRoomEventOpenController({
    alive,
    effectiveViewMode,
    focusEventInRoom,
    hideMembershipEvents,
    hideNickAvatarEvents,
    ignoredUsersSet,
    mx,
    room,
    navigateRoomThread,
    overviewThreadRootIds,
    threadTargets,
    readUptoEventIdRef,
    recalibrateFilterOptsRef,
    roomOverviewOrderActive,
    roomThreadListThreads,
    prefetchDepth,
    prefetchDepthRef,
    cancelThreadBottomSettle,
    scheduledStatusMap,
    scrollRef,
    scrollThreadEventIntoView,
    scrollToBottomRef,
    scrollToElement,
    scrollToItem: scrollToTimelineItem,
    searchQuery: threadIndexSearchQuery,
    setFocusItem,
    notifyThreadEventsChanged: threadCommands.notifyEventsChanged,
    setTimeline,
    showHiddenEvents,
    threadEventIndexMapRef,
    threadFilteredEvents,
    threadFilterStateRef,
    threadId,
    threadParticipantMap,
    threadReplyCountMap,
    threadResolutionMap,
    threadSortControlSignature,
    threadSortFreezeState,
    threadSummaryInfoMap,
  });

  useRoomLiveRenderController({
    atBottomRef,
    atLiveEndRef,
    effectiveThreadFilterState,
    hideActivity,
    hideMembershipEvents,
    hideNickAvatarEvents,
    ignoredUsersSet,
    markLiveExpansionCandidate: messageFeature.markLiveExpansionCandidate,
    mx,
    normalThreadRecordMap,
    onStoreThreadSummary,
    room,
    roomThreadFilterActive,
    scrollRef,
    scrollToBottomRef,
    setSupplementalThreadEvents,
    observeLiveTail: threadCommands.observeLiveTail,
    notifyThreadEventsChanged: threadCommands.notifyEventsChanged,
    setTimeline,
    setUnreadInfo,
    showHiddenEvents,
    threadEventIndexMapRef,
    threadId,
    threadResolutionMap,
    timelineAtLiveEnd,
    unreadInfo,
  });

  const { minimapStripMap, minimapItems, handleMinimapSelect } = useRoomTimelineMinimap({
    minimapEvents: threadId ? threadEvents : threadFilteredEvents,
    showCompactRoomView,
    scrollRef,
    handleOpenEvent,
  });

  const buildRoomCacheHydratedTimeline = useCallback(
    () =>
      getInitialTimeline(room, prefetchDepthRef.current, {
        threadId: undefined,
        ignoredUsersSet: recalibrateFilterOptsRef.current?.ignoredUsersSet ?? new Set(),
        showHiddenEvents: recalibrateFilterOptsRef.current?.showHiddenEvents ?? false,
        hideMembershipEvents: recalibrateFilterOptsRef.current?.hideMembershipEvents ?? false,
        hideNickAvatarEvents: recalibrateFilterOptsRef.current?.hideNickAvatarEvents ?? false,
        showThreadRepliesInRoom: recalibrateFilterOptsRef.current?.showThreadRepliesInRoom,
      }),
    [room]
  );

  useRoomCacheHydrationController({
    alive,
    buildInitialTimeline: buildRoomCacheHydratedTimeline,
    eventId,
    mx,
    room,
    roomDebugTraceId,
    roomIdRef,
    scrollToBottomRef,
    sessionId,
    setAtBottom,
    setRoomInitialCacheHydratedKey,
    setTimeline,
    threadId,
    threadIdRef,
  });

  // Limited sync can replace the SDK live timeline with an unlinked chain.
  // Rebuild only an orphaned room view; thread/event routes own their timelines.
  useRoomTimelineResetRelink({
    room,
    threadId,
    eventId,
    timeline,
    rebuildTimeline: buildRoomCacheHydratedTimeline,
    setTimeline,
    isViewportAtBottomNow,
    scrollToBottomRef,
  });

  useThreadAwareTimelineRefresh({
    room,
    threadId,
    liveTimelineLinked,
    refreshLatestThreadSlice,
    onRoomRefresh: useCallback(() => {
      setTimeline(
        getInitialTimeline(room, prefetchDepth, {
          threadId,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
          showThreadRepliesInRoom,
        })
      );
    }, [
      room,
      threadId,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      showThreadRepliesInRoom,
      prefetchDepth,
    ]),
  });

  // Both toolbar variants share this wrapper, including its outside margins.
  useEffect(() => {
    const root = overlayRootRef.current;
    const overview = overviewRef.current;
    if (!root || !overview) return undefined;
    const measure = () =>
      root.style.setProperty('--room-overview-height', overview.offsetHeight + 'px');
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(overview);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--room-overview-height');
    };
  }, [shouldShowRoomThreadOverviewControls]);

  // Publish the whole footer inset before correcting bottom pinning. The
  // viewport stays full height, so its old bottom distance is still valid.
  // Observing the footer also covers approvals, uploads, and the safe area.
  useResizeObserver(
    useMemo(() => {
      let mounted = false;
      let previousHeight = 0;
      return (entries) => {
        const target = roomFooterRef?.current ?? roomInputRef.current;
        if (!target) return;
        const editorBaseEntry = getResizeObserverEntry(target, entries);
        if (!editorBaseEntry) return;
        const height = roomFooterRef ? target.offsetHeight : editorBaseEntry.contentRect.height;
        const wasPinned = isViewportAtBottomNow();
        if (roomFooterRef) {
          overlayRootRef.current?.style.setProperty('--room-footer-height', height + 'px');
          if (wasPinned && scrollRef.current) scrollToBottom(scrollRef.current);
          return;
        }
        const growth = Math.max(0, height - previousHeight);
        previousHeight = height;
        if (!mounted) {
          // skip initial mounting call
          mounted = true;
          return;
        }
        const scrollElement = getScrollElement();
        if (!scrollElement) return;

        // Live reading, not the ~1s-stale atBottom state (a composer resize
        // right after the user scrolled up must not yank them back down).
        // The growth slack reconstructs the pre-resize position: a composer
        // growing by d moves the bottom away by d for a pinned user.
        if (isViewportAtBottomNow(growth)) {
          scrollToBottom(scrollElement);
        }
      };
    }, [getScrollElement, isViewportAtBottomNow, roomInputRef, roomFooterRef]),
    useCallback(() => roomFooterRef?.current ?? roomInputRef.current, [roomFooterRef, roomInputRef])
  );
  // Live reply frames grow a message without the timeline event that pins the bottom.
  useFollowContentGrowth(
    getScrollElement,
    scrollContentRef,
    isViewportAtBottomNow,
    atLiveEndRef,
    getLiveReplyStore(mx),
    room.roomId
  );

  const { handleMarkAsRead } = useTimelineReadReceiptController({
    atBottom,
    atBottomAnchorRef,
    atBottomRef,
    atLiveEndRef,
    getScrollElement,
    handleOpenEvent,
    hideActivity,
    mx,
    readUptoEventIdRef,
    room,
    setAtBottom,
    threadEventsLength: threadEvents.length,
    threadId,
    threadInitialRenderMode,
    threadTailLoaded,
    timelineAtLiveEnd,
    unreadInfo,
  });

  useRoomEventRouteOpenController({
    effectiveViewMode,
    eventId,
    focusEventInRoom,
    openRoomEventRoute,
    roomId: room.roomId,
    roomOverviewOrderActive,
    threadId,
  });

  useThreadOpenLifecycleController({
    route: threadSnapshot.route,
    commands: threadCommands,
    runtime: threadOpenRuntime,
  });

  useRoomFocusScrollController({
    alive,
    atBottomAnchorRef,
    cancelThreadBottomSettle,
    editId: messageFeature.editingEventId,
    focusItem,
    focusScrollResetToken: effectiveThreadFilterState,
    threadTargets,
    pendingThreadOpenTick,
    retryPagination,
    roomId: room.roomId,
    scrollRef,
    scrollThreadEventIntoView,
    scrollToBottomRef,
    scrollToElement,
    scrollToItem: scrollToTimelineItem,
    setAtBottom,
    setFocusItem,
    suppressFocusPaginationRef,
    isThreadOpenBottomPinSuppressed,
    requestThreadOpenBottomPin,
    cancelThreadOpenBottomPin,
    shouldApplyThreadBottomPin: threadBackViewport.shouldApplyBottomPin,
    threadEventIndexMapRef,
    threadEventsLength: threadEvents.length,
    threadFilteredEvents,
    threadFilteredEventsRef,
    threadId,
    threadInitialRenderMode,
    threadLatestOpenPending,
    threadOpenedAtLatest: threadOpenedAtLatestRef.current,
    threadUserScrolled,
    threadTimelineTick,
    timelineAtLiveEnd,
    unreadInfo,
    unreadScrollAnchorIndex,
  });

  // Remove unreadInfo on mark as read
  useEffect(() => {
    if (!unread) {
      setUnreadInfo(undefined);
    }
  }, [unread]);

  const { handleJumpToLatest, handleJumpToUnread, handleOpenCompactThread, handleOpenReply } =
    useRoomTimelineNavigationController({
      classicRoomTimeline: showThreadRepliesInRoom,
      eventId,
      handleOpenEvent,
      hideMembershipEvents,
      hideNickAvatarEvents,
      ignoredUsersSet,
      navigateRoom,
      navigateRoomThread,
      room,
      prefetchDepth,
      scrollToBottomRef,
      setAtBottom,
      setTimeline,
      showHiddenEvents,
      showThreadRepliesInRoom,
      threadId,
      unreadInfo,
    });

  useThreadSummaryPublishController({
    onStoreThreadSummary,
    room,
    thread,
    threadEvents,
    threadId,
    threadSummaryInfoMap,
  });

  useThreadOverviewResumeController({
    alive,
    activeTimelineRange,
    compactFilteredThreadRootIds,
    compactViewRequested,
    debugTraceId: roomDebugTraceId,
    filteredThreadRootIds,
    limit: THREAD_OVERVIEW_METADATA_CACHE_LIMIT,
    mx,
    onApplyThreadRelations: applyThreadOverviewRelationEvents,
    onStoreThreadSummary,
    beginThreadCacheWrite,
    refreshCompactThreadList: refreshRoomThreadList,
    room,
    sessionId,
    setOverviewRefreshCounter,
    showCompactRoomView,
    threadFilteredEventEntries,
    threadId,
    threadIdRef,
    threadReplyCountMap,
    threadResolutionMap,
  });

  useThreadEditBackfillController({
    atLiveEndRef,
    eventId,
    forceTimelineUpdate,
    mx,
    beginThreadCacheWrite,
    room,
    scrollRef,
    scrollToBottomRef,
    notifyThreadEventsChanged: threadCommands.notifyEventsChanged,
    editResetEpoch,
    readEditResetEpoch: threadCommands.readEditResetEpoch,
    threadEvents,
    threadId,
    threadIdRef,
    threadTailLoaded,
  });

  bindThreadPaginationRuntime({
    mx,
    beginThreadCacheWrite,
    room,
    sessionId,
    thread,
    threadEvents,
    threadHasMoreCachedBack,
    viewport: threadPrependViewport,
  });
  const { paginateBack: handleThreadPaginateBack, paginateFront: handleThreadPaginateFront } =
    threadPagination;

  // Scroll-driven thread back-pagination (task #125). Threads bypass
  // useVirtualPaginator (its count is 0 for threads), so unlike the
  // room view they had NO scroll trigger — older content only arrived
  // via the "Load Older Messages" chip or background band fills, and
  // upward momentum scrolling hard-stopped at the loaded-window edge
  // on slow connections. This effect fires the SAME chip pipeline
  // (cache-first IDB page, network fallback, commit at scroll rest)
  // when the top of the rendered window comes within
  // THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS of the loaded edge.
  //
  // Guard inputs are STATE values, not refs (greptile P1 on PR #74):
  // the gating conditions must RE-RUN the effect when they change.
  // With refs in the dep array the identity is stable, so a
  // suppressed evaluation would never re-run without an index change.
  //
  // The "not an open-time artifact" gate is USER SCROLL INTENT, not
  // the open-lifecycle pending flag: threadLatestOpenPending stays
  // true until the whole open-time backfill chain completes (its
  // clear lives in the chain's finally), which on slow networks spans
  // the entire loading phase — exactly when a scrolling user needs
  // the trigger live. A real gesture (the same event set the
  // pin-settle loop watches) is both necessary and sufficient: before
  // any gesture, a low rendered index is the pre-pin transient and
  // must not fire; after one, the user is genuinely navigating.
  //
  // Barren-attempt guard (greptile P2): one fire per
  // (firstRenderedIndex, threadEvents.length) observation. If an
  // attempt completes without growing the loaded window (exhausted or
  // miscounted coverage upstream), the identical state must not
  // re-fire in a loop; the next fire requires the user to scroll
  // (index changes) or content to land (length changes).
  const threadFirstRenderedIndex = threadId
    ? roomTimelineVirtualizer.getVirtualItems()[0]?.index
    : undefined;
  // Bumped by a fresh gesture ONLY while a barren-attempt block is
  // armed (see below) — a renewed explicit user gesture is what
  // authorizes retrying after a no-progress attempt. Normal scrolling
  // never bumps it (zero extra renders on the hot path).
  const [threadAutoPaginateGestureTick, setThreadAutoPaginateGestureTick] = useState(0);
  const threadAutoPaginateLastFireRef = useRef<{ index: number; count: number } | null>(null);
  useEffect(() => {
    // Reset ONLY on thread change (coderabbit on PR #74: resetting on
    // render-mode transitions would wipe real user intent mid-open).
    setThreadUserScrolled(false);
    threadAutoPaginateLastFireRef.current = null;
  }, [threadId]);
  useEffect(() => {
    if (!threadId) return undefined;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return undefined;
    // 'touchstart' included: an iOS flick can produce scroll activity
    // before the first touchmove is seen, and user-scroll intent must
    // already be marked by then. pointerdown covers this on PointerEvent
    // browsers; touchstart is the belt for the rest.
    const gestureEvents = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const;
    const onGesture = () => {
      setThreadUserScrolled(true);
      // Renewed intent clears a barren block (greptile P1 round 2 on
      // PR #74): a no-progress attempt must not strand the user at
      // the edge while older history still exists — but retries are
      // paced by explicit gestures, so an exhausted-but-miscounted
      // coverage state cannot re-fire in an unattended loop either.
      if (threadAutoPaginateLastFireRef.current !== null) {
        threadAutoPaginateLastFireRef.current = null;
        setThreadAutoPaginateGestureTick((tick) => tick + 1);
      }
    };
    gestureEvents.forEach((eventType) => {
      scrollEl.addEventListener(eventType, onGesture, { passive: true });
    });
    return () => {
      gestureEvents.forEach((eventType) => {
        scrollEl.removeEventListener(eventType, onGesture);
      });
    };
    // threadInitialRenderMode: the scroll element mounts after the
    // loading placeholder phase; re-attach once real rows render.
  }, [threadId, threadInitialRenderMode]);
  useEffect(() => {
    if (
      !shouldAutoPaginateThreadBack({
        threadId,
        firstRenderedIndex: threadFirstRenderedIndex,
        paginatingBack: threadPaginatingBack,
        showLoadOlder: showThreadLoadOlderMessages,
        hasUserScrollIntent: threadUserScrolled,
        triggerRows: THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS,
      })
    ) {
      return;
    }
    const lastFire = threadAutoPaginateLastFireRef.current;
    if (
      lastFire &&
      lastFire.index === threadFirstRenderedIndex &&
      lastFire.count === threadEvents.length
    ) {
      return;
    }
    threadAutoPaginateLastFireRef.current = {
      index: threadFirstRenderedIndex as number,
      count: threadEvents.length,
    };
    countCacheProbe('threadAutoPaginateBackFired');
    handleThreadPaginateBack();
  }, [
    threadFirstRenderedIndex,
    threadId,
    showThreadLoadOlderMessages,
    threadPaginatingBack,
    threadUserScrolled,
    threadAutoPaginateGestureTick,
    threadEvents.length,
    handleThreadPaginateBack,
  ]);

  let prevEvent: MatrixEvent | undefined;
  let prevRenderedEventAbsoluteIndex: number | undefined;
  let isPrevRendered = false;
  let newDivider = false;
  let dayDivider = false;
  const renderResolvedEvent = (
    mEvent: MatrixEvent,
    item: number,
    timelineSet: EventTimelineSet,
    eventAbsoluteIndex?: number
  ) => {
    const mEventId = mEvent?.getId();

    if (!mEvent || !mEventId) return null;

    if (hiddenThreadEventIds.has(mEventId)) return null;

    const eventSender = mEvent.getSender();
    if (eventSender && ignoredUsersSet.has(eventSender)) {
      return null;
    }
    if (
      !threadId &&
      !showThreadRepliesInRoom &&
      mEvent.threadRootId &&
      mEvent.threadRootId !== mEventId
    ) {
      return null;
    }
    if (mEvent.isRedacted() && !showHiddenEvents) {
      return null;
    }

    // Suppress dividers when overview is active — chronological constructs don't apply
    if (!roomThreadFilterActive) {
      if (!newDivider) {
        newDivider = shouldRenderUnreadDividerAt({
          readUptoAbsoluteIndex,
          eventAbsoluteIndex,
          prevRenderedEventAbsoluteIndex,
        });
      }
      if (!dayDivider) {
        dayDivider = prevEvent ? !inSameDay(prevEvent.getTs(), mEvent.getTs()) : false;
      }
    }

    const collapsed =
      isPrevRendered &&
      !dayDivider &&
      (!newDivider || eventSender === mx.getUserId()) &&
      prevEvent !== undefined &&
      prevEvent.getSender() === eventSender &&
      prevEvent.getType() === mEvent.getType() &&
      minuteDifference(prevEvent.getTs(), mEvent.getTs()) < 2;

    const eventJSX = reactionOrEditEvent(mEvent)
      ? null
      : messageFeature.renderEvent(
          {
            eventId: mEventId,
            event: mEvent,
            index: item,
            timelineSet,
            collapse: collapsed,
            highlighted: focusItem?.index === item && !!focusItem.highlight,
            previousEventId: prevEvent?.getId(),
          },
          {
            threadRecordMap,
            threadEventMap,
            approvalTimeline,
            threadSummaryTimeline,
            handleOpenReply,
          }
        );
    prevEvent = mEvent;
    isPrevRendered = !!eventJSX;
    if (eventJSX) {
      prevRenderedEventAbsoluteIndex = eventAbsoluteIndex;
    }

    const newDividerJSX =
      newDivider && eventJSX && eventSender !== mx.getUserId() ? (
        <MessageBase space={messageSpacing}>
          <TimelineDivider style={{ color: color.Success.Main }} variant="Inherit">
            <Badge as="span" size="500" variant="Success" fill="Solid" radii="300">
              <Text size="L400">{t('mindroomUi.threads.mindroomRoomTimeline.newMessages')}</Text>
            </Badge>
          </TimelineDivider>
        </MessageBase>
      ) : null;

    const dayDividerJSX =
      dayDivider && eventJSX ? (
        <MessageBase space={messageSpacing}>
          <TimelineDivider variant="Surface">
            <Badge as="span" size="500" variant="Secondary" fill="None" radii="300">
              <Text size="L400">
                {(() => {
                  if (today(mEvent.getTs()))
                    return t('mindroomUi.threads.mindroomRoomTimeline.today');
                  if (yesterday(mEvent.getTs()))
                    return t('mindroomUi.threads.mindroomRoomTimeline.yesterday');
                  return timeDayMonthYear(mEvent.getTs());
                })()}
              </Text>
            </Badge>
          </TimelineDivider>
        </MessageBase>
      ) : null;

    if (eventJSX && (newDividerJSX || dayDividerJSX)) {
      if (newDividerJSX) newDivider = false;
      if (dayDividerJSX) dayDivider = false;

      return (
        <React.Fragment key={mEventId}>
          {newDividerJSX}
          {dayDividerJSX}
          {eventJSX}
        </React.Fragment>
      );
    }

    return eventJSX;
  };

  const eventRenderer = (item: number) => {
    const eventEntry = threadFilteredEventEntries[item];
    const mEvent = eventEntry?.event;
    if (!mEvent) return null;
    const mEventId = mEvent.getId();
    if (!mEventId) return null;
    const evtTimeline = room.getUnfilteredTimelineSet().getTimelineForEvent(mEventId);
    const timelineSet = evtTimeline?.getTimelineSet() ?? room.getUnfilteredTimelineSet();

    return renderResolvedEvent(mEvent, item, timelineSet, eventEntry.absoluteIndex);
  };

  const isRoomTimelinePrimeSkipped = (mEvent: MatrixEvent) => {
    const mEventId = mEvent.getId();
    const eventSender = mEvent.getSender();
    if (eventSender && ignoredUsersSet.has(eventSender)) return true;
    if (!showThreadRepliesInRoom && mEvent.threadRootId && mEvent.threadRootId !== mEventId) {
      return true;
    }
    return mEvent.isRedacted() && !showHiddenEvents;
  };

  const primeRoomTimelineRenderContextBefore = (item: number) => {
    const primed = primeTimelineRenderContextBefore(
      (index) => threadFilteredEventEntries[index]?.event,
      item,
      isRoomTimelinePrimeSkipped
    );
    if (!primed) return;
    prevEvent = primed.prevEvent;
    isPrevRendered = primed.isPrevRendered;
    if (!roomThreadFilterActive) {
      dayDivider = primed.pendingDayDivider;
    }
    // The sequential path advances prevRenderedEventAbsoluteIndex only on
    // rendered rows, so it comes from the nearest surviving non-edit entry —
    // possibly further back than prevEvent.
    for (let previousItem = item - 1; previousItem >= 0; previousItem -= 1) {
      const eventEntry = threadFilteredEventEntries[previousItem];
      const mEvent = eventEntry?.event;
      if (!mEvent || !mEvent.getId()) continue;
      if (isRoomTimelinePrimeSkipped(mEvent)) continue;
      if (reactionOrEditEvent(mEvent)) continue;
      prevRenderedEventAbsoluteIndex = eventEntry.absoluteIndex;
      return;
    }
  };

  const renderVirtualRoomTimelineItems = () => {
    const virtualItems = roomTimelineVirtualizer.getVirtualItems();
    const firstVirtualItem = virtualItems[0];
    const firstItem =
      firstVirtualItem !== undefined ? timelineItems[firstVirtualItem.index] : undefined;
    if (firstItem !== undefined) {
      primeRoomTimelineRenderContextBefore(firstItem);
    }

    return (
      <div
        ref={virtualInnerRef}
        data-testid="room-virtual-inner"
        aria-busy={roomAutomaticFill.hideInitialRows || undefined}
        style={{
          visibility: roomAutomaticFill.hideInitialRows ? 'hidden' : undefined,
          height: roomTimelineVirtualizer.getTotalSize(),
          position: 'relative',
          width: '100%',
        }}
      >
        {virtualItems.map((virtualItem) => {
          const item = timelineItems[virtualItem.index];
          if (item === undefined) return null;

          return (
            <VirtualTile
              key={virtualItem.key}
              ref={measureTimelineElement}
              virtualItem={virtualItem}
              // Content-relative top: virtualItem.start includes the
              // scrollMargin option (the negative offset-ledger snapshot),
              // which the container's marginTop already applies in
              // the DOM — keeping start verbatim would double-count the
              // ledger and push the painted tiles out from under the
              // computed window (the sustained-ride e2e's blank bands at
              // ~2000px accumulation). Adding the ref back subtracts the
              // same render's margin exactly.
              style={{ top: virtualItem.start + ledgerPxAtRender }}
            >
              {eventRenderer(item)}
            </VirtualTile>
          );
        })}
      </div>
    );
  };

  const primeThreadTimelineRenderContextBefore = (index: number) => {
    const primed = primeTimelineRenderContextBefore(
      (previousIndex) => threadEvents[previousIndex],
      index,
      (mEvent) => {
        if (hiddenThreadEventIds.has(mEvent.getId() ?? '')) return true;
        const eventSender = mEvent.getSender();
        if (eventSender && ignoredUsersSet.has(eventSender)) return true;
        return mEvent.isRedacted() && !showHiddenEvents;
      }
    );
    if (!primed) return;
    prevEvent = primed.prevEvent;
    isPrevRendered = primed.isPrevRendered;
    if (!roomThreadFilterActive) {
      dayDivider = primed.pendingDayDivider;
    }
  };

  const threadEventRenderer = (index: number) => {
    const mEvent = threadEvents[index];
    if (!mEvent) return null;
    const mEventId = mEvent.getId();
    if (!mEventId) return null;
    return renderResolvedEvent(mEvent, index, getThreadEventTimelineSet(mEventId));
  };

  const renderVirtualThreadTimelineItems = () => {
    const virtualItems = roomTimelineVirtualizer.getVirtualItems();
    const firstVirtualItem = virtualItems[0];
    if (firstVirtualItem !== undefined) {
      primeThreadTimelineRenderContextBefore(firstVirtualItem.index);
    }

    return (
      <div
        ref={virtualInnerRef}
        data-thread-count={threadEvents.length}
        style={{
          height: roomTimelineVirtualizer.getTotalSize(),
          position: 'relative',
          width: '100%',
        }}
      >
        {virtualItems
          .filter((item) => !hiddenThreadEventIds.has(threadEvents[item.index]?.getId() ?? ''))
          .map((virtualItem) => {
            // Advance grouping/day-divider context even for null-rendering
            // relations, but do not mount and measure an empty tile for every
            // streaming edit. Their size estimate is already exactly zero.
            const content = threadEventRenderer(virtualItem.index);
            const event = threadEvents[virtualItem.index];
            // A decrypted relation can retain an encrypted row's cached
            // height. Keep that tile until ResizeObserver corrects it to zero.
            if (event && reactionOrEditEvent(event) && virtualItem.size === 0) return null;

            return (
              <VirtualTile
                key={virtualItem.key}
                ref={measureTimelineElement}
                virtualItem={virtualItem}
                // Content-relative top — see renderVirtualRoomTimelineItems.
                style={{ top: virtualItem.start + ledgerPxAtRender }}
              >
                {content}
              </VirtualTile>
            );
          })}
      </div>
    );
  };

  const timelineView = messageFeature.wrapExpansion(
    <Box ref={overlayRootRef} grow="Yes" direction="Column" style={{ position: 'relative' }}>
      {shouldShowRoomThreadOverviewControls && (
        <div ref={overviewRef} className={overlay.Overview}>
          <RoomThreadOverview
            hasMindroomAgents={hasMindroomAgents}
            threadCount={
              showCompactRoomView
                ? compactFilteredThreadRootIds.length
                : filteredThreadRootIds.length
            }
            totalThreadCount={
              showCompactRoomView
                ? compactThreadRootData.ids.length
                : visibleThreadRootData.ids.length
            }
            statusCounts={statusCounts}
            tagCounts={tagCounts}
            state={liveThreadFilterState}
            availableTags={availableRoomTags}
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            isThreadSortFrozen={threadSortFreezeState !== null}
            onToggle={onToggle}
            onSortDirectionChange={onSortDirectionChange}
            onToggleThreadSortFreeze={onToggleThreadSortFreeze}
            onToggleUnresolvedOnly={onToggleUnresolvedOnly}
            onReset={onReset}
            onCycleTag={onCycleTag}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
            onApplyPreset={onApplyPreset}
            onSearchQueryChange={onSearchQueryChange}
          />
        </div>
      )}
      <Box grow="Yes" style={{ position: 'relative' }}>
        {showCompactRoomView ? (
          <CompactRoomView
            room={room}
            threadRootIds={overviewThreadRootIds}
            threadRecordMap={threadRecordMap}
            onThreadClick={handleOpenCompactThread}
            compactRoomScrollStateRef={compactRoomScrollStateRef}
          />
        ) : (
          <>
            {!threadId && unreadInfo?.readUptoEventId && !unreadInfo?.inLiveTimeline && (
              <TimelineFloat position="Top">
                <Chip
                  variant="Primary"
                  radii="Pill"
                  before={<Icon size="50" src={Icons.MessageUnread} />}
                  onClick={handleJumpToUnread}
                >
                  <Text size="L400">
                    {t('mindroomUi.threads.mindroomRoomTimeline.jumpToUnread')}
                  </Text>
                </Chip>

                <Chip
                  variant="SurfaceVariant"
                  radii="Pill"
                  before={<Icon size="50" src={Icons.CheckTwice} />}
                  onClick={handleMarkAsRead}
                >
                  <Text size="L400">{t('mindroomUi.threads.mindroomRoomTimeline.markAsRead')}</Text>
                </Chip>
              </TimelineFloat>
            )}
            {!threadHeader && (
              <div
                style={{ position: 'absolute', top: overlay.topInset, insetInline: 0, zIndex: 2 }}
              >
                {messageFeature.expansionControl}
              </div>
            )}
            <Scroll
              ref={scrollRef}
              className={overlay.Scroll}
              visibility="Hover"
              style={{ overflowAnchor: threadId ? 'none' : 'auto' }}
            >
              <Box
                ref={scrollContentRef}
                direction="Column"
                justifyContent={threadId ? 'Start' : 'End'}
                style={{
                  minHeight: '100%',
                  paddingTop: threadHeader
                    ? overlay.topInset
                    : `calc(${overlay.topInset} + ${config.space.S600})`,
                  position: 'relative',
                }}
              >
                {threadHeader && (
                  <ThreadTimelineHeader
                    onResize={holdThreadBannerResize}
                    scrollRef={scrollRef}
                    expansionControl={messageFeature.expansionControl}
                  >
                    {threadHeader}
                  </ThreadTimelineHeader>
                )}
                {!threadId &&
                  !roomHasMoreCachedBack &&
                  !canPaginateBack &&
                  rangeAtStart &&
                  timelineItems.length > 0 && (
                    <div
                      style={{
                        padding: `${config.space.S700} ${config.space.S400} ${config.space.S600} ${
                          messageLayout === MessageLayout.Compact ? config.space.S400 : toRem(64)
                        }`,
                      }}
                    >
                      <RoomIntro room={room} />
                    </div>
                  )}
                {threadId && (
                  <Box ref={threadLeadingRef} direction="Column">
                    {threadLoadError && (
                      <MessageBase space={messageSpacing}>
                        <TimelineDivider variant="Surface">
                          <Badge as="span" size="500" variant="Critical" fill="None" radii="300">
                            <Text size="L400">
                              {t('mindroomUi.threads.mindroomRoomTimeline.failedToLoadThisThread')}
                            </Text>
                          </Badge>
                        </TimelineDivider>
                      </MessageBase>
                    )}
                    {showThreadLoadOlderMessages && (
                      <MessageBase space={messageSpacing}>
                        <TimelineDivider variant="Surface">
                          <Chip
                            variant="SurfaceVariant"
                            radii="Pill"
                            before={<Icon size="50" src={Icons.ArrowTop} />}
                            onClick={handleThreadPaginateBack}
                          >
                            <Text size="L400">
                              {threadPaginatingBack
                                ? t('mindroomUi.threads.mindroomRoomTimeline.loading')
                                : t('mindroomUi.threads.mindroomRoomTimeline.loadOlderMessages')}
                            </Text>
                          </Chip>
                        </TimelineDivider>
                      </MessageBase>
                    )}
                  </Box>
                )}
                {threadId &&
                  threadInitialRenderMode === 'loading' &&
                  !threadLoadError &&
                  (messageLayout === MessageLayout.Compact ? (
                    <>
                      <MessageBase>
                        <CompactPlaceholder />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder />
                      </MessageBase>
                    </>
                  ) : (
                    <>
                      <MessageBase>
                        <DefaultPlaceholder />
                      </MessageBase>
                      <MessageBase>
                        <DefaultPlaceholder />
                      </MessageBase>
                    </>
                  ))}
                {!threadId &&
                  (roomHasMoreCachedBack || canPaginateBack || !rangeAtStart) &&
                  (messageLayout === MessageLayout.Compact ? (
                    <>
                      <MessageBase>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase ref={observeBackAnchor}>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                    </>
                  ) : (
                    <>
                      <MessageBase>
                        <DefaultPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <DefaultPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase ref={observeBackAnchor}>
                        <DefaultPlaceholder key={timelineItems.length} />
                      </MessageBase>
                    </>
                  ))}

                {threadId ? renderVirtualThreadTimelineItems() : renderVirtualRoomTimelineItems()}
                {threadId && canPaginateThreadFront && (
                  <MessageBase space={messageSpacing}>
                    <TimelineDivider variant="Surface">
                      <Chip
                        variant="SurfaceVariant"
                        radii="Pill"
                        before={<Icon size="50" src={Icons.ArrowBottom} />}
                        onClick={handleThreadPaginateFront}
                      >
                        <Text size="L400">
                          {threadPaginatingFront
                            ? t('mindroomUi.threads.mindroomRoomTimeline.loading')
                            : t('mindroomUi.threads.mindroomRoomTimeline.loadNewerMessages')}
                        </Text>
                      </Chip>
                    </TimelineDivider>
                  </MessageBase>
                )}

                {!threadId &&
                  (!liveTimelineLinked || !rangeAtEnd) &&
                  (messageLayout === MessageLayout.Compact ? (
                    <>
                      <MessageBase ref={observeFrontAnchor}>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                    </>
                  ) : (
                    <>
                      <MessageBase ref={observeFrontAnchor}>
                        <DefaultPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <DefaultPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <DefaultPlaceholder key={timelineItems.length} />
                      </MessageBase>
                    </>
                  ))}
                <div
                  aria-hidden="true"
                  style={{
                    height: `calc(${overlay.footerInset} + ${config.space.S600})`,
                    flexShrink: 0,
                  }}
                />
                <span ref={atBottomAnchorRef} />
              </Box>
              <InsetScrollbar
                scrollRef={scrollRef}
                contentRef={scrollContentRef}
                className={overlay.Scrollbar}
                label={t('threadNav.messages')}
              />
            </Scroll>
            <TimelineMinimap
              items={minimapItems}
              stripMap={minimapStripMap}
              onSelect={handleMinimapSelect}
            />
            {!atBottom && (
              <TimelineFloat position="Bottom">
                <Chip
                  variant="SurfaceVariant"
                  radii="Pill"
                  before={<Icon size="50" src={Icons.ArrowBottom} />}
                  onClick={handleJumpToLatest}
                >
                  <Text size="L400">
                    {t('mindroomUi.threads.mindroomRoomTimeline.jumpToLatest')}
                  </Text>
                </Chip>
              </TimelineFloat>
            )}
          </>
        )}
      </Box>
    </Box>
  );
  return (
    <ThreadConversationCostProvider value={threadConversationCost}>
      {timelineView}
    </ThreadConversationCostProvider>
  );
}
