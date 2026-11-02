import React, { useMemo, useState, type ReactNode } from 'react';
import { Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { HTMLReactParserOptions } from 'html-react-parser';
import type { Opts } from 'linkifyjs';
import { RenderBody } from '../../components/message';
import { renderLiveMarkdown, useLiveMarkdownReady } from '../live/liveMarkdown';
import { LIVE_ACTIVITY_KEY, LIVE_REASONING_KEY } from '../live/useLiveReplyContent';
import * as css from './MindroomReasoning.css';

/** On a reply's terminal edit: `{ text, duration_ms }` of the model reasoning it streamed. */
export const MINDROOM_REASONING_KEY = 'io.mindroom.reasoning';

type MindroomReasoningInfo = { text: string; durationMs?: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getMindroomReasoning = (
  content: Record<string, unknown>
): MindroomReasoningInfo | undefined => {
  const live = content[LIVE_REASONING_KEY];
  if (typeof live === 'string' && live) return { text: live };
  const reasoning = content[MINDROOM_REASONING_KEY];
  if (!isRecord(reasoning) || typeof reasoning.text !== 'string' || !reasoning.text) {
    return undefined;
  }
  const durationMs = reasoning.duration_ms;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return undefined;
  }
  return { text: reasoning.text, durationMs };
};

type MindroomReasoningProps = {
  reasoning: MindroomReasoningInfo;
  htmlReactParserOptions: HTMLReactParserOptions;
  linkifyOpts: Opts;
};

type MindroomReasoningTextProps = {
  text: string;
  htmlReactParserOptions: HTMLReactParserOptions;
  linkifyOpts: Opts;
};

/**
 * The reasoning as Markdown. It mounts only while its block is expanded, so collapsed final
 * reasoning loads no renderer.
 */
function MindroomReasoningText({
  text,
  htmlReactParserOptions,
  linkifyOpts,
}: MindroomReasoningTextProps) {
  const ready = useLiveMarkdownReady();
  // Live frames rerender the reply while the answer streams under unchanged reasoning.
  const html = useMemo(() => (ready ? renderLiveMarkdown(text) : undefined), [ready, text]);
  return (
    // A body without HTML, such as the thinking placeholder, keeps newlines, which would double the
    // line breaks of rendered Markdown; plain reasoning before the renderer loads keeps its newlines.
    <div style={{ whiteSpace: html === undefined ? 'pre-wrap' : 'normal' }}>
      <RenderBody
        body={text}
        customBody={html}
        htmlReactParserOptions={htmlReactParserOptions}
        linkifyOpts={linkifyOpts}
      />
    </div>
  );
}

/** A small text toggle over the reasoning, so it stays out of the way of the answer. */
function MindroomReasoningDisclosure({
  label,
  defaultExpanded,
  children,
}: {
  label: string;
  defaultExpanded: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className={css.Reasoning}>
      <button
        type="button"
        className={css.Toggle}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <Icon size="50" src={Icons.Bulb} aria-hidden />
        <span className={css.Label}>{label}</span>
        <Icon
          data-directional
          size="50"
          src={expanded ? Icons.ChevronBottom : Icons.ChevronRight}
          aria-hidden
        />
      </button>
      {expanded && <div className={css.Body}>{children}</div>}
    </div>
  );
}

/** Model reasoning: open while it streams, then collapsed with how long the model thought. */
function MindroomReasoning({
  reasoning,
  htmlReactParserOptions,
  linkifyOpts,
}: MindroomReasoningProps) {
  const { t } = useTranslation();
  const { durationMs } = reasoning;
  const live = durationMs === undefined;
  return (
    <MindroomReasoningDisclosure
      // The final reasoning starts collapsed, whatever the live block was.
      key={live ? 'live' : 'final'}
      label={
        live
          ? t('mindroomUi.messages.mindroomReasoning.thinking')
          : t('mindroomUi.messages.mindroomReasoning.thoughtFor', {
              count: Math.max(1, Math.round(durationMs / 1000)),
            })
      }
      defaultExpanded={live}
    >
      <MindroomReasoningText
        text={reasoning.text}
        htmlReactParserOptions={htmlReactParserOptions}
        linkifyOpts={linkifyOpts}
      />
    </MindroomReasoningDisclosure>
  );
}

/**
 * Activity text with its tool names in backticks as inline code, like the body shows them.
 * A failure's error, from its line's first `: `, keeps its backticks as sent.
 */
const renderActivity = (activity: string): ReactNode =>
  activity.split(/`([^`\n]+)`|(: [^\n]*)/).map((part, index) =>
    index % 3 === 1 && part !== undefined ? (
      // The parts of one activity text never reorder.
      // eslint-disable-next-line react/no-array-index-key
      <code key={index} className={css.ActivityCode}>
        {part}
      </code>
    ) : (
      part
    )
  );

/**
 * The message body with the reply's reasoning above it and its live activity below it,
 * or the body itself when the content has neither.
 */
export const withMindroomReasoning = (
  content: Record<string, unknown>,
  body: ReactNode,
  htmlReactParserOptions: HTMLReactParserOptions,
  linkifyOpts: Opts
): ReactNode => {
  const reasoning = getMindroomReasoning(content);
  const activity = content[LIVE_ACTIVITY_KEY];
  const hasActivity = typeof activity === 'string' && activity.length > 0;
  if (!reasoning && !hasActivity) return body;
  return (
    <>
      {reasoning && (
        <MindroomReasoning
          reasoning={reasoning}
          htmlReactParserOptions={htmlReactParserOptions}
          linkifyOpts={linkifyOpts}
        />
      )}
      {body}
      {hasActivity && (
        <Text as="div" size="T200" priority="300" style={{ whiteSpace: 'pre-line' }}>
          {renderActivity(activity)}
        </Text>
      )}
    </>
  );
};
