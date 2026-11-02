// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISMISSED_NOTICES_STORAGE_KEY, NOTICE_REFRESH_INTERVAL_MS } from './notices';
import { NoticeBanners, NoticeLayout } from './NoticeBanners';

const native = vi.hoisted(() => ({ value: false }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.value },
}));
vi.mock('./NoticeBanners.css', () => ({
  NoticeStack: 'NoticeStack',
  Notice: ({ level }: { level: string }) => `Notice Notice-${level}`,
  NoticeIcon: 'NoticeIcon',
  NoticeBody: 'NoticeBody',
  NoticeText: 'NoticeText',
  NoticeTextCollapsed: 'NoticeTextCollapsed',
  NoticeAction: 'NoticeAction',
  NoticeLayoutContent: 'NoticeLayoutContent',
}));
vi.mock('../../styles/CustomHtml.css', () => ({ Code: 'Code' }));

type Response = { status: number; body?: unknown };
let responses: Response[];
let fetchMock: ReturnType<typeof vi.fn>;
let container: HTMLDivElement;
let root: Root;

const notice = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  text: `Notice ${id}`,
  level: 'info',
  ...overrides,
});
const serve = (...next: Response[]) => {
  responses = next;
};
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
const render = async (element = <NoticeBanners />) => {
  await act(async () => {
    root.render(element);
  });
  await flush();
};
const banners = () => [...container.querySelectorAll('[data-notice-level]')];
const texts = () => banners().map((banner) => banner.querySelector('.NoticeText')?.textContent);
const dismissButton = (banner: Element) =>
  banner.querySelector<HTMLButtonElement>('button[aria-label="Dismiss notice"]');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-10-24T08:00:00Z'));
  native.value = false;
  localStorage.clear();
  serve({ status: 200, body: [] });
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const next = responses.length > 1 ? responses.shift()! : responses[0];
    if (next.status === 0) throw new TypeError('Failed to fetch');
    // A request that never answers until it is aborted.
    if (next.status === -1) {
      return new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')));
      });
    }
    return new globalThis.Response(JSON.stringify(next.body ?? null), { status: next.status });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}

      unobserve() {}

      disconnect() {}
    }
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('NoticeBanners', () => {
  it('fetches the same-origin file without caching and shows active notices in a status region', async () => {
    serve({
      status: 200,
      body: [
        notice('now', { level: 'warning' }),
        notice('later', { startsAt: '2026-10-24T09:00:00Z' }),
        notice('over', { endsAt: '2026-10-24T07:00:00Z' }),
        { id: 'invalid' },
      ],
    });
    await render();

    expect(fetchMock).toHaveBeenCalledWith(
      '/notices.json',
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(texts()).toEqual(['Notice now']);
    expect(banners()[0].className).toContain('Notice-warning');
  });

  it('renders text as text, never as HTML', async () => {
    serve({
      status: 200,
      body: [notice('x', { text: '<img src=x onerror="alert(1)"> **Down** [log](javascript:x)' })],
    });
    await render();

    const text = banners()[0].querySelector('.NoticeText')!;
    expect(text.querySelector('img')).toBeNull();
    expect(text.querySelector('a')).toBeNull();
    expect(text.querySelector('strong')?.textContent).toBe('Down');
    expect(text.textContent).toBe('<img src=x onerror="alert(1)"> Down [log](javascript:x)');
  });

  it('renders the link button and inline links to open in a new tab', async () => {
    serve({
      status: 200,
      body: [
        notice('x', {
          text: 'See [notes](https://example.org/notes).',
          linkUrl: 'https://status.example.org',
          linkText: 'Status',
        }),
      ],
    });
    await render();

    const links = [...banners()[0].querySelectorAll('a')].map((anchor) => [
      anchor.textContent,
      anchor.getAttribute('href'),
      anchor.getAttribute('target'),
      anchor.getAttribute('rel'),
    ]);
    expect(links).toEqual([
      ['notes', 'https://example.org/notes', '_blank', 'noopener noreferrer'],
      ['Status', 'https://status.example.org/', '_blank', 'noopener noreferrer'],
    ]);
  });

  it('remembers a dismissal on this device by id, and shows a new id again', async () => {
    serve({ status: 200, body: [notice('a'), notice('b')] });
    await render();

    await act(async () => {
      dismissButton(banners()[0])!.click();
    });
    expect(texts()).toEqual(['Notice b']);
    expect(JSON.parse(localStorage.getItem(DISMISSED_NOTICES_STORAGE_KEY)!)).toEqual(['a']);

    act(() => root.unmount());
    root = createRoot(container);
    serve({ status: 200, body: [notice('a'), notice('b'), notice('c')] });
    await render();
    expect(texts()).toEqual(['Notice b', 'Notice c']);
  });

  it('keeps earlier dismissals in this tab when localStorage rejects writes', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    serve({ status: 200, body: [notice('a'), notice('b'), notice('c')] });
    await render();

    await act(async () => {
      dismissButton(banners()[0])!.click();
    });
    await act(async () => {
      dismissButton(banners()[0])!.click();
    });
    expect(texts()).toEqual(['Notice c']);
  });

  it('offers no dismiss button when a notice is not dismissible', async () => {
    serve({ status: 200, body: [notice('pinned', { dismissible: false })] });
    await render();

    expect(texts()).toEqual(['Notice pinned']);
    expect(dismissButton(banners()[0])).toBeNull();
  });

  it('refreshes every minute and on focus, so a removed notice disappears', async () => {
    serve({ status: 200, body: [notice('a')] });
    await render();
    expect(texts()).toEqual(['Notice a']);

    serve({ status: 200, body: [] });
    await act(async () => {
      vi.advanceTimersByTime(NOTICE_REFRESH_INTERVAL_MS);
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(texts()).toEqual([]);

    serve({ status: 200, body: [notice('b')] });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(texts()).toEqual(['Notice b']);
  });

  it('hides a notice once its end passes, at the next refresh', async () => {
    serve({ status: 200, body: [notice('a', { endsAt: '2026-10-24T08:00:30Z' })] });
    await render();
    expect(texts()).toEqual(['Notice a']);

    await act(async () => {
      vi.advanceTimersByTime(NOTICE_REFRESH_INTERVAL_MS);
    });
    await flush();
    expect(texts()).toEqual([]);
  });

  it('keeps the last notices through network and server errors, and clears them on a 404', async () => {
    serve({ status: 200, body: [notice('a')] });
    await render();

    for (const status of [0, 502]) {
      serve({ status });
      await act(async () => {
        vi.advanceTimersByTime(NOTICE_REFRESH_INTERVAL_MS);
      });
      await flush();
      expect(texts()).toEqual(['Notice a']);
    }

    serve({ status: 404 });
    await act(async () => {
      vi.advanceTimersByTime(NOTICE_REFRESH_INTERVAL_MS);
    });
    await flush();
    expect(texts()).toEqual([]);
  });

  it('expires notices and keeps polling while a request hangs', async () => {
    serve({ status: 200, body: [notice('a', { endsAt: '2026-10-24T08:01:30Z' })] });
    await render();
    serve({ status: -1 });

    await act(async () => {
      vi.advanceTimersByTime(NOTICE_REFRESH_INTERVAL_MS);
    });
    await flush();
    expect(texts()).toEqual(['Notice a']);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The hung request times out, the next tick hides the expired notice and polls again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTICE_REFRESH_INTERVAL_MS);
    });
    await flush();
    expect(texts()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shows nothing when the first fetch fails', async () => {
    serve({ status: 0 });
    await render();
    expect(banners()).toEqual([]);
  });

  it('clamps long text and toggles the rest with Show more and Show less', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function height(
      this: HTMLElement
    ) {
      return this.textContent === 'Notice long' ? 100 : 60;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60);
    serve({ status: 200, body: [notice('long'), notice('short')] });
    await render();
    const toggle = (index: number) =>
      banners()[index].querySelector<HTMLButtonElement>('button[aria-expanded]');
    const text = () => banners()[0].querySelector('.NoticeText')!;

    expect(toggle(0)?.textContent).toBe('Show more');
    expect(toggle(0)?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle(1)).toBeNull();
    expect(text().className).toContain('NoticeTextCollapsed');

    await act(async () => {
      toggle(0)!.click();
    });
    expect(toggle(0)?.textContent).toBe('Show less');
    expect(toggle(0)?.getAttribute('aria-expanded')).toBe('true');
    expect(text().className).not.toContain('NoticeTextCollapsed');
  });

  it('does not fetch in the native apps', async () => {
    native.value = true;
    await render();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lays the app out below the notices', async () => {
    serve({ status: 200, body: [notice('a')] });
    await render(
      <NoticeLayout>
        <main>App</main>
      </NoticeLayout>
    );

    const [stack, content] = [...container.children];
    expect(stack.getAttribute('role')).toBe('status');
    expect(content.className).toBe('NoticeLayoutContent');
    expect(content.textContent).toBe('App');
  });
});
