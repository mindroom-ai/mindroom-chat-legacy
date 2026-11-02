import { useTranslation } from 'react-i18next';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Input,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
} from 'folds';
import { PageScroll } from '../../components/page';
import { Dialog, Header } from '../../components/glass/GlassPrimitives';
import { useGlassHighlight } from '../../components/glass/liquid/useLiquidGlass';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { glassDenseOverBackdrop } from '../../styles/Glass.css';
import { useThreadApprovals } from './ThreadApprovalProvider';
import { groupApprovalRecords, ThreadApprovalRecord } from './threadApprovalModel';
import { getToolApprovalOperationLabel, parseToolApprovalExpiryTimestamp } from './toolApproval';
import { mergeArgumentFields, summarizeArguments } from './argumentFields';
import { formatApprovalTime, formatExpiryDistance } from './approvalScheduleText';
import { ApprovalArgumentFields } from './ApprovalArgumentFields';
import { ActivityIcon, ThreadActivity } from './ThreadActivity';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { ApprovalReviewCall } from './ApprovalReviewCall';
import { getApprovalCapabilities, getApprovalGrantState } from './approvalActions';
import { ApprovalGrantStatus } from './ApprovalGrantStatus';
import { ApprovalReceipt } from './ApprovalReceipt';
import {
  describeApprovalChip,
  describeApprovalHistory,
  describeReviewHeader,
  describeWaitingApprovals,
} from './approvalLabels';
import { agentDisplayName, useApprovalRoom, userDisplayName } from './approvalPeople';
import {
  ApprovalAgentAvatar,
  ApprovalDurations,
  ApprovalMeta,
  ApprovalSectionHeader,
} from './ApprovalSection';
import * as css from './ThreadApprovals.css';

export function ApprovalDialog({
  title,
  subtitle,
  leading,
  onClose,
  children,
  returnFocus,
}: {
  title: string;
  subtitle?: string;
  leading?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  returnFocus: React.RefObject<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const context = useThreadApprovals();
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            setReturnFocus: () => returnFocus.current ?? false,
            onDeactivate: onClose,
            onPostDeactivate: () => {
              if (!returnFocus.current?.isConnected) context?.focusConversation?.();
            },
            clickOutsideDeactivates: true,
          }}
        >
          <Dialog
            className={glassDenseOverBackdrop}
            variant="Background"
            role="dialog"
            aria-modal="true"
            style={{ width: '40rem', maxWidth: 'calc(100vw - 24px)' }}
            aria-label={title}
          >
            <PageScroll
              className={css.DialogScroll}
              header={
                <Header
                  size={subtitle ? '600' : '500'}
                  variant="Surface"
                  style={{ padding: '0 12px' }}
                >
                  <Box grow="Yes" alignItems="Center" gap="300">
                    {leading}
                    <Box direction="Column" className={css.DialogHeading}>
                      <Text size={subtitle ? 'H5' : 'H4'}>{title}</Text>
                      {subtitle && (
                        <Text size="T200" priority="300">
                          {subtitle}
                        </Text>
                      )}
                    </Box>
                  </Box>
                  <IconButton
                    size="300"
                    aria-label={t('mindroomUi.messages.threadApprovalControls.close')}
                    onClick={onClose}
                  >
                    <Icon src={Icons.Cross} />
                  </IconButton>
                </Header>
              }
            >
              <div className={css.DialogBody}>{children}</div>
            </PageScroll>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

export function ApprovalGroup({
  children,
  flat = false,
}: {
  children: React.ReactNode;
  flat?: boolean;
}) {
  const glassRef = useGlassHighlight<HTMLElement>(undefined, !flat);
  return (
    <section ref={glassRef} className={flat ? css.Section : css.Group}>
      {children}
    </section>
  );
}

export function ApprovalReviewGroup({
  records,
  flat = false,
  showMeta = true,
}: {
  records: readonly ThreadApprovalRecord[];
  flat?: boolean;
  /** The review sheet names the agent and requester once in its header. */
  showMeta?: boolean;
}) {
  const { t } = useTranslation();
  const context = useThreadApprovals();
  const user = useMatrixClient().getUserId();
  const room = useApprovalRoom();
  const [reason, setReason] = useState('');
  const [denyingAll, setDenyingAll] = useState(false);
  const reasonInput = useRef<HTMLInputElement>(null);
  const callsId = useId();
  const records0 = records[0];
  const availableCount = context
    ? records.filter(
        (record) =>
          getApprovalCapabilities(record, user, context.actions.get(record.eventId), context.now)
            .deny && record.approval.approvable
      ).length
    : 0;
  // Bulk approval stands in for the calls; without it, each call needs its own controls.
  const [showCalls, setShowCalls] = useState(availableCount <= 1);
  useEffect(() => {
    if (denyingAll) reasonInput.current?.focus();
  }, [denyingAll]);
  if (!context || !records0) return null;
  const { approval } = records0;
  const available = records.filter(
    (record) =>
      getApprovalCapabilities(record, user, context.actions.get(record.eventId), context.now).deny
  );
  const approvable = available.filter((record) => record.approval.approvable);
  const timed =
    approval.approverUserId === user && approval.scope && approvable.length === available.length
      ? approval.autoApproveOptions.filter((duration) =>
          approvable.every((record) =>
            getApprovalCapabilities(
              record,
              user,
              context.actions.get(record.eventId),
              context.now
            ).durations.includes(duration)
          )
        )
      : [];
  const chip = describeApprovalChip(records, context.actions, context.now, available.length > 0);
  // Bulk actions stand in for the calls; once they no longer apply, list every call.
  const bulk = available.length > 1;
  const single = records.length === 1;
  const callsListed = single || !bulk || showCalls;
  const calls = records.map((record, index) => (
    <ApprovalReviewCall
      key={record.eventId}
      record={record}
      index={index}
      single={single}
      offersDurations={timed.length > 0}
      userId={user}
      action={context.actions.get(record.eventId)}
      now={context.now}
      submit={context.submit}
    />
  ));
  return (
    <ApprovalGroup flat={flat}>
      <ApprovalSectionHeader
        operation={getToolApprovalOperationLabel(approval)}
        count={records.length}
        chip={chip}
      />
      <div className={css.SectionBody}>
        {showMeta && <ApprovalMeta approval={approval} room={room} viewerId={user} />}
        {single || !bulk ? (
          calls
        ) : (
          <>
            {!showCalls && (
              <ApprovalArgumentFields
                value={records.map((record) => record.approval.arguments)}
                limit={3}
                parse={mergeArgumentFields}
              />
            )}
            <Button
              type="button"
              size="300"
              variant="Secondary"
              fill="Soft"
              radii="300"
              className={css.CallsToggle}
              aria-expanded={showCalls}
              aria-controls={callsId}
              onClick={() => setShowCalls((value) => !value)}
              before={<Icon size="50" src={showCalls ? Icons.ChevronTop : Icons.ChevronBottom} />}
              outlined
            >
              <Text size="B300">
                {showCalls
                  ? t('mindroomUi.messages.threadApprovalControls.hideCalls')
                  : t('mindroomUi.messages.threadApprovalControls.showCalls', {
                      count: records.length,
                    })}
              </Text>
            </Button>
            {showCalls && <div id={callsId}>{calls}</div>}
          </>
        )}
        {bulk && !denyingAll && (
          <div className={css.Actions}>
            {approvable.length > 1 && (
              <Button
                size="300"
                variant="Primary"
                fill="Soft"
                onClick={() => {
                  approvable.forEach((record) => {
                    void context.submit(record, { status: 'approved' });
                  });
                }}
                outlined
                radii="300"
              >
                <Text size="B300">
                  {t('mindroomUi.messages.threadApprovalControls.approveAllOnce', {
                    count: approvable.length,
                  })}
                </Text>
              </Button>
            )}
            <Button
              size="300"
              variant="Critical"
              fill="Soft"
              onClick={() => setDenyingAll(true)}
              outlined
              radii="300"
            >
              <Text size="B300">
                {t('mindroomUi.messages.threadApprovalControls.denyAll', {
                  count: available.length,
                })}
              </Text>
            </Button>
          </div>
        )}
        {bulk && denyingAll && (
          <form
            className={css.DenyRow}
            onSubmit={(event) => {
              event.preventDefault();
              available.forEach((record) => {
                void context.submit(record, { status: 'denied', reason });
              });
              setDenyingAll(false);
              setReason('');
            }}
          >
            <Input
              ref={reasonInput}
              aria-label={t(
                'mindroomUi.messages.threadApprovalControls.reasonForDenyingAllOptional'
              )}
              placeholder={t('mindroomUi.messages.approvalDecisionControls.denialReasonOptional')}
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
            <div className={css.Actions}>
              <Button type="submit" size="300" variant="Critical" fill="Soft" outlined radii="300">
                <Text size="B300">
                  {t('mindroomUi.messages.threadApprovalControls.confirmDenyAll', {
                    count: available.length,
                  })}
                </Text>
              </Button>
              <Button
                type="button"
                size="300"
                variant="Secondary"
                fill="Soft"
                outlined
                onClick={() => {
                  setDenyingAll(false);
                  setReason('');
                }}
                radii="300"
              >
                <Text size="B300">{t('mindroomUi.messages.approvalDecisionControls.cancel')}</Text>
              </Button>
            </div>
          </form>
        )}
        <ApprovalDurations
          durations={bulk && denyingAll ? [] : timed}
          disabled={approvable.length === 0}
          onPick={(duration) => {
            if (approvable[0]) void context.submit(approvable[0], { status: 'approved', duration });
          }}
          accessibleLabel={(duration) =>
            t('mindroomUi.messages.threadApprovalControls.allowForMinutes', {
              count: duration / 60,
            })
          }
          explanation={t(
            'mindroomUi.messages.threadApprovalControls.allowThisOperationForThisThreadRequesterAndAgentArguments'
          )}
        />
        {/* A listed call says this itself. */}
        {!callsListed &&
          records.some(
            (record) =>
              context.actions.get(record.eventId)?.status === 'submitted' &&
              context.pendingEventIds.has(record.eventId)
          ) && (
            <small role="status">
              {t('mindroomUi.messages.threadApprovalControls.submittedWaitingForRoomUpdate')}
            </small>
          )}
      </div>
    </ApprovalGroup>
  );
}

export function ThreadApprovalQueue() {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const context = useThreadApprovals();
  const mx = useMatrixClient();
  const user = mx.getUserId();
  const room = useApprovalRoom();
  const [selection, setSelection] = useState<string[][]>();
  const trigger = useRef<HTMLButtonElement>(null);
  const noticed = useRef(new Set<string>());
  const [pulse, setPulse] = useState(0);
  const actionableIds = useMemo(
    () =>
      context?.records
        .filter(
          (record) =>
            context.pendingEventIds.has(record.eventId) &&
            getApprovalCapabilities(record, user, context.actions.get(record.eventId), context.now)
              .deny
        )
        .map((record) => record.eventId) ?? [],
    [context, user]
  );
  const needsAttention = actionableIds.length > 0;
  useEffect(() => {
    const hasNewRequest = actionableIds.some((id) => !noticed.current.has(id));
    actionableIds.forEach((id) => noticed.current.add(id));
    if (selection || actionableIds.length === 0) setPulse(0);
    else if (hasNewRequest) setPulse((previous) => previous + 1);
  }, [actionableIds, selection]);
  if (!context) return null;
  const groups = groupApprovalRecords(
    context.records.filter((record) => context.pendingEventIds.has(record.eventId))
  );
  const awaitingOnly = groups
    .flat()
    .every(
      (record) =>
        context.actions.get(record.eventId)?.status === 'submitted' ||
        context.actions.get(record.eventId)?.status === 'sending'
    );
  const pendingCount = groups.reduce((sum, group) => sum + group.length, 0);
  const waiting =
    needsAttention && !awaitingOnly
      ? describeWaitingApprovals(
          groups.map((group) => group.filter((record) => actionableIds.includes(record.eventId)))
        )
      : undefined;
  const waitingText = waiting
    ? waiting.agents.length === 1
      ? t('mindroomUi.messages.threadApprovalControls.agentWaitingForYou', {
          agent: agentDisplayName(room, waiting.agents[0]),
        })
      : t('mindroomUi.messages.threadApprovalControls.agentsWaitingForYou', {
          count: waiting.agents.length,
        })
    : undefined;
  const waitingTools = waiting?.tools
    .map(({ operation, count }) => (count > 1 ? `${count}× ${operation}` : operation))
    .join(', ');
  let statusText =
    pendingCount > 0
      ? awaitingOnly
        ? t('mindroomUi.messages.threadApprovalControls.awaitingConfirmation', {
            count: pendingCount,
          })
        : waitingText ??
          t('mindroomUi.messages.threadApprovalControls.pausedForApproval', {
            count: pendingCount,
          })
      : context.error ?? '';
  if (context.loading && pendingCount > 0) {
    statusText = t('mindroomUi.messages.threadApprovalControls.statusCheckingHistory', {
      status: statusText,
    });
  }
  if (context.error && pendingCount > 0) {
    statusText = t('mindroomUi.messages.threadApprovalControls.statusHistoryIncomplete', {
      status: statusText,
    });
  }
  const reviewGroups = selection
    ? groupApprovalRecords(
        selection
          .flat()
          .flatMap((id) => context.records.find((record) => record.eventId === id) ?? [])
      )
    : [];
  const review = describeReviewHeader(reviewGroups.flat(), user);
  const reviewTitle =
    review.agents.length === 1
      ? t('mindroomUi.messages.threadApprovalControls.reviewAgentWants', {
          agent: agentDisplayName(room, review.agents[0]),
          count: review.count,
        })
      : review.agents.length > 1
      ? t('mindroomUi.messages.threadApprovalControls.reviewAgentsWant', {
          agents: review.agents.length,
          count: review.count,
        })
      : t('mindroomUi.messages.threadApprovalControls.reviewToolCalls');
  const reviewSubtitle = [
    review.requester &&
      t('mindroomUi.messages.threadApprovalControls.reviewRequestedBy', {
        requester:
          review.requester === 'you'
            ? t('mindroomUi.messages.threadApprovalControls.you')
            : userDisplayName(room, review.requester),
      }),
    review.expiresAt &&
      t('mindroomUi.messages.threadApprovalControls.expires', {
        time:
          formatExpiryDistance(review.expiresAt, Date.now(), language) ??
          formatApprovalTime(review.expiresAt, language),
      }),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      {(pendingCount > 0 || context.error) && (
        <div
          className={css.Bar}
          role="region"
          aria-label={t('mindroomUi.messages.threadApprovalControls.threadApprovals')}
        >
          <small className={css.BarStatus} role="status">
            {waiting?.agents.length === 1 ? (
              <ApprovalAgentAvatar room={room} agentName={waiting.agents[0]} />
            ) : (
              pendingCount > 0 && !awaitingOnly && <Icon src={Icons.Pause} size="50" aria-hidden />
            )}
            <span className={classNames(waiting && css.BarTitle)}>{statusText}</span>
            {waitingTools && <span className={css.BarDetail}>{` · ${waitingTools}`}</span>}
          </small>
          {pendingCount > 0 && (
            <Button
              ref={trigger}
              size="300"
              variant={needsAttention ? 'Warning' : 'Primary'}
              fill="Soft"
              className={classNames(css.ReviewButton, needsAttention && css.ReviewButtonPending)}
              onClick={() => {
                setPulse(0);
                setSelection(groups.map((group) => group.map((record) => record.eventId)));
              }}
              // ReviewButtonPending draws its own warning ring.
              outlined={!needsAttention}
              radii="300"
            >
              <Text size="B300">
                {t('mindroomUi.messages.threadApprovalControls.reviewCount', {
                  count: pendingCount,
                })}
              </Text>
              {needsAttention && !selection && pulse > 0 && (
                <span
                  key={pulse}
                  aria-hidden
                  className={css.ReviewPulse}
                  onAnimationEnd={() => setPulse(0)}
                />
              )}
            </Button>
          )}
          {context.error && (
            <button type="button" className={css.Chip} onClick={context.refresh}>
              {t('mindroomUi.messages.threadApprovalControls.retryHistory')}
            </button>
          )}
        </div>
      )}
      {selection && (
        <ApprovalDialog
          title={reviewTitle}
          subtitle={reviewSubtitle || undefined}
          leading={
            review.agents.length === 1 ? (
              <ApprovalAgentAvatar room={room} agentName={review.agents[0]} size="300" />
            ) : undefined
          }
          onClose={() => setSelection(undefined)}
          returnFocus={trigger}
        >
          {reviewGroups.map((records) => (
            <ApprovalReviewGroup
              key={records[0].eventId}
              records={records}
              flat
              showMeta={review.agents.length > 1 || review.requester === null}
            />
          ))}
          {selection
            .flat()
            .some((id) => !context.records.some((record) => record.eventId === id)) && (
            <p>
              {t('mindroomUi.messages.threadApprovalControls.someRequestsAreNoLongerAvailable')}
            </p>
          )}
        </ApprovalDialog>
      )}
    </>
  );
}

export function ThreadApprovalPermissions() {
  const { t } = useTranslation();
  const user = useMatrixClient().getUserId();
  const context = useThreadApprovals();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!context) return null;
  const grants = context.records.filter(
    ({ approval }) => getApprovalGrantState(approval, context.now) === 'active'
  );
  if (!open && grants.length === 0) return null;
  return (
    <>
      <button
        ref={trigger}
        className={css.HeaderChip}
        type="button"
        data-thread-status-chip=""
        onClick={() => setOpen(true)}
      >
        {t('mindroomUi.messages.threadApprovalControls.activePermissionCount', {
          count: grants.length,
        })}
      </button>
      {open && (
        <ApprovalDialog
          title={t('mindroomUi.messages.threadApprovalControls.activePermissions')}
          onClose={() => setOpen(false)}
          returnFocus={trigger}
        >
          {grants.length === 0 && (
            <p>{t('mindroomUi.messages.threadApprovalControls.noActiveTimedPermissions')}</p>
          )}
          {grants.map((record) => {
            const { approval, eventId } = record;
            return (
              <ApprovalGroup key={eventId}>
                <b>{getToolApprovalOperationLabel(approval)}</b>
                <small>
                  {t('mindroomUi.messages.threadApprovalControls.permissionScope', {
                    agent: approval.agentName,
                    requester: approval.requesterId,
                  })}
                </small>
                <ApprovalGrantStatus
                  record={record}
                  userId={user}
                  action={context.actions.get(record.eventId)}
                  now={context.now}
                  submit={context.submit}
                />
              </ApprovalGroup>
            );
          })}
        </ApprovalDialog>
      )}
    </>
  );
}

type HistoryStatus = 'approved' | 'denied' | 'expired';
const HISTORY_LABEL_KEYS = {
  you: {
    approved: 'mindroomUi.messages.threadApprovalControls.historyYouApproved',
    denied: 'mindroomUi.messages.threadApprovalControls.historyYouDenied',
    expired: 'mindroomUi.messages.threadApprovalControls.historyYouExpired',
  },
  user: {
    approved: 'mindroomUi.messages.threadApprovalControls.historyUserApproved',
    denied: 'mindroomUi.messages.threadApprovalControls.historyUserDenied',
    expired: 'mindroomUi.messages.threadApprovalControls.historyUserExpired',
  },
  nobody: {
    approved: 'mindroomUi.messages.threadApprovalControls.historyApproved',
    denied: 'mindroomUi.messages.threadApprovalControls.historyDenied',
    expired: 'mindroomUi.messages.threadApprovalControls.historyExpired',
  },
} as const;
const isHistoryStatus = (status: string): status is HistoryStatus =>
  status === 'approved' || status === 'denied' || status === 'expired';

export function ApprovalHistory({ records }: { records: readonly ThreadApprovalRecord[] }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const room = useApprovalRoom();
  const language = useAppLanguageCode();
  if (records.length === 0) return null;
  const approved = records.filter((record) => record.approval.status === 'approved').length;
  const summary = describeApprovalHistory(records, mx.getUserId());
  const single =
    summary.kind === 'single' && isHistoryStatus(summary.status)
      ? { ...summary, status: summary.status }
      : undefined;
  let singleLabel: string | undefined;
  if (single?.actor === 'you') {
    singleLabel = t(HISTORY_LABEL_KEYS.you[single.status], { operation: single.operation });
  } else if (single?.actor) {
    singleLabel = t(HISTORY_LABEL_KEYS.user[single.status], {
      user: userDisplayName(room, single.actor.userId),
      operation: single.operation,
    });
  } else if (single) {
    singleLabel = t(HISTORY_LABEL_KEYS.nobody[single.status], { operation: single.operation });
  }
  const resolvedTs = single
    ? parseToolApprovalExpiryTimestamp(records[0].approval.resolvedAt ?? '')
    : undefined;
  const detail = single
    ? [
        summarizeArguments(records[0].approval.arguments),
        resolvedTs !== undefined &&
          new Date(resolvedTs).toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' }),
      ]
        .filter(Boolean)
        .join(' · ')
    : t('mindroomUi.messages.threadApprovalControls.approvedCount', { count: approved });
  return (
    <ThreadActivity
      icon={
        <ActivityIcon
          src={
            single?.status === 'approved'
              ? Icons.Check
              : single?.status === 'denied'
              ? Icons.Cross
              : Icons.Terminal
          }
          tone={
            single?.status === 'approved'
              ? 'success'
              : single?.status === 'denied'
              ? 'critical'
              : 'neutral'
          }
        />
      }
      title={
        singleLabel ??
        t('mindroomUi.messages.threadApprovalControls.toolApprovalCount', {
          count: records.length,
        })
      }
      detail={detail || undefined}
    >
      <div className={css.HistoryBody}>
        {records.map((record) => (
          <ApprovalReceipt key={record.eventId} approval={record.approval} nested />
        ))}
      </div>
    </ThreadActivity>
  );
}
