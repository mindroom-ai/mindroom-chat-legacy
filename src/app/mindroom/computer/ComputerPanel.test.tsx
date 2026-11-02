// @vitest-environment jsdom

import React, { forwardRef, lazy, useEffect, useImperativeHandle } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { ConnectionError, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputerPanel, type ComputerPanelProps } from './ComputerPanel';
import {
  ComputerScreen,
  type ComputerScreenHandle,
  type ComputerScreenProps,
  type RfbClient,
} from './ComputerScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('folds', () => ({
  Box: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Button: ({
    before,
    children,
    outlined: _outlined,
    ...props
  }: React.ComponentProps<'button'> & { before?: React.ReactNode; outlined?: boolean }) => (
    <button {...props}>
      {before}
      {children}
    </button>
  ),
  Icon: () => <span />,
  IconButton: React.forwardRef<HTMLButtonElement, React.ComponentProps<'button'>>(
    ({ children, ...props }, ref) => (
      <button {...props} ref={ref}>
        {children}
      </button>
    )
  ),
  Icons: { Cross: 'Cross', Monitor: 'Monitor' },
  Spinner: () => <span />,
  // Icon buttons name themselves in tooltips; render only the trigger.
  Tooltip: () => null,
  TooltipProvider: ({ children }: { children: (triggerRef: () => void) => React.ReactNode }) =>
    children(() => undefined),
  Text: ({ children, role }: { children?: React.ReactNode; role?: string }) => (
    <span role={role}>{children}</span>
  ),
}));

vi.mock('./ComputerPanel.css.ts', () => ({
  Actions: 'Actions',
  AgentField: 'AgentField',
  AgentSelect: 'AgentSelect',
  Body: 'Body',
  Details: 'Details',
  Error: 'Error',
  Header: 'Header',
  KeyboardInput: 'KeyboardInput',
  Layout: 'Layout',
  Panel: 'Panel',
  PanelWithScreen: 'PanelWithScreen',
  Screen: 'Screen',
  ScreenArea: 'ScreenArea',
  // Composed with ScreenArea, as in the stylesheet.
  ScreenFrame: 'ScreenArea ScreenFrame',
  ScreenInControl: 'ScreenInControl',
  Status: 'Status',
}));

const openIdToken = {
  access_token: 'short-lived-openid-token',
  token_type: 'Bearer',
  matrix_server_name: 'example.org',
  expires_in: 3600,
};

const jsonResponse = (status: number, body?: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);

const makeStatus = (sessionId: string, mode: 'view' | 'control' = 'view') => ({
  session_id: sessionId,
  session_token: `secret-${sessionId}`,
  state: 'ready',
  mode,
  expires_at: 2_000_000_000,
});

const createGateway = () => {
  let nextSession = 1;
  let nextTicket = 1;
  const modes = new Map<string, 'view' | 'control'>();
  const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    if (init?.method === 'POST' && url.pathname === '/api/computers/sessions') {
      const sessionId = `session-${nextSession++}`;
      modes.set(sessionId, 'view');
      return jsonResponse(200, makeStatus(sessionId));
    }
    const match = url.pathname.match(/^\/api\/computers\/sessions\/([^/]+)(.*)$/);
    if (!match) return jsonResponse(404, { detail: 'Not found' });
    const [, sessionId, suffix] = match;
    if (init?.method === 'DELETE' && suffix === '') return jsonResponse(204);
    if (init?.method === 'GET' && suffix === '') {
      return jsonResponse(200, makeStatus(sessionId, modes.get(sessionId)));
    }
    if (init?.method === 'POST' && suffix === '/stream-ticket') {
      return jsonResponse(200, {
        ticket: `ticket-${nextTicket++}`,
        expires_at: 2_000_000_000,
      });
    }
    if (init?.method === 'POST' && suffix === '/control') {
      const action = JSON.parse(init.body as string).action as 'take' | 'release' | 'stop';
      const mode = action === 'take' ? 'control' : 'view';
      modes.set(sessionId, mode);
      return jsonResponse(200, {
        ...makeStatus(sessionId, mode),
        state: action === 'stop' ? 'stopped' : 'ready',
      });
    }
    return jsonResponse(404, { detail: 'Not found' });
  });
  return request as unknown as typeof fetch;
};

const screenConnections: ComputerScreenProps[] = [];
const screenDisposals = vi.fn();
let screensConnect = true;
const screenKeyboard = { openKeyboard: vi.fn(), closeKeyboard: vi.fn() };
const TestScreen = forwardRef<ComputerScreenHandle, ComputerScreenProps>((screenProps, ref) => {
  const screenPropsRef = React.useRef(screenProps);
  screenPropsRef.current = screenProps;
  const { mode, url } = screenProps;
  useImperativeHandle(ref, () => screenKeyboard, []);
  useEffect(() => {
    const connection = screenPropsRef.current;
    screenConnections.push({
      ...connection,
      onDisconnected: (message) => screenPropsRef.current.onDisconnected(message),
    });
    if (screensConnect) connection.onConnected();
    return () => screenDisposals();
  }, [url]);
  return <div data-testid="computer-screen" data-mode={mode} />;
});

const makeMatrixClient = (userId = '@alice:example.org') =>
  ({
    http: { authedRequest: vi.fn().mockResolvedValue(openIdToken) },
    getSafeUserId: () => userId,
    getHomeserverUrl: () => 'https://example.org',
    getRoom: () => ({
      getMember: (memberId: string) =>
        memberId === '@mindroom_helper:example.org' ? { rawDisplayName: 'Helper <Bot>' } : null,
    }),
    sendMessage: vi.fn().mockResolvedValue({ event_id: '$continuation' }),
  } as unknown as MatrixClient);

const findButton = (container: HTMLElement, name: string): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) =>
      candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name
  );
  if (!button) throw new Error(`Missing button: ${name}; content: ${container.textContent}`);
  return button;
};

const click = async (button: HTMLButtonElement) => {
  await act(async () => button.click());
};

const waitFor = async (assertion: () => void) => {
  await vi.waitFor(async () => {
    await act(async () => Promise.resolve());
    assertion();
  });
};

/** Advances fake timers, then lets pending requests and renders settle. */
const advance = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
  });
};

const requestsTo = (request: typeof fetch, method: string, path: string) =>
  vi
    .mocked(request)
    .mock.calls.filter(
      ([url, init]) => init?.method === method && new URL(url.toString()).pathname === path
    );

const createRequests = (request: typeof fetch) =>
  requestsTo(request, 'POST', '/api/computers/sessions');

const buttonNames = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('button')).map((button) => button.textContent?.trim());

describe('ComputerPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    screenConnections.length = 0;
    screenDisposals.mockReset();
    screenKeyboard.openKeyboard.mockReset();
    screenKeyboard.closeKeyboard.mockReset();
    screensConnect = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const renderPanel = (overrides: Partial<ComputerPanelProps> = {}) => {
    const props: ComputerPanelProps = {
      agents: [{ userId: '@mindroom_helper:example.org', name: 'Helper' }],
      apiUrl: 'https://computer.example.org',
      mx: makeMatrixClient(),
      onClose: vi.fn(),
      request: createGateway(),
      roomId: '!room:example.org',
      ScreenComponent: TestScreen,
      threadId: '$thread',
      ...overrides,
    };
    act(() => root.render(<ComputerPanel {...props} />));
    return props;
  };

  const pasteRefusal = 'Text over 512 KB cannot be pasted into the computer.';
  const refusalAlert = () =>
    Array.from(container.querySelectorAll('[role="alert"]')).find(
      (alert) => alert.textContent === pasteRefusal
    );

  it('says when pasted text is too large, until a paste is sent', async () => {
    renderPanel();
    await waitFor(() => expect(container.textContent).toContain('Watch mode'));
    expect(refusalAlert()).toBeUndefined();

    act(() => screenConnections[0].onPaste!('too-large'));
    expect(refusalAlert()).toBeDefined();

    act(() => screenConnections[0].onPaste!('sent'));
    expect(refusalAlert()).toBeUndefined();
  });

  it('clears the paste refusal when another agent is chosen', async () => {
    const agents = [
      { userId: '@mindroom_first:example.org', name: 'First' },
      { userId: '@mindroom_second:example.org', name: 'Second' },
    ];
    renderPanel({ agents, requestedAgent: { userId: agents[0].userId } });
    await waitFor(() => expect(container.textContent).toContain('Watch mode'));
    act(() => screenConnections[0].onPaste!('too-large'));
    expect(refusalAlert()).toBeDefined();

    const select = container.querySelector('select')!;
    await act(async () => {
      select.value = agents[1].userId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(refusalAlert()).toBeUndefined();
    await click(findButton(container, 'Watch computer'));
    await waitFor(() => expect(container.textContent).toContain('Watch mode'));
    expect(refusalAlert()).toBeUndefined();
  });

  it('clears the paste refusal when Reconnect opens a new screen', async () => {
    vi.useFakeTimers();
    const gateway = createGateway();
    let denied = false;
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (denied && init?.method === 'GET') {
        return jsonResponse(403, { detail: 'Requester cannot use this agent.' });
      }
      return gateway(input, init);
    }) as unknown as typeof fetch;
    renderPanel({ request });
    await advance();
    act(() => screenConnections[0].onPaste!('too-large'));
    expect(refusalAlert()).toBeDefined();

    denied = true;
    act(() => screenConnections[0].onDisconnected());
    await advance(500);
    expect(container.textContent).toContain('Computer disconnected');
    expect(refusalAlert()).toBeDefined();

    denied = false;
    await click(findButton(container, 'Reconnect'));
    await advance();
    expect(screenConnections).toHaveLength(2);
    expect(refusalAlert()).toBeUndefined();
  });

  it('opens the requested agent directly in a multi-agent room', async () => {
    const request = createGateway();
    renderPanel({
      agents: [
        { userId: '@mindroom_first:example.org', name: 'First' },
        { userId: '@mindroom_second:example.org', name: 'Second' },
      ],
      requestedAgent: { userId: '@mindroom_second:example.org' },
      request,
    });
    await waitFor(() => expect(container.textContent).toContain('Watch mode'));
    const [input, init] = vi.mocked(request).mock.calls[0];
    expect(input).toBe('https://computer.example.org/api/computers/sessions');
    expect(JSON.parse(init!.body as string).agent_user_id).toBe('@mindroom_second:example.org');
    expect(container.querySelector('select')!.value).toBe('@mindroom_second:example.org');
  });

  it('shows Expand computer as a pressed toggle only when given one', async () => {
    const onToggleExpanded = vi.fn();
    const expandButton = () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Expand computer"]');

    renderPanel({ onToggleExpanded, expanded: false });
    await waitFor(() => expect(container.textContent).toContain('Watch mode'));
    expect(expandButton()!.getAttribute('aria-pressed')).toBe('false');
    await click(expandButton()!);
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);

    renderPanel({ onToggleExpanded, expanded: true });
    await waitFor(() => expect(expandButton()!.getAttribute('aria-pressed')).toBe('true'));

    renderPanel({ onToggleExpanded: undefined });
    await waitFor(() => expect(expandButton()).toBeNull());
  });

  // A container query on the panel moves these into a grid: the screen beside a column of the
  // rest. jsdom cannot evaluate it, so this pins what it relies on: each region is a child of the
  // body, which joins the layout's grid, and the reading order stays header, agent, screen, details.
  it('keeps each region a grid item of the layout, in reading order', async () => {
    const agents = [
      { userId: '@mindroom_first:example.org', name: 'First' },
      { userId: '@mindroom_second:example.org', name: 'Second' },
    ];
    renderPanel({
      agents,
      requestedAgent: { userId: agents[0].userId },
      onToggleExpanded: vi.fn(),
    });
    await waitFor(() => expect(container.textContent).toContain('Watch mode'));

    const panel = container.querySelector('aside[aria-label="Computer panel"]')!;
    const layout = panel.querySelector('.Layout')!;
    const header = layout.firstElementChild!;
    expect(header.contains(findButton(container, 'Close computer'))).toBe(true);
    const body = header.nextElementSibling!;
    expect(body.classList.contains('Body')).toBe(true);
    const regionOf = (element: Element, region: string) => {
      const found = element.closest(`.${region}`);
      expect(found?.parentElement).toBe(body);
      return found;
    };
    regionOf(container.querySelector('select')!, 'AgentField');
    regionOf(container.querySelector('[data-testid="computer-screen"]')!, 'ScreenArea');
    const details = regionOf(container.querySelector('[role="status"]')!, 'Details');
    expect(details!.contains(findButton(container, 'Take control'))).toBe(true);

    const readingOrder = Array.from(
      panel.querySelectorAll('button, select, [data-testid="computer-screen"], [role="status"]')
    ).map(
      (element) =>
        element.getAttribute('aria-label') ??
        element.getAttribute('data-testid') ??
        element.textContent?.trim()
    );
    expect(readingOrder).toEqual([
      'Expand computer',
      'Close computer',
      'Agent',
      'computer-screen',
      'Watch mode',
      'Take control',
      'Stop',
    ]);
  });

  it('puts the connecting spinner in the screen area and the start notice in the details', async () => {
    // A session request that never answers keeps the panel connecting.
    renderPanel({ request: vi.fn(() => new Promise<Response>(() => {})) });
    await waitFor(() => expect(container.textContent).toContain('Connecting to computer…'));

    const body = container.querySelector('.Body')!;
    const spinner = Array.from(body.querySelectorAll('.ScreenArea')).find(
      (area) => area.textContent === 'Connecting…'
    );
    expect(spinner?.parentElement).toBe(body);
    const notice = Array.from(body.querySelectorAll('span')).find(
      (text) => text.textContent === 'Starting the computer can take a minute.'
    );
    expect(notice?.closest('.Details')?.parentElement).toBe(body);
  });

  // Without the container name the side layout is off, so the controls span the panel.
  it('names the panel a layout container only while a screen or its spinner shows', async () => {
    const panelHasScreen = () =>
      container
        .querySelector('aside[aria-label="Computer panel"]')!
        .classList.contains('PanelWithScreen');
    const agents = [
      { userId: '@mindroom_first:example.org', name: 'First' },
      { userId: '@mindroom_second:example.org', name: 'Second' },
    ];
    renderPanel({ agents });
    await waitFor(() => expect(container.textContent).toContain('Choose an agent to watch'));
    expect(panelHasScreen()).toBe(false);

    act(() => root.unmount());
    root = createRoot(container);
    renderPanel({ request: vi.fn(() => new Promise<Response>(() => {})) });
    await waitFor(() => expect(container.textContent).toContain('Connecting to computer…'));
    expect(panelHasScreen()).toBe(true);

    act(() => root.unmount());
    root = createRoot(container);
    renderPanel();
    await waitFor(() => expect(container.textContent).toContain('Watch mode'));
    expect(panelHasScreen()).toBe(true);
    await click(findButton(container, 'Stop'));
    await waitFor(() => expect(container.textContent).toContain('Computer stopped'));
    expect(panelHasScreen()).toBe(false);
  });

  it('requests an OpenID token bound to the computer service origin', async () => {
    const mx = makeMatrixClient();
    renderPanel({ mx, apiUrl: 'https://computer.example.org' });
    await waitFor(() => expect(container.textContent).toContain('Watch mode'));
    expect(mx.http.authedRequest).toHaveBeenCalledWith(
      'POST',
      '/user/%40alice%3Aexample.org/openid/request_token',
      undefined,
      { 'io.mindroom.audience': 'https://computer.example.org' }
    );
  });

  const homeserverVersions = (binds: boolean) =>
    vi.fn(async () =>
      jsonResponse(200, {
        versions: ['v1.11'],
        unstable_features: { 'io.mindroom.openid_audience': binds },
      })
    );
  const foundAgent = {
    userId: '@mindroom_helper:example.org',
    name: 'Helper',
    serverUrl: 'https://found.example.org',
  };

  it('opens an agent found from its own server there, after the homeserver confirms it binds tokens', async () => {
    const versions = homeserverVersions(true);
    vi.stubGlobal('fetch', versions);
    const mx = makeMatrixClient();
    const request = createGateway();
    renderPanel({ mx, request, agents: [foundAgent] });
    await waitFor(() => expect(container.textContent).toContain('Watch mode'));
    expect(vi.mocked(request).mock.calls[0][0]).toBe(
      'https://found.example.org/api/computers/sessions'
    );
    // Once before the token is requested and once after it is issued.
    expect(versions).toHaveBeenCalledTimes(2);
    expect(mx.http.authedRequest).toHaveBeenCalledWith(
      'POST',
      '/user/%40alice%3Aexample.org/openid/request_token',
      undefined,
      { 'io.mindroom.audience': 'https://found.example.org' }
    );
    vi.unstubAllGlobals();
  });

  it('gives a found server no token once the homeserver no longer binds tokens', async () => {
    vi.stubGlobal('fetch', homeserverVersions(false));
    const mx = makeMatrixClient();
    const request = createGateway();
    renderPanel({ mx, request, agents: [foundAgent] });
    await waitFor(() => expect(container.textContent).toContain('Computer unavailable'));
    expect(mx.http.authedRequest).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('preserves the same viewer and human control when another reveal is requested', async () => {
    const agents = [
      { userId: '@mindroom_first:example.org', name: 'First' },
      { userId: '@mindroom_second:example.org', name: 'Second' },
    ];
    const props = renderPanel({ agents, requestedAgent: { userId: agents[0].userId } });
    await waitFor(() => expect(container.textContent).toContain('Watch mode'));
    await click(findButton(container, 'Take control'));
    renderPanel({ ...props, requestedAgent: { userId: agents[1].userId } });
    expect(container.textContent).toContain('You have control');
    expect(container.querySelector('select')!.value).toBe(agents[0].userId);
    expect(screenDisposals).not.toHaveBeenCalled();
    renderPanel({ ...props, requestedAgent: { userId: agents[0].userId } });
    expect(container.textContent).toContain('You have control');
    expect(screenDisposals).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'preserves a manually opened singleton on a same-agent request (control: %s)',
    async (control) => {
      const props = renderPanel();
      await waitFor(() => expect(container.textContent).toContain('Watch mode'));
      if (control) await click(findButton(container, 'Take control'));
      renderPanel({ ...props, requestedAgent: { userId: props.agents[0].userId } });
      expect(container.textContent).toContain(control ? 'You have control' : 'Watch mode');
      expect(screenDisposals).not.toHaveBeenCalled();
      const sessions = vi
        .mocked(props.request!)
        .mock.calls.filter(
          ([url, init]) => url.toString().endsWith('/sessions') && init?.method === 'POST'
        );
      expect(sessions).toHaveLength(1);
    }
  );

  it('shows the touchpad hint on a coarse pointer while in control', async () => {
    const hint = 'Drag to move the pointer. Tap to click, two fingers to scroll.';
    let coarse = true;
    const matchMedia = vi.fn((query: string) => ({
      matches: query === '(pointer: coarse)' && coarse,
      media: query,
    }));
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      renderPanel();
      await waitFor(() => expect(container.textContent).toContain('Watch mode'));
      expect(container.textContent).not.toContain(hint);

      await click(findButton(container, 'Take control'));
      await waitFor(() => expect(container.textContent).toContain('You have control'));
      const lines = Array.from(container.querySelectorAll('span'), (line) => line.textContent);
      expect(lines).toContain(hint);
      expect(lines.indexOf(hint)).toBe(lines.indexOf('You have control') + 1);

      await click(findButton(container, 'Resume agent'));
      await waitFor(() => expect(container.textContent).toContain('Watch mode'));
      expect(container.textContent).not.toContain(hint);

      // A mouse or trackpad: no hint, in control either.
      coarse = false;
      await click(findButton(container, 'Take control'));
      await waitFor(() => expect(container.textContent).toContain('You have control'));
      expect(container.textContent).not.toContain(hint);
      expect(matchMedia).toHaveBeenCalledWith('(pointer: coarse)');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe('the Keyboard button', () => {
    let coarse: boolean;
    const keyboardButton = () =>
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Keyboard'
      );

    beforeEach(() => {
      coarse = true;
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({ matches: query === '(pointer: coarse)' && coarse }))
      );
    });
    afterEach(() => vi.unstubAllGlobals());

    it('shows only in control on a touch screen, next to Resume agent', async () => {
      renderPanel();
      await waitFor(() => expect(container.textContent).toContain('Watch mode'));
      expect(keyboardButton()).toBeUndefined();

      await click(findButton(container, 'Take control'));
      await waitFor(() => expect(container.textContent).toContain('You have control'));
      expect(buttonNames(container)).toEqual(
        expect.arrayContaining(['Resume agent', 'Keyboard', 'Stop'])
      );
      const names = buttonNames(container);
      expect(names.indexOf('Keyboard')).toBe(names.indexOf('Resume agent') + 1);
      expect(keyboardButton()?.getAttribute('aria-pressed')).toBe('false');

      await click(findButton(container, 'Resume agent'));
      await waitFor(() => expect(container.textContent).toContain('Watch mode'));
      expect(keyboardButton()).toBeUndefined();

      // A mouse or trackpad types on the canvas: no button, in control either.
      coarse = false;
      await click(findButton(container, 'Take control'));
      await waitFor(() => expect(container.textContent).toContain('You have control'));
      expect(keyboardButton()).toBeUndefined();
    });

    it('shows only once the screen is connected, as noVNC drops keys before', async () => {
      vi.useFakeTimers();
      renderPanel();
      await advance();
      await click(findButton(container, 'Take control'));
      await advance();
      expect(keyboardButton()).toBeDefined();

      // The stream drops; the automatic reconnect opens a screen that has not connected yet.
      screensConnect = false;
      act(() => screenConnections[0].onDisconnected());
      await advance(500);
      expect(screenConnections).toHaveLength(2);
      expect(findButton(container, 'Resume agent')).toBeInstanceOf(HTMLButtonElement);
      expect(keyboardButton()).toBeUndefined();

      act(() => screenConnections[1].onConnected());
      expect(keyboardButton()).toBeDefined();
    });

    it('hides the touchpad hint while the keyboard is open', async () => {
      const hint = 'Drag to move the pointer. Tap to click, two fingers to scroll.';
      renderPanel();
      await waitFor(() => expect(container.textContent).toContain('Watch mode'));
      await click(findButton(container, 'Take control'));
      await waitFor(() => expect(keyboardButton()).toBeDefined());
      expect(container.textContent).toContain(hint);

      act(() => screenConnections[0].onKeyboardChange!(true));
      expect(container.textContent).not.toContain(hint);
      expect(keyboardButton()).toBeDefined();

      act(() => screenConnections[0].onKeyboardChange!(false));
      expect(container.textContent).toContain(hint);
    });

    it('opens and closes the keyboard through the screen, pressed while it is open', async () => {
      renderPanel();
      await waitFor(() => expect(container.textContent).toContain('Watch mode'));
      await click(findButton(container, 'Take control'));
      await waitFor(() => expect(keyboardButton()).toBeDefined());

      // Keeps focus where it is, so a tap does not close the keyboard before it toggles.
      const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      keyboardButton()!.dispatchEvent(press);
      expect(press.defaultPrevented).toBe(true);

      await click(keyboardButton()!);
      expect(screenKeyboard.openKeyboard).toHaveBeenCalledOnce();
      // The screen reports the keyboard from its textarea's focus.
      expect(keyboardButton()!.getAttribute('aria-pressed')).toBe('false');
      act(() => screenConnections[0].onKeyboardChange!(true));
      expect(keyboardButton()!.getAttribute('aria-pressed')).toBe('true');

      await click(keyboardButton()!);
      expect(screenKeyboard.closeKeyboard).toHaveBeenCalledOnce();
      expect(screenKeyboard.openKeyboard).toHaveBeenCalledOnce();
      act(() => screenConnections[0].onKeyboardChange!(false));
      expect(keyboardButton()!.getAttribute('aria-pressed')).toBe('false');
    });

    // The real screen, on a stand-in for noVNC that connects at once.
    const createRfb = vi.fn((target: HTMLElement): RfbClient => {
      const canvas = document.createElement('canvas');
      canvas.tabIndex = -1;
      target.append(canvas);
      const events = new EventTarget();
      queueMicrotask(() => events.dispatchEvent(new Event('connect')));
      return {
        addEventListener: (name, listener) => events.addEventListener(name, listener),
        removeEventListener: (name, listener) => events.removeEventListener(name, listener),
        disconnect: vi.fn(),
        focus: (options) => canvas.focus(options),
        clipboardPasteFrom: vi.fn(),
        sendKey: vi.fn(),
        scaleViewport: false,
        viewOnly: true,
        focusOnClick: true,
      };
    });
    // Loaded lazily, as the panel's default screen is, so the ref goes through React.lazy.
    const RealScreen = lazy(async () => ({
      default: forwardRef<ComputerScreenHandle, ComputerScreenProps>((props, ref) => (
        <ComputerScreen {...props} ref={ref} createRfb={createRfb} />
      )),
    }));
    const textarea = () =>
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Type on the computer"]');

    it('focuses the textarea within the tap, and follows its focus', async () => {
      renderPanel({ ScreenComponent: RealScreen });
      await waitFor(() => expect(container.textContent).toContain('Watch mode'));
      await click(findButton(container, 'Take control'));
      await waitFor(() => expect(keyboardButton()).toBeDefined());
      const canvas = container.querySelector('canvas')!;
      expect(document.activeElement).toBe(canvas);

      // iOS opens the keyboard only for a focus that runs while the tap's click is dispatched.
      let inClick = false;
      const clickStarts = () => {
        inClick = true;
      };
      const clickEnds = () => {
        inClick = false;
      };
      const focusedInClick = vi.fn(() => inClick);
      window.addEventListener('click', clickStarts, true);
      window.addEventListener('click', clickEnds);
      textarea()!.addEventListener('focus', focusedInClick);
      try {
        await click(keyboardButton()!);
      } finally {
        window.removeEventListener('click', clickStarts, true);
        window.removeEventListener('click', clickEnds);
      }
      expect(focusedInClick).toHaveBeenCalledOnce();
      expect(focusedInClick).toHaveReturnedWith(true);
      expect(document.activeElement).toBe(textarea());
      expect(keyboardButton()!.getAttribute('aria-pressed')).toBe('true');

      // The keyboard's own dismiss control blurs the textarea.
      act(() => textarea()!.blur());
      expect(keyboardButton()!.getAttribute('aria-pressed')).toBe('false');

      await click(keyboardButton()!);
      expect(keyboardButton()!.getAttribute('aria-pressed')).toBe('true');
      // A second tap closes it, back to the canvas.
      await click(keyboardButton()!);
      expect(document.activeElement).toBe(canvas);
      expect(keyboardButton()!.getAttribute('aria-pressed')).toBe('false');
    });

    it('closes the keyboard when control ends', async () => {
      renderPanel({ ScreenComponent: RealScreen });
      await waitFor(() => expect(container.textContent).toContain('Watch mode'));
      await click(findButton(container, 'Take control'));
      await waitFor(() => expect(keyboardButton()).toBeDefined());
      await click(keyboardButton()!);
      expect(document.activeElement).toBe(textarea());

      await click(findButton(container, 'Resume agent'));
      await waitFor(() => expect(container.textContent).toContain('Watch mode'));
      expect(document.activeElement).not.toBe(textarea());

      // Back in control, the keyboard starts closed.
      await click(findButton(container, 'Take control'));
      await waitFor(() => expect(keyboardButton()).toBeDefined());
      expect(keyboardButton()!.getAttribute('aria-pressed')).toBe('false');
    });
  });

  it('does not switch to the remaining agent when the requested agent leaves', async () => {
    const agents = [
      { userId: '@mindroom_first:example.org', name: 'First' },
      { userId: '@mindroom_second:example.org', name: 'Second' },
    ];
    const props = renderPanel({ agents, requestedAgent: { userId: agents[0].userId } });
    await waitFor(() => expect(container.textContent).toContain('Watch mode'));
    renderPanel({ ...props, agents: [agents[1]] });
    await waitFor(() => expect(container.textContent).toContain('Choose an agent'));
    const sessions = vi
      .mocked(props.request!)
      .mock.calls.filter(
        ([url, init]) => url.toString().endsWith('/sessions') && init?.method === 'POST'
      );
    expect(sessions).toHaveLength(1);
    const select = container.querySelector('select')!;
    expect(select).not.toBeNull();
    await act(async () => {
      select.value = agents[1].userId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(findButton(container, 'Watch computer'));
    await waitFor(() => expect(container.textContent).toContain('Watch mode'));
  });

  it('moves from watch through control and release, reconnecting before showing watch again', async () => {
    const props = renderPanel();

    await waitFor(() =>
      expect(findButton(container, 'Take control')).toBeInstanceOf(HTMLButtonElement)
    );
    expect(container.textContent).toContain('Watch mode');

    await click(findButton(container, 'Take control'));
    await waitFor(() =>
      expect(findButton(container, 'Resume agent')).toBeInstanceOf(HTMLButtonElement)
    );
    expect(container.textContent).toContain('You have control');

    await click(findButton(container, 'Resume agent'));
    await waitFor(() =>
      expect(findButton(container, 'Take control')).toBeInstanceOf(HTMLButtonElement)
    );

    expect(container.textContent).toContain('Control released');
    expect(container.textContent).toContain('The agent was asked to continue.');
    expect(screenConnections).toHaveLength(2);
    expect(screenConnections[0].protocols[1]).toBe('mindroom-ticket.ticket-1');
    expect(screenConnections[1].protocols[1]).toBe('mindroom-ticket.ticket-2');
    expect(screenConnections[1].url).toContain('/sessions/session-1/stream');
    expect(props.mx.sendMessage).toHaveBeenCalledTimes(1);
    expect(props.mx.sendMessage).toHaveBeenCalledWith(
      '!room:example.org',
      expect.objectContaining({
        body: '@mindroom_helper:example.org The computer is available again. Please continue.',
        format: 'org.matrix.custom.html',
        formatted_body:
          '<a href="https://matrix.to/#/%40mindroom_helper%3Aexample.org">Helper &lt;Bot&gt;</a> The computer is available again. Please continue.',
        'm.mentions': { user_ids: ['@mindroom_helper:example.org'] },
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: '$thread',
          is_falling_back: true,
          'm.in_reply_to': { event_id: '$thread' },
        },
      })
    );
    await click(findButton(container, 'Take control'));
    await waitFor(() => expect(container.textContent).toContain('You have control'));
    expect(container.textContent).not.toContain('Control released');
    expect(container.textContent).not.toContain('The agent was asked to continue.');
  });

  it('ignores the retired control stream closing while continuation delivery is pending', async () => {
    let resolveContinuation: ((value: { event_id: string }) => void) | undefined;
    const continuation = new Promise<{ event_id: string }>((resolve) => {
      resolveContinuation = resolve;
    });
    const mx = makeMatrixClient();
    vi.mocked(mx.sendMessage).mockReturnValue(continuation);
    renderPanel({ mx });

    await waitFor(() => findButton(container, 'Take control'));
    await click(findButton(container, 'Take control'));
    await waitFor(() => findButton(container, 'Resume agent'));
    await click(findButton(container, 'Resume agent'));
    await waitFor(() => expect(screenConnections).toHaveLength(2));

    expect(container.textContent).toContain('Control released');
    expect(container.textContent).not.toContain('The agent was asked to continue.');
    act(() => screenConnections[0].onDisconnected('Retired control stream closed.'));

    expect(container.textContent).not.toContain('Retired control stream closed.');
    expect(container.textContent).not.toContain('Computer disconnected');
    expect(container.querySelector('[data-testid="computer-screen"]')).not.toBeNull();

    await act(async () => resolveContinuation?.({ event_id: '$continuation' }));
    expect(mx.sendMessage).toHaveBeenCalledOnce();
  });

  const holdControl = (action: 'take' | 'release', fail = false) => {
    const gateway = createGateway();
    const pending: { resolve?: () => void } = {};
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body && JSON.parse(init.body as string).action === action) {
        await new Promise<void>((resolve) => {
          pending.resolve = resolve;
        });
        if (fail) return jsonResponse(503, { detail: 'Control unavailable.' });
      }
      return gateway(input, init);
    });
    return { pending, request: request as unknown as typeof fetch };
  };

  const screenTickets = () => screenConnections.map(({ protocols }) => protocols[1]);

  it('keeps the screen when the control stream closes before the release response', async () => {
    const { pending, request } = holdControl('release');
    renderPanel({ request });

    await waitFor(() => findButton(container, 'Take control'));
    await click(findButton(container, 'Take control'));
    await waitFor(() => findButton(container, 'Resume agent'));
    await click(findButton(container, 'Resume agent'));
    await waitFor(() => expect(pending.resolve).toBeDefined());
    act(() => screenConnections[0].onDisconnected());

    expect(container.textContent).not.toContain('Computer disconnected');
    expect(container.textContent).not.toContain('The computer connection closed.');
    expect(container.querySelector('[data-testid="computer-screen"]')).not.toBeNull();

    await act(async () => pending.resolve?.());
    await waitFor(() => findButton(container, 'Take control'));
    expect(screenTickets()).toEqual(['mindroom-ticket.ticket-1', 'mindroom-ticket.ticket-2']);
    expect(container.textContent).toContain('Watch mode');
    expect(container.textContent).not.toContain('Computer disconnected');
  });

  it('keeps control when release fails with the stream still open', async () => {
    const { pending, request } = holdControl('release', true);
    renderPanel({ request });

    await waitFor(() => findButton(container, 'Take control'));
    await click(findButton(container, 'Take control'));
    await waitFor(() => findButton(container, 'Resume agent'));
    await click(findButton(container, 'Resume agent'));
    await waitFor(() => expect(pending.resolve).toBeDefined());
    await act(async () => pending.resolve?.());

    await waitFor(() => expect(findButton(container, 'Resume agent').disabled).toBe(false));
    expect(container.textContent).toContain('Control was not released. Control unavailable.');
    expect(container.textContent).toContain('You have control');

    act(() => screenConnections[0].onDisconnected());
    expect(container.textContent).toContain('Reconnecting to computer…');
    expect(container.textContent).not.toContain('Computer disconnected');
  });

  it.each([
    ['release', 'Resume agent'],
    ['take', 'Take control'],
  ] as const)('recovers when %s fails after the stream closed', async (action, restoredButton) => {
    const { pending, request } = holdControl(action, true);
    renderPanel({ request });

    await waitFor(() => findButton(container, 'Take control'));
    await click(findButton(container, 'Take control'));
    if (action === 'release') {
      await waitFor(() => findButton(container, 'Resume agent'));
      await click(findButton(container, 'Resume agent'));
    }
    await waitFor(() => expect(pending.resolve).toBeDefined());
    act(() => screenConnections[0].onDisconnected());
    await act(async () => pending.resolve?.());

    await waitFor(() => expect(findButton(container, 'Reconnect').disabled).toBe(false));
    expect(container.textContent).toContain('Computer disconnected');
    expect(container.textContent).toContain('Control unavailable.');
    expect(container.querySelector('[data-testid="computer-screen"]')).toBeNull();

    await click(findButton(container, 'Reconnect'));
    await waitFor(() => findButton(container, restoredButton));
    expect(screenTickets()).toEqual(['mindroom-ticket.ticket-1', 'mindroom-ticket.ticket-2']);
  });

  it('reconnects a failed replacement watch stream while continuation delivery is pending', async () => {
    let resolveContinuation: ((value: { event_id: string }) => void) | undefined;
    const continuation = new Promise<{ event_id: string }>((resolve) => {
      resolveContinuation = resolve;
    });
    const mx = makeMatrixClient();
    vi.mocked(mx.sendMessage).mockReturnValue(continuation);
    renderPanel({ mx });

    await waitFor(() => findButton(container, 'Take control'));
    await click(findButton(container, 'Take control'));
    await waitFor(() => findButton(container, 'Resume agent'));
    await click(findButton(container, 'Resume agent'));
    await waitFor(() => expect(screenConnections).toHaveLength(2));

    act(() => screenConnections[1].onDisconnected('Replacement watch stream closed.'));

    await waitFor(() => findButton(container, 'Reconnect'));
    expect(container.textContent).toContain('Replacement watch stream closed.');
    await act(async () => resolveContinuation?.({ event_id: '$continuation' }));
    await waitFor(() => expect(findButton(container, 'Reconnect').disabled).toBe(false));
    expect(mx.sendMessage).toHaveBeenCalledOnce();

    await click(findButton(container, 'Reconnect'));
    await waitFor(() => expect(screenConnections).toHaveLength(3));
    expect(screenConnections.map(({ protocols }) => protocols[1])).toEqual([
      'mindroom-ticket.ticket-1',
      'mindroom-ticket.ticket-2',
      'mindroom-ticket.ticket-3',
    ]);
    expect(mx.sendMessage).toHaveBeenCalledOnce();
  });

  it('sends the continuation exactly once even when watch reconnect fails', async () => {
    const gateway = createGateway();
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (
        url.endsWith('/stream-ticket') &&
        request.mock.calls.filter(([value]) => value.toString().endsWith('/stream-ticket'))
          .length === 2
      ) {
        return jsonResponse(503, { detail: 'Computer stream is unavailable.' });
      }
      return gateway(input, init);
    }) as unknown as typeof fetch;
    const props = renderPanel({ request });

    await waitFor(() => findButton(container, 'Take control'));
    await click(findButton(container, 'Take control'));
    await waitFor(() => findButton(container, 'Resume agent'));
    await click(findButton(container, 'Resume agent'));

    await waitFor(() => expect(container.textContent).toContain('Computer stream is unavailable.'));
    expect(container.querySelector('[data-testid="computer-screen"]')).toBeNull();
    expect(props.mx.sendMessage).toHaveBeenCalledTimes(1);
    await click(findButton(container, 'Reconnect'));
    await waitFor(() => findButton(container, 'Take control'));
    expect(props.mx.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('shows a failed watch reconnect before continuation delivery settles', async () => {
    let resolveContinuation: ((value: { event_id: string }) => void) | undefined;
    const mx = makeMatrixClient();
    vi.mocked(mx.sendMessage).mockReturnValue(
      new Promise<{ event_id: string }>((resolve) => {
        resolveContinuation = resolve;
      })
    );
    const gateway = createGateway();
    let tickets = 0;
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString().endsWith('/stream-ticket') && ++tickets === 2) {
        return jsonResponse(503, { detail: 'Computer stream is unavailable.' });
      }
      return gateway(input, init);
    }) as unknown as typeof fetch;
    renderPanel({ mx, request });

    await waitFor(() => findButton(container, 'Take control'));
    await click(findButton(container, 'Take control'));
    await waitFor(() => findButton(container, 'Resume agent'));
    await click(findButton(container, 'Resume agent'));

    await waitFor(() => expect(container.textContent).toContain('Computer stream is unavailable.'));
    expect(container.textContent).toContain('Computer disconnected');
    expect(container.querySelector('[data-testid="computer-screen"]')).toBeNull();
    expect(findButton(container, 'Reconnect').disabled).toBe(true);

    await act(async () => resolveContinuation?.({ event_id: '$continuation' }));
    await waitFor(() => expect(findButton(container, 'Reconnect').disabled).toBe(false));
    expect(container.textContent).toContain('The agent was asked to continue.');
  });

  it.each(['failure', 'success'])('handles disconnect before Stop %s settles', async (outcome) => {
    const gateway = createGateway();
    let settle!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      settle = resolve;
    });
    const request: typeof fetch = (input, init) => {
      if (init?.body && JSON.parse(init.body as string).action === 'stop') return pending;
      return gateway(input, init);
    };
    renderPanel({ request });
    await waitFor(() => findButton(container, 'Take control'));
    const old = screenConnections.at(-1)!;
    await click(findButton(container, 'Stop'));
    act(() => old.onDisconnected('Stream closed during stop.'));
    await act(async () =>
      settle(
        outcome === 'failure'
          ? jsonResponse(503, { detail: 'Stop unavailable.' })
          : jsonResponse(200, { ...makeStatus('session-1'), state: 'stopped' })
      )
    );
    expect(container.querySelector('[data-testid="computer-screen"]')).toBeNull();
    expect(container.textContent).not.toContain('Take control');
    if (outcome === 'failure') {
      expect(container.textContent).toContain('Computer disconnected');
      expect(findButton(container, 'Reconnect').disabled).toBe(false);
      await click(findButton(container, 'Reconnect'));
      await waitFor(() => findButton(container, 'Take control'));
      expect(screenConnections.at(-1)!.protocols).not.toEqual(old.protocols);
    } else {
      expect(container.textContent).toContain('Computer stopped');
      expect(container.textContent).not.toContain('Stream closed during stop.');
    }
  });

  it('waits for a resolved thread before allowing continuation', async () => {
    const props = renderPanel({ continuationReady: false });
    await waitFor(() => findButton(container, 'Take control'));
    await click(findButton(container, 'Take control'));
    await waitFor(() => findButton(container, 'Resume agent'));
    expect(findButton(container, 'Resume agent').disabled).toBe(true);
    expect(props.mx.sendMessage).not.toHaveBeenCalled();
    act(() => root.render(<ComputerPanel {...props} continuationReady threadId="$root" />));
    await waitFor(() => findButton(container, 'Take control'));
    await click(findButton(container, 'Take control'));
    await click(findButton(container, 'Resume agent'));
    await waitFor(() => expect(props.mx.sendMessage).toHaveBeenCalledOnce());
    expect(vi.mocked(props.mx.sendMessage).mock.calls[0][1]).toMatchObject({
      'm.relates_to': { event_id: '$root', 'm.in_reply_to': { event_id: '$root' } },
    });
  });

  it('creates a fresh public session after stop', async () => {
    const request = createGateway();
    renderPanel({ request });
    await waitFor(() => findButton(container, 'Take control'));

    await click(findButton(container, 'Stop'));
    await waitFor(() => expect(container.textContent).toContain('Computer stopped'));
    await click(findButton(container, 'Start computer'));
    await waitFor(() => findButton(container, 'Take control'));

    const createCalls = vi
      .mocked(request)
      .mock.calls.filter(
        ([url, init]) =>
          url.toString().endsWith('/api/computers/sessions') && init?.method === 'POST'
      );
    expect(createCalls).toHaveLength(2);
    expect(screenConnections.at(-1)?.url).toContain('/sessions/session-2/stream');
  });

  it('waits for an explicit Watch action when more than one agent is available', async () => {
    const request = createGateway();
    renderPanel({
      agents: [
        { userId: '@mindroom_helper:example.org', name: 'Helper' },
        { userId: '@mindroom_writer:example.org', name: 'Writer' },
      ],
      request,
    });

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Agent"]');
    expect(select).not.toBeNull();
    await act(async () => {
      if (select) {
        select.value = '@mindroom_writer:example.org';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(vi.mocked(request)).not.toHaveBeenCalled();
    await click(findButton(container, 'Watch computer'));
    await waitFor(() => findButton(container, 'Take control'));

    expect(JSON.parse(vi.mocked(request).mock.calls[0][1]?.body as string)).toMatchObject({
      agent_user_id: '@mindroom_writer:example.org',
    });
  });

  it('keeps control released and does not retry a failed continuation send', async () => {
    const mx = makeMatrixClient();
    vi.mocked(mx.sendMessage).mockRejectedValue(new Error('send failed'));
    renderPanel({ mx });
    await waitFor(() => findButton(container, 'Take control'));
    await click(findButton(container, 'Take control'));
    await waitFor(() => findButton(container, 'Resume agent'));

    await click(findButton(container, 'Resume agent'));

    await waitFor(() =>
      expect(container.textContent).toContain(
        'Control was released, but the continuation message could not be sent.'
      )
    );
    expect(findButton(container, 'Take control')).toBeInstanceOf(HTMLButtonElement);
    expect(container.textContent).toContain('Control released');
    expect(container.textContent).not.toContain('The agent was asked to continue.');
    expect(mx.sendMessage).toHaveBeenCalledOnce();
    vi.useFakeTimers();
    act(() => screenConnections.at(-1)?.onDisconnected());
    expect(container.textContent).toContain('Reconnecting to computer…');
    await advance(500);
    expect(findButton(container, 'Take control')).toBeInstanceOf(HTMLButtonElement);
    expect(screenConnections).toHaveLength(3);
    expect(mx.sendMessage).toHaveBeenCalledOnce();
  });

  it.each([
    [403, 'This requester is not allowed to control this agent.'],
    [409, 'Another viewer currently has control.'],
  ])('preserves a bounded %i control error returned by the server', async (status, detail) => {
    const gateway = createGateway();
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/control') && JSON.parse(init?.body as string).action === 'take') {
        return jsonResponse(status, { detail });
      }
      return gateway(input, init);
    }) as unknown as typeof fetch;
    renderPanel({ request });
    await waitFor(() => findButton(container, 'Take control'));

    await click(findButton(container, 'Take control'));

    await waitFor(() => expect(container.textContent).toContain(detail));
    expect(container.textContent).not.toContain('The computer changed.');
  });

  it.each([
    [403, 'Requester cannot use this agent.'],
    [409, 'Computer requires exactly one browser provider.'],
    [429, 'Computer session capacity reached.'],
  ])(
    'shows an actionable retry, without retrying, after session creation fails with %i',
    async (status, detail) => {
      vi.useFakeTimers();
      const request = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(status, { detail }))
        .mockImplementation(createGateway()) as unknown as typeof fetch;
      renderPanel({ request });

      await advance();
      expect(container.textContent).toContain('Computer unavailable');
      expect(container.textContent).toContain(detail);
      await advance(200_000);
      expect(createRequests(request)).toHaveLength(1);

      await click(findButton(container, 'Reconnect'));
      await advance();
      expect(findButton(container, 'Take control')).toBeInstanceOf(HTMLButtonElement);
    }
  );

  it('retries transient session creation failures while the computer starts', async () => {
    vi.useFakeTimers();
    const gateway = createGateway();
    const failures = [
      jsonResponse(503, {
        detail: 'Computer worker is unavailable; create a new session to restart.',
      }),
      jsonResponse(524),
    ];
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const failure =
        init?.method === 'POST' && new URL(input.toString()).pathname === '/api/computers/sessions'
          ? failures.shift()
          : undefined;
      return failure ?? gateway(input, init);
    }) as unknown as typeof fetch;
    renderPanel({ request });

    await advance();
    expect(createRequests(request)).toHaveLength(1);
    expect(container.textContent).toContain('Connecting to computer…');
    expect(container.textContent).toContain('Starting the computer can take a minute.');
    expect(container.textContent).not.toContain('Computer unavailable');

    await advance(2_000);
    expect(createRequests(request)).toHaveLength(2);
    expect(container.textContent).not.toContain('Computer request failed (524).');

    await advance(4_000);
    expect(createRequests(request)).toHaveLength(3);
    expect(container.textContent).toContain('Watch mode');
    expect(container.textContent).not.toContain('Starting the computer can take a minute.');
  });

  it('retries starting when the homeserver cannot be reached for the OpenID token', async () => {
    vi.useFakeTimers();
    const mx = makeMatrixClient();
    vi.mocked(mx.http.authedRequest).mockRejectedValueOnce(new ConnectionError('fetch failed'));
    const request = createGateway();
    renderPanel({ mx, request });
    await advance();
    expect(container.textContent).toContain('Connecting to computer…');
    expect(createRequests(request)).toHaveLength(0);

    await advance(2_000);
    expect(createRequests(request)).toHaveLength(1);
    expect(container.textContent).toContain('Watch mode');
  });

  it('gives up starting after about three minutes of transient failures', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    renderPanel({ request });

    await advance(170_000);
    expect(container.textContent).toContain('Connecting to computer…');
    await advance(10_000);
    expect(container.textContent).toContain('Computer unavailable');
    expect(container.textContent).toContain('Unable to reach the computer service.');
    const attempts = createRequests(request).length;
    await advance(60_000);
    expect(createRequests(request)).toHaveLength(attempts);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops starting when a throttled tab wakes after the start budget', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    renderPanel({ request });
    await advance();
    expect(createRequests(request)).toHaveLength(1);

    vi.setSystemTime(Date.now() + 240_000);
    await advance(2_000);
    expect(createRequests(request)).toHaveLength(1);
    expect(container.textContent).toContain('Computer unavailable');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reconnects on its own after an unexpected close, reusing a valid session', async () => {
    vi.useFakeTimers();
    const request = createGateway();
    renderPanel({ request });
    await advance();
    expect(container.textContent).toContain('Watch mode');

    act(() => screenConnections[0].onDisconnected('The computer connection was interrupted.'));
    expect(container.textContent).toContain('Reconnecting to computer…');
    expect(container.textContent).not.toContain('Computer disconnected');
    expect(container.textContent).not.toContain('The computer connection was interrupted.');
    expect(buttonNames(container)).not.toContain('Reconnect');

    await advance(500);
    expect(container.textContent).toContain('Watch mode');
    expect(screenTickets()).toEqual(['mindroom-ticket.ticket-1', 'mindroom-ticket.ticket-2']);
    expect(screenConnections[1].url).toContain('/sessions/session-1/stream');
    expect(createRequests(request)).toHaveLength(1);
  });

  const reconnectDelays = [500, 1_000, 2_000, 4_000, 8_000];

  it('gives a stream that stayed connected the full set of automatic attempts again', async () => {
    vi.useFakeTimers();
    renderPanel();
    await advance();
    for (let close = 1; close <= 6; close += 1) {
      await advance(35_000);
      act(() => screenConnections.at(-1)!.onDisconnected());
      await advance(500);
      expect(screenConnections).toHaveLength(close + 1);
      expect(container.textContent).toContain('Watch mode');
    }
  });

  it.each([
    ['right after connecting', 0],
    ['by the next periodic recheck', 15_000],
  ])('ends at Reconnect when each new session is revoked %s', async (_when, livedMs) => {
    vi.useFakeTimers();
    const gateway = createGateway();
    const revoked = new Set<string>();
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const sessionId = new URL(input.toString()).pathname.split('/')[4];
      if (sessionId && revoked.has(sessionId)) {
        return jsonResponse(401, { detail: 'Invalid or expired computer session.' });
      }
      return gateway(input, init);
    }) as unknown as typeof fetch;
    renderPanel({ request });
    await advance();

    for (const [index, delay] of reconnectDelays.entries()) {
      await advance(livedMs);
      revoked.add(`session-${index + 1}`);
      act(() => screenConnections.at(-1)!.onDisconnected());
      await advance(delay);
      expect(screenConnections.at(-1)!.url).toContain(`/sessions/session-${index + 2}/stream`);
    }
    await advance(livedMs);
    revoked.add('session-6');
    act(() => screenConnections.at(-1)!.onDisconnected());
    expect(container.textContent).toContain('Computer disconnected');
    await advance(60_000);
    expect(createRequests(request)).toHaveLength(6);
  });

  it('ends at Reconnect when the new streams never connect', async () => {
    vi.useFakeTimers();
    renderPanel();
    await advance();

    screensConnect = false;
    for (const delay of reconnectDelays) {
      act(() => screenConnections.at(-1)!.onDisconnected());
      await advance(delay);
      expect(container.textContent).not.toContain('Computer disconnected');
    }
    expect(screenConnections).toHaveLength(6);
    act(() => screenConnections.at(-1)!.onDisconnected());
    expect(container.textContent).toContain('Computer disconnected');
    expect(findButton(container, 'Reconnect')).toBeInstanceOf(HTMLButtonElement);
    await advance(60_000);
    expect(screenConnections).toHaveLength(6);
  });

  it('stops reconnecting at once on an error that is not transient', async () => {
    vi.useFakeTimers();
    const gateway = createGateway();
    let denied = false;
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (denied && init?.method === 'GET') {
        return jsonResponse(403, { detail: 'Requester cannot use this agent.' });
      }
      return gateway(input, init);
    }) as unknown as typeof fetch;
    renderPanel({ request });
    await advance();

    denied = true;
    act(() => screenConnections[0].onDisconnected());
    await advance(500);
    expect(container.textContent).toContain('Computer disconnected');
    expect(container.textContent).toContain('Requester cannot use this agent.');
    await advance(20_000);
    expect(requestsTo(request, 'GET', '/api/computers/sessions/session-1')).toHaveLength(1);
    expect(createRequests(request)).toHaveLength(1);
  });

  it.each([
    [401, 'Invalid or expired computer session.'],
    [409, 'Computer worker changed; create a new session.'],
  ])(
    'replaces a session revoked with %i during reconnect, back in watch mode',
    async (status, detail) => {
      vi.useFakeTimers();
      const gateway = createGateway();
      let revoked = false;
      const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (revoked && input.toString().includes('/sessions/session-1')) {
          return jsonResponse(status, { detail });
        }
        return gateway(input, init);
      }) as unknown as typeof fetch;
      renderPanel({ request });
      await advance();
      await click(findButton(container, 'Take control'));
      await advance();
      expect(container.textContent).toContain('You have control');

      revoked = true;
      act(() => screenConnections[0].onDisconnected());
      expect(container.textContent).toContain('Reconnecting to computer…');
      await advance(500);

      expect(createRequests(request)).toHaveLength(2);
      expect(screenConnections.at(-1)!.url).toContain('/sessions/session-2/stream');
      expect(container.textContent).toContain('Watch mode');
      expect(findButton(container, 'Take control')).toBeInstanceOf(HTMLButtonElement);
      expect(container.textContent).not.toContain(detail);
    }
  );

  it('keeps reconnecting when a replacement session fails its first stream ticket', async () => {
    vi.useFakeTimers();
    const gateway = createGateway();
    let revoked = false;
    let replacementTicketFailures = 1;
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = new URL(input.toString());
      if (revoked && pathname.startsWith('/api/computers/sessions/session-1')) {
        return jsonResponse(401, { detail: 'Invalid or expired computer session.' });
      }
      if (
        pathname === '/api/computers/sessions/session-2/stream-ticket' &&
        replacementTicketFailures > 0
      ) {
        replacementTicketFailures -= 1;
        return jsonResponse(503, { detail: 'Computer worker is unavailable.' });
      }
      return gateway(input, init);
    }) as unknown as typeof fetch;
    renderPanel({ request });
    await advance();

    revoked = true;
    act(() => screenConnections[0].onDisconnected());
    await advance(500);
    expect(createRequests(request)).toHaveLength(2);
    expect(container.textContent).toContain('Reconnecting to computer…');
    expect(container.textContent).not.toContain('Computer unavailable');

    await advance(1_000);
    expect(container.textContent).toContain('Watch mode');
    expect(screenConnections.at(-1)!.url).toContain('/sessions/session-2/stream');
    expect(createRequests(request)).toHaveLength(2);
  });

  it.each([
    ['still pending', false],
    ['already complete', true],
  ])(
    'keeps Stop when a replacement session fails its first ticket with Stop %s',
    async (_when, stopFirst) => {
      vi.useFakeTimers();
      const gateway = createGateway();
      let revoked = false;
      let resolveTicket: (response: Response) => void = () => undefined;
      let resolveStop: (response: Response) => void = () => undefined;
      const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const { pathname } = new URL(input.toString());
        if (revoked && pathname.startsWith('/api/computers/sessions/session-1')) {
          return jsonResponse(401, { detail: 'Invalid or expired computer session.' });
        }
        if (pathname.startsWith('/api/computers/sessions/session-2/stream-ticket')) {
          return new Promise<Response>((resolve) => {
            resolveTicket = resolve;
          });
        }
        if (pathname === '/api/computers/sessions/session-2/control') {
          return new Promise<Response>((resolve) => {
            resolveStop = resolve;
          });
        }
        if (pathname === '/api/computers/sessions/session-2' && init?.method === 'GET') {
          return jsonResponse(401, { detail: 'Invalid or expired computer session.' });
        }
        return gateway(input, init);
      }) as unknown as typeof fetch;
      renderPanel({ request });
      await advance();

      revoked = true;
      act(() => screenConnections[0].onDisconnected());
      await advance(500);
      expect(createRequests(request)).toHaveLength(2);

      await click(findButton(container, 'Stop'));
      const stopped = { ...makeStatus('session-2'), state: 'stopped' };
      if (stopFirst) {
        resolveStop(jsonResponse(200, stopped));
        await advance();
      }
      resolveTicket(
        stopFirst
          ? jsonResponse(403, { detail: 'Requester cannot use this agent.' })
          : jsonResponse(409, { detail: 'Computer stopped or restarted; create a new session.' })
      );
      await advance();
      if (!stopFirst) {
        // The Stop response outlasts the next automatic attempt's delay.
        await advance(2_000);
        resolveStop(jsonResponse(200, stopped));
        await advance();
      }
      await advance(20_000);

      expect(createRequests(request)).toHaveLength(2);
      expect(container.textContent).toContain('Computer stopped');
      expect(findButton(container, 'Start computer')).toBeInstanceOf(HTMLButtonElement);
    }
  );

  it('offers Reconnect after the automatic attempts, which replaces a revoked session', async () => {
    vi.useFakeTimers();
    const gateway = createGateway();
    let outage = false;
    let revoked = false;
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (outage) throw new TypeError('Failed to fetch');
      if (revoked && input.toString().includes('/sessions/session-1')) {
        return jsonResponse(401, { detail: 'Invalid or expired computer session.' });
      }
      return gateway(input, init);
    }) as unknown as typeof fetch;
    renderPanel({ request });
    await advance();

    outage = true;
    act(() => screenConnections[0].onDisconnected());
    for (const delay of [500, 1_000, 2_000, 4_000]) {
      await advance(delay);
      expect(container.textContent).toContain('Reconnecting to computer…');
    }
    await advance(8_000);
    expect(requestsTo(request, 'GET', '/api/computers/sessions/session-1')).toHaveLength(5);
    expect(container.textContent).toContain('Computer disconnected');
    expect(container.textContent).toContain('Unable to reach the computer service.');
    await advance(60_000);
    expect(requestsTo(request, 'GET', '/api/computers/sessions/session-1')).toHaveLength(5);

    outage = false;
    revoked = true;
    await click(findButton(container, 'Reconnect'));
    await advance();
    expect(container.textContent).toContain('Watch mode');
    expect(screenConnections.at(-1)!.url).toContain('/sessions/session-2/stream');

    // Reconnect restores the automatic attempts, even for a stream that drops right away.
    act(() => screenConnections.at(-1)!.onDisconnected());
    expect(container.textContent).toContain('Reconnecting to computer…');
    await advance(500);
    expect(container.textContent).toContain('Watch mode');
  });

  it('replaces a session in one Reconnect click after a 409', async () => {
    vi.useFakeTimers();
    const gateway = createGateway();
    let outage = false;
    let stopped = false;
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (outage) throw new TypeError('Failed to fetch');
      if (stopped && input.toString().includes('/sessions/session-1')) {
        return jsonResponse(409, {
          detail: 'Computer stopped or restarted; create a new session.',
        });
      }
      return gateway(input, init);
    }) as unknown as typeof fetch;
    renderPanel({ request });
    await advance();

    outage = true;
    act(() => screenConnections[0].onDisconnected());
    await advance(20_000);
    expect(container.textContent).toContain('Computer disconnected');

    outage = false;
    stopped = true;
    await click(findButton(container, 'Reconnect'));
    await advance();
    expect(container.textContent).toContain('Watch mode');
    expect(screenConnections.at(-1)!.url).toContain('/sessions/session-2/stream');
    expect(container.textContent).not.toContain('create a new session');
  });

  it('aborts an in-flight reconnect request when the panel closes', async () => {
    vi.useFakeTimers();
    const gateway = createGateway();
    const pending: AbortSignal[] = [];
    let stalled = false;
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (stalled && init?.method === 'GET') {
        const { signal } = init;
        if (signal) pending.push(signal);
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        });
      }
      return gateway(input, init);
    }) as unknown as typeof fetch;
    renderPanel({ request });
    await advance();

    stalled = true;
    act(() => screenConnections[0].onDisconnected());
    await advance(500);
    expect(pending).toHaveLength(1);
    expect(pending[0].aborted).toBe(false);

    act(() => root.unmount());
    expect(pending[0].aborted).toBe(true);
  });

  it('cancels a pending reconnect when the panel closes', async () => {
    vi.useFakeTimers();
    const request = createGateway();
    renderPanel({ request });
    await advance();
    act(() => screenConnections[0].onDisconnected());
    expect(vi.getTimerCount()).toBe(1);

    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    await advance(20_000);
    expect(requestsTo(request, 'GET', '/api/computers/sessions/session-1')).toHaveLength(0);
    expect(
      requestsTo(request, 'POST', '/api/computers/sessions/session-1/stream-ticket')
    ).toHaveLength(1);
    expect(requestsTo(request, 'DELETE', '/api/computers/sessions/session-1')).toHaveLength(1);
  });

  it('cancels a pending start retry when the panel closes', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () =>
      jsonResponse(503, { detail: 'Computer authorization is unavailable.' })
    ) as unknown as typeof fetch;
    renderPanel({ request });
    await advance();
    expect(vi.getTimerCount()).toBe(1);

    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    await advance(200_000);
    expect(createRequests(request)).toHaveLength(1);
  });

  it('disposes a replacement session that arrives after the panel closed', async () => {
    vi.useFakeTimers();
    const gateway = createGateway();
    let revoked = false;
    let resolveReplacement: ((response: Response) => void) | undefined;
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (revoked && init?.method === 'POST' && url.pathname === '/api/computers/sessions') {
        return new Promise<Response>((resolve) => {
          resolveReplacement = resolve;
        });
      }
      if (revoked && url.pathname.startsWith('/api/computers/sessions/session-1')) {
        return jsonResponse(401, { detail: 'Invalid or expired computer session.' });
      }
      return gateway(input, init);
    }) as unknown as typeof fetch;
    renderPanel({ request });
    await advance();

    revoked = true;
    act(() => screenConnections[0].onDisconnected());
    await advance(500);
    expect(resolveReplacement).toBeDefined();
    expect(container.textContent).toContain('Reconnecting to computer…');
    expect(container.textContent).toContain('Starting the computer can take a minute.');

    act(() => root.unmount());
    resolveReplacement?.(jsonResponse(200, makeStatus('session-2')));
    await advance();
    expect(requestsTo(request, 'DELETE', '/api/computers/sessions/session-2')).toHaveLength(1);
    expect(
      requestsTo(request, 'POST', '/api/computers/sessions/session-2/stream-ticket')
    ).toHaveLength(0);
  });

  it('disposes a session that arrives after its thread scope was replaced', async () => {
    let resolveOldSession: ((response: Response) => void) | undefined;
    let createCount = 0;
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (init?.method === 'POST' && url.pathname === '/api/computers/sessions') {
        createCount += 1;
        if (createCount === 1) {
          return new Promise<Response>((resolve) => {
            resolveOldSession = resolve;
          });
        }
        return jsonResponse(200, makeStatus('session-new'));
      }
      if (init?.method === 'POST' && url.pathname.endsWith('/stream-ticket')) {
        return jsonResponse(200, { ticket: 'ticket-new', expires_at: 2_000_000_000 });
      }
      if (init?.method === 'DELETE') return jsonResponse(204);
      return jsonResponse(404, { detail: 'Not found' });
    }) as unknown as typeof fetch;
    const initial = renderPanel({ request });
    await waitFor(() => expect(createCount).toBe(1));

    act(() => root.render(<ComputerPanel {...initial} threadId="$replacement" />));
    await waitFor(() => expect(screenConnections).toHaveLength(1));
    expect(screenConnections[0].url).toContain('/sessions/session-new/stream');

    resolveOldSession?.(jsonResponse(200, makeStatus('session-old')));
    await waitFor(() =>
      expect(
        vi
          .mocked(request)
          .mock.calls.some(
            ([url, init]) =>
              url.toString().endsWith('/sessions/session-old') && init?.method === 'DELETE'
          )
      ).toBe(true)
    );
    expect(screenConnections).toHaveLength(1);
  });

  it.each([
    ['account', { mx: makeMatrixClient('@bob:example.org') }],
    ['room', { roomId: '!other:example.org' }],
    ['thread', { threadId: '$other-thread' }],
    ['agent', { agents: [{ userId: '@mindroom_writer:example.org', name: 'Writer' }] }],
  ])('closes the previous connection and session when the %s changes', async (_label, change) => {
    const request = createGateway();
    const initial = renderPanel({ request });
    await waitFor(() => findButton(container, 'Take control'));

    act(() => root.render(<ComputerPanel {...initial} {...change} />));
    await waitFor(() => expect(screenConnections).toHaveLength(2));

    expect(screenDisposals).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        vi
          .mocked(request)
          .mock.calls.some(
            ([url, init]) =>
              url.toString().endsWith('/sessions/session-1') && init?.method === 'DELETE'
          )
      ).toBe(true)
    );
  });
});
