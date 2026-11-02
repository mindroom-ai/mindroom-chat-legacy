// @vitest-environment jsdom

import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Settings } from './Settings';
import { ScreenSize } from '../../hooks/useScreenSize';
import { renderMindroomSettingsPage } from '../../mindroom/settings/settingsExtensions';
import { LOCAL_MINDROOM_SETTINGS_PAGE } from '../../mindroom/local-mindroom/settingsPage';

const mocks = vi.hoisted(() => ({
  simpleMode: true,
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');
  type Props = { children?: React.ReactNode; [key: string]: unknown };
  const element =
    (tag: string) =>
    ({ children, before, after, ...props }: Props) =>
      reactModule.createElement(
        tag,
        props,
        before as React.ReactNode,
        children,
        after as React.ReactNode
      );
  return {
    Avatar: element('div'),
    Box: element('div'),
    Button: element('button'),
    config: { fontWeight: { W600: 600 }, space: { S200: '8px' } },
    Icon: () => null,
    IconButton: element('button'),
    Icons: new Proxy({}, { get: (_target, name) => String(name) }),
    MenuItem: element('button'),
    Overlay: element('div'),
    OverlayBackdrop: element('div'),
    OverlayCenter: element('div'),
    Text: element('span'),
  };
});

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../components/page', async () => {
  const reactModule = await import('react');
  const passthrough = ({ children, nav, header }: Record<string, React.ReactNode>) =>
    reactModule.createElement('div', null, header, nav, children);
  return {
    PageNav: passthrough,
    PageNavContent: passthrough,
    PageNavHeader: passthrough,
    PageRoot: passthrough,
  };
});
vi.mock('./general', () => ({ General: () => null }));
vi.mock('./account', () => ({ Account: () => null }));
vi.mock('./notifications', () => ({ Notifications: () => null }));
vi.mock('./devices', () => ({ Devices: () => null }));
vi.mock('./emojis-stickers', () => ({ EmojisStickers: () => null }));
vi.mock('./developer-tools', () => ({ DeveloperTools: () => null }));
vi.mock('./about', () => ({ About: () => null }));
vi.mock('../../components/user-avatar', () => ({ UserAvatar: () => null }));
vi.mock('../../components/LogoutDialog', () => ({ LogoutDialog: () => null }));
vi.mock('../../hooks/useUserProfile', () => ({ useUserProfile: () => ({}) }));
vi.mock('../../hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@alice:mindroom.chat',
    getHomeserverUrl: () => 'https://mindroom.chat',
    getAccessToken: () => 'token',
  }),
}));
vi.mock('../../hooks/useClientConfig', () => ({ useClientConfig: () => ({ sidebar: {} }) }));
vi.mock('../../hooks/useScreenSize', async () => ({
  ...(await vi.importActual<typeof import('../../hooks/useScreenSize')>(
    '../../hooks/useScreenSize'
  )),
  useScreenSizeContext: () => ScreenSize.Desktop,
}));
vi.mock('../../mindroom/settings/useMindroomAccountSettings', () => ({
  useSimpleMode: () => mocks.simpleMode,
}));
vi.mock('../../mindroom/settings/settingsExtensions', () => ({
  renderMindroomSettingsPage: vi.fn(() => null),
}));

const textOf = (node: ReactTestInstance | undefined): string =>
  (node?.children ?? [])
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join(' ');

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  renderer?.unmount();
  renderer = undefined;
  vi.clearAllMocks();
});

describe('Settings', () => {
  it('keeps Local MindRoom available in simple mode', async () => {
    mocks.simpleMode = true;

    await act(async () => {
      renderer = create(
        <Settings initialPage={LOCAL_MINDROOM_SETTINGS_PAGE} requestClose={vi.fn()} />
      );
    });

    expect(textOf(renderer?.root)).toContain('Local MindRoom');
    expect(textOf(renderer?.root)).not.toContain('Developer Tools');
    expect(vi.mocked(renderMindroomSettingsPage)).toHaveBeenLastCalledWith(
      LOCAL_MINDROOM_SETTINGS_PAGE,
      true,
      expect.any(Function),
      expect.any(Function)
    );
  });
});
