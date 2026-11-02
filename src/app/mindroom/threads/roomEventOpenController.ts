import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { NavigateOptions } from 'react-router-dom';
import type { EventTimeline, MatrixClient, MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import to from 'await-to-js';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import type { ScrollToElement, ScrollToItem } from '../../hooks/useVirtualPaginator';
import type { RoomViewMode } from './roomViewMode';
import type { ThreadFilterState, ThreadSortFreezeState } from './roomThreadOverviewModel';
import { getRenderableEventEntries } from './roomTimelineEvents';
import {
  getEmptyTimeline,
  getInitialTimeline,
  type RecalibrateFilterOpts,
  type Timeline,
} from './timelinePagination';
import {
  getEventElementById,
  getTimelineTargetAnchor,
  getUnreadTargetAnchor,
} from './timelineScrollUtils';
import { useEventTimelineLoader } from './timelinePaginationController';
import {
  fetchRoomEventThreadRootId,
  isRoomEventThreadRedirectActive,
  resolveRoomEventThreadRedirect,
} from './roomDeepLink';
import { getRoomEventFocusTarget } from './threadRoomFocus';
import { buildVisibleThreadReplyCountMap, eventBelongsToThread } from './threadUtils';
import type { ThreadTargetCommands } from './session/threadSessionTypes';
import type { ThreadScheduledStatus } from './threadScheduledStatus';
import type { ThreadResolutionState } from './useRoomThreadTags';

type FocusItemState = {
  eventId?: string;
  highlight: boolean;
  index: number;
  scrollTo: boolean;
};

export type OpenRoomEventHandler = (
  eventId: string,
  highlight?: boolean,
  onScroll?: (scrolled: boolean) => void
) => Promise<void>;

export type OpenRoomEventRoute = (eventId: string, isCurrentRoute: () => boolean) => Promise<void>;

export const useRoomEventOpenController = ({
  alive,
  cancelThreadBottomSettle,
  effectiveViewMode,
  focusEventInRoom,
  hideMembershipEvents,
  hideNickAvatarEvents,
  ignoredUsersSet,
  mx,
  navigateRoomThread,
  overviewThreadRootIds,
  threadTargets,
  readUptoEventIdRef,
  recalibrateFilterOptsRef,
  room,
  roomOverviewOrderActive,
  roomThreadListThreads,
  prefetchDepth,
  prefetchDepthRef,
  scheduledStatusMap,
  scrollRef,
  scrollThreadEventIntoView,
  scrollToBottomRef,
  scrollToElement,
  scrollToItem,
  searchQuery,
  setFocusItem,
  notifyThreadEventsChanged,
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
}: {
  alive: () => boolean;
  cancelThreadBottomSettle?: () => void;
  effectiveViewMode: RoomViewMode;
  focusEventInRoom?: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  ignoredUsersSet: Set<string>;
  mx: MatrixClient;
  navigateRoomThread: (
    roomId: string,
    threadId: string,
    eventId?: string,
    opts?: NavigateOptions
  ) => void;
  overviewThreadRootIds: string[];
  threadTargets: ThreadTargetCommands;
  readUptoEventIdRef: MutableRefObject<string | undefined>;
  recalibrateFilterOptsRef: MutableRefObject<RecalibrateFilterOpts | undefined>;
  room: Room;
  roomOverviewOrderActive: boolean;
  roomThreadListThreads: Thread[];
  prefetchDepth: number;
  prefetchDepthRef: MutableRefObject<number>;
  scheduledStatusMap: Map<string, ThreadScheduledStatus>;
  scrollRef: RefObject<HTMLElement>;
  scrollThreadEventIntoView?: (eventId: string) => boolean;
  scrollToBottomRef: MutableRefObject<{ count: number; smooth: boolean }>;
  scrollToElement: ScrollToElement;
  scrollToItem: ScrollToItem;
  searchQuery: string;
  setFocusItem: Dispatch<SetStateAction<FocusItemState | undefined>>;
  notifyThreadEventsChanged: () => void;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  showHiddenEvents: boolean;
  threadEventIndexMapRef: MutableRefObject<Map<string, number>>;
  threadFilteredEvents: MatrixEvent[];
  threadFilterStateRef: MutableRefObject<ThreadFilterState>;
  threadId?: string;
  threadParticipantMap: Map<string, string[]>;
  threadReplyCountMap: Map<string, number>;
  threadResolutionMap: Map<string, ThreadResolutionState>;
  threadSortControlSignature: string;
  threadSortFreezeState: ThreadSortFreezeState | null;
  threadSummaryInfoMap: Map<string, MindroomThreadSummaryInfo>;
}): {
  handleOpenEvent: OpenRoomEventHandler;
  openRoomEventRoute: OpenRoomEventRoute;
} => {
  const threadJumpGenerationRef = useRef(0);

  const redirectRoomEventDeepLink = useCallback(
    (targetEventId: string, linkedTimelines?: EventTimeline[]): boolean => {
      if (effectiveViewMode === 'classic') {
        return false;
      }

      const threadTarget = resolveRoomEventThreadRedirect({
        eventId: targetEventId,
        room,
        linkedTimelines,
        roomThreads: roomThreadListThreads,
        roomOverviewOrderActive,
        threadId,
        focusEventInRoom,
      });
      if (!threadTarget) {
        return false;
      }

      navigateRoomThread(room.roomId, threadTarget.threadId, threadTarget.eventId, {
        replace: true,
      });
      return true;
    },
    [
      focusEventInRoom,
      effectiveViewMode,
      navigateRoomThread,
      room,
      roomOverviewOrderActive,
      roomThreadListThreads,
      threadId,
    ]
  );

  const loadEventTimeline = useEventTimelineLoader(
    mx,
    room,
    useCallback(
      (evtId, linkedTimelines, eventAbsoluteIndex) => {
        if (!alive()) return;
        if (redirectRoomEventDeepLink(evtId, linkedTimelines)) {
          return;
        }
        const filterOpts = recalibrateFilterOptsRef.current;
        const renderableEntries = getRenderableEventEntries(
          linkedTimelines,
          room,
          threadId,
          filterOpts?.ignoredUsersSet ?? ignoredUsersSet,
          filterOpts?.showHiddenEvents ?? showHiddenEvents,
          filterOpts?.hideMembershipEvents ?? hideMembershipEvents,
          filterOpts?.hideNickAvatarEvents ?? hideNickAvatarEvents,
          filterOpts?.showThreadRepliesInRoom ?? effectiveViewMode === 'classic'
        );
        const loadedRenderableEvents = renderableEntries.map(({ event }) => event);
        const loadedThreadReplyCountMap = buildVisibleThreadReplyCountMap(
          linkedTimelines.flatMap((timeline) => timeline.getEvents())
        );
        const anchor =
          evtId === readUptoEventIdRef.current
            ? getUnreadTargetAnchor({
                renderableEntries,
                eventId: evtId,
                absoluteIndex: eventAbsoluteIndex,
              })
            : getTimelineTargetAnchor({
                linkedTimelines,
                renderableEntries,
                eventId: evtId,
                absoluteIndex: eventAbsoluteIndex,
              });
        const {
          index: focusIndex,
          count,
          canFocus,
        } = anchor
          ? getRoomEventFocusTarget({
              eventId: anchor.eventId,
              renderableEvents: loadedRenderableEvents,
              room,
              threadResolutionMap,
              threadId,
              threadFilterState: threadFilterStateRef.current,
              threadReplyCountMap: loadedThreadReplyCountMap,
              scheduledStatusMap,
              threadReplyCountMapForMeta: threadReplyCountMap,
              threadParticipantMap,
              summaryMap: threadSummaryInfoMap,
              currentUserId: mx.getSafeUserId(),
              searchQuery,
              threadSortFreezeState,
              threadSortControlSignature,
              viewMode: effectiveViewMode,
              roomThreads: roomThreadListThreads,
              orderedRoomOverviewEventIds: roomOverviewOrderActive
                ? overviewThreadRootIds
                : undefined,
            })
          : {
              index: 0,
              count: loadedRenderableEvents.length,
              canFocus: false,
            };

        setFocusItem(
          anchor && canFocus
            ? {
                eventId: anchor.eventId,
                index: focusIndex,
                scrollTo: !threadId,
                highlight: evtId !== readUptoEventIdRef.current,
              }
            : undefined
        );
        setTimeline({
          linkedTimelines,
          range: {
            start: Math.max(focusIndex - prefetchDepthRef.current, 0),
            end: Math.min(focusIndex + prefetchDepthRef.current, count),
          },
        });
      },
      [
        alive,
        effectiveViewMode,
        hideMembershipEvents,
        hideNickAvatarEvents,
        ignoredUsersSet,
        mx,
        overviewThreadRootIds,
        readUptoEventIdRef,
        recalibrateFilterOptsRef,
        redirectRoomEventDeepLink,
        room,
        roomOverviewOrderActive,
        roomThreadListThreads,
        prefetchDepthRef,
        searchQuery,
        scheduledStatusMap,
        setFocusItem,
        setTimeline,
        showHiddenEvents,
        threadFilterStateRef,
        threadId,
        threadParticipantMap,
        threadReplyCountMap,
        threadResolutionMap,
        threadSortControlSignature,
        threadSortFreezeState,
        threadSummaryInfoMap,
      ]
    ),
    useCallback(() => {
      if (!alive()) return;
      const filterOpts = recalibrateFilterOptsRef.current;
      setTimeline(
        getInitialTimeline(room, prefetchDepth, {
          threadId,
          ignoredUsersSet: filterOpts?.ignoredUsersSet ?? ignoredUsersSet,
          showHiddenEvents: filterOpts?.showHiddenEvents ?? showHiddenEvents,
          hideMembershipEvents: filterOpts?.hideMembershipEvents ?? hideMembershipEvents,
          hideNickAvatarEvents: filterOpts?.hideNickAvatarEvents ?? hideNickAvatarEvents,
          showThreadRepliesInRoom:
            filterOpts?.showThreadRepliesInRoom ?? effectiveViewMode === 'classic',
        })
      );
      scrollToBottomRef.current.count += 1;
      scrollToBottomRef.current.smooth = false;
    }, [
      alive,
      effectiveViewMode,
      hideMembershipEvents,
      hideNickAvatarEvents,
      ignoredUsersSet,
      recalibrateFilterOptsRef,
      room,
      prefetchDepth,
      scrollToBottomRef,
      setTimeline,
      showHiddenEvents,
      threadId,
    ])
  );

  const handleOpenEvent = useCallback<OpenRoomEventHandler>(
    async (evtId, highlight = true, onScroll = undefined) => {
      if (threadId && evtId !== threadId) {
        // The render index map is authoritative thread membership: events
        // loaded through the MindRoom thread cache may be absent from the SDK
        // room/thread structures that findEventById searches.
        const isRenderedThreadEvent = threadEventIndexMapRef.current.has(evtId);
        if (!isRenderedThreadEvent) {
          const targetEvent = room.findEventById(evtId);
          if (!targetEvent || !eventBelongsToThread(targetEvent, threadId)) {
            if (onScroll) onScroll(false);
            return;
          }
        }
      }

      if (threadId) {
        const threadItemIndex = threadEventIndexMapRef.current.get(evtId);
        if (typeof threadItemIndex === 'number') {
          cancelThreadBottomSettle?.();
          // Every jump supersedes any prior jump's retry chain — including
          // mounted-target jumps, which otherwise lose to a stale
          // unmounted-target chain still scrolling toward the older target.
          threadJumpGenerationRef.current += 1;
          const target = getEventElementById(scrollRef.current, evtId);
          setFocusItem({
            eventId: evtId,
            index: threadItemIndex,
            scrollTo: false,
            highlight,
          });
          if (target) {
            scrollToElement(target, {
              behavior: 'smooth',
              align: 'center',
              stopInView: true,
            });
            if (onScroll) onScroll(true);
            return;
          }
          // Under thread virtualization a loaded-but-distant row is unmounted;
          // scroll its virtual index into view and retry until the row mounts.
          // The virtualizer positions by estimated row heights, so a distant
          // jump converges over a few re-issued scrolls as freshly mounted
          // rows report their real sizes.
          if (scrollThreadEventIntoView?.(evtId)) {
            const generation = threadJumpGenerationRef.current;
            let attempts = 0;
            const retryScrollToMountedTarget = () => {
              if (!alive() || threadJumpGenerationRef.current !== generation) return;
              const retryTarget = getEventElementById(scrollRef.current, evtId);
              if (retryTarget) {
                scrollToElement(retryTarget, {
                  behavior: 'smooth',
                  align: 'center',
                  stopInView: true,
                });
                if (onScroll) onScroll(true);
                return;
              }
              attempts += 1;
              if (attempts < 12) {
                scrollThreadEventIntoView(evtId);
                requestAnimationFrame(retryScrollToMountedTarget);
                return;
              }
              if (onScroll) onScroll(false);
            };
            requestAnimationFrame(retryScrollToMountedTarget);
            return;
          }
          if (onScroll) onScroll(false);
          return;
        }
      }

      const filteredIndex = threadFilteredEvents.findIndex((event) => event.getId() === evtId);

      if (filteredIndex !== -1) {
        const scrolled = scrollToItem(filteredIndex, {
          behavior: 'smooth',
          align: 'center',
          stopInView: true,
        });
        if (onScroll) onScroll(scrolled);
        setFocusItem({
          eventId: evtId,
          index: filteredIndex,
          scrollTo: false,
          highlight,
        });
      } else {
        if (threadId) {
          let currentThreadTimelineSet = room.getThread(threadId)?.getUnfilteredTimelineSet();
          const expectedThreadId = threadId;
          if (!currentThreadTimelineSet) {
            const [threadErr] = await to(
              mx.getThreadTimeline(room.getUnfilteredTimelineSet(), threadId)
            );
            if (threadErr) {
              if (onScroll) onScroll(false);
              return;
            }
            currentThreadTimelineSet =
              room.getThread(threadId)?.getUnfilteredTimelineSet() ??
              room.getUnfilteredTimelineSet();
          }
          const [err, threadEventTimeline] = await to(
            mx.getEventTimeline(currentThreadTimelineSet, evtId)
          );
          if (err || !threadEventTimeline) {
            if (onScroll) onScroll(false);
            return;
          }
          threadTargets.queue({
            threadId: expectedThreadId,
            eventId: evtId,
            highlight,
            onScroll,
          });
          setTimeline((currentTimeline) => ({ ...currentTimeline }));
          notifyThreadEventsChanged();
          return;
        }
        setTimeline(getEmptyTimeline());
        await loadEventTimeline(evtId);
      }
    },
    [
      alive,
      cancelThreadBottomSettle,
      loadEventTimeline,
      mx,
      threadTargets,
      room,
      scrollRef,
      scrollThreadEventIntoView,
      scrollToElement,
      scrollToItem,
      setFocusItem,
      notifyThreadEventsChanged,
      setTimeline,
      threadEventIndexMapRef,
      threadFilteredEvents,
      threadId,
    ]
  );

  // The SDK loads no room timeline at a thread reply, so a route to a reply that is not
  // loaded asks the server for its thread before anything replaces the room timeline;
  // an answer for a route that has since changed is dropped.
  const openRoomEventRoute = useCallback<OpenRoomEventRoute>(
    async (targetEventId, isCurrentRoute) => {
      if (redirectRoomEventDeepLink(targetEventId)) return;

      if (
        effectiveViewMode !== 'classic' &&
        isRoomEventThreadRedirectActive({ focusEventInRoom, threadId, roomOverviewOrderActive }) &&
        !room.findEventById(targetEventId)
      ) {
        const threadRootId = await fetchRoomEventThreadRootId(mx, room.roomId, targetEventId);
        if (!alive() || !isCurrentRoute()) return;
        if (threadRootId) {
          navigateRoomThread(room.roomId, threadRootId, targetEventId, { replace: true });
          return;
        }
      }

      await handleOpenEvent(targetEventId);
    },
    [
      alive,
      effectiveViewMode,
      focusEventInRoom,
      handleOpenEvent,
      mx,
      navigateRoomThread,
      redirectRoomEventDeepLink,
      room,
      roomOverviewOrderActive,
      threadId,
    ]
  );

  return { handleOpenEvent, openRoomEventRoute };
};

export const useRoomEventRouteOpenController = ({
  effectiveViewMode,
  eventId,
  focusEventInRoom,
  openRoomEventRoute,
  roomId,
  roomOverviewOrderActive,
  threadId,
}: {
  effectiveViewMode: RoomViewMode;
  eventId?: string;
  focusEventInRoom?: boolean;
  openRoomEventRoute: OpenRoomEventRoute;
  roomId: string;
  roomOverviewOrderActive: boolean;
  threadId?: string;
}) => {
  const openRoomEventRouteRef = useRef(openRoomEventRoute);
  // One object per open, so a route that leaves and comes back starts a new open.
  const handledRoomEventRouteRef = useRef<{ key: string }>();

  useEffect(() => {
    openRoomEventRouteRef.current = openRoomEventRoute;
  }, [openRoomEventRoute]);

  useEffect(() => {
    if (!eventId) {
      handledRoomEventRouteRef.current = undefined;
      return;
    }

    const routeKey = [
      roomId,
      threadId ?? '',
      eventId,
      focusEventInRoom ? '1' : '0',
      effectiveViewMode,
      roomOverviewOrderActive ? '1' : '0',
    ].join('|');

    if (handledRoomEventRouteRef.current?.key === routeKey) {
      return;
    }

    const routeOpen = { key: routeKey };
    handledRoomEventRouteRef.current = routeOpen;

    void openRoomEventRouteRef.current(
      eventId,
      () => handledRoomEventRouteRef.current === routeOpen
    );
  }, [effectiveViewMode, eventId, focusEventInRoom, roomId, roomOverviewOrderActive, threadId]);
};
