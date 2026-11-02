import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Line } from 'folds';
import { KnownMembership, type MatrixEvent } from 'matrix-js-sdk';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAtomValue, useSetAtom } from 'jotai';
import { RoomView } from './MindroomRoomView';
import { MembersDrawer } from '../../features/room/MembersDrawer';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { PowerLevelsContextProvider, usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoom } from '../../hooks/useRoom';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { CallView } from '../../features/call/CallView';
import { RoomViewHeader } from './MindroomRoomViewHeader';
import { callChatAtom, callEmbedAtom } from '../../state/callEmbed';
import { MindroomCallChatView } from './MindroomCallChatView';
import { getRoomSearchParams } from '../../pages/pathSearchParam';
import { useRoomThreadRouteGuards } from './useRoomThreadRouteGuards';
import { useRoomEscapeReadReceipts } from './useRoomEscapeReadReceipts';
import { useRoomViewMode } from './useRoomViewMode';
import { useThreadRootEvent } from './useThreadRootEvent';
import { isThreadRouteReady } from './threadRouteUtils';
import { hasActiveMindroomAgent, isMindroomAgentUserId } from '../matrix/agentIdentity';
import { MembershipFilter } from '../../hooks/useMemberFilter';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useComputerApiUrl } from '../computer/useComputerApiUrl';
import { useBindsOpenIdTokens, useRoomMindroomServers } from '../server/useMindroomServers';
import { ComputerPanel } from '../computer/ComputerPanel';
import { useRoomComputerState } from '../computer/useRoomComputerState';
import { RoomCanvasPanel } from '../canvas/RoomCanvasPanel';
import { useRoomCanvasState } from '../canvas/useRoomCanvasState';
import { useCanvasOpenRequest } from '../canvas/useCanvasOpenRequest';
import {
  useComputerShown,
  useConversationCanvases,
  useOpenCanvasById,
} from '../canvas/canvasIndex';
import type { ComputerAgent } from '../computer/types';
import { ResizableMembersPanel } from '../sidebar/ResizableMembersPanel';
import { CONVERSATION_MIN_WIDTH, ResizablePanel } from '../sidebar/ResizablePanel';
import { useMembersDrawer } from '../sidebar/useMembersDrawer';
import { settingsModalAtom } from '../../state/settingsModal';
import {
  SettingsPages,
  SIMPLE_MODE_HIDDEN_SETTINGS_PAGES,
} from '../../features/settings/settingsPages';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { ChatUiActionContext, useChatUiActions } from '../ui-actions/ChatUiActionProvider';
import type { ChatUiAction, ChatUiSettingsSection } from '../ui-actions/chatUiProtocol';
import { useSimpleMode } from '../settings/useMindroomAccountSettings';

const COMPUTER_DEFAULT_WIDTH = 672;
const COMPUTER_MAX_WIDTH = 1600;

const UI_SETTINGS_PAGES: Record<ChatUiSettingsSection, SettingsPages> = {
  general: SettingsPages.GeneralPage,
  account: SettingsPages.AccountPage,
  notifications: SettingsPages.NotificationPage,
  devices: SettingsPages.DevicesPage,
  'emojis-stickers': SettingsPages.EmojisStickersPage,
  developer: SettingsPages.DeveloperToolsPage,
  about: SettingsPages.AboutPage,
};

export function Room() {
  const { t } = useTranslation();
  const simpleMode = useSimpleMode();
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const room = useRoom();
  const mx = useMatrixClient();
  const roomSearchParams = useMemo(() => getRoomSearchParams(searchParams), [searchParams]);
  const { focusEvent, threadId } = roomSearchParams;

  const [isDrawer, setPeopleDrawer] = useMembersDrawer();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const screenSize = useScreenSizeContext();
  const powerLevels = usePowerLevels(room);
  const members = useRoomMembers(mx, room.roomId);
  const clientConfig = useClientConfig();
  const servers = useRoomMindroomServers(room);
  const bindsTokens = useBindsOpenIdTokens();
  const roomServerUrl = bindsTokens ? servers.find((server) => server.computer)?.apiUrl : undefined;
  const configuredApiUrl = useComputerApiUrl();
  const computerApiUrl = useComputerApiUrl(roomServerUrl);
  // Found servers apply per agent, so a room with agents of two MindRooms opens each one's own.
  const discovering = !configuredApiUrl && computerApiUrl !== undefined;
  const canvasEnabled = clientConfig.mindroom?.canvas?.enabled === true;
  const canvasLibraries = clientConfig.mindroom?.canvas?.libraries === true;
  const computerAgents = useMemo<ComputerAgent[]>(
    () =>
      members
        .filter(
          (member) =>
            member.membership === KnownMembership.Join &&
            isMindroomAgentUserId(member.userId) &&
            // With a configured URL, an agent whose MindRoom does not publish its server yet keeps the
            // action; while discovering, only agents with a published server have one to open.
            (servers.find((server) => server.agentUserId === member.userId)?.computer ??
              !discovering)
        )
        .map((member) => ({
          userId: member.userId,
          name: member.name?.trim() || member.userId,
          serverUrl: discovering
            ? servers.find((server) => server.agentUserId === member.userId)?.apiUrl
            : undefined,
        })),
    [members, servers, discovering]
  );
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const computerAvailable = !!computerApiUrl && computerAgents.length > 0;
  const hasMindroomAgents = hasActiveMindroomAgent(members);
  const joinRequestCount = useMemo(
    () => members.filter(MembershipFilter.filterKnocked).length,
    [members]
  );
  const chat = useAtomValue(callChatAtom);
  // A call's frames listen to window messages, so no canvas runs while any call is active.
  const callActive = !!useAtomValue(callEmbedAtom);
  const { viewMode, setViewMode } = useRoomViewMode(room.roomId);
  const routedThreadId = viewMode === 'classic' ? undefined : threadId;
  const {
    open: effectiveComputerOpen,
    requestedAgent,
    interaction: computerInteraction,
    toggle: toggleComputer,
    show: showComputer,
    close: closeComputer,
    reportInteraction,
  } = useRoomComputerState({
    mx,
    roomId: room.roomId,
    threadId: routedThreadId,
    available: computerAvailable,
    apiUrl: computerApiUrl,
  });
  const {
    event: canvasEvent,
    show: showCanvas,
    close: closeCanvas,
  } = useRoomCanvasState({ mx, roomId: room.roomId, threadId: routedThreadId });
  useEffect(() => {
    if (callActive) closeCanvas();
  }, [callActive, closeCanvas]);
  // An expanded canvas takes the conversation's column; closing it brings the conversation back.
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  useEffect(() => {
    if (!canvasEvent) setCanvasExpanded(false);
  }, [canvasEvent]);
  const toggleCanvasExpanded = useCallback(() => setCanvasExpanded((value) => !value), []);
  // An expanded computer takes the conversation's column the same way; closing it resets.
  const [computerExpanded, setComputerExpanded] = useState(false);
  useEffect(() => {
    if (!effectiveComputerOpen) setComputerExpanded(false);
  }, [effectiveComputerOpen]);
  const toggleComputerExpanded = useCallback(() => setComputerExpanded((value) => !value), []);
  const callView = room.isCallRoom();
  const canvasShown =
    !callView && canvasEnabled && !callActive && !effectiveComputerOpen && !!canvasEvent;
  // The conversation is unmounted, not hidden, so it cannot mark messages read while out of view.
  // On phones the canvas and the computer always cover the conversation.
  const canvasFillsRoom = canvasShown && (canvasExpanded || screenSize === ScreenSize.Mobile);
  const computerFillsRoom =
    effectiveComputerOpen && (computerExpanded || screenSize === ScreenSize.Mobile);
  const panelFillsRoom = canvasFillsRoom || computerFillsRoom;
  const computerThreadId = useThreadRootEvent(room, routedThreadId);
  const continuationReady =
    computerThreadId !== routedThreadId || isThreadRouteReady(room, routedThreadId);
  const handleComputerToggle = useCallback(() => {
    if (!effectiveComputerOpen) {
      setPeopleDrawer(false);
      closeCanvas();
    }
    toggleComputer();
  }, [closeCanvas, effectiveComputerOpen, setPeopleDrawer, toggleComputer]);
  const handleThreadLoadError = useRoomThreadRouteGuards({
    eventId,
    roomId: room.roomId,
    threadId,
    viewMode,
  });
  useRoomEscapeReadReceipts({
    conversationHidden: panelFillsRoom,
    hideActivity,
    roomId: room.roomId,
    threadId: routedThreadId,
  });

  const uiUnavailable = useCallback(
    (action: ChatUiAction): string | undefined => {
      if (callView) return t('mindroomUi.uiActions.openConversation');
      if (
        action.action === 'open_settings' &&
        simpleMode &&
        SIMPLE_MODE_HIDDEN_SETTINGS_PAGES.includes(UI_SETTINGS_PAGES[action.section])
      ) {
        return t('mindroomUi.uiActions.settingsUnavailable');
      }
      if (
        effectiveComputerOpen &&
        computerInteraction.locked &&
        !(
          action.action === 'show_computer' &&
          action.agentUserId === computerInteraction.agentUserId &&
          action.threadId === computerThreadId
        )
      ) {
        return t('mindroomUi.uiActions.releaseControl');
      }
      if (
        action.action === 'show_computer' &&
        (!computerApiUrl || !computerAgents.some((agent) => agent.userId === action.agentUserId))
      ) {
        return t('mindroomUi.uiActions.computerUnavailable');
      }
      if (action.action === 'show_canvas' && !canvasEnabled) {
        return t('mindroomUi.uiActions.canvasDisabled');
      }
      if (action.action === 'show_canvas' && callActive) {
        return t('mindroomUi.uiActions.canvasDuringCall');
      }
      return undefined;
    },
    [
      canvasEnabled,
      callActive,
      callView,
      simpleMode,
      effectiveComputerOpen,
      computerInteraction,
      computerApiUrl,
      computerAgents,
      computerThreadId,
      t,
    ]
  );
  const performUiAction = useCallback(
    (action: ChatUiAction) => {
      if (action.action === 'show_computer') {
        setPeopleDrawer(false);
        closeCanvas();
        showComputer(action.agentUserId);
      } else if (action.action === 'open_settings') {
        setSettingsModal({
          initialPage: UI_SETTINGS_PAGES[action.section],
          requestId: action.eventId,
        });
      } else if (action.action === 'show_canvas') {
        setPeopleDrawer(false);
        closeComputer();
        showCanvas(action.event);
      } else {
        closeComputer();
        closeCanvas();
        setPeopleDrawer(true);
      }
    },
    [closeCanvas, closeComputer, setPeopleDrawer, setSettingsModal, showCanvas, showComputer]
  );
  const navigateUiAction = useCallback(
    (targetThreadId?: string) => {
      if (targetThreadId) {
        if (viewMode === 'classic') setViewMode('threaded');
        navigateRoomThread(room.roomId, targetThreadId);
      } else navigateRoom(room.roomId);
    },
    [navigateRoom, navigateRoomThread, room.roomId, setViewMode, viewMode]
  );
  const uiActions = useChatUiActions({
    mx,
    room,
    threadId: computerThreadId,
    autoOpenFromHomeservers: clientConfig.mindroom?.uiActions?.autoOpenFromHomeservers,
    ready: !callView && continuationReady,
    perform: performUiAction,
    unavailable: uiUnavailable,
    navigate: navigateUiAction,
  });
  // A canvas opened from the Canvases page fills the room once it shows.
  const [expandCanvasId, setExpandCanvasId] = useState<string>();
  const openRequestedCanvas = useCallback(
    (event: MatrixEvent) => {
      const action = uiActions.read(event);
      // A canvas that cannot open now (during a call) must not expand when opened later.
      if (!action || uiActions.unavailable(action)) return;
      setExpandCanvasId(event.getId());
      uiActions.activate(event);
    },
    [uiActions]
  );
  useCanvasOpenRequest(
    mx,
    room,
    canvasEnabled && !callView && continuationReady,
    openRequestedCanvas
  );
  // The header lists this conversation's canvases, so one closed (or far up the timeline) is one click away.
  const conversationCanvases = useConversationCanvases(mx, room.roomId, computerThreadId);
  const computerShown = useComputerShown(mx, room.roomId, computerThreadId);
  // A canvas still loading is opened only into the panel state it was chosen in: closing the canvas,
  // opening another, the computer or Members meanwhile is a later choice, and it wins.
  const openCanvasFromHeader = useOpenCanvasById(
    mx,
    room,
    [
      room.roomId,
      routedThreadId,
      computerThreadId,
      canvasEvent?.getId(),
      effectiveComputerOpen,
      isDrawer,
    ].join('\n'),
    uiActions.activate
  );
  useEffect(() => {
    if (!expandCanvasId || canvasEvent?.getId() !== expandCanvasId) return;
    setCanvasExpanded(true);
    setExpandCanvasId(undefined);
  }, [canvasEvent, expandCanvasId]);

  return (
    <ChatUiActionContext.Provider value={uiActions}>
      <PowerLevelsContextProvider value={powerLevels}>
        <Box grow="Yes">
          {callView && (screenSize === ScreenSize.Desktop || !chat) && (
            <Box grow="Yes" direction="Column">
              <RoomViewHeader callView hasMindroomAgents={hasMindroomAgents} />
              <Box grow="Yes">
                <CallView />
              </Box>
            </Box>
          )}
          {!callView && !panelFillsRoom && (
            <Box grow="Yes" direction="Column">
              <Box grow="Yes">
                <RoomView
                  room={room}
                  computerAvailable={computerAvailable}
                  computerOpen={effectiveComputerOpen}
                  computerShown={computerShown}
                  onComputerToggle={handleComputerToggle}
                  canvasOpen={canvasShown}
                  canvases={canvasEnabled && !callActive ? conversationCanvases : undefined}
                  openCanvasId={canvasShown ? canvasEvent?.getId() : undefined}
                  onCanvasOpen={openCanvasFromHeader}
                  onCanvasClose={closeCanvas}
                  hasMindroomAgents={hasMindroomAgents}
                  joinRequestCount={joinRequestCount}
                  eventId={eventId}
                  focusEventInRoom={focusEvent === '1'}
                  threadId={routedThreadId}
                  onThreadLoadError={handleThreadLoadError}
                />
              </Box>
            </Box>
          )}

          {callView && chat && (
            <>
              {screenSize === ScreenSize.Desktop && (
                <Line variant="Background" direction="Vertical" size="300" />
              )}
              <MindroomCallChatView
                room={room}
                hasMindroomAgents={hasMindroomAgents}
                eventId={eventId}
                focusEventInRoom={focusEvent === '1'}
                threadId={routedThreadId}
                onThreadLoadError={handleThreadLoadError}
              />
            </>
          )}
          {!callView && effectiveComputerOpen && computerApiUrl && (
            <ResizablePanel
              side="end"
              storageKey={`mindroom.computer.width:${mx.getSafeUserId()}`}
              defaultWidth={COMPUTER_DEFAULT_WIDTH}
              minContentWidth={CONVERSATION_MIN_WIDTH}
              maxPanelWidth={COMPUTER_MAX_WIDTH}
              passthrough={screenSize === ScreenSize.Mobile}
              resizeLabel="Resize computer panel"
              collapseLabel="Close computer"
              onCollapse={closeComputer}
              fullWidth={computerExpanded}
              testId="resizable-computer-panel"
            >
              <ComputerPanel
                key={computerApiUrl}
                agents={computerAgents}
                apiUrl={computerApiUrl}
                mx={mx}
                roomId={room.roomId}
                threadId={computerThreadId}
                continuationReady={continuationReady}
                requestedAgent={requestedAgent}
                onInteractionChange={reportInteraction}
                onClose={closeComputer}
                expanded={computerExpanded}
                onToggleExpanded={
                  screenSize === ScreenSize.Mobile ? undefined : toggleComputerExpanded
                }
              />
            </ResizablePanel>
          )}
          {canvasShown && canvasEvent && (
            <>
              <RoomCanvasPanel
                mx={mx}
                room={room}
                event={canvasEvent}
                onClose={closeCanvas}
                expanded={canvasExpanded}
                onToggleExpanded={toggleCanvasExpanded}
                libraries={canvasLibraries}
              />
            </>
          )}
          {!callView && isDrawer && !effectiveComputerOpen && !(canvasEnabled && canvasEvent) && (
            <ResizableMembersPanel key={room.roomId} onClose={() => setPeopleDrawer(false)}>
              <MembersDrawer room={room} members={members} />
            </ResizableMembersPanel>
          )}
        </Box>
      </PowerLevelsContextProvider>
    </ChatUiActionContext.Provider>
  );
}
