// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IOpenIDToken } from 'matrix-js-sdk';
import {
  connectionsHandoffSupported,
  openConnectionsPortal,
  submitConnectionsHandoff,
} from './openConnections';

const BACKEND = 'https://backend.example.org';

const makeToken = (n: number): IOpenIDToken => ({
  access_token: `openid-token-${n}`,
  token_type: 'Bearer',
  matrix_server_name: 'example.org',
  expires_in: 3600,
});

type FakeTarget = { closed: boolean; postMessage: ReturnType<typeof vi.fn> };
type MessageListener = (event: Partial<MessageEvent>) => void;

const makeTarget = (): FakeTarget => ({ closed: false, postMessage: vi.fn() });

const makeWindow = (target: FakeTarget | null) => {
  const listeners = new Set<MessageListener>();
  const win = {
    open: vi.fn(() => target),
    addEventListener: vi.fn((type: string, listener: MessageListener) => {
      if (type === 'message') listeners.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: MessageListener) => {
      if (type === 'message') listeners.delete(listener);
    }),
  };
  return {
    win: win as unknown as Window,
    open: win.open,
    addEventListener: win.addEventListener,
    removeEventListener: win.removeEventListener,
    listenerCount: () => listeners.size,
    dispatch: (event: Partial<MessageEvent>) => listeners.forEach((listener) => listener(event)),
  };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('openConnectionsPortal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns blocked when the browser blocks the window', () => {
    const fake = makeWindow(null);

    const result = openConnectionsPortal({
      backendUrl: BACKEND,
      getOpenIdToken: vi.fn(),
      win: fake.win,
    });

    expect(result).toBe('blocked');
    expect(fake.addEventListener).not.toHaveBeenCalled();
  });

  it('asks the portal to open an agent link once signed in', () => {
    const fake = makeWindow(makeTarget());

    openConnectionsPortal({
      backendUrl: BACKEND,
      getOpenIdToken: vi.fn(),
      next: '/api/oauth/slack/authorize?connect_token=t&agent_name=mind',
      win: fake.win,
    });

    expect(fake.open).toHaveBeenCalledWith(
      `${BACKEND}/connections/?next=%2Fapi%2Foauth%2Fslack%2Fauthorize%3Fconnect_token%3Dt%26agent_name%3Dmind`,
      'mindroom-connections'
    );
  });

  it('opens the portal path on the backend origin', () => {
    const fake = makeWindow(makeTarget());

    const result = openConnectionsPortal({
      backendUrl: `${BACKEND}/some/prefix?x=1`,
      getOpenIdToken: vi.fn(),
      win: fake.win,
    });

    expect(result).toBe('opened');
    expect(fake.open).toHaveBeenCalledTimes(1);
    expect(fake.open).toHaveBeenCalledWith(`${BACKEND}/connections/`, 'mindroom-connections');
  });

  it('posts a fresh token to the opened window with the backend origin', async () => {
    const target = makeTarget();
    const fake = makeWindow(target);
    const getOpenIdToken = vi.fn().mockResolvedValue(makeToken(1));
    openConnectionsPortal({ backendUrl: BACKEND, getOpenIdToken, win: fake.win });

    fake.dispatch({
      data: { type: 'mindroom:connections-ready' },
      source: target as unknown as MessageEventSource,
      origin: BACKEND,
    });
    await flush();

    expect(getOpenIdToken).toHaveBeenCalledTimes(1);
    // The token is bound to the same origin the browser delivers it to.
    expect(getOpenIdToken).toHaveBeenCalledWith(BACKEND);
    expect(target.postMessage).toHaveBeenCalledTimes(1);
    expect(target.postMessage).toHaveBeenCalledWith(
      { type: 'mindroom:connections-openid', openid_token: makeToken(1) },
      BACKEND
    );
  });

  it('ignores ready from another window', async () => {
    const target = makeTarget();
    const other = makeTarget();
    const fake = makeWindow(target);
    const getOpenIdToken = vi.fn().mockResolvedValue(makeToken(1));
    openConnectionsPortal({ backendUrl: BACKEND, getOpenIdToken, win: fake.win });

    fake.dispatch({
      data: { type: 'mindroom:connections-ready' },
      source: other as unknown as MessageEventSource,
      origin: BACKEND,
    });
    fake.dispatch({
      data: { type: 'mindroom:connections-ready' },
      source: null,
      origin: BACKEND,
    });
    await flush();

    expect(getOpenIdToken).not.toHaveBeenCalled();
    expect(target.postMessage).not.toHaveBeenCalled();
    expect(other.postMessage).not.toHaveBeenCalled();
  });

  it('ignores ready from another origin', async () => {
    const target = makeTarget();
    const fake = makeWindow(target);
    const getOpenIdToken = vi.fn().mockResolvedValue(makeToken(1));
    openConnectionsPortal({ backendUrl: BACKEND, getOpenIdToken, win: fake.win });

    fake.dispatch({
      data: { type: 'mindroom:connections-ready' },
      source: target as unknown as MessageEventSource,
      origin: 'https://evil.example.org',
    });
    await flush();

    expect(getOpenIdToken).not.toHaveBeenCalled();
    expect(target.postMessage).not.toHaveBeenCalled();
  });

  it('ignores other message types', async () => {
    const target = makeTarget();
    const fake = makeWindow(target);
    const getOpenIdToken = vi.fn().mockResolvedValue(makeToken(1));
    openConnectionsPortal({ backendUrl: BACKEND, getOpenIdToken, win: fake.win });
    const source = target as unknown as MessageEventSource;

    fake.dispatch({ data: { type: 'something-else' }, source, origin: BACKEND });
    fake.dispatch({ data: 'mindroom:connections-ready', source, origin: BACKEND });
    fake.dispatch({ data: null, source, origin: BACKEND });
    fake.dispatch({ data: undefined, source, origin: BACKEND });
    await flush();

    expect(getOpenIdToken).not.toHaveBeenCalled();
    expect(target.postMessage).not.toHaveBeenCalled();
  });

  it('answers each ready message with a new token', async () => {
    const target = makeTarget();
    const fake = makeWindow(target);
    const getOpenIdToken = vi
      .fn()
      .mockResolvedValueOnce(makeToken(1))
      .mockResolvedValueOnce(makeToken(2));
    openConnectionsPortal({ backendUrl: BACKEND, getOpenIdToken, win: fake.win });
    const ready = {
      data: { type: 'mindroom:connections-ready' },
      source: target as unknown as MessageEventSource,
      origin: BACKEND,
    };

    fake.dispatch(ready);
    await flush();
    fake.dispatch(ready);
    await flush();

    expect(getOpenIdToken).toHaveBeenCalledTimes(2);
    expect(target.postMessage.mock.calls).toEqual([
      [{ type: 'mindroom:connections-openid', openid_token: makeToken(1) }, BACKEND],
      [{ type: 'mindroom:connections-openid', openid_token: makeToken(2) }, BACKEND],
    ]);
  });

  it('skips the reply without an unhandled rejection when the token request fails', async () => {
    const target = makeTarget();
    const fake = makeWindow(target);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const getOpenIdToken = vi.fn().mockRejectedValue(new Error('homeserver down'));
      openConnectionsPortal({ backendUrl: BACKEND, getOpenIdToken, win: fake.win });

      fake.dispatch({
        data: { type: 'mindroom:connections-ready' },
        source: target as unknown as MessageEventSource,
        origin: BACKEND,
      });
      await flush();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      expect(getOpenIdToken).toHaveBeenCalledTimes(1);
      expect(target.postMessage).not.toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('stops listening after the window closes', async () => {
    const target = makeTarget();
    const fake = makeWindow(target);
    const getOpenIdToken = vi.fn().mockResolvedValue(makeToken(1));
    openConnectionsPortal({
      backendUrl: BACKEND,
      getOpenIdToken,
      win: fake.win,
      pollMs: 250,
    });
    expect(fake.listenerCount()).toBe(1);

    vi.advanceTimersByTime(1000);
    expect(fake.listenerCount()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    target.closed = true;
    vi.advanceTimersByTime(250);

    expect(fake.listenerCount()).toBe(0);
    expect(fake.removeEventListener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops a pending token reply after the window closes', async () => {
    const target = makeTarget();
    const fake = makeWindow(target);
    let resolveToken: (token: IOpenIDToken) => void = () => undefined;
    const getOpenIdToken = vi.fn(
      () =>
        new Promise<IOpenIDToken>((resolve) => {
          resolveToken = resolve;
        })
    );
    openConnectionsPortal({ backendUrl: BACKEND, getOpenIdToken, win: fake.win, pollMs: 250 });

    fake.dispatch({
      data: { type: 'mindroom:connections-ready' },
      source: target as unknown as MessageEventSource,
      origin: BACKEND,
    });
    await flush();
    expect(getOpenIdToken).toHaveBeenCalledTimes(1);

    target.closed = true;
    vi.advanceTimersByTime(250);
    expect(fake.listenerCount()).toBe(0);

    resolveToken(makeToken(1));
    await flush();

    expect(target.postMessage).not.toHaveBeenCalled();
  });

  it('drops a pending token reply after a newer session replaces it', async () => {
    const target = makeTarget();
    const fake = makeWindow(target);
    let resolveFirst: (token: IOpenIDToken) => void = () => undefined;
    const firstGetOpenIdToken = vi.fn(
      () =>
        new Promise<IOpenIDToken>((resolve) => {
          resolveFirst = resolve;
        })
    );
    const secondGetOpenIdToken = vi.fn().mockResolvedValue(makeToken(2));
    const ready = {
      data: { type: 'mindroom:connections-ready' },
      source: target as unknown as MessageEventSource,
      origin: BACKEND,
    };

    openConnectionsPortal({
      backendUrl: BACKEND,
      getOpenIdToken: firstGetOpenIdToken,
      win: fake.win,
    });
    fake.dispatch(ready);
    await flush();
    expect(firstGetOpenIdToken).toHaveBeenCalledTimes(1);

    openConnectionsPortal({
      backendUrl: BACKEND,
      getOpenIdToken: secondGetOpenIdToken,
      win: fake.win,
    });
    resolveFirst(makeToken(1));
    await flush();

    expect(target.postMessage).not.toHaveBeenCalled();

    fake.dispatch(ready);
    await flush();

    expect(firstGetOpenIdToken).toHaveBeenCalledTimes(1);
    expect(secondGetOpenIdToken).toHaveBeenCalledTimes(1);
    expect(target.postMessage.mock.calls).toEqual([
      [{ type: 'mindroom:connections-openid', openid_token: makeToken(2) }, BACKEND],
    ]);
  });

  it('polls once per second by default', () => {
    const target = makeTarget();
    const fake = makeWindow(target);
    openConnectionsPortal({ backendUrl: BACKEND, getOpenIdToken: vi.fn(), win: fake.win });

    target.closed = true;
    vi.advanceTimersByTime(999);
    expect(fake.listenerCount()).toBe(1);

    vi.advanceTimersByTime(1);
    expect(fake.listenerCount()).toBe(0);
  });

  it('answers a reopened portal only once per ready message', async () => {
    const target = makeTarget();
    const fake = makeWindow(target);
    const getOpenIdToken = vi.fn().mockResolvedValue(makeToken(1));
    openConnectionsPortal({ backendUrl: BACKEND, getOpenIdToken, win: fake.win });
    openConnectionsPortal({ backendUrl: BACKEND, getOpenIdToken, win: fake.win });

    expect(fake.listenerCount()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    fake.dispatch({
      data: { type: 'mindroom:connections-ready' },
      source: target as unknown as MessageEventSource,
      origin: BACKEND,
    });
    await flush();

    expect(getOpenIdToken).toHaveBeenCalledTimes(1);
    expect(target.postMessage).toHaveBeenCalledTimes(1);
  });
});

describe('submitConnectionsHandoff', () => {
  it('posts the token as a form to the backend hand-off, never in the URL', () => {
    const order: string[] = [];
    const submit = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => order.push('submit'));
    const replace = vi
      .spyOn(window.history, 'replaceState')
      .mockImplementation(() => order.push('replace'));
    submitConnectionsHandoff(`${BACKEND}/ignored/path`, makeToken(1), '/home/');
    const form = document.body.querySelector('form');
    expect(form?.method).toBe('post');
    expect(form?.action).toBe(`${BACKEND}/api/connections/session/handoff`);
    const field = form?.querySelector('input');
    expect(field?.type).toBe('hidden');
    expect(field?.name).toBe('openid_token');
    expect(JSON.parse(field?.value ?? '')).toEqual(makeToken(1));
    expect(form?.action).not.toContain('openid-token');
    // Back from the portal must land on `returnTo`, so the entry is replaced before the page leaves.
    expect(replace).toHaveBeenCalledWith(null, '', '/home/');
    expect(order).toEqual(['replace', 'submit']);
    form?.remove();
    submit.mockRestore();
    replace.mockRestore();
  });
});

describe('connectionsHandoffSupported', () => {
  it.each([
    ['https:', 'https://backend.example.org', true],
    ['http:', 'http://localhost:8765', true],
    ['http:', 'https://backend.example.org', true],
    // The browser sends Origin: null on a post from HTTPS to HTTP, which the backend refuses.
    ['https:', 'http://localhost:8765', false],
  ])('from a %s page to %s: %s', (pageProtocol, backendUrl, supported) => {
    expect(connectionsHandoffSupported(backendUrl, pageProtocol)).toBe(supported);
  });
});
