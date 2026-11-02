import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DISMISSED_NOTICES_STORAGE_KEY,
  MAX_NOTICE_ID_LENGTH,
  MAX_NOTICE_LINK_TEXT_LENGTH,
  MAX_NOTICE_TEXT_LENGTH,
  MAX_VISIBLE_NOTICES,
  Notice,
  dismissNotice,
  fetchNotices,
  isNoticeActive,
  parseNotice,
  parseNotices,
  readDismissedNoticeIds,
  selectVisibleNotices,
} from './notices';

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'cutover',
  text: 'Chat is moving tonight.',
  level: 'warning',
  ...overrides,
});

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  } as unknown as Storage & { values: Map<string, string> };
};

describe('parseNotice', () => {
  it('accepts the documented fields and fills defaults', () => {
    expect(parseNotice(entry())).toEqual({
      id: 'cutover',
      text: 'Chat is moving tonight.',
      level: 'warning',
      icon: undefined,
      startsAt: undefined,
      endsAt: undefined,
      dismissible: true,
      link: undefined,
    });
    expect(
      parseNotice(
        entry({
          level: 'critical',
          icon: 'clock',
          startsAt: '2026-10-24T00:50:00-07:00',
          endsAt: '2026-10-24T09:00Z',
          dismissible: false,
          linkUrl: 'https://status.example.org/cutover',
          linkText: 'Status',
          extra: 'ignored',
        })
      )
    ).toEqual({
      id: 'cutover',
      text: 'Chat is moving tonight.',
      level: 'critical',
      icon: 'clock',
      startsAt: Date.parse('2026-10-24T07:50:00Z'),
      endsAt: Date.parse('2026-10-24T09:00:00Z'),
      dismissible: false,
      link: { url: 'https://status.example.org/cutover', text: 'Status' },
    });
  });

  it('accepts February 29 in a leap year and fractional seconds', () => {
    expect(parseNotice(entry({ startsAt: '2028-02-29T23:59:59.999+14:00' }))?.startsAt).toBe(
      Date.parse('2028-02-29T09:59:59.999Z')
    );
  });

  it('labels a link without text with its host', () => {
    expect(parseNotice(entry({ linkUrl: 'https://status.example.org/x' }))?.link).toEqual({
      url: 'https://status.example.org/x',
      text: 'status.example.org',
    });
  });

  it('accepts the id, text and link text up to their length caps', () => {
    const id = 'i'.repeat(MAX_NOTICE_ID_LENGTH);
    const text = 'x'.repeat(MAX_NOTICE_TEXT_LENGTH);
    const linkText = 'l'.repeat(MAX_NOTICE_LINK_TEXT_LENGTH);
    expect(
      parseNotice(entry({ id, text, linkUrl: 'https://example.org', linkText }))
    ).toMatchObject({ id, text, link: { text: linkText } });
  });

  it.each(['info', 'warning', 'success', 'critical'])('accepts level %s', (level) => {
    expect(parseNotice(entry({ level }))?.level).toBe(level);
  });

  it.each([
    '🔧',
    '⚠️',
    '👩‍💻',
    '🇳🇱',
    'info',
    'warning',
    'check',
    'clock',
    'bell',
    'server',
    'settings',
  ])('accepts icon %s', (icon) => {
    expect(parseNotice(entry({ icon }))?.icon).toBe(icon);
  });

  it.each([
    ['a non-object', 'text'],
    ['an array', []],
    ['null', null],
    ['a missing id', { text: 'x', level: 'info' }],
    ['an empty id', entry({ id: ' ' })],
    ['a numeric id', entry({ id: 7 })],
    ['missing text', entry({ text: undefined })],
    ['blank text', entry({ text: '  ' })],
    ['text over the length cap', entry({ text: 'x'.repeat(MAX_NOTICE_TEXT_LENGTH + 1) })],
    ['an id over the length cap', entry({ id: 'x'.repeat(MAX_NOTICE_ID_LENGTH + 1) })],
    [
      'link text over the length cap',
      entry({
        linkUrl: 'https://example.org',
        linkText: 'x'.repeat(MAX_NOTICE_LINK_TEXT_LENGTH + 1),
      }),
    ],
    ['a missing level', entry({ level: undefined })],
    ['an unknown level', entry({ level: 'error' })],
    ['two emoji', entry({ icon: '🔧🔧' })],
    ['an emoji with text', entry({ icon: '🔧 fix' })],
    ['a letter icon', entry({ icon: 'x' })],
    ['an unknown icon name', entry({ icon: 'wrench' })],
    ['a non-boolean dismissible', entry({ dismissible: 'no' })],
    ['an http link', entry({ linkUrl: 'http://example.org' })],
    // eslint-disable-next-line no-script-url -- a link that must be rejected
    ['a javascript link', entry({ linkUrl: 'javascript:alert(1)' })],
    ['a data link', entry({ linkUrl: 'data:text/html,<b>x</b>' })],
    ['a relative link', entry({ linkUrl: '/status' })],
    ['a non-string link', entry({ linkUrl: 5 })],
    ['empty link text', entry({ linkUrl: 'https://example.org', linkText: '' })],
    ['a time without an offset', entry({ startsAt: '2026-10-24T00:50:00' })],
    ['a date-only time', entry({ endsAt: '2026-10-24' })],
    ['an impossible time', entry({ endsAt: '2026-13-40T00:00:00Z' })],
    ['February 30', entry({ endsAt: '2026-02-30T00:00:00Z' })],
    ['February 29 outside a leap year', entry({ startsAt: '2026-02-29T00:00:00-07:00' })],
    ['April 31', entry({ endsAt: '2026-04-31T00:00Z' })],
    ['hour 24', entry({ endsAt: '2026-10-24T24:00:00Z' })],
    ['minute 60', entry({ endsAt: '2026-10-24T23:60:00Z' })],
    ['an offset of 24 hours', entry({ endsAt: '2026-10-24T00:00:00+24:00' })],
    ['a numeric time', entry({ startsAt: 1761292200000 })],
    ['a null time', entry({ endsAt: null })],
  ])('rejects %s', (_name, value) => {
    expect(parseNotice(value)).toBeUndefined();
  });
});

describe('parseNotices', () => {
  it('keeps valid entries in order, drops invalid ones and repeated ids', () => {
    const notices = parseNotices([
      entry({ id: 'a' }),
      entry({ id: 'b', level: 'nope' }),
      entry({ id: 'a', text: 'second a' }),
      entry({ id: 'c', level: 'info' }),
    ]);
    expect(notices.map(({ id, text }) => [id, text])).toEqual([
      ['a', 'Chat is moving tonight.'],
      ['c', 'Chat is moving tonight.'],
    ]);
  });

  it.each([{}, 'x', null, 3, { notices: [] }])('treats %j as no notices', (value) => {
    expect(parseNotices(value)).toEqual([]);
  });
});

describe('time windows', () => {
  const start = Date.parse('2026-10-24T07:50:00Z');
  const end = Date.parse('2026-10-24T09:00:00Z');
  const notice = parseNotice(
    entry({ startsAt: '2026-10-24T07:50:00Z', endsAt: '2026-10-24T09:00:00Z' })
  ) as Notice;

  it('shows a notice from startsAt up to, not including, endsAt', () => {
    expect(isNoticeActive(notice, start - 1)).toBe(false);
    expect(isNoticeActive(notice, start)).toBe(true);
    expect(isNoticeActive(notice, end - 1)).toBe(true);
    expect(isNoticeActive(notice, end)).toBe(false);
  });

  it('leaves an open end unbounded', () => {
    const open = parseNotice(entry()) as Notice;
    expect(isNoticeActive(open, 0)).toBe(true);
    expect(isNoticeActive(open, Number.MAX_SAFE_INTEGER)).toBe(true);
    const onlyEnd = parseNotice(entry({ endsAt: '2026-10-24T09:00:00Z' })) as Notice;
    expect(isNoticeActive(onlyEnd, 0)).toBe(true);
    expect(isNoticeActive(onlyEnd, end)).toBe(false);
  });
});

describe('selectVisibleNotices', () => {
  const notices = parseNotices([
    entry({ id: 'past', endsAt: '2020-01-01T00:00:00Z' }),
    entry({ id: 'a' }),
    entry({ id: 'pinned', dismissible: false }),
    entry({ id: 'b' }),
    entry({ id: 'c' }),
    entry({ id: 'd' }),
  ]);
  const now = Date.parse('2026-10-24T08:00:00Z');

  it(`skips inactive and dismissed notices and shows at most ${MAX_VISIBLE_NOTICES}`, () => {
    expect(selectVisibleNotices(notices, now, new Set()).map(({ id }) => id)).toEqual([
      'a',
      'pinned',
      'b',
    ]);
    expect(selectVisibleNotices(notices, now, new Set(['a', 'b'])).map(({ id }) => id)).toEqual([
      'pinned',
      'c',
      'd',
    ]);
  });

  it('keeps showing a notice that cannot be dismissed, even if its id was dismissed before', () => {
    expect(selectVisibleNotices(notices, now, new Set(['pinned'])).map(({ id }) => id)).toContain(
      'pinned'
    );
  });
});

describe('dismissal storage', () => {
  it('remembers dismissed ids by id, newest last, without duplicates', () => {
    const storage = memoryStorage();
    expect(readDismissedNoticeIds(storage)).toEqual([]);
    expect(dismissNotice('a', storage)).toEqual(['a']);
    expect(dismissNotice('b', storage)).toEqual(['a', 'b']);
    expect(dismissNotice('a', storage)).toEqual(['b', 'a']);
    expect(JSON.parse(storage.values.get(DISMISSED_NOTICES_STORAGE_KEY) ?? '')).toEqual(['b', 'a']);
  });

  it('keeps only the 50 newest ids', () => {
    const storage = memoryStorage();
    for (let index = 0; index < 60; index += 1) dismissNotice(`n${index}`, storage);
    const ids = readDismissedNoticeIds(storage);
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe('n10');
    expect(ids[49]).toBe('n59');
  });

  it.each([
    ['not json', []],
    ['{"a":1}', []],
    ['[1,"a",null]', ['a']],
  ])('reads %s safely', (stored, expected) => {
    const storage = memoryStorage();
    storage.setItem(DISMISSED_NOTICES_STORAGE_KEY, stored);
    expect(readDismissedNoticeIds(storage)).toEqual(expected);
  });

  it('works without storage', () => {
    expect(readDismissedNoticeIds(undefined)).toEqual([]);
    expect(dismissNotice('a', undefined)).toEqual(['a']);
  });
});

describe('fetchNotices', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const respond = (response: Response | Error) => {
    const fetchMock = vi.fn(() =>
      response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('fetches without caching and parses the list', async () => {
    const fetchMock = respond(new Response(JSON.stringify([entry(), { id: 'bad' }])));
    expect((await fetchNotices('/notices.json'))?.map(({ id }) => id)).toEqual(['cutover']);
    expect(fetchMock).toHaveBeenCalledWith(
      '/notices.json',
      expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' })
    );
  });

  it('treats a 404, invalid JSON and a non-list as no notices', async () => {
    respond(new Response('Not found', { status: 404 }));
    expect(await fetchNotices('/notices.json')).toEqual([]);
    respond(new Response('<!doctype html><html></html>'));
    expect(await fetchNotices('/notices.json')).toEqual([]);
    respond(new Response('{"id":"x"}'));
    expect(await fetchNotices('/notices.json')).toEqual([]);
  });

  it('reports a body that fails or is aborted mid-read as unknown', async () => {
    const failingBody = (error: Error) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(error);
          },
        })
      );
    respond(failingBody(new TypeError('network error')));
    expect(await fetchNotices('/notices.json')).toBeUndefined();
    respond(failingBody(new DOMException('The operation was aborted.', 'AbortError')));
    expect(await fetchNotices('/notices.json')).toBeUndefined();
  });

  it('reports a network or server error as unknown, so the last list stays', async () => {
    respond(new TypeError('Failed to fetch'));
    expect(await fetchNotices('/notices.json')).toBeUndefined();
    respond(new Response('Bad gateway', { status: 502 }));
    expect(await fetchNotices('/notices.json')).toBeUndefined();
  });
});
