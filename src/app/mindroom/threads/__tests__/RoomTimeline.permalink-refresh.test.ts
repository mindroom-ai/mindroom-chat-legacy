import React from 'react';
import { RoomEvent } from 'matrix-js-sdk';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  compactPlaceholderType,
  create,
  createControlledRoomTimelineHarness,
  DEFAULT_THREAD_FILTER_STATE,
  flushAsyncWork,
  getRenderedEventIds,
  isTimelineAtLiveEndMock,
  makeEvent,
  makeRoom,
  makeTimeline,
  matrixClientMock,
  navigateRoomThreadMock,
  roomTimelineVirtualizerState,
  roomThreadListThreadsMock,
  roomThreadOverviewType,
  scrollType,
  setThreadAwareTimelineRefreshHook,
  TEST_DEFAULT_THREAD_FILTER_STATE,
  threadLastActivityTsMapMock,
  threadResolutionMapMock,
  TimelineRefreshHarness,
} from '../test-utils/RoomTimeline.test.shared';

describe('RoomTimeline', () => {
  describe('permalink focus and timeline refresh', () => {
    describe('permalink targeting', () => {
      it('computes room-event focus against the active thread-filtered room list', async () => {
        const { getRoomEventFocusTarget } = await import('../threadRoomFocus');
        const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
        const messageEvent = makeEvent('$message-1');
        const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
        const room = makeRoom();

        expect(
          getRoomEventFocusTarget({
            eventId: secondThread.getId(),
            renderableEvents: [firstThread, messageEvent, secondThread] as never,
            room: room as never,
            threadResolutionMap: threadResolutionMapMock as never,
            threadId: undefined,
            threadFilterState: {
              ...DEFAULT_THREAD_FILTER_STATE,
              resolved: 'exclude' as const,
              tags: new Map(),
            },
            scheduledStatusMap: new Map(),
            threadReplyCountMapForMeta: new Map(),
            threadParticipantMap: new Map(),
            summaryMap: new Map(),
            currentUserId: '@alice:example.org',
          })
        ).toEqual({
          index: 1,
          count: 2,
          canFocus: true,
        });
      }, 10000);

      it('uses canonical free-text search when no searchQuery override is passed', async () => {
        const { getRoomEventFocusTarget } = await import('../threadRoomFocus');
        const matchingThread = makeEvent('$thread-1', {
          isThreadRoot: true,
          content: { body: 'hello world' },
        });
        const otherThread = makeEvent('$thread-2', {
          isThreadRoot: true,
          content: { body: 'other body' },
        });

        expect(
          getRoomEventFocusTarget({
            eventId: matchingThread.getId(),
            renderableEvents: [matchingThread, otherThread] as never,
            room: makeRoom() as never,
            threadResolutionMap: threadResolutionMapMock as never,
            threadId: undefined,
            threadFilterState: {
              ...DEFAULT_THREAD_FILTER_STATE,
              tags: new Map(),
              freeText: 'hello',
            },
            scheduledStatusMap: new Map(),
            threadReplyCountMapForMeta: new Map(),
            threadParticipantMap: new Map(),
            summaryMap: new Map(),
            currentUserId: '@alice:example.org',
          })
        ).toEqual({
          index: 0,
          count: 1,
          canFocus: true,
        });
      });

      it('computes room-event focus against the frozen overview order', async () => {
        const { getRoomEventFocusTarget } = await import('../threadRoomFocus');
        const { createThreadSortControlSignature } = await import('../roomThreadOverviewModel');
        const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
        const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
        const thirdThread = makeEvent('$thread-3', { isThreadRoot: true });
        const room = makeRoom();
        const threadFilterState = { ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() };
        const threadSortControlSignature = createThreadSortControlSignature({
          state: threadFilterState,
          searchQuery: '',
          viewMode: 'threaded',
        });
        threadLastActivityTsMapMock.set(firstThread.getId(), 100);
        threadLastActivityTsMapMock.set(secondThread.getId(), 200);
        threadLastActivityTsMapMock.set(thirdThread.getId(), 300);

        expect(
          getRoomEventFocusTarget({
            eventId: firstThread.getId(),
            renderableEvents: [firstThread, secondThread, thirdThread] as never,
            room: room as never,
            threadResolutionMap: threadResolutionMapMock as never,
            threadId: undefined,
            threadFilterState,
            scheduledStatusMap: new Map(),
            threadReplyCountMapForMeta: new Map(),
            threadParticipantMap: new Map(),
            summaryMap: new Map(),
            currentUserId: '@alice:example.org',
            searchQuery: '',
            threadSortFreezeState: {
              controlSignature: threadSortControlSignature,
              orderedRootIds: [secondThread.getId(), firstThread.getId(), thirdThread.getId()],
            },
            threadSortControlSignature,
          })
        ).toEqual({
          index: 1,
          count: 3,
          canFocus: true,
        });
      });

      it('computes room-event focus against compact-only roots in the frozen compact order', async () => {
        const { getRoomEventFocusTarget } = await import('../threadRoomFocus');
        const { createThreadSortControlSignature } = await import('../roomThreadOverviewModel');
        const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
        const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
        const compactOnlyThread = makeEvent('$thread-3', { isThreadRoot: true });
        const roomThreads = [
          { id: firstThread.getId(), rootEvent: firstThread, length: 1 },
          { id: secondThread.getId(), rootEvent: secondThread, length: 1 },
          { id: compactOnlyThread.getId(), rootEvent: compactOnlyThread, length: 1 },
        ];
        const room = makeRoom({
          liveEvents: [firstThread, secondThread],
          threads: roomThreads as never,
        });
        const threadFilterState = {
          ...TEST_DEFAULT_THREAD_FILTER_STATE,
          sortBy: 'lastReply' as const,
          sortDirection: 'desc' as const,
          tags: new Map(),
        };
        const threadSortControlSignature = createThreadSortControlSignature({
          state: threadFilterState,
          searchQuery: '',
          viewMode: 'compact',
        });
        threadLastActivityTsMapMock.set(firstThread.getId(), 100);
        threadLastActivityTsMapMock.set(secondThread.getId(), 200);
        threadLastActivityTsMapMock.set(compactOnlyThread.getId(), 300);

        expect(
          getRoomEventFocusTarget({
            eventId: compactOnlyThread.getId(),
            renderableEvents: [firstThread, secondThread] as never,
            room: room as never,
            threadResolutionMap: threadResolutionMapMock as never,
            threadId: undefined,
            threadFilterState,
            scheduledStatusMap: new Map(),
            threadReplyCountMapForMeta: new Map(),
            threadParticipantMap: new Map(),
            summaryMap: new Map(),
            currentUserId: '@alice:example.org',
            searchQuery: '',
            threadSortFreezeState: {
              controlSignature: threadSortControlSignature,
              orderedRootIds: [
                compactOnlyThread.getId(),
                secondThread.getId(),
                firstThread.getId(),
              ],
            },
            threadSortControlSignature,
            viewMode: 'compact',
            roomThreads: roomThreads as never,
          })
        ).toEqual({
          index: 0,
          count: 3,
          canFocus: true,
        });
      });

      it('derives a thread redirect target for room-overview thread permalinks', async () => {
        const { getRoomEventThreadOpenTarget } = await import('../roomDeepLink');
        const threadRoot = makeEvent('$thread-root', { isThreadRoot: true });
        const threadReply = makeEvent('$thread-reply', {
          threadRootId: threadRoot.getId(),
        });
        const room = makeRoom({
          liveEvents: [threadRoot, threadReply],
          threads: [{ id: threadRoot.getId(), rootEvent: threadRoot }] as never,
        });

        expect(
          getRoomEventThreadOpenTarget({
            eventId: threadRoot.getId(),
            room: room as never,
            roomThreads: room.getThreads() as never,
          })
        ).toEqual({
          threadId: threadRoot.getId(),
          eventId: undefined,
        });

        expect(
          getRoomEventThreadOpenTarget({
            eventId: threadReply.getId(),
            room: room as never,
            roomThreads: room.getThreads() as never,
          })
        ).toEqual({
          threadId: threadRoot.getId(),
          eventId: threadReply.getId(),
        });
      });

      it('redirects compact-room permalinks into thread view', async () => {
        const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
        const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
        const threadRoot = makeEvent('$thread-root', { isThreadRoot: true });
        const room = makeRoom({
          liveEvents: [threadRoot],
          threads: [{ id: threadRoot.getId(), rootEvent: threadRoot }] as never,
        });

        await act(async () => {
          create(
            React.createElement(ControlledRoomTimeline, {
              room,
              eventId: threadRoot.getId(),
              initialViewMode: 'compact',
            })
          );
          await flushAsyncWork();
        });

        expect(navigateRoomThreadMock).toHaveBeenCalledWith(
          room.roomId,
          threadRoot.getId(),
          undefined,
          { replace: true }
        );
      });

      it('redirects a permalink to a thread reply the client has not loaded into its thread', async () => {
        const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
        const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
        const threadRoot = makeEvent('$thread-root', { isThreadRoot: true });
        const room = makeRoom({ liveEvents: [threadRoot] });
        // An active thread keeps the compact list from emptying while the event loads.
        roomThreadListThreadsMock.push({
          id: threadRoot.getId(),
          rootEvent: threadRoot,
          length: 2,
        } as never);
        matrixClientMock.fetchRoomEvent.mockResolvedValue({
          content: { 'm.relates_to': { rel_type: 'm.thread', event_id: threadRoot.getId() } },
        });

        await act(async () => {
          create(
            React.createElement(ControlledRoomTimeline, {
              room,
              eventId: '$unloaded-reply',
              initialViewMode: 'compact',
            })
          );
          await flushAsyncWork();
        });

        expect(matrixClientMock.fetchRoomEvent).toHaveBeenCalledWith(
          room.roomId,
          '$unloaded-reply'
        );
        expect(navigateRoomThreadMock).toHaveBeenCalledWith(
          room.roomId,
          threadRoot.getId(),
          '$unloaded-reply',
          { replace: true }
        );
      });

      const threadAnswer = {
        content: { 'm.relates_to': { rel_type: 'm.thread', event_id: '$thread-root' } },
      };
      it.each([
        ['moves on to another event', ['$later-message'], threadAnswer],
        ['drops its event', [undefined], threadAnswer],
        // The open that came back already handled the event; the first answer must not redo it.
        ['drops its event and comes back', [undefined, '$unloaded-reply'], {}],
      ])('drops a late lookup when the route %s', async (_case, nextEventIds, lateAnswer) => {
        const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
        const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
        const threadRoot = makeEvent('$thread-root', { isThreadRoot: true });
        const laterMessage = makeEvent('$later-message');
        const laterTimeline = makeTimeline([laterMessage]);
        const room = makeRoom({ liveEvents: [threadRoot] });
        roomThreadListThreadsMock.push({
          id: threadRoot.getId(),
          rootEvent: threadRoot,
          length: 2,
        } as never);
        // Only the first lookup is held back; a later one for the same event answers at once.
        let resolveFetch: (event: unknown) => void = () => undefined;
        matrixClientMock.fetchRoomEvent.mockReturnValueOnce(
          new Promise((resolve) => {
            resolveFetch = resolve;
          })
        );
        matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) =>
          eventId === laterMessage.getId() ? laterTimeline : null
        );
        const getItemKeys = () => {
          const options = roomTimelineVirtualizerState.lastOptions;
          return Array.from({ length: options?.count ?? 0 }, (_, index) =>
            options?.getItemKey?.(index)
          );
        };
        let renderer: ReturnType<typeof create> | undefined;

        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              eventId: '$unloaded-reply',
              initialViewMode: 'compact',
            })
          );
          await flushAsyncWork();
        });
        for (const nextEventId of nextEventIds) {
          await act(async () => {
            renderer?.update(
              React.createElement(ControlledRoomTimeline, {
                room,
                eventId: nextEventId,
                initialViewMode: 'compact',
              })
            );
            await flushAsyncWork();
          });
        }
        const itemKeys = getItemKeys();
        const loadCount = matrixClientMock.getEventTimeline.mock.calls.length;

        await act(async () => {
          resolveFetch(lateAnswer);
          await flushAsyncWork();
        });

        // The late answer neither redirects, nor loads, nor replaces the newer route's timeline.
        expect(navigateRoomThreadMock).not.toHaveBeenCalled();
        expect(matrixClientMock.getEventTimeline).toHaveBeenCalledTimes(loadCount);
        expect(getItemKeys()).toEqual(itemKeys);
      });

      it('keeps synthetic room-focus permalinks in compact room view', async () => {
        const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
        const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
        const threadRoot = makeEvent('$thread-root', { isThreadRoot: true });
        const room = makeRoom({
          liveEvents: [threadRoot],
          threads: [{ id: threadRoot.getId(), rootEvent: threadRoot }] as never,
        });

        await act(async () => {
          create(
            React.createElement(ControlledRoomTimeline, {
              room,
              eventId: threadRoot.getId(),
              focusEventInRoom: true,
              initialViewMode: 'compact',
            })
          );
          await flushAsyncWork();
        });

        expect(navigateRoomThreadMock).not.toHaveBeenCalled();
        expect(roomTimelineVirtualizerState.scrollToIndexMock).toHaveBeenCalledWith(0, {
          align: 'center',
          behavior: 'smooth',
        });
      });

      it('bypasses room overview filters for synthetic room-focus routes when the focused root is hidden', async () => {
        const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
        const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
        const threadRoot = makeEvent('$thread-root', { isThreadRoot: true });
        const room = makeRoom({
          liveEvents: [threadRoot],
          threads: [{ id: threadRoot.getId(), rootEvent: threadRoot }] as never,
        });

        let renderer: ReturnType<typeof create> | undefined;

        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              eventId: threadRoot.getId(),
              focusEventInRoom: true,
              initialViewMode: 'threaded',
              initialThreadFilterState: {
                ...DEFAULT_THREAD_FILTER_STATE,
                freeText: 'does-not-match-hidden-root',
                tags: new Map(),
              },
            })
          );
          await flushAsyncWork(2);
        });

        expect(getRenderedEventIds(renderer!)).toEqual([threadRoot.getId()]);
        expect(renderer?.root.findAllByType(roomThreadOverviewType)).toHaveLength(1);
        expect(renderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);
      });

      it('keeps synthetic room-focus permalinks in room-overview order for visible roots in natural mode', async () => {
        const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
        const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
        const filler = makeEvent('$filler');
        const firstThreadRoot = makeEvent('$thread-root-1', { isThreadRoot: true });
        const secondThreadRoot = makeEvent('$thread-root-2', { isThreadRoot: true });
        const room = makeRoom({
          liveEvents: [filler, firstThreadRoot, secondThreadRoot],
          threads: [
            { id: firstThreadRoot.getId(), rootEvent: firstThreadRoot },
            { id: secondThreadRoot.getId(), rootEvent: secondThreadRoot },
          ] as never,
        });

        let renderer: ReturnType<typeof create> | undefined;

        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              eventId: secondThreadRoot.getId(),
              focusEventInRoom: true,
              initialViewMode: 'threaded',
              initialThreadFilterState: {
                ...DEFAULT_THREAD_FILTER_STATE,
                sortBy: 'natural',
                sortDirection: 'desc',
                tags: new Map(),
              },
            })
          );
          await flushAsyncWork(2);
        });

        expect(getRenderedEventIds(renderer!)).toEqual([
          firstThreadRoot.getId(),
          secondThreadRoot.getId(),
        ]);
        expect(renderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);
      });

      it('lets synthetic room-focus routes switch between expanded and compact views', async () => {
        const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
        const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
        const threadRoot = makeEvent('$thread-root', { isThreadRoot: true });
        const room = makeRoom({
          liveEvents: [threadRoot],
          threads: [{ id: threadRoot.getId(), rootEvent: threadRoot }] as never,
        });

        let renderer: ReturnType<typeof create> | undefined;

        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              eventId: threadRoot.getId(),
              focusEventInRoom: true,
              initialViewMode: 'threaded',
              initialThreadFilterState: {
                ...DEFAULT_THREAD_FILTER_STATE,
                resolved: 'exclude',
                scheduled: 'exclude',
                sortBy: 'lastReply',
                tags: new Map(),
              },
            })
          );
          await flushAsyncWork(2);
        });

        expect(getRenderedEventIds(renderer!)).toEqual([threadRoot.getId()]);
        expect(renderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);

        await act(async () => {
          renderer?.root.findByType(roomThreadOverviewType).props.onViewModeChange('compact');
          await flushAsyncWork(2);
        });

        expect(renderer?.root.findByType(roomThreadOverviewType).props.viewMode).toBe('compact');
        expect(renderer?.root.findByType(compactPlaceholderType).props.threadRootIds).toEqual([
          threadRoot.getId(),
        ]);

        await act(async () => {
          renderer?.root.findByType(roomThreadOverviewType).props.onViewModeChange('threaded');
          await flushAsyncWork(2);
        });

        expect(renderer?.root.findByType(roomThreadOverviewType).props.viewMode).toBe('threaded');
        expect(getRenderedEventIds(renderer!)).toEqual([threadRoot.getId()]);
        expect(renderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);
      });

      it('uses stopInView=false for the explicit room focus scroll', async () => {
        const { getRoomFocusScrollToItemOptions } = await import('../timelineScrollUtils');

        expect(getRoomFocusScrollToItemOptions(10, 100)).toEqual({
          align: 'center',
          behavior: 'instant',
          offset: undefined,
          stopInView: false,
        });
      });

      it('switches room focus to start alignment near the loaded room start', async () => {
        const { getRoomFocusScrollOptions, getRoomFocusScrollToItemOptions } = await import(
          '../timelineScrollUtils'
        );

        expect(getRoomFocusScrollOptions(0, 100)).toEqual({
          align: 'start',
          behavior: 'instant',
          offset: 32,
        });
        expect(getRoomFocusScrollOptions(4, 100)).toEqual({
          align: 'start',
          behavior: 'instant',
          offset: 32,
        });
        expect(getRoomFocusScrollToItemOptions(2, 100)).toEqual({
          align: 'start',
          behavior: 'instant',
          offset: 32,
          stopInView: false,
        });
      });
    });

    describe('refresh and jump-to-latest', () => {
      it('switches room focus to end alignment near the loaded room end', async () => {
        const { getRoomFocusScrollOptions, getRoomFocusScrollToItemOptions } = await import(
          '../timelineScrollUtils'
        );

        expect(getRoomFocusScrollOptions(8, 12)).toEqual({
          align: 'end',
          behavior: 'instant',
          offset: -32,
        });
        expect(getRoomFocusScrollToItemOptions(8, 12)).toEqual({
          align: 'end',
          behavior: 'instant',
          offset: -32,
          stopInView: false,
        });
      });

      it('recenters focus during observed resize activity and finishes after the idle window', async () => {
        const { setupFocusObserver } = await import('../timelineScrollUtils');
        vi.useFakeTimers();

        try {
          const onRecenter = vi.fn();
          const onDone = vi.fn();
          const resizeObserverInstances: Array<{
            callback: (entries: ResizeObserverEntry[]) => void;
            observe: ReturnType<typeof vi.fn>;
            disconnect: ReturnType<typeof vi.fn>;
          }> = [];
          const rafCallbacks: FrameRequestCallback[] = [];

          class ResizeObserverMock {
            callback: (entries: ResizeObserverEntry[]) => void;

            observe = vi.fn();

            disconnect = vi.fn();

            constructor(callback: (entries: ResizeObserverEntry[]) => void) {
              this.callback = callback;
              resizeObserverInstances.push(this);
            }
          }

          vi.stubGlobal('ResizeObserver', ResizeObserverMock as never);
          vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
          });

          const cleanup = setupFocusObserver({
            scrollContainer: {} as HTMLElement,
            target: {} as HTMLElement,
            onRecenter,
            onDone,
            idleMs: 200,
            hardMs: 2000,
          });

          expect(resizeObserverInstances).toHaveLength(1);
          const resizeObserver = resizeObserverInstances[0];
          expect(resizeObserver.observe).toHaveBeenNthCalledWith(1, expect.anything());
          expect(resizeObserver.observe).toHaveBeenNthCalledWith(2, expect.anything());

          resizeObserver.callback([] as ResizeObserverEntry[]);
          expect(onRecenter).not.toHaveBeenCalled();

          act(() => {
            rafCallbacks.shift()?.(0);
          });

          expect(onRecenter).toHaveBeenCalledTimes(1);

          act(() => {
            vi.advanceTimersByTime(199);
          });
          expect(onDone).not.toHaveBeenCalled();

          act(() => {
            vi.advanceTimersByTime(1);
          });

          expect(resizeObserver.disconnect).toHaveBeenCalledTimes(1);
          expect(onDone).toHaveBeenCalledTimes(1);

          cleanup();
        } finally {
          vi.useRealTimers();
          vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0);
            return 0;
          });
        }
      });

      it('cancels a pending room focus retry when the focused event changes', async () => {
        const { isContinuingRoomFocusRetry } = await import('../timelineScrollUtils');

        expect(
          isContinuingRoomFocusRetry('$first', {
            eventId: '$first',
            attempts: 1,
          })
        ).toBe(true);
        expect(
          isContinuingRoomFocusRetry('$second', {
            eventId: '$first',
            attempts: 1,
          })
        ).toBe(false);
        expect(isContinuingRoomFocusRetry(undefined, { eventId: '$first', attempts: 1 })).toBe(
          false
        );
      });

      it('does not focus room events hidden by the active filter', async () => {
        const { getRoomEventFocusTarget } = await import('../threadRoomFocus');
        const unresolvedThread = makeEvent('$thread-unresolved', { isThreadRoot: true });
        const resolvedThread = makeEvent('$thread-resolved', { isThreadRoot: true });
        const room = makeRoom();
        threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true, tags: null });

        expect(
          getRoomEventFocusTarget({
            eventId: resolvedThread.getId(),
            renderableEvents: [unresolvedThread, resolvedThread] as never,
            room: room as never,
            threadResolutionMap: threadResolutionMapMock,
            threadId: undefined,
            threadFilterState: {
              ...DEFAULT_THREAD_FILTER_STATE,
              resolved: 'exclude' as const,
              tags: new Map(),
            },
            scheduledStatusMap: new Map(),
            threadReplyCountMapForMeta: new Map(),
            threadParticipantMap: new Map(),
            summaryMap: new Map(),
            currentUserId: '@alice:example.org',
          })
        ).toEqual({
          index: 0,
          count: 1,
          canFocus: false,
        });
      });

      it('coalesces queued refreshes and reruns after in-flight settles', async () => {
        const { useThreadAwareTimelineRefresh } = await import('../useThreadAwareTimelineRefresh');
        setThreadAwareTimelineRefreshHook(useThreadAwareTimelineRefresh);
        const threadId = '$thread';
        const room = makeRoom();
        const onRoomRefresh = vi.fn();
        let resolveRefresh: ((value: boolean) => void) | undefined;
        const refreshLatestThreadSlice = vi
          .fn(async (_expectedThreadId: string) => true)
          .mockImplementationOnce(
            () =>
              new Promise<boolean>((resolve) => {
                resolveRefresh = resolve;
              })
          );
        let renderer: ReturnType<typeof create> | undefined;

        await act(async () => {
          renderer = create(
            React.createElement(TimelineRefreshHarness, {
              room,
              threadId,
              liveTimelineLinked: true,
              refreshLatestThreadSlice,
              onRoomRefresh,
            })
          );
          await flushAsyncWork(1);
        });

        const refreshHandler = room.__listeners.get(RoomEvent.TimelineRefresh);
        expect(refreshHandler).toBeTypeOf('function');

        // Fire twice while first is in-flight — only one call, second is queued
        await act(async () => {
          refreshHandler?.(room);
          refreshHandler?.(room);
          await flushAsyncWork(1);
        });

        expect(refreshLatestThreadSlice).toHaveBeenCalledTimes(1);
        expect(refreshLatestThreadSlice).toHaveBeenCalledWith(threadId);
        expect(onRoomRefresh).not.toHaveBeenCalled();

        // Settle the first — the coalesced pending triggers a second call
        await act(async () => {
          resolveRefresh?.(true);
          await flushAsyncWork();
        });

        expect(refreshLatestThreadSlice).toHaveBeenCalledTimes(2);

        // After both settle, a fresh event still works
        await act(async () => {
          refreshHandler?.(room);
          await flushAsyncWork();
        });

        expect(refreshLatestThreadSlice).toHaveBeenCalledTimes(3);

        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(1);
        });
      });

      it('cancels a queued refresh when the thread closes mid-flight', async () => {
        const { useThreadAwareTimelineRefresh } = await import('../useThreadAwareTimelineRefresh');
        setThreadAwareTimelineRefreshHook(useThreadAwareTimelineRefresh);
        const threadId = '$thread';
        const room = makeRoom();
        const onRoomRefresh = vi.fn();
        let resolveRefresh: ((value: boolean) => void) | undefined;
        const refreshLatestThreadSlice = vi
          .fn(async (_expectedThreadId: string) => true)
          .mockImplementationOnce(
            () =>
              new Promise<boolean>((resolve) => {
                resolveRefresh = resolve;
              })
          );
        let renderer: ReturnType<typeof create> | undefined;

        await act(async () => {
          renderer = create(
            React.createElement(TimelineRefreshHarness, {
              room,
              threadId,
              liveTimelineLinked: true,
              refreshLatestThreadSlice,
              onRoomRefresh,
            })
          );
          await flushAsyncWork(1);
        });

        const refreshHandler = room.__listeners.get(RoomEvent.TimelineRefresh);
        expect(refreshHandler).toBeTypeOf('function');

        // Fire refresh — starts in-flight
        await act(async () => {
          refreshHandler?.(room);
          await flushAsyncWork(1);
        });

        expect(refreshLatestThreadSlice).toHaveBeenCalledTimes(1);

        // Queue another refresh while the first request is still in-flight.
        await act(async () => {
          refreshHandler?.(room);
          await flushAsyncWork(1);
        });

        expect(refreshLatestThreadSlice).toHaveBeenCalledTimes(1);

        // Re-render without threadId (thread closed) before the queued rerun can start.
        await act(async () => {
          renderer?.update(
            React.createElement(TimelineRefreshHarness, {
              room,
              threadId: undefined,
              liveTimelineLinked: true,
              refreshLatestThreadSlice,
              onRoomRefresh,
            })
          );
          await flushAsyncWork(1);
        });

        // Settle the original in-flight — the queued rerun should be discarded.
        await act(async () => {
          resolveRefresh?.(true);
          await flushAsyncWork();
        });

        expect(refreshLatestThreadSlice).toHaveBeenCalledTimes(1);
        expect(onRoomRefresh).not.toHaveBeenCalled();

        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(1);
        });
      });

      it('shows Jump to Latest when timeline is not at live end (non-live navigation)', async () => {
        isTimelineAtLiveEndMock.mockReturnValue(false);
        const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
        const room = makeRoom({ liveEvents: [makeEvent('$1')] });
        const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
        let renderer: ReturnType<typeof create> | undefined;

        try {
          await act(async () => {
            renderer = create(React.createElement(ControlledRoomTimeline, { room }));
            await flushAsyncWork();
          });

          const jumpLabels = renderer!.root.findAll((node) => {
            try {
              return node.children.includes('Jump to Latest');
            } catch {
              return false;
            }
          });
          expect(jumpLabels.length).toBeGreaterThan(0);
        } finally {
          await act(async () => {
            renderer?.unmount();
            await flushAsyncWork(1);
          });
        }
      });

      it('recovery effect hides Jump to Latest when anchor is visible and timelineAtLiveEnd flips to true', async () => {
        isTimelineAtLiveEndMock.mockReturnValue(false);
        const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
        const room = makeRoom({ liveEvents: [makeEvent('$1')] });
        const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
        let renderer: ReturnType<typeof create> | undefined;

        const createNodeMock = (element: { type: string }) => {
          if (element.type === scrollType) {
            return {
              addEventListener: vi.fn(),
              removeEventListener: vi.fn(),
              getBoundingClientRect: () => ({ bottom: 500 }),
            };
          }
          if (element.type === 'span') {
            return { getBoundingClientRect: () => ({ top: 400 }) };
          }
          return null;
        };

        try {
          // Render with timelineAtLiveEnd=false → atBottom=false → button visible
          await act(async () => {
            renderer = create(React.createElement(ControlledRoomTimeline, { room }), {
              createNodeMock,
            });
            await flushAsyncWork();
          });

          const findJumpLabels = () =>
            renderer!.root.findAll((node) => {
              try {
                return node.children.includes('Jump to Latest');
              } catch {
                return false;
              }
            });

          expect(findJumpLabels().length).toBeGreaterThan(0);

          // Flip timelineAtLiveEnd to true and re-render.
          // The recovery useEffect sees anchor visible → setAtBottom(true) → button hides.
          isTimelineAtLiveEndMock.mockReturnValue(true);
          await act(async () => {
            renderer!.update(React.createElement(ControlledRoomTimeline, { room }));
            await flushAsyncWork();
          });

          expect(findJumpLabels().length).toBe(0);
        } finally {
          await act(async () => {
            renderer?.unmount();
            await flushAsyncWork(1);
          });
        }
      });

      it('isAnchorVisibleInScroll returns true when anchor is within scroll bounds plus margin', async () => {
        const { isAnchorVisibleInScroll } = await import('../timelineScrollUtils');

        const anchor = { getBoundingClientRect: () => ({ top: 500 }) } as Element;
        const scroll = { getBoundingClientRect: () => ({ bottom: 450 }) } as Element;
        expect(isAnchorVisibleInScroll(anchor, scroll, 100)).toBe(true);
      });

      it('isAnchorVisibleInScroll returns false when anchor is below scroll bounds plus margin', async () => {
        const { isAnchorVisibleInScroll } = await import('../timelineScrollUtils');

        const anchor = { getBoundingClientRect: () => ({ top: 600 }) } as Element;
        const scroll = { getBoundingClientRect: () => ({ bottom: 450 }) } as Element;
        expect(isAnchorVisibleInScroll(anchor, scroll, 100)).toBe(false);
      });
    });
  });
});
