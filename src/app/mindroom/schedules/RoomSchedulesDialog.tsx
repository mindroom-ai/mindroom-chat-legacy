import React, { forwardRef, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Box, Button, Icon, IconButton, Icons, Text } from 'folds';
import { PageScroll } from '../../components/page';
import { Header, Modal } from '../../components/glass/GlassPrimitives';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMentionClickHandler } from '../../hooks/useMentionClickHandler';
import { getMatrixToUser } from '../../plugins/matrix-to';
import {
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../plugins/react-custom-html-parser';
import { isUserId } from '../../utils/matrix';
import { parseScheduleTimestamp, type ParsedScheduledTask } from '../threads/scheduledTaskContract';
import { getScheduleTimestamp } from './roomSchedules';
import * as css from './roomSchedules.css';

function ScheduleCard({
  roomId,
  task,
  now,
  formatter,
  onOpenThread,
}: {
  roomId: string;
  task: ParsedScheduledTask;
  now: number;
  formatter: Intl.DateTimeFormat;
  onOpenThread: (threadId: string) => void;
}) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const mentionClickHandler = useMentionClickHandler(roomId);
  const creatorMention =
    task.createdBy && isUserId(task.createdBy)
      ? renderMatrixMention(mx, roomId, getMatrixToUser(task.createdBy), {
          ...makeMentionCustomProps(mentionClickHandler),
          title: task.createdBy,
        })
      : undefined;
  const executionTime = getScheduleTimestamp(task);
  const createdTime = parseScheduleTimestamp(task.createdAt);
  const updatedTime = parseScheduleTimestamp(task.updatedAt);
  const recurring = task.scheduleType === 'cron' || !!task.cronExpression || !!task.cronDescription;
  // Cron fields are UTC; the runtime writes the description in the task's own wall time.
  const utcCronExpression = task.cronExpression ? (
    <bdi>{task.cronExpression} (UTC)</bdi>
  ) : undefined;

  return (
    <Box as="article" direction="Column" gap="300" className={css.Card}>
      <Box direction="Column" gap="200">
        <Box gap="100" wrap="Wrap">
          <Badge size="500" variant="Secondary" fill="Soft" radii="Pill">
            <Text size="L400">
              {recurring ? t('roomSchedules.recurring') : t('roomSchedules.once')}
            </Text>
          </Badge>
          {task.silent && (
            <Badge size="500" variant="Secondary" fill="Soft" radii="Pill">
              <Text size="L400">{t('roomSchedules.silent')}</Text>
            </Badge>
          )}
          {task.isConditional && (
            <Badge size="500" variant="Secondary" fill="Soft" radii="Pill">
              <Text size="L400">{t('roomSchedules.conditional')}</Text>
            </Badge>
          )}
        </Box>
        <Text as="h3" size="H5" className={css.Wrap} dir="auto">
          {task.description ?? task.taskId}
        </Text>
        {recurring ? (
          <Box direction="Column" gap="100">
            <Text size="L400" priority="300">
              {t('roomSchedules.recurrence')}
            </Text>
            <Text size="T300" className={css.Wrap}>
              {task.cronDescription ? (
                <span dir="auto">{task.cronDescription}</span>
              ) : (
                utcCronExpression ?? t('roomSchedules.unknownTime')
              )}
            </Text>
            {task.cronDescription && utcCronExpression && (
              <Text size="T200" priority="300" className={css.Wrap}>
                {utcCronExpression}
              </Text>
            )}
          </Box>
        ) : (
          <Box direction="Column" gap="100">
            <Text size="L400" priority="300">
              {t('roomSchedules.executionTime')}
            </Text>
            <Text size="T300">
              {executionTime === undefined ? (
                t('roomSchedules.unknownTime')
              ) : (
                <time dateTime={new Date(executionTime).toISOString()}>
                  {formatter.format(executionTime)}
                </time>
              )}
            </Text>
            {executionTime !== undefined && executionTime <= now && (
              <Text size="T200" className={css.Awaiting}>
                {t('roomSchedules.awaitingExecution')}
              </Text>
            )}
          </Box>
        )}
      </Box>
      <Box direction="Column" gap="100">
        <Text size="L400" priority="300">
          {t('roomSchedules.prompt')}
        </Text>
        <Text as="p" size="T300" className={css.Prompt} dir="auto">
          {task.message ?? t('roomSchedules.promptUnavailable')}
        </Text>
      </Box>
      <dl className={css.Metadata}>
        <Text as="dt" size="T200" priority="300">
          {t('roomSchedules.model')}
        </Text>
        <Text as="dd" size="T200" className={css.Wrap}>
          {task.model ? <bdi>{task.model}</bdi> : t('roomSchedules.inheritedModel')}
        </Text>
        {task.createdBy && (
          <>
            <Text as="dt" size="T200" priority="300">
              {t('roomSchedules.owner')}
            </Text>
            <Text as="dd" size="T200" className={css.Wrap}>
              <bdi>{creatorMention ?? task.createdBy}</bdi>
            </Text>
          </>
        )}
        {createdTime !== undefined && (
          <>
            <Text as="dt" size="T200" priority="300">
              {t('roomSchedules.createdAt')}
            </Text>
            <Text as="dd" size="T200">
              <time dateTime={new Date(createdTime).toISOString()}>
                {formatter.format(createdTime)}
              </time>
            </Text>
          </>
        )}
        {updatedTime !== undefined && (
          <>
            <Text as="dt" size="T200" priority="300">
              {t('roomSchedules.updatedAt')}
            </Text>
            <Text as="dd" size="T200">
              <time dateTime={new Date(updatedTime).toISOString()}>
                {formatter.format(updatedTime)}
              </time>
            </Text>
          </>
        )}
        {task.historyLimit !== undefined && (
          <>
            <Text as="dt" size="T200" priority="300">
              {t('roomSchedules.historyLimit')}
            </Text>
            <Text as="dd" size="T200">
              {task.historyLimit === null
                ? t('roomSchedules.fullHistory')
                : task.historyLimit === 0
                ? t('roomSchedules.noHistory')
                : t('roomSchedules.recentMessages', { total: task.historyLimit })}
            </Text>
          </>
        )}
        <Text as="dt" size="T200" priority="300">
          {t('roomSchedules.taskId')}
        </Text>
        <Text as="dd" size="T200" className={css.Wrap}>
          <bdi>{task.taskId}</bdi>
        </Text>
      </dl>
      <Box>
        {task.newThread ? (
          <Text size="T200" priority="300">
            {t('roomSchedules.newThread')}
          </Text>
        ) : task.threadId ? (
          <Button
            size="300"
            variant="Secondary"
            fill="Soft"
            onClick={() => onOpenThread(task.threadId!)}
            outlined
            radii="300"
          >
            <Icon size="100" src={Icons.Thread} />
            <Text size="T200">{t('roomSchedules.openThread')}</Text>
          </Button>
        ) : (
          <Text size="T200" priority="300">
            {t('roomSchedules.roomTimeline')}
          </Text>
        )}
      </Box>
    </Box>
  );
}

export const RoomSchedulesDialog = forwardRef<
  HTMLDivElement,
  {
    roomId: string;
    tasks: readonly ParsedScheduledTask[];
    onClose: () => void;
    onOpenThread: (threadId: string) => void;
  }
>(({ roomId, tasks, onClose, onOpenThread }, ref) => {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const [now, setNow] = useState(Date.now);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const formatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'long' }),
    [locale]
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <Modal
      ref={ref}
      size="400"
      flexHeight
      className={css.Dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <PageScroll
        header={
          <Header size="500" className={css.Header}>
            <Box grow="Yes" alignItems="Center" gap="200">
              <Icon size="200" src={Icons.Clock} />
              <Text as="h2" id={titleId} size="H4">
                {t('roomSchedules.title')}
              </Text>
              <Text size="T200" priority="300">
                {tasks.length}
              </Text>
            </Box>
            <IconButton
              size="300"
              radii="300"
              aria-label={t('roomSchedules.close')}
              onClick={onClose}
            >
              <Icon src={Icons.Cross} />
            </IconButton>
          </Header>
        }
      >
        <Box direction="Column" gap="300" className={css.Content}>
          {tasks.length === 0 ? (
            <Box direction="Column" gap="200" className={css.Empty}>
              <Text size="T400">{t('roomSchedules.empty')}</Text>
              <Text size="T300" priority="300">
                {t('roomSchedules.emptyHint')}
              </Text>
            </Box>
          ) : (
            tasks.map((task) => (
              <ScheduleCard
                key={task.taskId}
                roomId={roomId}
                task={task}
                now={now}
                formatter={formatter}
                onOpenThread={onOpenThread}
              />
            ))
          )}
        </Box>
      </PageScroll>
    </Modal>
  );
});
