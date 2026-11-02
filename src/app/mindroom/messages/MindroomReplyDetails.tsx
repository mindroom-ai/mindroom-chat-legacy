import React, { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'folds';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { ProviderModelIcon } from '../models/ProviderModelIcon';
import { IconTooltip } from '../tooltip/IconTooltip';
import type { ThreadConversationCost } from '../threads/threadConversationCost';
import { useThreadConversationCost } from '../threads/useThreadConversationCost';
import { MindroomAiRunInfo } from './aiRun';
import {
  formatMindroomAiRunNumber,
  formatMindroomAiRunPercentage,
  formatMindroomAiRunTimeToFirstToken,
  formatMindroomCostUsd,
  getMindroomAiRunCompactModelLabel,
  getMindroomAiRunContextBarSegments,
  getMindroomAiRunContextLabel,
  getMindroomAiRunTokenParts,
} from './aiRunDisplay';
import * as css from './MindroomReplyDetails.css';

// Enough bars to read a long thread's shape without each one shrinking to a hairline.
const MAX_HISTORY_BARS = 40;

function Section({
  title,
  value,
  children,
}: {
  title: string;
  value?: string;
  children: ReactNode;
}) {
  return (
    <section className={css.Section}>
      <div className={css.SectionHeader}>
        <Text as="h3" size="L400" priority="300">
          {title}
        </Text>
        {value && (
          <Text size="T200" className={css.HeaderValue}>
            {value}
          </Text>
        )}
      </div>
      {children}
    </section>
  );
}

type MeterPart = {
  key: keyof typeof css.Segment;
  label: string;
  tokens: number;
  percentage: number;
};

/**
 * A bar split into parts, each naming its tokens and share on hover. A bar without a legend
 * names its parts to screen readers itself.
 */
function Meter({ parts, legend = false }: { parts: MeterPart[]; legend?: boolean }) {
  const language = useAppLanguageCode();
  const amount = (part: MeterPart) =>
    `${formatMindroomAiRunNumber(part.tokens, language)} · ${formatMindroomAiRunPercentage(
      part.percentage,
      language
    )}`;
  return (
    <div
      className={css.Meter}
      aria-hidden={legend || undefined}
      role={legend ? undefined : 'img'}
      aria-label={
        legend ? undefined : parts.map((part) => `${part.label} ${amount(part)}`).join(', ')
      }
    >
      {parts.map((part) => (
        <IconTooltip key={part.key} label={part.label} hint={amount(part)} position="Top">
          {(triggerRef) => (
            <span
              ref={triggerRef}
              className={css.Segment[part.key]}
              style={{ width: `${part.percentage}%` }}
            />
          )}
        </IconTooltip>
      ))}
    </div>
  );
}

/** Each priced reply's cost as a bar, this reply highlighted, in a window around it for long threads. */
function CostHistory({ threadCost, index }: { threadCost: ThreadConversationCost; index: number }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  // The reply under the pointer, which the caption names in place of this one. It is kept by
  // event ID, because replies can arrive or be redacted while the dialog is open.
  const [pointedId, setPointedId] = useState<string>();
  const { replies, complete } = threadCost;
  const pointedIndex = replies.findIndex((reply) => reply.eventId === pointedId);
  const pointed = pointedIndex < 0 ? undefined : pointedIndex;
  const start = Math.max(
    0,
    Math.min(index - MAX_HISTORY_BARS / 2, replies.length - MAX_HISTORY_BARS)
  );
  const shown = replies.slice(start, start + MAX_HISTORY_BARS);
  const highest = Math.max(...shown.map(({ usd }) => usd));
  // Without older replies the numbers would be wrong, so a reply is named by its cost alone.
  const replyLabel = (position: number) => {
    const cost = formatMindroomCostUsd(replies[position].usd, language);
    return complete
      ? t('mindroomUi.messages.mindroomReplyDetails.costHistoryBar', { index: position + 1, cost })
      : cost;
  };
  // Reading the bar from the pointer's position lets a finger drag across the bars as a mouse does.
  const point = (event: React.PointerEvent<HTMLOListElement>) => {
    const x = event.clientX;
    const bars = [...event.currentTarget.children].map((bar) => bar.getBoundingClientRect());
    if (!bars.some((bar) => x >= bar.left) || !bars.some((bar) => x <= bar.right)) {
      setPointedId(undefined);
      return;
    }
    // The nearest bar, whichever way the bars run, so right-to-left languages point right too.
    const distance = (bar: DOMRect) => Math.abs(x - (bar.left + bar.right) / 2);
    const offset = bars.reduce(
      (nearest, bar, candidate) => (distance(bar) < distance(bars[nearest]) ? candidate : nearest),
      0
    );
    setPointedId(shown[offset].eventId);
  };
  let caption: string;
  if (pointed !== undefined) caption = replyLabel(pointed);
  else if (complete) {
    caption = t('mindroomUi.messages.mindroomReplyDetails.costHistoryPosition', {
      index: index + 1,
      count: replies.length,
    });
  } else caption = t('mindroomUi.messages.mindroomReplyDetails.thisReply');
  return (
    <div>
      {/* A list, so a screen reader reads each reply's cost without pointing at it. */}
      <ol
        className={css.Bars}
        aria-label={t('mindroomUi.messages.mindroomReplyDetails.costHistory')}
        onPointerDown={point}
        onPointerMove={point}
        onPointerLeave={(event) => {
          // A tap keeps its reply named after the finger lifts.
          if (event.pointerType === 'mouse') setPointedId(undefined);
        }}
        // A finger that starts a vertical scroll on the bars did not mean to point at one.
        onPointerCancel={() => setPointedId(undefined)}
      >
        {shown.map(({ eventId, usd }, offset) => {
          const position = start + offset;
          const place = position < index ? 'earlier' : position === index ? 'current' : 'later';
          return (
            <li
              key={eventId}
              data-position={place}
              data-pointed={position === pointed ? 'true' : undefined}
              aria-current={place === 'current' ? 'true' : undefined}
              className={css.Bar[place]}
              style={{ height: `${Math.max(8, highest > 0 ? (usd / highest) * 100 : 0)}%` }}
            >
              <span className={css.HiddenLabel}>{replyLabel(position)}</span>
            </li>
          );
        })}
      </ol>
      <div className={css.Caption}>
        <span>{caption}</span>
        {/* A long thread shows a window of its replies; the range says which. */}
        {complete && shown.length < replies.length && (
          <span className={css.Range}>
            {start + 1}–{start + shown.length}
          </span>
        )}
      </div>
    </div>
  );
}

function CostCard({ costUsd, eventId }: { costUsd: number; eventId?: string }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const threadCost = useThreadConversationCost();
  const throughReply = eventId ? threadCost?.byEventId.get(eventId) : undefined;
  const index =
    threadCost && eventId ? threadCost.replies.findIndex((reply) => reply.eventId === eventId) : -1;
  const conversationCost = throughReply && formatMindroomCostUsd(throughReply.usd, language);
  return (
    <section
      className={css.CostCard}
      aria-label={t('mindroomUi.messages.mindroomReplyDetails.cost')}
    >
      <div className={throughReply ? css.CostFigures.two : css.CostFigures.one}>
        <div className={css.CostFigure}>
          <span className={css.CostLabel}>
            {t('mindroomUi.messages.mindroomReplyDetails.thisReply')}
          </span>
          <span className={css.CostValue}>{formatMindroomCostUsd(costUsd, language)}</span>
        </div>
        {threadCost && throughReply && (
          <div className={css.CostFigure}>
            <span className={css.CostLabel}>
              {t('mindroomUi.messages.mindroomReplyDetails.conversationSoFar')}
            </span>
            <span className={css.CostValue}>
              {threadCost.complete
                ? conversationCost
                : t('mindroomUi.messages.mindroomReplyDetails.atLeastCost', {
                    cost: conversationCost,
                  })}
            </span>
            <span className={css.CostNote}>
              {threadCost.complete
                ? t('mindroomUi.messages.mindroomReplyDetails.replyCount', {
                    count: throughReply.replyCount,
                  })
                : t('mindroomUi.messages.mindroomReplyDetails.loadedReplyCount', {
                    count: throughReply.replyCount,
                  })}
            </span>
          </div>
        )}
      </div>
      {threadCost && index >= 0 && threadCost.replies.length > 1 && (
        <CostHistory threadCost={threadCost} index={index} />
      )}
    </section>
  );
}

function Tokens({ info }: { info: MindroomAiRunInfo }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const tokens = getMindroomAiRunTokenParts(info, t);
  if (!tokens) return null;
  return (
    <Section
      title={t('mindroomUi.messages.mindroomReplyDetails.tokens')}
      value={formatMindroomAiRunNumber(tokens.total, language)}
    >
      <Meter parts={tokens.parts} legend />
      <ul className={css.Legend}>
        {tokens.parts.map((part) => (
          <Text as="li" key={part.key} size="T200" className={css.LegendItem}>
            <span className={css.Swatch[part.key]} aria-hidden />
            <Text as="span" size="T200" priority="300">
              {part.label}
            </Text>{' '}
            {formatMindroomAiRunNumber(part.tokens, language)}
          </Text>
        ))}
      </ul>
    </Section>
  );
}

function ContextWindow({ info }: { info: MindroomAiRunInfo }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const usage = getMindroomAiRunContextLabel(info, t, language);
  if (!usage) return null;
  const segments = getMindroomAiRunContextBarSegments(info, t);
  return (
    <Section title={t('mindroomUi.messages.mindroomReplyDetails.contextWindow')} value={usage}>
      {/* The bar's track is the unused part of the window. */}
      {segments && <Meter parts={segments} />}
    </Section>
  );
}

function Activity({ info }: { info: MindroomAiRunInfo }) {
  const { t } = useTranslation();
  const firstToken = formatMindroomAiRunTimeToFirstToken(info.timeToFirstToken);
  if (info.toolCount === undefined && !firstToken) return null;
  return (
    <Text as="div" size="T200" priority="300" className={css.Meta}>
      {info.toolCount !== undefined && (
        <span>
          {t('mindroomUi.messages.mindroomReplyDetails.toolCallCount', { count: info.toolCount })}
        </span>
      )}
      {firstToken && (
        <span>
          {t('mindroomUi.messages.mindroomReplyDetails.timeToFirstToken')}{' '}
          <span className={css.MetaValue}>{firstToken}</span>
        </span>
      )}
    </Text>
  );
}

const STATUS_LABEL_KEYS = {
  error: 'mindroomUi.messages.mindroomReplyDetails.failed',
  cancelled: 'mindroomUi.messages.mindroomReplyDetails.stopped',
} as const;

const isFlaggedStatus = (status: string | undefined): status is keyof typeof STATUS_LABEL_KEYS =>
  status === 'error' || status === 'cancelled';

/** What a MindRoom reply ran on, what it and the conversation cost, and what it used. */
export function MindroomReplyDetails({
  info,
  eventId,
}: {
  info: MindroomAiRunInfo;
  eventId?: string;
}) {
  const { t } = useTranslation();
  const modelLabel = getMindroomAiRunCompactModelLabel(info);
  const modelSource = [info.modelProvider, info.modelId].filter(Boolean).join(' · ');
  const status = info.status?.toLowerCase();

  return (
    <div className={css.Body}>
      {(modelLabel || isFlaggedStatus(status)) && (
        <div className={css.Lead}>
          {modelLabel && (
            <span className={css.Tile}>
              <ProviderModelIcon provider={info.modelProvider} id={info.modelId} size={20} />
            </span>
          )}
          <div className={css.ModelName}>
            {modelLabel && (
              <Text size="T400" truncate>
                <b>{modelLabel}</b>
              </Text>
            )}
            {modelSource && (
              <Text size="T200" priority="300" className={css.ModelSource}>
                {modelSource}
              </Text>
            )}
          </div>
          {isFlaggedStatus(status) && (
            <span className={css.Status[status]}>{t(STATUS_LABEL_KEYS[status])}</span>
          )}
        </div>
      )}
      {info.costUsd !== undefined && <CostCard costUsd={info.costUsd} eventId={eventId} />}
      <Tokens info={info} />
      <ContextWindow info={info} />
      <Activity info={info} />
      {(info.modelConfig || info.runId || info.sessionId) && (
        <details>
          <Text as="summary" size="T200" priority="300" className={css.TechnicalSummary}>
            {t('mindroomUi.messages.mindroomReplyDetails.technicalDetails')}
          </Text>
          <dl className={css.TechnicalRows}>
            {(
              [
                [t('mindroomUi.messages.mindroomReplyDetails.configuredModel'), info.modelConfig],
                [t('mindroomUi.messages.mindroomReplyDetails.runId'), info.runId],
                [t('mindroomUi.messages.mindroomReplyDetails.sessionId'), info.sessionId],
              ] as const
            ).map(([label, value]) =>
              value === undefined ? null : (
                <React.Fragment key={label}>
                  <Text as="dt" size="T200" priority="300">
                    {label}
                  </Text>
                  <Text as="dd" size="T200" className={css.Identifier}>
                    {value}
                  </Text>
                </React.Fragment>
              )
            )}
          </dl>
        </details>
      )}
    </div>
  );
}
