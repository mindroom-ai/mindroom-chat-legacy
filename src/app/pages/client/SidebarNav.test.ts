import React from 'react';
import { create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../../hooks/useClientConfig';
import { SidebarNav } from './SidebarNav';

const mocks = vi.hoisted(() => ({
  simpleMode: false,
  showCanvases: true,
  homeserverUrl: 'https://mindroom.chat',
}));

vi.mock('folds', () => ({
  Scroll: React.forwardRef<HTMLDivElement, { children: React.ReactNode }>(({ children }, ref) =>
    React.createElement('div', { ref }, children)
  ),
}));

vi.mock('../../components/sidebar', () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) =>
    React.createElement('nav', null, children),
  SidebarContent: ({
    scrollable,
    sticky,
  }: {
    scrollable: React.ReactNode;
    sticky: React.ReactNode;
  }) => React.createElement('div', null, scrollable, sticky),
  SidebarStackSeparator: () => React.createElement('hr'),
  SidebarStack: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('./sidebar', () => ({
  DirectTab: () => React.createElement('div', { 'data-tab': 'direct' }),
  HomeTab: () => React.createElement('div', { 'data-tab': 'home' }),
  SpaceTabs: () => React.createElement('div', { 'data-tab': 'spaces' }),
  InboxTab: () => React.createElement('div', { 'data-tab': 'inbox' }),
  ExploreTab: () => React.createElement('div', { 'data-tab': 'explore' }),
  SettingsTab: () => React.createElement('div', { 'data-tab': 'settings' }),
  UnverifiedTab: () => React.createElement('div', { 'data-tab': 'unverified' }),
  SearchTab: () => React.createElement('div', { 'data-tab': 'search' }),
  ThreadsTab: () => React.createElement('div', { 'data-tab': 'threads' }),
  CanvasesTab: () => React.createElement('div', { 'data-tab': 'canvases' }),
}));

vi.mock('./sidebar/CreateTab', () => ({
  CreateTab: () => React.createElement('div', { 'data-tab': 'create' }),
}));

vi.mock('../../mindroom/sidebar/MindroomTab', () => ({
  MindroomTab: () => React.createElement('div', { 'data-tab': 'mindroom' }),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getHomeserverUrl: () => mocks.homeserverUrl,
    getAccessToken: () => 'token',
  }),
}));

vi.mock('../../mindroom/settings/useMindroomAccountSettings', () => ({
  useSimpleMode: () => mocks.simpleMode,
  useShowCanvasesInSidebar: () => mocks.showCanvases,
}));

const renderSidebarNav = (clientConfig: ClientConfig = {}, footer?: React.ReactNode) =>
  create(
    React.createElement(
      ClientConfigProvider,
      { value: clientConfig },
      React.createElement(SidebarNav, { footer })
    )
  );

const hasTab = (renderer: ReturnType<typeof renderSidebarNav>, tab: string): boolean =>
  renderer.root.findAll((node) => node.props['data-tab'] === tab).length > 0;

describe('SidebarNav', () => {
  beforeEach(() => {
    mocks.simpleMode = false;
    mocks.showCanvases = true;
    mocks.homeserverUrl = 'https://mindroom.chat';
  });

  it('shows Threads after Direct Messages and before spaces by default', () => {
    const renderer = renderSidebarNav();

    expect(
      renderer.root
        .findAll((node) => typeof node.props['data-tab'] === 'string')
        .map((node) => node.props['data-tab'])
        .slice(0, 4)
    ).toEqual(['home', 'direct', 'threads', 'spaces']);

    renderer.unmount();
  });

  it('hides the Threads tab when sidebar.showThreads is false', () => {
    const renderer = renderSidebarNav({
      sidebar: {
        showThreads: false,
      },
    });

    expect(hasTab(renderer, 'threads')).toBe(false);

    renderer.unmount();
  });

  it('shows Canvases after Threads where canvases are on, in Simple Mode too', () => {
    const canvases = { mindroom: { canvas: { enabled: true } } };
    const renderer = renderSidebarNav(canvases);
    expect(
      renderer.root
        .findAll((node) => typeof node.props['data-tab'] === 'string')
        .map((node) => node.props['data-tab'])
        .slice(0, 5)
    ).toEqual(['home', 'direct', 'threads', 'canvases', 'spaces']);
    renderer.unmount();

    const off = renderSidebarNav();
    expect(hasTab(off, 'canvases')).toBe(false);
    off.unmount();

    mocks.simpleMode = true;
    const simple = renderSidebarNav(canvases);
    expect(hasTab(simple, 'canvases')).toBe(true);
    simple.unmount();

    // The user can turn the button off in Settings → General → Interface.
    mocks.showCanvases = false;
    const turnedOff = renderSidebarNav(canvases);
    expect(hasTab(turnedOff, 'canvases')).toBe(false);
    turnedOff.unmount();
  });

  it('keeps Explorer visible in the full interface regardless of the Simple Mode option', () => {
    const cases: [ClientConfig, boolean][] = [
      [{}, true],
      [{ sidebar: {} }, true],
      [{ sidebar: { showExploreCommunityInSimpleMode: false } }, true],
      [{ sidebar: { showExploreCommunityInSimpleMode: true } }, true],
      [{ sidebar: { showExploreCommunity: false } }, false],
      [{ sidebar: { showExploreCommunity: true } }, true],
    ];

    cases.forEach(([config, visible]) => {
      const renderer = renderSidebarNav(config);

      expect(hasTab(renderer, 'explore')).toBe(visible);

      renderer.unmount();
    });
  });

  it('only shows Explorer in Simple Mode when its dedicated option is enabled', () => {
    mocks.simpleMode = true;
    const cases: [ClientConfig, boolean][] = [
      [{}, false],
      [{ sidebar: {} }, false],
      [{ sidebar: { showExploreCommunityInSimpleMode: false } }, false],
      [{ sidebar: { showExploreCommunityInSimpleMode: true } }, true],
      [{ sidebar: { showExploreCommunity: false } }, false],
      [{ sidebar: { showExploreCommunity: true } }, false],
      [{ sidebar: { showExploreCommunity: false, showExploreCommunityInSimpleMode: true } }, true],
    ];

    cases.forEach(([config, visible]) => {
      const renderer = renderSidebarNav(config);

      expect(hasTab(renderer, 'explore')).toBe(visible);

      renderer.unmount();
    });
  });

  it('keeps other advanced navigation hidden when Explorer is enabled in Simple Mode', () => {
    mocks.simpleMode = true;
    const renderer = renderSidebarNav({ sidebar: { showExploreCommunityInSimpleMode: true } });

    expect(hasTab(renderer, 'explore')).toBe(true);
    expect(hasTab(renderer, 'threads')).toBe(false);
    expect(hasTab(renderer, 'mindroom')).toBe(false);
    expect(hasTab(renderer, 'create')).toBe(false);

    renderer.unmount();
  });

  it('keeps spaces visible in Simple Mode while hiding advanced navigation', () => {
    mocks.simpleMode = true;
    const renderer = renderSidebarNav();

    expect(hasTab(renderer, 'spaces')).toBe(true);
    expect(hasTab(renderer, 'threads')).toBe(false);
    expect(hasTab(renderer, 'explore')).toBe(false);
    expect(hasTab(renderer, 'mindroom')).toBe(false);
    expect(hasTab(renderer, 'create')).toBe(false);

    renderer.unmount();
  });

  it('shows Local MindRoom only for accounts on the provisioning homeserver', () => {
    const config = { sidebar: { mindRoomProvisioningUrl: 'https://mindroom.chat' } };
    const onProvisioningServer = renderSidebarNav(config);
    expect(hasTab(onProvisioningServer, 'mindroom')).toBe(true);
    onProvisioningServer.unmount();

    mocks.homeserverUrl = 'https://matrix.example.org';
    const elsewhere = renderSidebarNav(config);
    expect(hasTab(elsewhere, 'mindroom')).toBe(false);
    elsewhere.unmount();

    // Without a provisioning URL, every homeserver provisions its own accounts.
    const ownProvisioning = renderSidebarNav();
    expect(hasTab(ownProvisioning, 'mindroom')).toBe(true);
    ownProvisioning.unmount();
  });

  it('renders an optional footer below the sticky navigation stack', () => {
    const renderer = renderSidebarNav(
      {},
      React.createElement('button', { 'aria-label': 'Collapse navigation panel' })
    );

    expect(
      renderer.root.findAllByProps({ 'aria-label': 'Collapse navigation panel' })
    ).toHaveLength(1);

    renderer.unmount();
  });
});
