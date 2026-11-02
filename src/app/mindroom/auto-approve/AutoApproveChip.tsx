import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { inSameDay } from '../../utils/time';
import { useAgentRoomState } from '../matrix/agentRoomState';
import { userDisplayName } from '../messages/approvalPeople';
import { ApprovalDialog, ApprovalGroup } from '../messages/ThreadApprovalControls';
import { usePageResume } from '../threads/usePageResume';
import {
  MINDROOM_AUTO_APPROVE_EVENT,
  openAutoApproveWindowsInThread,
  selectAutoApproveWindows,
} from './autoApproveContract';
import * as css from './AutoApproveChip.css';

// setTimeout fires at once past this many milliseconds, so a later end is reached in steps.
const MAX_TIMER_MS = 2_147_483_647;

/** When a window ends, in the viewer's clock format, with the day when that is not today. */
const formatEnd = (expiresAt: number, now: number, language: string, hour24Clock: boolean) =>
  new Date(expiresAt).toLocaleString(language, {
    weekday: inSameDay(expiresAt, now) ? undefined : 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: !hour24Clock,
  });

/**
 * Says in a thread's header that someone's tool calls there run without approval cards; it opens the list of
 * whose, and until when.
 */
export function AutoApproveChip({ room, threadId }: { room: Room; threadId: string }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [now, setNow] = useState(Date.now);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const windows = openAutoApproveWindowsInThread(
    useAgentRoomState(room, MINDROOM_AUTO_APPROVE_EVENT, selectAutoApproveWindows),
    threadId,
    now
  );
  const nextEnd = windows[0]?.expiresAt;

  // Timers can stop while a device sleeps, so a window that ended meanwhile goes as the page comes back.
  usePageResume(useCallback(() => setNow(Date.now()), []));
  useEffect(() => {
    if (nextEnd === undefined) return undefined;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(1, Math.min(MAX_TIMER_MS, nextEnd - Date.now()))
    );
    return () => clearTimeout(timer);
  }, [nextEnd, now]);

  if (windows.length === 0) {
    // The dialog closes with the last window, so a later window does not reopen it unasked.
    if (open) setOpen(false);
    return null;
  }
  const others = windows.filter(({ requesterId }) => requesterId !== room.myUserId);
  let label = t('mindroomUi.autoApprove.label');
  if (others.length === windows.length) {
    const name = userDisplayName(room, others[0].requesterId);
    label =
      others.length === 1
        ? t('mindroomUi.autoApprove.labelOne', { name })
        : t('mindroomUi.autoApprove.labelMany', { name, count: others.length - 1 });
  }
  return (
    <>
      <button
        ref={trigger}
        className={css.Chip}
        type="button"
        data-thread-status-chip=""
        onClick={() => {
          // The clock only moves at a window's end, so the dialog names today's ends without a weekday.
          setNow(Date.now());
          setOpen(true);
        }}
      >
        <Icon className={css.ChipIcon} src={Icons.Warning} size="50" aria-hidden="true" />
        {label}
      </button>
      {open && (
        <ApprovalDialog
          title={t('mindroomUi.autoApprove.title')}
          onClose={() => setOpen(false)}
          returnFocus={trigger}
        >
          <p>{t('mindroomUi.autoApprove.intro')}</p>
          {windows.map(({ requesterId, expiresAt }) => {
            const own = requesterId === room.myUserId;
            const time = formatEnd(expiresAt, now, language, hour24Clock);
            return (
              <ApprovalGroup key={requesterId}>
                <b>{own ? t('mindroomUi.autoApprove.you') : userDisplayName(room, requesterId)}</b>
                <small>
                  {own
                    ? t('mindroomUi.autoApprove.ownUntil', { time })
                    : t('mindroomUi.autoApprove.until', { time })}
                </small>
              </ApprovalGroup>
            );
          })}
        </ApprovalDialog>
      )}
    </>
  );
}
