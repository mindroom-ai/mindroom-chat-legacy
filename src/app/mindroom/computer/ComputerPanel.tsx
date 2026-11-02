import React, {
  ComponentType,
  lazy,
  RefAttributes,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Box, Button, Icon, IconButton, Icons, Spinner, Text } from 'folds';
import { ConnectionError, type MatrixClient } from 'matrix-js-sdk';
import { requestAudienceOpenIdToken } from '../matrix/openidAudience';
import { ComputerApiError, ComputerSessionClient, createComputerSession } from './api';
import type { ComputerScreenHandle, ComputerScreenProps } from './ComputerScreen';
import type { ComputerAgent, ComputerStatus, ComputerStreamConnection } from './types';
import { sendComputerContinuation } from './continuation';
import { hasCoarsePointer } from './computerFocus';
import { IconTooltip } from '../tooltip/IconTooltip';
import { ExpandIcon, ShrinkIcon } from '../sidebar/panelIcons';
import * as css from './ComputerPanel.css';

const LazyComputerScreen = lazy(() => import('./ComputerScreen'));

// Soft, outlined actions read as controls without a bright solid fill in dark themes.
const actionButtonProps = { size: '300', fill: 'Soft', outlined: true, radii: '300' } as const;

type PanelPhase =
  | 'selecting'
  | 'connecting'
  | 'reconnecting'
  | 'ready'
  | 'disconnected'
  | 'stopped'
  | 'error';
type PanelOperation = 'take' | 'resume' | 'stop' | 'reconnect';

// After a connected stream closes unexpectedly, retry for about 15 seconds before offering Reconnect.
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];
// A stream that stayed connected this long earns a full set of attempts again. It outlasts the
// runtime's 15-second recheck cadence plus its 15-second budget, so a session revoked by every
// recheck keeps counting attempts.
const STABLE_STREAM_MS = 35_000;
// Starting a scaled-down worker can take minutes, and the proxy in front gives up after about 100 s.
const START_RETRY_BUDGET_MS = 180_000;
const START_RETRY_DELAY_MS = 2_000;
const START_RETRY_MAX_DELAY_MS = 10_000;
// Network failures (status 0) and an unavailable gateway, proxy or worker.
const TRANSIENT_STATUSES = new Set([0, 502, 503, 504, 524]);
// The server revokes a session when it closes its stream; these mean a new session is needed.
const SESSION_GONE_STATUSES = new Set([401, 404, 409]);

// Also covers a homeserver that cannot be reached for the OpenID token.
const isTransientError = (error: unknown, signal: AbortSignal): boolean =>
  !signal.aborted &&
  ((error instanceof ComputerApiError && TRANSIENT_STATUSES.has(error.status)) ||
    error instanceof ConnectionError);

const isSessionGone = (error: unknown): boolean =>
  error instanceof ComputerApiError && SESSION_GONE_STATUSES.has(error.status);

/** Resolves true after `ms`, or false as soon as the signal aborts (clearing the timer). */
const wait = (ms: number, signal: AbortSignal): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

export type ComputerInteraction = { agentUserId?: string; locked: boolean };

export type ComputerPanelProps = {
  agents: readonly ComputerAgent[];
  apiUrl: string;
  mx: MatrixClient;
  roomId: string;
  threadId?: string;
  continuationReady?: boolean;
  onClose: () => void;
  request?: typeof fetch;
  ScreenComponent?: ComponentType<ComputerScreenProps & RefAttributes<ComputerScreenHandle>>;
  requestedAgent?: { userId: string };
  onInteractionChange?: (interaction: ComputerInteraction) => void;
  /** Whether the panel fills the room; with `onToggleExpanded`, shows the Expand toggle. */
  expanded?: boolean;
  onToggleExpanded?: () => void;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof ComputerApiError) {
    if (error.status === 401) return 'Your computer session expired. Start a new session.';
    return error.message;
  }
  return 'Unable to open the computer.';
};

const phaseLabel = (
  phase: PanelPhase,
  status: ComputerStatus | undefined,
  connected: boolean
): string => {
  if (phase === 'connecting') return 'Connecting to computer…';
  if (phase === 'reconnecting') return 'Reconnecting to computer…';
  if (phase === 'stopped') return 'Computer stopped';
  if (phase === 'disconnected') return 'Computer disconnected';
  if (phase === 'error') return 'Computer unavailable';
  if (phase === 'selecting') return 'Choose an agent to watch its computer.';
  if (status?.state === 'starting') return 'Computer is starting…';
  if (!connected) return 'Connecting display…';
  return status?.mode === 'control' ? 'You have control' : 'Watch mode';
};

export function ComputerPanel({
  agents,
  apiUrl,
  mx,
  roomId,
  threadId,
  continuationReady = true,
  onClose,
  request,
  ScreenComponent = LazyComputerScreen,
  requestedAgent,
  onInteractionChange,
  expanded = false,
  onToggleExpanded,
}: ComputerPanelProps) {
  const [chosenAgentId, setChosenAgentId] = useState<string | undefined>(requestedAgent?.userId);
  const [activeAgentId, setActiveAgentId] = useState<string | undefined>(requestedAgent?.userId);
  const handledRequestRef = useRef(requestedAgent);
  const [restart, setRestart] = useState(0);
  const [phase, setPhase] = useState<PanelPhase>('selecting');
  const [operation, setOperation] = useState<PanelOperation>();
  const [status, setStatus] = useState<ComputerStatus>();
  const [stream, setStream] = useState<ComputerStreamConnection>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string>();
  const [sendError, setSendError] = useState<string>();
  const [pasteError, setPasteError] = useState<string>();
  const [releaseNotice, setReleaseNotice] = useState<'released' | 'sent'>();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const screenRef = useRef<ComputerScreenHandle>(null);
  const sessionRef = useRef<ComputerSessionClient>();
  const lifecycleRef = useRef(0);
  const activeStreamTicketRef = useRef<string>();
  const releasingStreamTicketRef = useRef<string>();
  const disposedSessionsRef = useRef(new WeakSet<ComputerSessionClient>());
  // Aborted by the session effect's cleanup, which cancels every pending retry and request.
  const lifecycleSignalRef = useRef<AbortSignal>();
  const connectedStreamRef = useRef<{ ticket: string; since: number }>();
  // Automatic reconnect attempts since a stream last stayed connected.
  const reconnectAttemptsRef = useRef(0);
  const recoverOnRestartRef = useRef(false);
  // Lets the session effect hand a replacement session's failed first connect to the retry policy.
  const reconnectAutomaticallyRef =
    useRef<(session: ComputerSessionClient, message?: string) => Promise<void>>();

  const chosenAgent = useMemo(
    () => agents.find((agent) => agent.userId === chosenAgentId),
    [agents, chosenAgentId]
  );
  const selectedAgent = useMemo(
    () =>
      !activeAgentId &&
      agents.length === 1 &&
      (!requestedAgent || requestedAgent.userId === agents[0].userId)
        ? agents[0]
        : agents.find((agent) => agent.userId === activeAgentId),
    [activeAgentId, agents, requestedAgent]
  );
  const selectedAgentUserId = selectedAgent?.userId;
  // A server found from the agent itself must be trusted afresh before it gets a token.
  const agentServerUrl = selectedAgent?.serverUrl;
  const sessionApiUrl = agentServerUrl ?? apiUrl;

  useEffect(() => {
    onInteractionChange?.({
      agentUserId: selectedAgentUserId,
      locked: status?.mode === 'control' || !!operation,
    });
  }, [onInteractionChange, selectedAgentUserId, status?.mode, operation]);

  useEffect(() => {
    if (!requestedAgent || handledRequestRef.current === requestedAgent) return;
    handledRequestRef.current = requestedAgent;
    if ((status?.mode === 'control' || operation) && requestedAgent.userId !== selectedAgentUserId)
      return;
    if (!agents.some((agent) => agent.userId === requestedAgent.userId)) return;
    setChosenAgentId(requestedAgent.userId);
    setActiveAgentId(requestedAgent.userId);
  }, [requestedAgent, agents, status?.mode, operation, selectedAgentUserId]);

  const disposeSession = useCallback((session: ComputerSessionClient) => {
    if (disposedSessionsRef.current.has(session)) return;
    disposedSessionsRef.current.add(session);
    void session.dispose().catch(() => undefined);
  }, []);

  const connectStream = useCallback(
    async (
      session: ComputerSessionClient,
      lifecycle: number,
      refreshStatus: boolean,
      signal?: AbortSignal
    ): Promise<void> => {
      const nextStatus = refreshStatus ? await session.refreshStatus(signal) : session.status;
      if (lifecycleRef.current !== lifecycle || sessionRef.current !== session) return;
      if (nextStatus.state === 'stopped') {
        disposedSessionsRef.current.add(session);
        sessionRef.current = undefined;
        setStatus(nextStatus);
        setStream(undefined);
        setConnected(false);
        setError(undefined);
        setPhase('stopped');
        return;
      }
      const nextStream = await session.createStream(signal);
      if (lifecycleRef.current !== lifecycle || sessionRef.current !== session) return;
      setStatus(nextStatus);
      setConnected(false);
      activeStreamTicketRef.current = nextStream.protocols[1];
      setStream(nextStream);
      setPhase('ready');
    },
    []
  );

  useEffect(() => {
    const lifecycle = lifecycleRef.current + 1;
    lifecycleRef.current = lifecycle;
    const abortController = new AbortController();
    const { signal } = abortController;
    lifecycleSignalRef.current = signal;
    // A session replaced after a revocation keeps counting the reconnect attempts made so far.
    const recovering = recoverOnRestartRef.current;
    recoverOnRestartRef.current = false;
    if (!recovering) reconnectAttemptsRef.current = 0;
    let createdSession: ComputerSessionClient | undefined;

    setStatus(undefined);
    activeStreamTicketRef.current = undefined;
    connectedStreamRef.current = undefined;
    setStream(undefined);
    setConnected(false);
    setError(undefined);
    setSendError(undefined);
    setPasteError(undefined);
    setReleaseNotice(undefined);
    setOperation(undefined);

    if (!selectedAgentUserId) {
      setPhase('selecting');
      return () => {
        abortController.abort();
      };
    }

    setPhase(recovering ? 'reconnecting' : 'connecting');
    const requestSession = async (): Promise<ComputerSessionClient | undefined> => {
      const startedAt = Date.now();
      for (let attempt = 0; ; attempt += 1) {
        try {
          const openIdToken = await requestAudienceOpenIdToken(mx, sessionApiUrl, {
            requireBinding: agentServerUrl !== undefined,
          });
          if (lifecycleRef.current !== lifecycle) return undefined;
          return await createComputerSession({
            apiUrl: sessionApiUrl,
            agentUserId: selectedAgentUserId,
            openIdToken,
            request,
            roomId,
            signal,
          });
        } catch (sessionError) {
          const delay = Math.min(START_RETRY_DELAY_MS * 2 ** attempt, START_RETRY_MAX_DELAY_MS);
          if (
            !isTransientError(sessionError, signal) ||
            Date.now() - startedAt + delay > START_RETRY_BUDGET_MS
          ) {
            throw sessionError;
          }
          if (!(await wait(delay, signal))) return undefined;
          // A throttled background tab can wake long after the delay.
          if (Date.now() - startedAt > START_RETRY_BUDGET_MS) throw sessionError;
        }
      }
    };
    const createSession = async () => {
      try {
        createdSession = await requestSession();
        if (!createdSession) return;
        if (lifecycleRef.current !== lifecycle) {
          disposeSession(createdSession);
          return;
        }
        sessionRef.current = createdSession;
        setStatus(createdSession.status);
        try {
          await connectStream(createdSession, lifecycle, false, signal);
        } catch (connectError) {
          // A session retired meanwhile, for example by Stop, keeps the state its owner set.
          if (lifecycleRef.current !== lifecycle || sessionRef.current !== createdSession) return;
          if (
            !recovering ||
            !(isTransientError(connectError, signal) || isSessionGone(connectError))
          ) {
            throw connectError;
          }
          // A replacement session's first connect counts against the remaining reconnect attempts.
          void reconnectAutomaticallyRef.current?.(createdSession, getErrorMessage(connectError));
        }
      } catch (sessionError) {
        if (lifecycleRef.current !== lifecycle) return;
        setError(getErrorMessage(sessionError));
        setPhase('error');
      }
    };
    void createSession();

    return () => {
      abortController.abort();
      if (lifecycleRef.current === lifecycle) {
        lifecycleRef.current += 1;
        activeStreamTicketRef.current = undefined;
      }
      if (createdSession) disposeSession(createdSession);
      if (sessionRef.current === createdSession) sessionRef.current = undefined;
    };
  }, [
    agentServerUrl,
    connectStream,
    disposeSession,
    mx,
    request,
    restart,
    roomId,
    selectedAgentUserId,
    sessionApiUrl,
    threadId,
  ]);

  const handleTakeControl = async () => {
    const session = sessionRef.current;
    if (!session || operation) return;
    const lifecycle = lifecycleRef.current;
    setOperation('take');
    setError(undefined);
    try {
      const nextStatus = await session.control('take');
      if (lifecycleRef.current !== lifecycle || sessionRef.current !== session) return;
      setStatus(nextStatus);
      setReleaseNotice(undefined);
      setSendError(undefined);
    } catch (controlError) {
      if (lifecycleRef.current === lifecycle) {
        setError(getErrorMessage(controlError));
        setPhase(activeStreamTicketRef.current ? 'ready' : 'disconnected');
      }
    } finally {
      if (lifecycleRef.current === lifecycle) setOperation(undefined);
    }
  };

  const handleResumeAgent = async () => {
    const session = sessionRef.current;
    if (!session || operation || !selectedAgentUserId || !continuationReady) return;
    const lifecycle = lifecycleRef.current;
    setOperation('resume');
    setError(undefined);
    setSendError(undefined);
    setReleaseNotice(undefined);
    // Releasing control closes the controller's stream, often before the release response arrives.
    const releasingTicket = activeStreamTicketRef.current;
    releasingStreamTicketRef.current = releasingTicket;
    try {
      const nextStatus = await session.control('release');
      if (lifecycleRef.current !== lifecycle || sessionRef.current !== session) return;
      setStatus(nextStatus);
      // The retired screen stays in place until the watch stream replaces it.
      activeStreamTicketRef.current = undefined;
      setConnected(false);
      setReleaseNotice('released');

      const continuation = sendComputerContinuation(mx, roomId, threadId, selectedAgentUserId);
      // A failed watch reconnect shows at once, without waiting for the continuation to send.
      const reconnect = connectStream(session, lifecycle, false).catch((reconnectError) => {
        if (lifecycleRef.current !== lifecycle || sessionRef.current !== session) return;
        setStream(undefined);
        setError(getErrorMessage(reconnectError));
        setPhase('disconnected');
      });
      const [continuationResult] = await Promise.allSettled([continuation, reconnect]);
      if (lifecycleRef.current !== lifecycle || sessionRef.current !== session) return;
      if (continuationResult.status === 'rejected') {
        setSendError('Control was released, but the continuation message could not be sent.');
      } else {
        setReleaseNotice('sent');
      }
    } catch (releaseError) {
      if (lifecycleRef.current === lifecycle) {
        setError(`Control was not released. ${getErrorMessage(releaseError)}`);
        if (activeStreamTicketRef.current) {
          setPhase('ready');
        } else {
          setStream(undefined);
          setPhase('disconnected');
        }
      }
    } finally {
      if (releasingStreamTicketRef.current === releasingTicket) {
        releasingStreamTicketRef.current = undefined;
      }
      if (lifecycleRef.current === lifecycle) setOperation(undefined);
    }
  };

  const handleStop = async () => {
    const session = sessionRef.current;
    if (!session || operation) return;
    const lifecycle = lifecycleRef.current;
    setOperation('stop');
    setError(undefined);
    try {
      const nextStatus = await session.control('stop');
      if (lifecycleRef.current !== lifecycle || sessionRef.current !== session) return;
      disposedSessionsRef.current.add(session);
      sessionRef.current = undefined;
      setStatus(nextStatus);
      activeStreamTicketRef.current = undefined;
      setStream(undefined);
      setConnected(false);
      setError(undefined);
      setPhase('stopped');
    } catch (stopError) {
      if (lifecycleRef.current === lifecycle) {
        setError(getErrorMessage(stopError));
        setPhase(activeStreamTicketRef.current ? 'ready' : 'disconnected');
      }
    } finally {
      if (lifecycleRef.current === lifecycle) setOperation(undefined);
    }
  };

  // A revoked session cannot reconnect: the session effect creates a new one in watch mode.
  const replaceSession = (session: ComputerSessionClient) => {
    sessionRef.current = undefined;
    disposeSession(session);
    recoverOnRestartRef.current = true;
    setRestart((value) => value + 1);
  };

  const handleReconnect = async () => {
    if (operation) return;
    reconnectAttemptsRef.current = 0;
    const session = sessionRef.current;
    if (!session) {
      setRestart((value) => value + 1);
      return;
    }
    const lifecycle = lifecycleRef.current;
    setOperation('reconnect');
    setError(undefined);
    setPhase('connecting');
    try {
      await connectStream(session, lifecycle, true, lifecycleSignalRef.current);
    } catch (reconnectError) {
      if (lifecycleRef.current === lifecycle) {
        if (isSessionGone(reconnectError)) {
          replaceSession(session);
          return;
        }
        setError(getErrorMessage(reconnectError));
        setPhase('disconnected');
      }
    } finally {
      if (lifecycleRef.current === lifecycle) setOperation(undefined);
    }
  };

  const reconnectAutomatically = async (session: ComputerSessionClient, message?: string) => {
    const lifecycle = lifecycleRef.current;
    const signal = lifecycleSignalRef.current;
    if (!signal) return;
    const current = () => lifecycleRef.current === lifecycle && sessionRef.current === session;
    // A pending operation such as Stop owns the outcome.
    if (!current() || operation) return;
    let failure = message ?? 'The computer connection closed.';
    setOperation('reconnect');
    setError(undefined);
    setPhase('reconnecting');
    try {
      while (reconnectAttemptsRef.current < RECONNECT_DELAYS_MS.length) {
        const delay = RECONNECT_DELAYS_MS[reconnectAttemptsRef.current];
        reconnectAttemptsRef.current += 1;
        if (!(await wait(delay, signal)) || !current()) return;
        try {
          // The new screen reports whether it connects; a close before then retries again.
          await connectStream(session, lifecycle, true, signal);
          return;
        } catch (reconnectError) {
          if (!current()) return;
          if (isSessionGone(reconnectError)) {
            replaceSession(session);
            return;
          }
          failure = getErrorMessage(reconnectError);
          if (!isTransientError(reconnectError, signal)) break;
        }
      }
      setError(failure);
      setPhase('disconnected');
    } finally {
      if (lifecycleRef.current === lifecycle) setOperation(undefined);
    }
  };

  const handleClose = () => {
    const session = sessionRef.current;
    if (session) {
      sessionRef.current = undefined;
      disposeSession(session);
    }
    activeStreamTicketRef.current = undefined;
    onClose();
  };

  reconnectAutomaticallyRef.current = reconnectAutomatically;

  const handleDisconnected = (streamTicket: string, message?: string) => {
    if (activeStreamTicketRef.current !== streamTicket) return;
    const session = sessionRef.current;
    if (!session) return;
    activeStreamTicketRef.current = undefined;
    setConnected(false);
    // Resume agent owns this close: it reconnects on success or reports the disconnect on failure.
    if (releasingStreamTicketRef.current === streamTicket) return;
    setStream(undefined);
    // A pending operation reports its own outcome; otherwise a stream that had connected, or one
    // opened by an automatic reconnect, is retried before the panel shows the disconnect.
    const connectedSince =
      connectedStreamRef.current?.ticket === streamTicket
        ? connectedStreamRef.current.since
        : undefined;
    if (!operation && (connectedSince !== undefined || reconnectAttemptsRef.current > 0)) {
      // Streams that drop right after connecting keep counting, so the retries stay bounded.
      if (connectedSince !== undefined && Date.now() - connectedSince >= STABLE_STREAM_MS) {
        reconnectAttemptsRef.current = 0;
      }
      void reconnectAutomatically(session, message);
      return;
    }
    setError(message ?? 'The computer connection closed.');
    setPhase('disconnected');
  };

  const statusText = phaseLabel(phase, status, connected);
  const connectingScreen = !stream && (phase === 'connecting' || phase === 'reconnecting');
  // Only a class changes, so the screen is never remounted when the layout switches.
  const panelClassName =
    stream || connectingScreen ? `${css.Panel} ${css.PanelWithScreen}` : css.Panel;
  const canControl = phase === 'ready' && connected && status?.state === 'ready';
  // While the keyboard is up, the panel is short: the hint gives its lines to the Keyboard button,
  // the only way to close the keyboard in the app, which hides iOS's Done bar.
  const showTouchpadHint =
    canControl && status?.mode === 'control' && hasCoarsePointer() && !keyboardOpen;
  const inControl = status?.mode === 'control' && phase === 'ready';

  return (
    <aside className={panelClassName} aria-label="Computer panel">
      <div className={css.Layout}>
        <div className={css.Header}>
          <Box alignItems="Center" gap="200">
            <Icon size="300" src={Icons.Monitor} />
            <Text size="H4">Computer</Text>
          </Box>
          <Box alignItems="Center" gap="100">
            {onToggleExpanded && (
              <IconTooltip label="Expand computer">
                {(triggerRef) => (
                  <IconButton
                    ref={triggerRef}
                    onClick={onToggleExpanded}
                    aria-label="Expand computer"
                    aria-pressed={expanded}
                    size="300"
                  >
                    <Icon size="300" src={expanded ? ShrinkIcon : ExpandIcon} />
                  </IconButton>
                )}
              </IconTooltip>
            )}
            <IconButton onClick={handleClose} aria-label="Close computer" size="300">
              <Icon size="300" src={Icons.Cross} />
            </IconButton>
          </Box>
        </div>

        <div className={css.Body}>
          {(agents.length > 1 || !selectedAgent) && (
            <label className={css.AgentField} htmlFor="mindroom-computer-agent">
              <Text size="L400">Agent</Text>
              <select
                id="mindroom-computer-agent"
                className={css.AgentSelect}
                aria-label="Agent"
                value={chosenAgent?.userId ?? ''}
                onChange={(event) => {
                  const nextAgentId = event.currentTarget.value || undefined;
                  setChosenAgentId(nextAgentId);
                  if (nextAgentId !== activeAgentId) setActiveAgentId(undefined);
                }}
              >
                <option value="">Choose an agent</option>
                {agents.map((agent) => (
                  <option key={agent.userId} value={agent.userId}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {stream && (
            <div className={css.ScreenFrame}>
              <Suspense fallback={<Spinner variant="Secondary" size="300" />}>
                <ScreenComponent
                  key={`${stream.url}:${stream.protocols[1]}`}
                  ref={screenRef}
                  mode={status?.mode ?? 'view'}
                  onKeyboardChange={setKeyboardOpen}
                  onConnected={() => {
                    if (activeStreamTicketRef.current !== stream.protocols[1]) return;
                    connectedStreamRef.current = { ticket: stream.protocols[1], since: Date.now() };
                    setConnected(true);
                    setPhase('ready');
                    setError(undefined);
                    setPasteError(undefined);
                  }}
                  onDisconnected={(message) => handleDisconnected(stream.protocols[1], message)}
                  onPaste={(result) =>
                    setPasteError(
                      result === 'too-large'
                        ? 'Text over 512 KB cannot be pasted into the computer.'
                        : undefined
                    )
                  }
                  protocols={stream.protocols}
                  url={stream.url}
                />
              </Suspense>
            </div>
          )}

          {connectingScreen && (
            <Box
              className={css.ScreenArea}
              grow="Yes"
              alignItems="Center"
              justifyContent="Center"
              gap="200"
            >
              <Spinner variant="Secondary" size="300" />
              <Text>{phase === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</Text>
            </Box>
          )}

          <div className={css.Details}>
            {connectingScreen && !sessionRef.current && (
              <Text size="T200">Starting the computer can take a minute.</Text>
            )}
            <Text className={css.Status} size="T300" role="status">
              {statusText}
            </Text>
            {showTouchpadHint && (
              <Text className={css.Status} size="T300">
                Drag to move the pointer. Tap to click, two fingers to scroll.
              </Text>
            )}
            {releaseNotice && (
              <Text size="T300">
                Control released.{releaseNotice === 'sent' && ' The agent was asked to continue.'}
              </Text>
            )}
            {error && (
              <Text className={css.Error} size="T300" role="alert">
                {error}
              </Text>
            )}
            {sendError && (
              <Text className={css.Error} size="T300" role="alert">
                {sendError}
              </Text>
            )}
            {pasteError && (
              <Text className={css.Error} size="T300" role="alert">
                {pasteError}
              </Text>
            )}

            <div className={css.Actions}>
              {phase === 'selecting' && (
                <Button
                  {...actionButtonProps}
                  disabled={!chosenAgent}
                  onClick={() => {
                    if (chosenAgent) setActiveAgentId(chosenAgent.userId);
                  }}
                  variant="Primary"
                >
                  <Text size="B300">Watch computer</Text>
                </Button>
              )}
              {canControl && status?.mode === 'view' && (
                <Button
                  {...actionButtonProps}
                  disabled={!!operation}
                  onClick={handleTakeControl}
                  variant="Primary"
                >
                  <Text size="B300">
                    {operation === 'take' ? 'Taking control…' : 'Take control'}
                  </Text>
                </Button>
              )}
              {inControl && (
                <Button
                  {...actionButtonProps}
                  disabled={!!operation || !continuationReady}
                  onClick={handleResumeAgent}
                  variant="Primary"
                >
                  <Text size="B300">{operation === 'resume' ? 'Releasing…' : 'Resume agent'}</Text>
                </Button>
              )}
              {inControl && connected && hasCoarsePointer() && (
                <Button
                  {...actionButtonProps}
                  aria-pressed={keyboardOpen}
                  // Focus stays in the keyboard's textarea, so a second tap closes the keyboard.
                  onMouseDown={(event: React.MouseEvent) => event.preventDefault()}
                  // Within the tap itself: iOS opens the keyboard only for a focus inside the gesture.
                  onClick={() =>
                    keyboardOpen
                      ? screenRef.current?.closeKeyboard()
                      : screenRef.current?.openKeyboard()
                  }
                  variant="Secondary"
                >
                  <Text size="B300">Keyboard</Text>
                </Button>
              )}
              {(phase === 'disconnected' || phase === 'error') && (
                <Button
                  {...actionButtonProps}
                  disabled={!!operation}
                  onClick={handleReconnect}
                  variant="Secondary"
                >
                  <Text size="B300">Reconnect</Text>
                </Button>
              )}
              {phase === 'stopped' && (
                <Button {...actionButtonProps} onClick={handleReconnect} variant="Primary">
                  <Text size="B300">Start computer</Text>
                </Button>
              )}
              {sessionRef.current && phase !== 'stopped' && (
                <Button
                  {...actionButtonProps}
                  disabled={!!operation}
                  onClick={handleStop}
                  variant="Critical"
                >
                  <Text size="B300">{operation === 'stop' ? 'Stopping…' : 'Stop'}</Text>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
