import React, { ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Capacitor } from '@capacitor/core';
import { ErrorBoundary } from 'react-error-boundary';
import { Icon, IconButton, Icons, IconSrc, Text } from 'folds';
import { appUrl } from '../../utils/basePath';
import { useResizeObserver } from '../../hooks/useResizeObserver';
import { Notice, NoticeIconName, NoticeLevel, NOTICES_FILE, isNoticeIconName } from './notices';
import { renderNoticeText } from './noticeText';
import { useNotices } from './useNotices';
import * as css from './NoticeBanners.css';

const NOTICE_ICONS: Record<NoticeIconName, IconSrc> = {
  info: Icons.Info,
  warning: Icons.Warning,
  check: Icons.Check,
  clock: Icons.Clock,
  bell: Icons.Bell,
  server: Icons.Server,
  settings: Icons.Setting,
};

const LEVEL_ICONS: Record<NoticeLevel, NoticeIconName> = {
  info: 'info',
  warning: 'warning',
  success: 'check',
  critical: 'warning',
};

const LEVEL_VARIANTS = {
  info: 'Primary',
  warning: 'Warning',
  success: 'Success',
  critical: 'Critical',
} as const;

function NoticeIcon({ notice }: { notice: Notice }) {
  const icon = notice.icon ?? LEVEL_ICONS[notice.level];
  return (
    <span className={css.NoticeIcon} aria-hidden>
      {isNoticeIconName(icon) ? <Icon src={NOTICE_ICONS[icon]} size="100" filled /> : icon}
    </span>
  );
}

type NoticeBannerProps = {
  notice: Notice;
  onDismiss: (id: string) => void;
};

function NoticeBanner({ notice, onDismiss }: NoticeBannerProps) {
  const { t } = useTranslation();
  const textRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const content = useMemo(() => renderNoticeText(notice.text), [notice.text]);

  const measure = useCallback(() => {
    const element = textRef.current;
    if (element && !expanded) setClamped(element.scrollHeight > element.clientHeight + 1);
  }, [expanded]);
  useResizeObserver(
    measure,
    useCallback(() => textRef.current, [])
  );
  useLayoutEffect(measure, [measure, content]);

  return (
    <div className={css.Notice({ level: notice.level })} data-notice-level={notice.level}>
      <NoticeIcon notice={notice} />
      <div className={css.NoticeBody}>
        <Text
          as="div"
          size="T300"
          ref={textRef}
          className={classNames(css.NoticeText, !expanded && css.NoticeTextCollapsed)}
        >
          {content}
        </Text>
        {notice.link && (
          <Text
            as="a"
            size="T300"
            className={css.NoticeAction}
            href={notice.link.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {notice.link.text}
          </Text>
        )}
        {(clamped || expanded) && (
          <Text
            as="button"
            size="T300"
            type="button"
            className={css.NoticeAction}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t('mindroomUi.notices.showLess') : t('mindroomUi.notices.showMore')}
          </Text>
        )}
      </div>
      {notice.dismissible && (
        <IconButton
          variant={LEVEL_VARIANTS[notice.level]}
          fill="None"
          size="300"
          radii="300"
          aria-label={t('mindroomUi.notices.dismiss')}
          onClick={() => onDismiss(notice.id)}
        >
          <Icon src={Icons.Cross} size="100" />
        </IconButton>
      )}
    </div>
  );
}

/**
 * Operator notices from `notices.json`, above every screen including sign-in and loading.
 * Native apps serve their own bundled copy of the file, so they skip it.
 */
export function NoticeBanners() {
  const url = useMemo(() => (Capacitor.isNativePlatform() ? undefined : appUrl(NOTICES_FILE)), []);
  const { notices, dismiss } = useNotices(url);

  // aria-atomic: announce only the notice that changed, not the whole stack.
  return (
    <div role="status" aria-atomic="false" className={css.NoticeStack}>
      {notices.map((notice) => (
        <NoticeBanner key={notice.id} notice={notice} onDismiss={dismiss} />
      ))}
    </div>
  );
}

/** Puts the notices above `children`, which get the remaining height. */
export function NoticeLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* A broken notice must never take the app down with it. */}
      <ErrorBoundary fallback={null}>
        <NoticeBanners />
      </ErrorBoundary>
      <div className={css.NoticeLayoutContent}>{children}</div>
    </>
  );
}
