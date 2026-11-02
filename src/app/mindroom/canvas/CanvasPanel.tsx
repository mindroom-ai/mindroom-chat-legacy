import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EventStatus, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { Box, Button, Icon, IconButton, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import {
  buildCanvasDocument,
  CANVAS_ESCAPE_MESSAGE,
  CANVAS_PERMISSIONS,
  CANVAS_WRAPPER_SANDBOX,
  canvasFrameWindow,
  type CanvasColorScheme,
  type CanvasSaved,
} from './canvasDocument';
import {
  buildCanvasErrorContent,
  buildCanvasResponseContent,
  buildCanvasResponsePreview,
  canvasResponseFitsInEvent,
  readCanvasError,
  readCanvasState,
  readCanvasSubmission,
  type CanvasSubmission,
} from './canvasMessages';
import type { CanvasTheme } from './canvasTheme';
import { FailedSendActions } from '../messages/FailedSendActions';
import { useLocalEchoStatus } from '../messages/useLocalEchoStatus';
import { uploadMindroomLongTextSidecar } from '../messages/longTextSidecarUpload';
import * as css from './CanvasPanel.css';
import { IconTooltip } from '../tooltip/IconTooltip';
import { ExpandIcon, ShrinkIcon } from '../sidebar/panelIcons';

/** A new snapshot cannot be sent by a click that was already on its way. */
export const CANVAS_SEND_ARM_DELAY_MS = 500;

export type CanvasView = {
  eventId: string;
  revisionEventId: string;
  agentUserId: string;
  threadId?: string;
  title: string;
  html: string;
  /** An uploaded page that is still downloading, or could not be loaded. */
  status?: 'loading' | 'failed';
};

export type CanvasPanelProps = {
  mx: MatrixClient;
  room: Room;
  canvas: CanvasView;
  agentName: string;
  colorScheme: CanvasColorScheme;
  theme: CanvasTheme;
  /** The deployment lets pages load libraries from the library source. */
  libraries?: boolean;
  onClose: () => void;
  onRetry?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  /** Which of the canvas's versions is shown, when it has more than one. */
  version?: { current: number; total: number };
  /** The canvas's saved state, read whenever a page loads, so it holds what the previous page saved. */
  savedState?: () => CanvasSaved;
  /** `byUser` is false for what the page saves before the user has worked in it. */
  onSaveState?: (change: CanvasSaved, byUser: boolean) => void;
  /** The agent can read what the user does in the page, so the panel says so. */
  shared?: boolean;
  onSelectVersion?: (current: number) => void;
};

type Staged = {
  submission: CanvasSubmission;
  armed: boolean;
  /** The page submitted again while this answer waited; only then does the user need to hear how to change it. */
  resubmitted?: true;
};

// Submissions arrive as canonical JSON (`readCanvasSubmission`), so equal answers stringify equally.
const sameAnswer = (a: CanvasSubmission, b: CanvasSubmission): boolean =>
  a.label === b.label && JSON.stringify(a.data) === JSON.stringify(b.data);

/** The last answer this panel sent: its SDK local echo, which also drives the timeline. */
type SentAnswer = { echo: MatrixEvent; label: string };

type AnswerState = 'sending' | 'sent' | 'failed' | 'cancelled';

/** Errors the page reported that the user has not sent yet, or the last ones they sent. */
type PageErrors = { errors: string[]; report?: { echo?: MatrixEvent; errors: string[] } };
const NO_PAGE_ERRORS: PageErrors = { errors: [] };
// Enough to say what went wrong; a page cannot fill the report.
const MAX_PAGE_ERRORS = 5;

// SENT counts as sent: the server has the message even if /sync never brings its copy.
const answerState = (status: EventStatus | null): AnswerState => {
  if (status === EventStatus.NOT_SENT) return 'failed';
  if (status === EventStatus.CANCELLED) return 'cancelled';
  if (status === null || status === EventStatus.SENT) return 'sent';
  return 'sending';
};

/** An answer still sending or failed holds the panel: one unresolved answer at a time. */
const isUnresolved = (answer?: SentAnswer): boolean => {
  const state = answer && answerState(answer.echo.status);
  return state === 'sending' || state === 'failed';
};

/** Hash a document so a changed canvas remounts its frame and drops stale script state. */
const documentKey = (doc: string): string => {
  let hash = 5381;
  for (let index = 0; index < doc.length; index += 1) {
    hash = (hash * 33) ^ doc.charCodeAt(index);
  }
  return `${doc.length}:${hash >>> 0}`;
};

const formatData = (data: unknown): string => JSON.stringify(data, null, 2) ?? 'null';

const STAGE_INTERVAL_MS = 100;

type Displayed = CanvasView & { colorScheme: CanvasColorScheme; theme: CanvasTheme };

const revisionKey = (canvas: CanvasView, htmlKey: string) =>
  `${canvas.revisionEventId}\n${canvas.status ?? 'ready'}\n${canvas.title}\n${htmlKey}`;

export function CanvasPanel({
  mx,
  room,
  canvas,
  agentName,
  colorScheme,
  theme,
  libraries = false,
  onClose,
  onRetry,
  expanded = false,
  onToggleExpanded,
  version,
  onSelectVersion,
  savedState,
  onSaveState,
  shared = false,
}: CanvasPanelProps) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLIFrameElement>(null);
  // The theme is fixed when a revision is shown, so switching themes cannot discard unsent work.
  const [displayed, setDisplayed] = useState<Displayed>(() => ({
    ...canvas,
    colorScheme,
    theme,
  }));
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [reloads, setReloads] = useState(0);
  // Saving never rebuilds the page; every page shown, and every reload, starts from the latest saved state.
  const doc = useMemo(
    () =>
      buildCanvasDocument(
        displayed.html,
        displayed.colorScheme,
        displayed.theme,
        displayed.title,
        libraries,
        savedState?.()
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayed, libraries, reloads]
  );
  const docKey = useMemo(() => documentKey(doc), [doc]);
  const frameKey = `${displayed.revisionEventId}:${docKey}:${reloads}`;
  const [escapedFrame, setEscapedFrame] = useState<string>();
  const [staged, setStaged] = useState<Staged>();
  // Once sent, an answer belongs to the SDK and the timeline; the panel only shows its status.
  const [lastAnswer, setLastAnswer] = useState<SentAnswer>();
  const [sendError, setSendError] = useState(false);
  // An answer too large for one event is uploaded before its event exists.
  const [uploading, setUploading] = useState(false);
  const [pageErrors, setPageErrors] = useState(NO_PAGE_ERRORS);
  // The listed errors as of the last message, read by the message handler.
  const pageErrorsNow = useRef(pageErrors);
  pageErrorsNow.current = pageErrors;
  // Every error this page reported, so one already sent is not offered again.
  const seenErrors = useRef(new Set<string>());
  // The answer being uploaded; Discard clears it, which cancels sending it.
  const uploadingSubmission = useRef<CanvasSubmission>();
  const stagedNow = useRef(staged);
  stagedNow.current = staged;
  const loads = useRef({ frameKey, count: 0 });
  const currentFrameKey = useRef(frameKey);
  currentFrameKey.current = frameKey;
  // Whether the frame may hold work the user has not sent since it loaded or since their last send.
  const touched = useRef(false);
  // Whether the user has worked in this page since it loaded; what the page saves before that is not theirs.
  const used = useRef(false);
  const lastStageAt = useRef(0);
  const latest = useRef({ canvas, colorScheme, theme, onSaveState });
  latest.current = { canvas, colorScheme, theme, onSaveState };
  // Pages can be megabytes, so revisions compare by a hash of their HTML.
  const incomingHtmlKey = useMemo(() => documentKey(canvas.html), [canvas.html]);
  const displayedHtmlKey = useMemo(() => documentKey(displayed.html), [displayed.html]);
  const handledRevision = useRef(revisionKey(canvas, incomingHtmlKey));

  useEffect(() => {
    touched.current = false;
    used.current = false;
    lastStageAt.current = 0;
    setStaged(undefined);
    setSendError(false);
    // An answer still sending or failed stays, with its Retry and Delete, across a new page.
    setLastAnswer((current) => (isUnresolved(current) ? current : undefined));
    setUpdateAvailable(false);
    setPageErrors(NO_PAGE_ERRORS);
    seenErrors.current = new Set();
  }, [frameKey]);

  // An update loads at once unless it would discard work the user has not sent.
  const incomingRevision = revisionKey(canvas, incomingHtmlKey);
  const displayedRevision = revisionKey(displayed, displayedHtmlKey);
  const displayedRevisionId = displayed.revisionEventId;
  const displayedPending = !!displayed.status;
  useEffect(() => {
    if (incomingRevision === displayedRevision) {
      handledRevision.current = incomingRevision;
      setUpdateAvailable(false);
      return;
    }
    // Each revision is decided once, so a later re-render cannot drop a newer staged answer.
    if (handledRevision.current === incomingRevision) return;
    handledRevision.current = incomingRevision;
    // A page that finished downloading belongs to the revision already shown.
    const sameRevisionLoaded =
      latest.current.canvas.revisionEventId === displayedRevisionId && displayedPending;
    if (sameRevisionLoaded || (!touched.current && document.activeElement !== frameRef.current)) {
      setDisplayed({
        ...latest.current.canvas,
        colorScheme: latest.current.colorScheme,
        theme: latest.current.theme,
      });
    } else {
      // An answer the user is already sending stays until it is sent or its upload fails.
      setStaged((current) =>
        current && current.submission === uploadingSubmission.current ? current : undefined
      );
      setUpdateAvailable(true);
    }
  }, [incomingRevision, displayedRevision, displayedRevisionId, displayedPending]);

  useEffect(() => {
    const handleBlur = () => {
      if (document.activeElement !== frameRef.current) return;
      touched.current = true;
      used.current = true;
    };
    const handleMessage = (event: MessageEvent) => {
      const wrapper = frameRef.current?.contentWindow;
      if (
        wrapper &&
        event.source === wrapper &&
        event.origin === 'null' &&
        event.data?.type === CANVAS_ESCAPE_MESSAGE
      ) {
        // The wrapper reports that the canvas frame tried to load something else.
        setEscapedFrame(currentFrameKey.current);
        return;
      }
      const frame = canvasFrameWindow(frameRef.current);
      if (!frame || event.source !== frame) return;
      const saved = readCanvasState(event, frame);
      if (saved !== undefined) {
        // The page's own focus() cannot fake user activation; focus is the fallback where it is unknown.
        const byUser = saved.user ?? (used.current || document.activeElement === frameRef.current);
        latest.current.onSaveState?.(saved.change, byUser);
        return;
      }
      const error = readCanvasError(event, frame);
      if (error !== undefined) {
        const listed = pageErrorsNow.current;
        // A report still sending or failed may return to the list, so its errors count toward the five.
        const { report } = listed;
        const held =
          report?.echo && ['sending', 'failed'].includes(answerState(report.echo.status))
            ? report.errors.length
            : 0;
        // Only listed errors are remembered, so a page throwing endlessly stores five at a time.
        if (seenErrors.current.has(error) || listed.errors.length + held >= MAX_PAGE_ERRORS) return;
        seenErrors.current.add(error);
        const next = { ...listed, errors: [...listed.errors, error] };
        pageErrorsNow.current = next;
        setPageErrors(next);
        return;
      }
      const now = Date.now();
      // Bound bridge traffic before parsing; a canvas cannot flood the host with snapshots.
      if (now - lastStageAt.current < STAGE_INTERVAL_MS) return;
      lastStageAt.current = now;
      const submission = readCanvasSubmission(event, frame);
      if (!submission) return;
      touched.current = true;
      // A pending snapshot stays exactly what the user is reviewing until they send or discard
      // it, so a canvas cannot swap the payload under the user's click.
      setStaged((current) => {
        if (!current) return { submission, armed: false };
        return current.resubmitted || sameAnswer(current.submission, submission)
          ? current
          : { ...current, resubmitted: true };
      });
    };
    window.addEventListener('blur', handleBlur);
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('message', handleMessage);
    };
  }, [mx]);

  const stagedSubmission = staged?.submission;
  useEffect(() => {
    if (!stagedSubmission) return undefined;
    const timer = window.setTimeout(
      () =>
        setStaged((current) =>
          current?.submission === stagedSubmission ? { ...current, armed: true } : current
        ),
      CANVAS_SEND_ARM_DELAY_MS
    );
    return () => window.clearTimeout(timer);
  }, [stagedSubmission]);

  const answerStatus = useLocalEchoStatus(lastAnswer?.echo);
  const answer = lastAnswer && answerStatus !== undefined ? answerState(answerStatus) : undefined;
  const answerOpen = answer === 'sending' || answer === 'failed';

  const busy = answerOpen || uploading;
  // A refused send or an upload happen only while no answer is open, so they take priority.
  let footer: AnswerState | 'idle' | 'refused' = answer ?? 'idle';
  if (uploading) footer = 'sending';
  if (sendError) footer = 'refused';

  // Hands one event to the SDK; from then on its local echo carries the answer's status.
  const deliver = useCallback(
    (
      eventContent: Record<string, unknown>,
      label: string,
      submission: CanvasSubmission
    ): boolean => {
      const txnId = mx.makeTxnId();
      let sending: Promise<unknown>;
      try {
        // The relation travels in the content. The SDK adds the local echo before this returns.
        sending = mx.sendMessage(room.roomId, eventContent as never, txnId);
      } catch {
        return false;
      }
      // A failure shows through the echo's status, here and in the timeline.
      sending.catch(() => undefined);
      const echo = room.getEventForTxnId(txnId);
      // A newer snapshot staged during an upload stays.
      if (stagedNow.current?.submission === submission) {
        setStaged(undefined);
        // Work in the frame after this answer marks it again.
        touched.current = false;
      }
      setLastAnswer(echo ? { echo, label } : undefined);
      return true;
    },
    [mx, room]
  );

  const handleSend = useCallback(() => {
    if (!staged?.armed || busy) return;
    const { submission } = staged;
    const label = submission.label ?? t('mindroomUi.canvas.unlabeled');
    const content = buildCanvasResponseContent(
      {
        eventId: displayed.eventId,
        revisionEventId: displayed.revisionEventId,
        agentUserId: displayed.agentUserId,
        agentName,
        threadId: displayed.threadId,
      },
      submission
    );
    setSendError(false);
    // Until the answer is handed to the SDK, the frame still holds the user's work, so an update
    // during an upload waits for "Load update" and a failed upload can be tried again.
    const refused = () => {
      setSendError(true);
      // The snapshot stays unsent, so an update must not replace the page without asking.
      touched.current = true;
    };
    if (canvasResponseFitsInEvent(content)) {
      if (!deliver(content, label, submission)) refused();
      return;
    }
    // Too large for one event: upload the whole answer and send a preview that points at it,
    // as MindRoom sends long replies. The snapshot stays until the preview is handed to the SDK,
    // and Discard until then cancels the answer.
    uploadingSubmission.current = submission;
    setUploading(true);
    const current = () => uploadingSubmission.current === submission;
    uploadMindroomLongTextSidecar(mx, room, content, buildCanvasResponsePreview(content))
      .then((preview) => {
        if (current() && !deliver(preview, label, submission)) refused();
      })
      .catch(() => {
        if (current()) refused();
      })
      .finally(() => {
        if (!current()) return;
        uploadingSubmission.current = undefined;
        setUploading(false);
      });
  }, [agentName, busy, deliver, displayed, mx, room, staged, t]);

  const reportStatus = useLocalEchoStatus(pageErrors.report?.echo);
  const reportState =
    pageErrors.report?.echo && reportStatus !== undefined ? answerState(reportStatus) : undefined;
  // One report at a time, as with answers; new errors keep collecting meanwhile.
  const reportOpen = reportState === 'sending' || reportState === 'failed';
  useEffect(() => {
    // A report the user deleted after it failed was never sent, so its errors are offered again.
    if (reportState === 'cancelled') {
      setPageErrors((current) => ({
        errors: [...(current.report?.errors ?? []), ...current.errors],
      }));
    }
  }, [reportState]);

  // The user sees the errors before choosing to send them, as with an answer.
  const handleReport = useCallback(() => {
    if (reportOpen || pageErrors.errors.length === 0) return;
    const sent = pageErrors.errors;
    const content = buildCanvasErrorContent(
      {
        eventId: displayed.eventId,
        revisionEventId: displayed.revisionEventId,
        agentUserId: displayed.agentUserId,
        agentName,
        threadId: displayed.threadId,
      },
      sent
    );
    const txnId = mx.makeTxnId();
    try {
      // A failure shows through the echo's status, here and in the timeline.
      mx.sendMessage(room.roomId, content as never, txnId).catch(() => undefined);
    } catch {
      return;
    }
    const echo = room.getEventForTxnId(txnId) ?? undefined;
    setPageErrors((current) => ({
      errors: current.errors.filter((error) => !sent.includes(error)),
      report: { echo, errors: sent },
    }));
  }, [agentName, displayed, mx, pageErrors, reportOpen, room]);

  const handleDiscard = useCallback(() => {
    // Discarding the answer being uploaded cancels it; a newer snapshot leaves that upload alone.
    if (uploadingSubmission.current === stagedNow.current?.submission) {
      uploadingSubmission.current = undefined;
      setUploading(false);
    }
    setStaged(undefined);
    setSendError(false);
  }, []);

  // An answer waiting or sending belongs to the version shown, so the version stays until it resolves.
  const versionLocked = !!staged || busy;
  // While an update waits behind Load update, the numbers describe that update, not the page shown.
  const versions = updateAvailable ? undefined : version;
  const selectVersion = (current: number) => {
    // Picking a version is the user's choice, like Load update, so it replaces the page at once.
    touched.current = false;
    onSelectVersion?.(current);
  };

  const handleLoad = useCallback(() => {
    if (loads.current.frameKey !== frameKey) loads.current = { frameKey, count: 0 };
    loads.current.count += 1;
    // The wrapper's document is inline and nothing inside may navigate it, so a later load is an escape.
    if (loads.current.count > 1) setEscapedFrame(frameKey);
  }, [frameKey]);

  const escaped = escapedFrame === frameKey;

  return (
    <aside className={css.Panel} aria-label={t('mindroomUi.canvas.panelLabel')}>
      <div className={css.Header}>
        <Box className={css.TitleGroup} alignItems="Center" gap="200">
          <Icon size="300" src={Icons.Category} />
          <div className={css.Title}>
            <Text size="H4" truncate>
              {displayed.title}
            </Text>
            <Text size="T200" priority="300" truncate>
              {t('mindroomUi.canvas.fromAgent', { agent: agentName })}
            </Text>
          </div>
        </Box>
        <Box className={css.Controls} alignItems="Center" gap="100">
          {versions && onSelectVersion && (
            <Box alignItems="Center" gap="100">
              <IconTooltip label={t('mindroomUi.canvas.previousVersion')}>
                {(triggerRef) => (
                  <IconButton
                    ref={triggerRef}
                    onClick={() => selectVersion(versions.current - 1)}
                    aria-label={t('mindroomUi.canvas.previousVersion')}
                    disabled={versionLocked || versions.current <= 1}
                    size="300"
                  >
                    <Icon size="300" src={Icons.ChevronLeft} />
                  </IconButton>
                )}
              </IconTooltip>
              <Text className={css.Version} size="T200" priority="300">
                {t('mindroomUi.canvas.version', {
                  current: versions.current,
                  total: versions.total,
                })}
              </Text>
              <IconTooltip label={t('mindroomUi.canvas.nextVersion')}>
                {(triggerRef) => (
                  <IconButton
                    ref={triggerRef}
                    onClick={() => selectVersion(versions.current + 1)}
                    aria-label={t('mindroomUi.canvas.nextVersion')}
                    disabled={versionLocked || versions.current >= versions.total}
                    size="300"
                  >
                    <Icon size="300" src={Icons.ChevronRight} />
                  </IconButton>
                )}
              </IconTooltip>
            </Box>
          )}
          {onToggleExpanded && (
            <IconTooltip label={t('mindroomUi.canvas.expand')}>
              {(triggerRef) => (
                <IconButton
                  ref={triggerRef}
                  onClick={onToggleExpanded}
                  aria-label={t('mindroomUi.canvas.expand')}
                  aria-pressed={expanded}
                  size="300"
                >
                  <Icon size="300" src={expanded ? ShrinkIcon : ExpandIcon} />
                </IconButton>
              )}
            </IconTooltip>
          )}
          <IconButton onClick={onClose} aria-label={t('mindroomUi.canvas.close')} size="300">
            <Icon size="300" src={Icons.Cross} />
          </IconButton>
        </Box>
      </div>

      {updateAvailable && (
        <div className={css.Notice} role="status">
          <Text size="T300">{t('mindroomUi.canvas.updated', { agent: agentName })}</Text>
          <Button
            size="300"
            variant="Secondary"
            onClick={() => setDisplayed({ ...canvas, colorScheme, theme })}
            fill="Soft"
            outlined
            radii="300"
          >
            <Text size="B300">{t('mindroomUi.canvas.loadUpdate')}</Text>
          </Button>
        </div>
      )}

      {versions && onSelectVersion && versions.current < versions.total && (
        <div className={css.Notice} role="status">
          <Text size="T300">{t('mindroomUi.canvas.earlierVersion')}</Text>
          <Button
            size="300"
            variant="Secondary"
            disabled={versionLocked}
            onClick={() => selectVersion(versions.total)}
            fill="Soft"
            outlined
            radii="300"
          >
            <Text size="B300">{t('mindroomUi.canvas.showLatest')}</Text>
          </Button>
        </div>
      )}

      {(pageErrors.errors.length > 0 || pageErrors.report) && (
        <div
          className={css.Notice}
          role={pageErrors.errors.length > 0 || reportState === 'failed' ? 'alert' : 'status'}
        >
          <div className={css.Staged}>
            {pageErrors.report &&
              (reportState === 'failed' && pageErrors.report.echo ? (
                <FailedSendActions
                  room={room}
                  event={pageErrors.report.echo}
                  message={t('mindroomUi.canvas.errorsNotSent', { agent: agentName })}
                />
              ) : (
                <Text size="T300">
                  {reportState === 'sending'
                    ? t('mindroomUi.canvas.sending', { agent: agentName })
                    : t('mindroomUi.canvas.errorsSent', { agent: agentName })}
                </Text>
              ))}
            {pageErrors.errors.length > 0 && (
              <>
                <Text size="T300">{t('mindroomUi.canvas.pageError')}</Text>
                <pre className={css.Data}>{pageErrors.errors.join('\n')}</pre>
                <Box>
                  <Button
                    size="300"
                    variant="Secondary"
                    disabled={reportOpen}
                    onClick={handleReport}
                    data-canvas-report
                    fill="Soft"
                    outlined
                    radii="300"
                  >
                    <Text size="B300" truncate>
                      {t('mindroomUi.canvas.tellAgent', { agent: agentName })}
                    </Text>
                  </Button>
                </Box>
              </>
            )}
          </div>
        </div>
      )}

      {displayed.status && (
        <Box grow="Yes" direction="Column" alignItems="Center" justifyContent="Center" gap="300">
          <Text
            className={displayed.status === 'failed' ? css.Error : undefined}
            size="T300"
            role={displayed.status === 'failed' ? 'alert' : 'status'}
          >
            {displayed.status === 'loading'
              ? t('mindroomUi.canvas.loading')
              : t('mindroomUi.canvas.loadFailed')}
          </Text>
          {displayed.status === 'failed' && onRetry && (
            <Button
              size="300"
              variant="Secondary"
              onClick={onRetry}
              fill="Soft"
              outlined
              radii="300"
            >
              <Text size="B300">{t('mindroomUi.canvas.retry')}</Text>
            </Button>
          )}
        </Box>
      )}
      {!displayed.status && escaped && (
        <Box grow="Yes" direction="Column" alignItems="Center" justifyContent="Center" gap="300">
          <Text className={css.Error} size="T300" role="alert">
            {t('mindroomUi.canvas.escaped')}
          </Text>
          <Button
            size="300"
            variant="Secondary"
            data-canvas-reload
            onClick={() => setReloads((count) => count + 1)}
            fill="Soft"
            outlined
            radii="300"
          >
            <Text size="B300">{t('mindroomUi.canvas.reload')}</Text>
          </Button>
        </Box>
      )}
      {!displayed.status && !escaped && (
        <iframe
          key={frameKey}
          ref={frameRef}
          className={css.Frame}
          title={displayed.title}
          sandbox={CANVAS_WRAPPER_SANDBOX}
          allow={CANVAS_PERMISSIONS}
          srcDoc={doc}
          referrerPolicy="no-referrer"
          onLoad={handleLoad}
        />
      )}

      <div className={css.Footer}>
        {staged && (
          <div className={css.Staged}>
            <Text size="T300">
              {t('mindroomUi.canvas.sendTo', { agent: agentName })}{' '}
              <b>{staged.submission.label ?? t('mindroomUi.canvas.unlabeled')}</b>
            </Text>
            {staged.resubmitted && (
              <Text size="T200" priority="300">
                {t('mindroomUi.canvas.changeAnswer')}
              </Text>
            )}
            <details>
              <summary>
                <Text as="span" size="T200">
                  {t('mindroomUi.canvas.data')}
                </Text>
              </summary>
              <pre className={css.Data}>{formatData(staged.submission.data)}</pre>
            </details>
            <Box gap="200">
              <Button
                size="300"
                variant="Primary"
                disabled={!staged.armed || busy}
                onClick={handleSend}
                data-canvas-send
                fill="Soft"
                outlined
                radii="300"
              >
                <Text size="B300">{t('mindroomUi.canvas.send')}</Text>
              </Button>
              <Button
                size="300"
                variant="Secondary"
                fill="None"
                onClick={handleDiscard}
                data-canvas-discard
              >
                <Text size="B300">{t('mindroomUi.canvas.discard')}</Text>
              </Button>
            </Box>
          </div>
        )}
        {shared && (
          <Text size="T200" priority="300" data-canvas-shared>
            {t('mindroomUi.canvas.sharedNotice', { agent: agentName })}
          </Text>
        )}
        <div role="status" data-canvas-status>
          {answer === 'failed' && lastAnswer ? (
            <FailedSendActions
              room={room}
              event={lastAnswer.echo}
              message={t('mindroomUi.canvas.notSent', {
                agent: agentName,
                label: lastAnswer.label,
              })}
            />
          ) : (
            <Text size="T200" priority="300" className={sendError ? css.Error : undefined}>
              {footer === 'refused' && t('mindroomUi.canvas.sendFailed')}
              {footer === 'sending' && t('mindroomUi.canvas.sending', { agent: agentName })}
              {footer === 'sent' &&
                lastAnswer &&
                t('mindroomUi.canvas.sent', { agent: agentName, label: lastAnswer.label })}
              {(footer === 'idle' || footer === 'cancelled') &&
                t('mindroomUi.canvas.disclosure', { agent: agentName })}
            </Text>
          )}
        </div>
      </div>
    </aside>
  );
}
