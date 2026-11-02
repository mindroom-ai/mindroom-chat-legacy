import React, { ReactNode, useId, useState } from 'react';
import { Icon, Icons, IconSrc, Spinner } from 'folds';
import * as css from './ThreadActivity.css';

export type ActivityTone = keyof typeof css.Icon;

/** Small rounded tile for an activity line or a panel row. */
export function ActivityIcon({
  src,
  tone = 'neutral',
  pending = false,
}: {
  src: IconSrc;
  tone?: ActivityTone;
  pending?: boolean;
}) {
  return (
    <span className={css.Icon[tone]} aria-hidden>
      {pending ? <Spinner size="50" variant="Secondary" /> : <Icon size="50" src={src} />}
    </span>
  );
}

/**
 * What an agent did, as one quiet line in the message: icon, bold title, muted detail.
 * The line toggles a panel with the details.
 */
export function ThreadActivity({
  icon,
  title,
  detail,
  preview,
  children,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  // Shown under the line whether or not the panel is open.
  preview?: ReactNode;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  return (
    // Lets the message content take the full column, so every row lines up its chevron.
    <div className={css.Activity} data-message-disclosure="">
      <button
        type="button"
        className={css.Line}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
      >
        {icon}
        <span className={css.Title}>{title}</span>
        {detail && <span className={css.Detail}>{detail}</span>}
        <Icon
          size="50"
          className={css.Chevron}
          src={expanded ? Icons.ChevronTop : Icons.ChevronBottom}
          aria-hidden
        />
      </button>
      {preview}
      {expanded && (
        <div id={panelId} className={css.Panel}>
          {children}
        </div>
      )}
    </div>
  );
}

/** A tool result shown on one line; selecting it shows the whole text. */
export function ActivityResult({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  return (
    <button
      type="button"
      className={css.Result}
      aria-expanded={full}
      onClick={() => setFull((value) => !value)}
    >
      {text}
    </button>
  );
}
