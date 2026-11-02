import React, { useEffect, useReducer, useState } from 'react';
import { MatrixEventEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { ThemeKind, useTheme } from '../../hooks/useTheme';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { getMxIdLocalPart } from '../../utils/matrix';
import { getMemberDisplayName, isEventOrderedAfter } from '../../utils/room';
import { CONVERSATION_MIN_WIDTH, ResizablePanel } from '../sidebar/ResizablePanel';
import { readChatUiAction, type ChatUiCanvas } from '../ui-actions/chatUiProtocol';
import { CanvasPanel } from './CanvasPanel';
import { readCanvasTheme } from './canvasTheme';
import { useCanvasPage } from './useCanvasPage';
import { useCanvasVersions } from './useCanvasVersions';
import { useCanvasSavedState } from './useCanvasSavedState';
import { useCanvasStateShare } from './useCanvasStateShare';

type RoomCanvasPanelProps = {
  mx: MatrixClient;
  room: Room;
  event: MatrixEvent;
  onClose: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  libraries: boolean;
};

type ShowCanvas = {
  eventId: string;
  revisionEventId: string;
  agentUserId: string;
  threadId?: string;
  canvas: ChatUiCanvas;
  shareState?: true;
};

// Dashboards need room: the panel may grow wide while the conversation keeps a usable column.
const CANVAS_DEFAULT_WIDTH = 560;
const CANVAS_MAX_WIDTH = 1600;

function LoadedCanvasPanel({
  mx,
  room,
  request,
  action,
  onClose,
  expanded,
  onToggleExpanded,
  libraries,
}: Omit<RoomCanvasPanelProps, 'event'> & { request: MatrixEvent; action: ShowCanvas }) {
  const { t } = useTranslation();
  const appTheme = useTheme();
  const colorScheme = appTheme.kind === ThemeKind.Dark ? 'dark' : 'light';
  const [theme, setTheme] = useState(() => readCanvasTheme(colorScheme));
  useEffect(() => {
    // The theme manager applies the new theme in its own effect, after this one; read a frame later.
    const frame = requestAnimationFrame(() => setTheme(readCanvasTheme(colorScheme)));
    return () => cancelAnimationFrame(frame);
  }, [colorScheme, appTheme.id]);
  const [attempt, setAttempt] = useState(0);
  const versions = useCanvasVersions(mx, room, request, {
    canvas: action.canvas,
    revisionEventId: action.revisionEventId,
  });
  // The version the user picked; none follows the latest.
  const [chosen, setChosen] = useState<string>();
  const shown = versions.find((version) => version.revisionEventId === chosen) ?? action;
  const current = versions.findIndex(
    (version) => version.revisionEventId === shown.revisionEventId
  );
  const page = useCanvasPage(mx, room.roomId, shown.revisionEventId, shown.canvas, attempt);
  const saved = useCanvasSavedState(mx, action.eventId);
  const share = useCanvasStateShare(mx, room, action.eventId, !!action.shareState);
  // The page waits until its saved state is read, so it starts from it.
  const loaded = page.status === 'ready' && saved.ready ? page : undefined;
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const agentName =
    getMemberDisplayName(room, action.agentUserId) ??
    getMxIdLocalPart(action.agentUserId) ??
    action.agentUserId;
  const panel = (
    <CanvasPanel
      mx={mx}
      room={room}
      canvas={{
        eventId: action.eventId,
        revisionEventId: shown.revisionEventId,
        agentUserId: action.agentUserId,
        threadId: action.threadId,
        title: shown.canvas.title,
        html: loaded ? loaded.html : '',
        ...(loaded ? {} : { status: page.status === 'ready' ? 'loading' : page.status }),
      }}
      agentName={agentName}
      colorScheme={colorScheme}
      theme={theme}
      libraries={libraries}
      onClose={onClose}
      onRetry={() => setAttempt((count) => count + 1)}
      expanded={!mobile && expanded}
      onToggleExpanded={mobile ? undefined : onToggleExpanded}
      version={
        versions.length > 1 && current >= 0
          ? { current: current + 1, total: versions.length }
          : undefined
      }
      savedState={saved.read}
      onSaveState={(change, byUser) => {
        saved.save(change);
        // What the page saves before the user works in it (its defaults on another device) is not theirs to share.
        if (byUser) share(saved.read());
      }}
      shared={!!action.shareState}
      onSelectVersion={(number) => {
        const picked = versions[number - 1]?.revisionEventId;
        setChosen(picked === action.revisionEventId ? undefined : picked);
      }}
    />
  );
  // One tree for every screen size, so crossing a breakpoint never reloads the page:
  // phones show the panel full screen (no box of its own), wider screens a resizable column.
  return (
    <ResizablePanel
      side="end"
      storageKey={`mindroom.canvas.width:${mx.getSafeUserId()}`}
      defaultWidth={CANVAS_DEFAULT_WIDTH}
      minContentWidth={CONVERSATION_MIN_WIDTH}
      maxPanelWidth={CANVAS_MAX_WIDTH}
      fullWidth={expanded}
      passthrough={mobile}
      resizeLabel={t('mindroomUi.canvas.resize')}
      collapseLabel={t('mindroomUi.canvas.close')}
      onCollapse={onClose}
      testId="resizable-canvas-panel"
    >
      {panel}
    </ResizablePanel>
  );
}

/** The request's applied edit, when the UI-action protocol accepts it as the canvas to show. */
const acceptedEdit = (
  request: MatrixEvent,
  viewerId: string,
  room: Room
): MatrixEvent | undefined => {
  const edit = request.replacingEvent();
  if (!edit) return undefined;
  const action = readChatUiAction(request, viewerId, room);
  return action?.action === 'show_canvas' && action.revisionEventId === edit.getId()
    ? edit
    : undefined;
};

/** Resolve the open request (and its latest same-sender edit) into the sandboxed panel. */
export function RoomCanvasPanel({ event, ...props }: RoomCanvasPanelProps) {
  const { mx, room, onClose } = props;
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  // The timeline can hold another copy of the request (a cached thread page, a reset timeline), so
  // an edit may land on a different object. A copy is followed only when the protocol accepts its edit
  // and that edit comes after the shown one in Matrix edit order, so notification order can never roll
  // the page back.
  const [request, setRequest] = useState(event);
  useEffect(() => setRequest(event), [event]);
  useEffect(() => {
    const eventId = event.getId();
    const viewerId = mx.getSafeUserId();
    const followCopy = (replaced: MatrixEvent) => {
      if (replaced.getId() !== eventId) return;
      const candidate = acceptedEdit(replaced, viewerId, room);
      if (!candidate) return;
      setRequest((current) => {
        const shown = acceptedEdit(current, viewerId, room);
        return !shown || isEventOrderedAfter(candidate, shown) ? replaced : current;
      });
    };
    // A deletion can also land on another copy; the deleted copy no longer reads as a canvas.
    const followDeletion = (deleted: MatrixEvent) => {
      if (deleted.getId() !== eventId) return;
      queueMicrotask(() => {
        setRequest(deleted);
        refresh();
      });
    };
    mx.on(MatrixEventEvent.Replaced, followCopy);
    room.on(MatrixEventEvent.BeforeRedaction, followDeletion);
    return () => {
      mx.off(MatrixEventEvent.Replaced, followCopy);
      room.off(MatrixEventEvent.BeforeRedaction, followDeletion);
    };
  }, [mx, room, event]);
  useEffect(() => {
    // The SDK announces a redaction before applying it, so re-read afterwards.
    const afterRedaction = () => queueMicrotask(refresh);
    request.on(MatrixEventEvent.Replaced, refresh);
    request.on(MatrixEventEvent.BeforeRedaction, afterRedaction);
    return () => {
      request.off(MatrixEventEvent.Replaced, refresh);
      request.off(MatrixEventEvent.BeforeRedaction, afterRedaction);
    };
  }, [request]);

  const action = readChatUiAction(request, mx.getSafeUserId(), room);
  const valid = action?.action === 'show_canvas';
  useEffect(() => {
    if (!valid) onClose();
  }, [valid, onClose]);
  if (action?.action !== 'show_canvas') return null;
  // One panel per canvas: its saved and shared state hooks rely on the canvas never changing under them.
  return <LoadedCanvasPanel key={action.eventId} {...props} request={request} action={action} />;
}
