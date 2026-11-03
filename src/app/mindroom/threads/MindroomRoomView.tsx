import { useTranslation } from 'react-i18next';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { createPortal } from 'react-dom';
import { Box, Text, config } from 'folds';
import { EventType, Room } from 'matrix-js-sdk';
import { ReactEditor } from 'slate-react';
import { isKeyHotkey } from 'is-hotkey';
import { useStateEvent } from '../../hooks/useStateEvent';
import { StateEvent } from '../../../types/matrix/room';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useEditor } from '../../components/editor';
import { RoomInputPlaceholder } from '../../features/room/RoomInputPlaceholder';
import { RoomViewTyping } from '../../features/room/RoomViewTyping';
import { RoomTombstone } from '../../features/room/RoomTombstone';
import {
  RoomViewFollowing,
  RoomViewFollowingPlaceholder,
} from '../../features/room/RoomViewFollowing';
import { RoomInput } from '../room-input/MindroomRoomInput';
import { RoomTimeline } from './MindroomRoomTimeline';
import { Page } from '../../components/page';
import { RoomViewHeader } from './MindroomRoomViewHeader';
import { useKeyDown } from '../../hooks/useKeyDown';
import { editableActiveElement } from '../../utils/dom';
import { settingsAtom } from '../../state/settings';
import { useSetting } from '../../state/hooks/settings';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { hasBlockingPortalOverlay } from '../../utils/portalOverlay';
import { ThreadContextBanner } from './ThreadContextBanner';
import { useRoomViewThreadState } from './useRoomViewThreadState';
import { isConfirmedMatrixEventId, isLocalEchoEventId } from './threadRouteUtils';
import { usePendingThreadRoot } from './usePendingThreadRoot';
import { isFailedLocalEchoEvent } from '../messages/pendingLocalEcho';
import { FailedSendActions } from '../messages/FailedSendActions';
import { ThreadApprovalProvider } from '../messages/ThreadApprovalProvider';
import { ThreadApprovalQueue } from '../messages/ThreadApprovalControls';
import { BackgroundJobsBar } from '../background-jobs/BackgroundJobsBar';
import { MINDROOM_BACKGROUND_JOB_CANCEL_EVENT } from '../background-jobs/backgroundJobsContract';
import { computerOwnsKeyboardEvent, computerOwnsKeyboardFocus } from '../computer/computerFocus';
import type { CanvasListEntry } from '../canvas/canvasIndexStore';

import { useMindroomSyncEngine } from '../engine/engineContext';
import type { ScrollAnchorMemory } from '../scroll/scrollAnchorMemory';

import * as overlay from './RoomOverlay.css';

const FN_KEYS_REGEX = /^F\d+$/;
const shouldFocusMessageField = (evt: KeyboardEvent): boolean => {
  const { code } = evt;
  if (evt.metaKey || evt.altKey || evt.ctrlKey) {
    return false;
  }

  if (FN_KEYS_REGEX.test(code)) return false;

  if (
    code.startsWith('OS') ||
    code.startsWith('Meta') ||
    code.startsWith('Shift') ||
    code.startsWith('Alt') ||
    code.startsWith('Control') ||
    code.startsWith('Arrow') ||
    code.startsWith('Page') ||
    code.startsWith('End') ||
    code.startsWith('Home') ||
    code === 'Tab' ||
    code === 'Space' ||
    code === 'Enter' ||
    code === 'NumLock' ||
    code === 'ScrollLock'
  ) {
    return false;
  }

  return true;
};

export function RoomView({
  room,
  computerAvailable = false,
  computerOpen = false,
  computerShown = false,
  onComputerToggle,
  canvasOpen = false,
  canvases,
  openCanvasId,
  onCanvasOpen,
  onCanvasClose,
  hasMindroomAgents = true,
  joinRequestCount = 0,
  eventId,
  focusEventInRoom,
  threadId,
  onThreadLoadError,
}: {
  room: Room;
  computerAvailable?: boolean;
  computerOpen?: boolean;
  computerShown?: boolean;
  onComputerToggle?: () => void;
  canvasOpen?: boolean;
  canvases?: CanvasListEntry[];
  openCanvasId?: string;
  onCanvasOpen?: (canvasId: string) => void;
  onCanvasClose?: () => void;
  hasMindroomAgents?: boolean;
  joinRequestCount?: number;
  eventId?: string;
  focusEventInRoom?: boolean;
  threadId?: string;
  onThreadLoadError?: (threadId: string) => void;
}) {
  const { t } = useTranslation();
  const roomInputRef = useRef<HTMLDivElement>(null);
  const roomViewRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [approvalQueueHost, setApprovalQueueHost] = useState<HTMLDivElement | null>(null);
  const compactRoomScrollStateRef = useRef<ScrollAnchorMemory>(new Map());

  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');

  const { roomId } = room;
  const mx = useMatrixClient();
  const syncEngine = useMindroomSyncEngine();
  const editor = useEditor();
  const focusConversation = useCallback(() => ReactEditor.focus(editor), [editor]);

  const tombstoneEvent = useStateEvent(room, StateEvent.RoomTombstone);
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

  const permissions = useRoomPermissions(creators, powerLevels);
  const canMessage = permissions.event(EventType.RoomMessage, mx.getSafeUserId());
  const canCancelJobs = permissions.event(MINDROOM_BACKGROUND_JOB_CANCEL_EVENT, mx.getSafeUserId());
  const {
    effectiveThreadId,
    handleAddTag,
    handleApplyPreset,
    handleCycleTag,
    handleExitThread,
    handleThreadRootDeleted,
    handleRemoveTag,
    handleReset,
    handleRoomMessageSent,
    handleSearchQueryChange,
    handleSortDirectionChange,
    handleToggle,
    handleToggleThreadSortFreeze,
    handleToggleUnresolvedOnly,
    handleViewModeChange,
    setThreadSortFreezeState,
    storeThreadSummary,
    summaryMap,
    threadFilterState,
    threadSortFreezeState,
    threadSummaryInfo,
    viewMode,
  } = useRoomViewThreadState({ eventId, hasMindroomAgents, room, threadId });
  // Room focus outlives the timeline, which remounts when the thread changes.
  useEffect(() => {
    syncEngine.noteRoomFocused(
      roomId,
      isConfirmedMatrixEventId(effectiveThreadId) ? effectiveThreadId : undefined
    );
  }, [syncEngine, roomId, effectiveThreadId]);
  useEffect(() => () => syncEngine.clearRoomFocus(roomId), [syncEngine, roomId]);

  useLayoutEffect(() => {
    const root = roomViewRef.current;
    const header = headerRef.current;
    if (!root || !header) return undefined;
    const measure = () =>
      root.style.setProperty('--room-header-height', header.offsetHeight + 'px');
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [roomId, effectiveThreadId]);
  const pendingThreadRoot = isLocalEchoEventId(effectiveThreadId);
  const pendingRootEvent = usePendingThreadRoot(
    room,
    pendingThreadRoot ? effectiveThreadId : undefined,
    handleThreadRootDeleted
  );
  const failedRootEvent = isFailedLocalEchoEvent(pendingRootEvent) ? pendingRootEvent : undefined;

  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (pendingThreadRoot) return;
        if (computerOwnsKeyboardEvent(evt) || computerOwnsKeyboardFocus()) return;
        if (editableActiveElement()) return;
        if (hasBlockingPortalOverlay()) return;
        if (shouldFocusMessageField(evt) || isKeyHotkey('mod+v', evt)) {
          focusConversation();
        }
      },
      [focusConversation, pendingThreadRoot]
    )
  );

  return (
    <Page ref={roomViewRef} style={{ position: 'relative' }}>
      <ThreadApprovalProvider
        room={room}
        threadId={pendingThreadRoot ? undefined : effectiveThreadId}
        focusConversation={focusConversation}
      >
        <div
          ref={headerRef}
          className={classNames(overlay.Header, effectiveThreadId && overlay.HeaderInThread)}
        >
          <RoomViewHeader
            hasMindroomAgents={hasMindroomAgents}
            computerAvailable={computerAvailable}
            computerOpen={computerOpen}
            computerShown={computerShown}
            onComputerToggle={onComputerToggle}
            canvasOpen={canvasOpen}
            canvases={canvases}
            openCanvasId={openCanvasId}
            onCanvasOpen={onCanvasOpen}
            onCanvasClose={onCanvasClose}
            threadId={effectiveThreadId}
            joinRequestCount={joinRequestCount}
          />
        </div>
        <Box grow="Yes" direction="Column">
          <RoomTimeline
            key={`${roomId}:${effectiveThreadId ?? ''}`}
            room={room}
            hasMindroomAgents={hasMindroomAgents}
            eventId={eventId}
            focusEventInRoom={focusEventInRoom}
            threadId={effectiveThreadId}
            threadHeader={
              effectiveThreadId && (
                <ThreadContextBanner
                  room={room}
                  threadId={effectiveThreadId}
                  summaryInfo={threadSummaryInfo}
                  onExitThread={handleExitThread}
                />
              )
            }
            threadFilterState={threadFilterState}
            threadSortFreezeState={threadSortFreezeState}
            onToggle={handleToggle}
            onSortDirectionChange={handleSortDirectionChange}
            onToggleThreadSortFreeze={handleToggleThreadSortFreeze}
            onToggleUnresolvedOnly={handleToggleUnresolvedOnly}
            setThreadSortFreezeState={setThreadSortFreezeState}
            onCycleTag={handleCycleTag}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            onReset={handleReset}
            onApplyPreset={handleApplyPreset}
            onSearchQueryChange={handleSearchQueryChange}
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            onThreadLoadError={onThreadLoadError}
            summaryMap={summaryMap}
            onStoreThreadSummary={storeThreadSummary}
            roomInputRef={roomInputRef}
            roomFooterRef={footerRef}
            compactRoomScrollStateRef={compactRoomScrollStateRef}
            editor={editor}
          />
        </Box>
        {approvalQueueHost && createPortal(<ThreadApprovalQueue />, approvalQueueHost)}
      </ThreadApprovalProvider>
      <Box
        ref={footerRef}
        className={overlay.Footer}
        shrink="No"
        direction="Column"
        data-room-footer="true"
      >
        {/* `m.typing` names no thread, so room-wide typing would mislead inside one. */}
        {!effectiveThreadId && <RoomViewTyping room={room} />}
        <div ref={setApprovalQueueHost} />
        <BackgroundJobsBar
          room={room}
          threadId={effectiveThreadId ?? null}
          canCancel={canCancelJobs}
        />
        <div style={{ padding: `0 ${config.space.S400}` }}>
          {failedRootEvent ? (
            <RoomInputPlaceholder
              style={{
                padding: config.space.S200,
                paddingBottom: `calc(${config.space.S200} + env(safe-area-inset-bottom, 0px))`,
              }}
              alignItems="Center"
              justifyContent="Center"
            >
              <FailedSendActions room={room} event={failedRootEvent} />
            </RoomInputPlaceholder>
          ) : tombstoneEvent ? (
            <RoomTombstone
              roomId={roomId}
              body={tombstoneEvent.getContent().body}
              replacementRoomId={tombstoneEvent.getContent().replacement_room}
            />
          ) : (
            <>
              {canMessage && !pendingThreadRoot && (
                <RoomInput
                  room={room}
                  editor={editor}
                  roomId={roomId}
                  threadId={effectiveThreadId}
                  threadingEnabled={viewMode !== 'classic'}
                  onRoomMessageSent={handleRoomMessageSent}
                  fileDropContainerRef={roomViewRef}
                  ref={roomInputRef}
                />
              )}
              {canMessage && pendingThreadRoot && (
                <RoomInputPlaceholder
                  style={{
                    padding: config.space.S200,
                    paddingBottom: `calc(${config.space.S200} + env(safe-area-inset-bottom, 0px))`,
                  }}
                  alignItems="Center"
                  justifyContent="Center"
                >
                  <Text align="Center">
                    {t(
                      'mindroomUi.threads.mindroomRoomView.repliesAreAvailableAfterThisMessageIsConfirmed'
                    )}
                  </Text>
                </RoomInputPlaceholder>
              )}
              {!canMessage && (
                <RoomInputPlaceholder
                  style={{
                    padding: config.space.S200,
                    paddingBottom: `calc(${config.space.S200} + env(safe-area-inset-bottom, 0px))`,
                  }}
                  alignItems="Center"
                  justifyContent="Center"
                >
                  <Text align="Center">
                    {t(
                      'mindroomUi.threads.mindroomRoomView.youDoNotHavePermissionToPostInThisRoom'
                    )}
                  </Text>
                </RoomInputPlaceholder>
              )}
            </>
          )}
        </div>
        <div className={overlay.Following} data-room-following="true">
          {hideActivity ? <RoomViewFollowingPlaceholder /> : <RoomViewFollowing room={room} />}
        </div>
      </Box>
    </Page>
  );
}
