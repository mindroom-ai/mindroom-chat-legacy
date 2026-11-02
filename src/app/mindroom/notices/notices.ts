import { EMOJI_PATTERN, VARIATION_SELECTOR_PATTERN } from '../../utils/regex';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  setStorageItemSafe,
} from '../../utils/safeLocalStorage';

// Operator notices come from a static file next to the app, so they keep working while
// Matrix and MindRoom are down. The schema is documented in README.md (Notices).

export const NOTICES_FILE = 'notices.json';
export const NOTICE_REFRESH_INTERVAL_MS = 60_000;
export const NOTICE_FETCH_TIMEOUT_MS = 10_000;
export const MAX_VISIBLE_NOTICES = 3;
// Bounds the inline Markdown parser's recursion; a slim banner never needs more.
export const MAX_NOTICE_TEXT_LENGTH = 1000;
// Ids are stored per dismissal and labels sit unfolded beside the text.
export const MAX_NOTICE_ID_LENGTH = 200;
export const MAX_NOTICE_LINK_TEXT_LENGTH = 200;

export const NOTICE_LEVELS = ['info', 'warning', 'success', 'critical'] as const;
export type NoticeLevel = typeof NOTICE_LEVELS[number];

// Names for icons the app already ships; any other icon must be one emoji.
export const NOTICE_ICON_NAMES = [
  'info',
  'warning',
  'check',
  'clock',
  'bell',
  'server',
  'settings',
] as const;
export type NoticeIconName = typeof NOTICE_ICON_NAMES[number];

export type Notice = {
  id: string;
  text: string;
  level: NoticeLevel;
  icon?: string;
  startsAt?: number;
  endsAt?: number;
  dismissible: boolean;
  link?: { url: string; text: string };
};

export const DISMISSED_NOTICES_STORAGE_KEY = 'mindroom.notices.dismissed';
const MAX_DISMISSED_NOTICE_IDS = 50;

// An explicit offset is required: a local time would mean a different moment for every reader.
const NOTICE_TIME_REG =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const SINGLE_EMOJI_REG = new RegExp(`^(?:${EMOJI_PATTERN})${VARIATION_SELECTOR_PATTERN}?$`);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

export const isNoticeIconName = (value: string): value is NoticeIconName =>
  (NOTICE_ICON_NAMES as readonly string[]).includes(value);

const isNoticeIcon = (value: unknown): value is string =>
  typeof value === 'string' && (isNoticeIconName(value) || SINGLE_EMOJI_REG.test(value));

/** Returns the URL when it is an absolute `https:` URL, otherwise `undefined`. */
export const toHttpsUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
};

/** `undefined` when absent, `null` when present but not a valid timestamp. */
const parseNoticeTime = (value: unknown): number | undefined | null => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const match = NOTICE_TIME_REG.exec(value);
  if (!match) return null;
  // Date.parse rolls a day that doesn't exist, such as February 30, into the next month.
  const [year, month, day] = match.slice(1, 4).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
};

/** Validates one entry of `notices.json`; any invalid field rejects the whole entry. */
export const parseNotice = (value: unknown): Notice | undefined => {
  if (!isRecord(value)) return undefined;
  const { id, text, level, icon, startsAt, endsAt, dismissible, linkUrl, linkText } = value;

  if (!isNonEmptyString(id) || !isNonEmptyString(text)) return undefined;
  if (id.length > MAX_NOTICE_ID_LENGTH || text.length > MAX_NOTICE_TEXT_LENGTH) return undefined;
  if (!(NOTICE_LEVELS as readonly unknown[]).includes(level)) return undefined;
  if (icon !== undefined && !isNoticeIcon(icon)) return undefined;
  if (dismissible !== undefined && typeof dismissible !== 'boolean') return undefined;
  if (
    linkText !== undefined &&
    (!isNonEmptyString(linkText) || linkText.length > MAX_NOTICE_LINK_TEXT_LENGTH)
  )
    return undefined;

  const start = parseNoticeTime(startsAt);
  const end = parseNoticeTime(endsAt);
  if (start === null || end === null) return undefined;

  const url = linkUrl === undefined ? undefined : toHttpsUrl(linkUrl);
  if (linkUrl !== undefined && url === undefined) return undefined;

  return {
    id,
    text,
    level: level as NoticeLevel,
    icon,
    startsAt: start,
    endsAt: end,
    dismissible: dismissible ?? true,
    link: url === undefined ? undefined : { url, text: linkText ?? new URL(url).host },
  };
};

/** Valid entries of a `notices.json` document, in file order; the first entry wins an id. */
export const parseNotices = (value: unknown): Notice[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.flatMap((entry) => {
    const notice = parseNotice(entry);
    if (!notice || seen.has(notice.id)) return [];
    seen.add(notice.id);
    return [notice];
  });
};

export const isNoticeActive = (notice: Notice, now: number): boolean =>
  (notice.startsAt === undefined || notice.startsAt <= now) &&
  (notice.endsAt === undefined || now < notice.endsAt);

export const selectVisibleNotices = (
  notices: readonly Notice[],
  now: number,
  dismissedIds: ReadonlySet<string>
): Notice[] =>
  notices
    .filter(
      (notice) =>
        isNoticeActive(notice, now) && !(notice.dismissible && dismissedIds.has(notice.id))
    )
    .slice(0, MAX_VISIBLE_NOTICES);

/**
 * Loads `notices.json`. A 404 or an invalid document means no notices. A network or server
 * error returns `undefined`, so the caller keeps its last list while the server is unreachable.
 */
export const fetchNotices = async (
  url: string,
  signal?: AbortSignal
): Promise<Notice[] | undefined> => {
  let body: string;
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'manual',
      signal,
    });
    if (response.status === 404) return [];
    if (!response.ok) return undefined;
    body = await response.text();
  } catch {
    // The request or its body failed or timed out: unknown, not empty.
    return undefined;
  }
  try {
    return parseNotices(JSON.parse(body));
  } catch {
    return [];
  }
};

export const readDismissedNoticeIds = (storage = getSafeLocalStorage()): string[] => {
  const stored = getStorageItemSafe(storage, DISMISSED_NOTICES_STORAGE_KEY);
  if (stored === null) return [];
  try {
    const ids: unknown = JSON.parse(stored);
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

/** Remembers a dismissal on this device and returns the updated ids, newest last. */
export const dismissNotice = (id: string, storage = getSafeLocalStorage()): string[] => {
  const ids = [
    ...readDismissedNoticeIds(storage).filter((dismissed) => dismissed !== id),
    id,
  ].slice(-MAX_DISMISSED_NOTICE_IDS);
  setStorageItemSafe(storage, DISMISSED_NOTICES_STORAGE_KEY, JSON.stringify(ids));
  return ids;
};
