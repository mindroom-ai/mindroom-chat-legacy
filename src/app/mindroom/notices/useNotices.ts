import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DISMISSED_NOTICES_STORAGE_KEY,
  Notice,
  NOTICE_FETCH_TIMEOUT_MS,
  NOTICE_REFRESH_INTERVAL_MS,
  dismissNotice,
  fetchNotices,
  readDismissedNoticeIds,
  selectVisibleNotices,
} from './notices';

/**
 * Polls `url` on mount, every minute and on window focus, and returns the notices to show
 * now. No `url` turns notices off.
 */
export const useNotices = (url: string | undefined) => {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(
    () => new Set(readDismissedNoticeIds())
  );

  useEffect(() => {
    if (!url) return undefined;
    let disposed = false;
    let request: AbortController | undefined;
    const refresh = () => {
      // Time windows advance on every tick, even while a request is still pending.
      setNow(Date.now());
      if (request) return;
      const current = new AbortController();
      request = current;
      const timeout = window.setTimeout(() => current.abort(), NOTICE_FETCH_TIMEOUT_MS);
      fetchNotices(url, current.signal).then((next) => {
        window.clearTimeout(timeout);
        request = undefined;
        if (disposed) return;
        if (next) setNotices(next);
        setNow(Date.now());
      });
    };

    refresh();
    const interval = window.setInterval(refresh, NOTICE_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    return () => {
      disposed = true;
      request?.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [url]);

  // Another tab's dismissal applies here too.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === DISMISSED_NOTICES_STORAGE_KEY) {
        setDismissedIds(new Set(readDismissedNoticeIds()));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Merge with the ids shown so far: without localStorage, dismissNotice knows only this one.
  const dismiss = useCallback((id: string) => {
    const stored = dismissNotice(id);
    setDismissedIds((ids) => new Set([...ids, ...stored]));
  }, []);
  const visible = useMemo(
    () => selectVisibleNotices(notices, now, dismissedIds),
    [notices, now, dismissedIds]
  );

  return { notices: visible, dismiss };
};
