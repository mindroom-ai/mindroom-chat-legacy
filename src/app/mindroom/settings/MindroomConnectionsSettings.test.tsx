// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../../hooks/useClientConfig';
import { computerServicePreferenceAtom } from '../computer/computerServiceSettings';
import { MindroomConnectionsSettings } from './MindroomConnectionsSettings';

const mocks = vi.hoisted(() => {
  const authedRequest = vi.fn();
  return {
    isNativePlatform: vi.fn(),
    openConnectionsPortal: vi.fn(),
    discoveredUrls: [] as string[],
    authedRequest,
    client: {
      clientRunning: true,
      getSafeUserId: () => '@alice:example.org',
      getHomeserverUrl: () => 'https://example.org',
      http: { authedRequest },
    },
  };
});

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children, role }: { children?: React.ReactNode; role?: string }) => (
    <span role={role}>{children}</span>
  ),
  Button: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  ),
  color: { Critical: { Main: 'red' } },
}));
vi.mock('../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) => <section>{children}</section>,
}));
vi.mock('../../components/setting-tile', () => ({
  SettingTile: ({
    title,
    description,
    children,
  }: {
    title?: React.ReactNode;
    description?: React.ReactNode;
    children?: React.ReactNode;
  }) => (
    <div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  ),
}));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mocks.client,
}));
vi.mock('../connections/openConnections', () => ({
  openConnectionsPortal: mocks.openConnectionsPortal,
}));
vi.mock('../server/useMindroomServers', () => ({
  useMindroomServerUrls: () => mocks.discoveredUrls,
}));

const OPEN_LABEL = 'Open Connections';
const NO_BACKEND = 'Set your MindRoom server under Computers to use Connections.';
const BLOCKED =
  'Your browser blocked the Connections window. Allow pop-ups for this site and try again.';

let renderer: ReactTestRenderer;
let store: ReturnType<typeof createStore>;
const openButton = () =>
  renderer.root
    .findAllByType('button')
    .find((node) => node.findByType('span').children.join('') === OPEN_LABEL)!;
const texts = () => renderer.root.findAllByType('span').map((node) => node.children.join(''));
const alerts = () =>
  renderer.root.findAllByType('span').filter((node) => node.props.role === 'alert');
const click = () => act(() => openButton().props.onClick());

beforeEach(() => {
  localStorage.clear();
  store = createStore();
  mocks.isNativePlatform.mockReset().mockReturnValue(false);
  mocks.openConnectionsPortal.mockReset().mockReturnValue('opened');
  mocks.authedRequest.mockReset();
  mocks.client.clientRunning = true;
  mocks.discoveredUrls = [];
});
afterEach(() => {
  act(() => renderer?.unmount());
});
const render = (deploymentUrl = 'https://backend.example') =>
  act(() => {
    renderer = create(
      <Provider store={store}>
        <ClientConfigProvider value={{ mindroom: { computers: { apiUrl: deploymentUrl } } }}>
          <MindroomConnectionsSettings />
        </ClientConfigProvider>
      </Provider>
    );
  });

describe('connections settings', () => {
  it('renders nothing on native builds', () => {
    mocks.isNativePlatform.mockReturnValue(true);
    render();
    expect(renderer.toJSON()).toBeNull();
  });

  it('shows the card copy with an enabled button when a server is configured', () => {
    render();
    expect(texts()).toContain('Connections');
    expect(renderer.root.findByType('h3').children).toEqual(['Connected accounts']);
    expect(renderer.root.findByType('p').children).toEqual([
      'Connect the accounts your agents use, such as Google or GitHub, on your MindRoom server.',
    ]);
    expect(openButton().props.disabled).toBeFalsy();
    expect(texts()).not.toContain(NO_BACKEND);
  });

  it('explains how to set a server when none is configured', () => {
    render('');
    expect(openButton().props.disabled).toBe(true);
    expect(texts()).toContain(NO_BACKEND);
    expect(mocks.openConnectionsPortal).not.toHaveBeenCalled();
  });

  it('treats a server the user turned off under Computers as not configured', () => {
    act(() => store.set(computerServicePreferenceAtom, ''));
    render('https://backend.example');
    expect(openButton().props.disabled).toBe(true);
    expect(texts()).toContain(NO_BACKEND);
  });

  it('opens the server the agents in the rooms publish when none is configured', () => {
    mocks.discoveredUrls = ['http://localhost:8765'];
    render('');
    expect(openButton().props.disabled).toBeFalsy();
    expect(texts()).not.toContain(NO_BACKEND);
    // A found server is named, so a hostile agent cannot pass its portal off as the user's own.
    expect(texts()).toContain('http://localhost:8765');
    click();
    expect(mocks.openConnectionsPortal.mock.calls[0][0].backendUrl).toBe('http://localhost:8765');
  });

  it.each([
    [true, 1],
    [false, 0],
  ])(
    'asks the homeserver afresh before a token for a found server (binds: %s)',
    async (binds, requests) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                versions: ['v1.11'],
                unstable_features: { 'io.mindroom.openid_audience': binds },
              }),
              { status: 200 }
            )
        )
      );
      mocks.authedRequest.mockResolvedValue({ access_token: 'openid-token' });
      mocks.discoveredUrls = ['http://localhost:8765'];
      render('');
      click();
      const token =
        mocks.openConnectionsPortal.mock.calls[0][0].getOpenIdToken('http://localhost:8765');
      if (binds) await expect(token).resolves.toEqual({ access_token: 'openid-token' });
      else await expect(token).rejects.toThrow('does not bind sign-in tokens');
      expect(mocks.authedRequest).toHaveBeenCalledTimes(requests);
      vi.unstubAllGlobals();
    }
  );

  it('asks nothing extra before a token for a configured server', async () => {
    const versions = vi.fn();
    vi.stubGlobal('fetch', versions);
    mocks.authedRequest.mockResolvedValue({ access_token: 'openid-token' });
    render('https://backend.example');
    click();
    await mocks.openConnectionsPortal.mock.calls[0][0].getOpenIdToken('https://backend.example');
    expect(versions).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('offers each published server by its address when the agents come from several', () => {
    mocks.discoveredUrls = ['https://mind.example.org', 'http://localhost:8765'];
    render('');
    const buttons = renderer.root
      .findAllByType('button')
      .filter((node) => node.findByType('span').children.join('') === OPEN_LABEL);
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.props['aria-label'])).toEqual([
      'Open Connections https://mind.example.org',
      'Open Connections http://localhost:8765',
    ]);
    expect(texts()).toEqual(
      expect.arrayContaining(['https://mind.example.org', 'http://localhost:8765'])
    );
    act(() => buttons[1].props.onClick());
    expect(mocks.openConnectionsPortal.mock.calls[0][0].backendUrl).toBe('http://localhost:8765');
  });

  it('prefers the configured server, and keeps a server the user turned off off', () => {
    mocks.discoveredUrls = ['http://localhost:8765'];
    render('https://backend.example');
    click();
    expect(mocks.openConnectionsPortal.mock.calls[0][0].backendUrl).toBe('https://backend.example');
    act(() => renderer.unmount());
    act(() => store.set(computerServicePreferenceAtom, ''));
    render('');
    expect(openButton().props.disabled).toBe(true);
    expect(texts()).toContain(NO_BACKEND);
  });

  it('opens the portal with the computers backend', () => {
    render('https://backend.example');
    click();
    expect(mocks.openConnectionsPortal).toHaveBeenCalledTimes(1);
    const options = mocks.openConnectionsPortal.mock.calls[0][0];
    expect(options.backendUrl).toBe('https://backend.example');
    expect(alerts()).toHaveLength(0);
  });

  it('opens the portal with a server the user saved under Computers', () => {
    act(() => store.set(computerServicePreferenceAtom, 'https://custom.example'));
    render('https://backend.example');
    click();
    expect(mocks.openConnectionsPortal.mock.calls[0][0].backendUrl).toBe('https://custom.example');
  });

  it('hands the portal the signed-in client token request', async () => {
    const token = { access_token: 'openid-token' };
    mocks.authedRequest.mockResolvedValue(token);
    render();
    click();
    const options = mocks.openConnectionsPortal.mock.calls[0][0];
    expect(mocks.authedRequest).not.toHaveBeenCalled();
    await expect(options.getOpenIdToken('https://backend.example')).resolves.toBe(token);
    expect(mocks.authedRequest).toHaveBeenCalledTimes(1);
  });

  it('binds the token to the audience the portal helper asks for', async () => {
    mocks.authedRequest.mockResolvedValue({ access_token: 'openid-token' });
    render();
    click();
    await mocks.openConnectionsPortal.mock.calls[0][0].getOpenIdToken('https://custom.example');
    expect(mocks.authedRequest).toHaveBeenCalledWith(
      'POST',
      '/user/%40alice%3Aexample.org/openid/request_token',
      undefined,
      { 'io.mindroom.audience': 'https://custom.example' }
    );
  });

  it('does not hand out a token after the Matrix client stopped', async () => {
    mocks.client.clientRunning = false;
    render();
    click();
    const options = mocks.openConnectionsPortal.mock.calls[0][0];
    await expect(options.getOpenIdToken('https://backend.example')).rejects.toThrow(
      'Matrix client stopped'
    );
    expect(mocks.authedRequest).not.toHaveBeenCalled();
  });

  it('drops a token that resolves after the Matrix client stopped', async () => {
    mocks.authedRequest.mockImplementation(async () => {
      mocks.client.clientRunning = false;
      return { access_token: 'openid-token' };
    });
    render();
    click();
    const options = mocks.openConnectionsPortal.mock.calls[0][0];
    await expect(options.getOpenIdToken('https://backend.example')).rejects.toThrow(
      'Matrix client stopped'
    );
    expect(mocks.authedRequest).toHaveBeenCalledTimes(1);
  });

  it('shows the blocked message when the window is blocked', () => {
    mocks.openConnectionsPortal.mockReturnValue('blocked');
    render();
    click();
    expect(alerts().map((node) => node.children.join(''))).toEqual([BLOCKED]);
  });

  it('clears the blocked message once a later attempt opens the window', () => {
    mocks.openConnectionsPortal.mockReturnValueOnce('blocked').mockReturnValueOnce('opened');
    render();
    click();
    expect(alerts()).toHaveLength(1);
    click();
    expect(alerts()).toHaveLength(0);
    expect(mocks.openConnectionsPortal).toHaveBeenCalledTimes(2);
  });
});
