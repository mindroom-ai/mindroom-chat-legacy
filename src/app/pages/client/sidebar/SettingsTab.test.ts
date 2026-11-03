import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHomePath, getLoginPath } from '../../pathUtils';
import { SettingsTab } from './SettingsTab';
import { useActiveSession, useStoredSessions } from '../../../hooks/useSessionStore';
import {
  setActiveSession,
  updateSessionProfile,
  type StoredSession,
} from '../../../state/sessions';
import { settingsModalAtom } from '../../../state/settingsModal';
import { withAddAccountSearch } from '../../auth/addAccount';
import { useUserProfile } from '../../../hooks/useUserProfile';
import { removeStoredSession } from '../../../../client/initMatrix';
import { mindroomAccountSettingsAtom } from '../../../mindroom/settings/useMindroomAccountSettings';

const navigate = vi.fn();
const mediaAuthState = vi.hoisted(() => ({ value: false }));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

vi.mock('folds', async () => {
  const reactModule = await import('react');
  return {
    Icon: () => reactModule.createElement('i'),
    Icons: {
      Plus: 'Plus',
    },
    Text: ({ children, ...props }: { children: React.ReactNode; role?: string }) =>
      reactModule.createElement('span', props, children),
  };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock('../../../components/sidebar', () => ({
  SidebarItem: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  SidebarItemTooltip: ({ children }: { children: (triggerRef: () => void) => React.ReactNode }) =>
    React.createElement(
      'div',
      null,
      children(() => undefined)
    ),
  SidebarAvatar: React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
      children: React.ReactNode;
    }
  >(({ children, ...props }, ref) =>
    React.createElement('button', { ref, type: 'button', ...props }, children)
  ),
}));

vi.mock('../../../components/user-avatar', () => ({
  UserAvatar: ({ userId, src }: { userId: string; src?: string }) =>
    React.createElement('div', { 'data-user-id': userId, 'data-src': src }, userId),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@alice:mindroom.chat',
    getHomeserverUrl: () => 'https://mindroom.chat',
    getAccessToken: () => 'token-a',
  }),
}));

vi.mock('../../../utils/matrix', () => ({
  getMxIdLocalPart: (userId: string) => userId.split(':')[0].replace('@', ''),
  mxcUrlToHttp: (
    _mx: unknown,
    mxcUrl: string,
    useAuthentication: boolean,
    width: number,
    height: number,
    method: string
  ) => {
    const match = mxcUrl.match(/^mxc:\/\/([^/]+)\/(.+)$/);
    if (!match || match[1] === '.' || match[1] === '..') return null;
    const endpoint = useAuthentication ? '_matrix/client/v1/media' : '_matrix/media/v3';
    return `https://mindroom.chat/${endpoint}/thumbnail/${encodeURIComponent(
      match[1]
    )}/${encodeURIComponent(match[2])}?width=${width}&height=${height}&method=${method}`;
  },
}));

vi.mock('../../../utils/common', () => ({
  nameInitials: (name: string) => name.slice(0, 1),
}));

vi.mock('../../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => mediaAuthState.value,
}));

vi.mock('../../../hooks/useUserProfile', () => ({
  useUserProfile: vi.fn(() => ({
    displayName: 'Alice',
    avatarUrl: undefined,
    isAvatarResolved: true,
    isDisplayNameResolved: true,
  })),
}));

vi.mock('../../../components/Modal500', () => ({
  Modal500: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../../hooks/useSessionStore', () => ({
  useActiveSession: vi.fn(),
  useStoredSessions: vi.fn(),
}));

vi.mock('../../../state/sessions', () => ({
  setActiveSession: vi.fn(),
  updateSessionProfile: vi.fn(),
}));

vi.mock('../../../../client/initMatrix', () => ({
  removeStoredSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./AccountSwitcher', () => ({
  AccountSwitcher: ({
    accounts,
    error,
    onRemoveAccount,
  }: {
    accounts: Array<{ session: StoredSession }>;
    error?: string;
    onRemoveAccount: (session: StoredSession) => void;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'account-switcher' },
      'account-switcher',
      error ? React.createElement('span', { role: 'alert' }, error) : undefined,
      React.createElement(
        'button',
        {
          'data-testid': 'remove-account',
          onClick: () => onRemoveAccount(accounts[1].session),
        },
        'remove-account'
      )
    ),
}));

const activeSession = {
  sessionId: 'session-a',
  baseUrl: 'https://chat.mindroom.chat',
  userId: '@alice:mindroom.chat',
  deviceId: 'DEVICE_A',
  accessToken: 'token-a',
  lastUsedAt: 1,
};

const inactiveSession = {
  sessionId: 'session-b',
  baseUrl: 'https://matrix.org',
  userId: '@bob:matrix.org',
  deviceId: 'DEVICE_B',
  accessToken: 'token-b',
  lastUsedAt: 2,
  lastKnownDisplayName: 'Bob',
  lastKnownPath: '/space/%23lobby%3Amindroom.chat?threadId=%24abc#reply',
};

const findButtonByAriaLabel = (renderer: ReturnType<typeof create>, label: string) =>
  renderer.root.findAll((node) => node.type === 'button' && node.props['aria-label'] === label)[0];

const renderSettingsTab = (sessions = [activeSession, inactiveSession]) => {
  vi.mocked(useActiveSession).mockReturnValue(activeSession);
  vi.mocked(useStoredSessions).mockReturnValue(sessions);

  const store = createStore();
  const renderer = create(
    React.createElement(Provider, { store }, React.createElement(SettingsTab))
  );

  return { renderer, store };
};

describe('SettingsTab', () => {
  beforeEach(() => {
    mediaAuthState.value = false;
    vi.mocked(setActiveSession).mockReturnValue(inactiveSession);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    navigate.mockReset();
  });

  it('opens settings from the active avatar instead of the account switcher', async () => {
    const { renderer, store } = renderSettingsTab();

    await act(async () => {
      findButtonByAriaLabel(renderer, 'Open settings for Alice').props.onClick();
    });

    expect(store.get(settingsModalAtom)).toEqual({});
    expect(
      renderer.root.findAll((node) => node.props['data-testid'] === 'account-switcher')
    ).toHaveLength(0);
    expect(vi.mocked(setActiveSession)).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the manage accounts trigger only when multiple sessions exist', () => {
    const { renderer: multiSessionRenderer } = renderSettingsTab();
    expect(findButtonByAriaLabel(multiSessionRenderer, 'Manage accounts')).toBeDefined();

    const { renderer: singleSessionRenderer } = renderSettingsTab([activeSession]);
    expect(findButtonByAriaLabel(singleSessionRenderer, 'Manage accounts')).toBeUndefined();
  });

  it('opens the account switcher from the manage accounts trigger', async () => {
    const { renderer, store } = renderSettingsTab();

    await act(async () => {
      findButtonByAriaLabel(renderer, 'Manage accounts').props.onClick();
    });

    expect(
      renderer.root.findAll((node) => node.props['data-testid'] === 'account-switcher')
    ).toHaveLength(1);
    expect(store.get(settingsModalAtom)).toBeUndefined();
  });

  it('restores the stored last route when switching to another account', async () => {
    const { renderer } = renderSettingsTab();

    await act(async () => {
      findButtonByAriaLabel(renderer, 'Switch to account Bob (@bob:matrix.org)').props.onClick();
    });

    expect(vi.mocked(setActiveSession)).toHaveBeenCalledWith('session-b');
    expect(navigate).toHaveBeenCalledWith('/space/%23lobby%3Amindroom.chat?threadId=%24abc#reply');
  });

  it('keeps the account switcher open when the selected account disappeared', async () => {
    vi.mocked(setActiveSession).mockReturnValueOnce(undefined);
    const { renderer } = renderSettingsTab();

    await act(async () => {
      findButtonByAriaLabel(renderer, 'Switch to account Bob (@bob:matrix.org)').props.onClick();
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(
      renderer.root.findAll((node) => node.props['data-testid'] === 'account-switcher')
    ).toHaveLength(1);
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toBe(
      'Could not update this account. Please try again.'
    );
  });

  it('keeps the account switcher open when browser storage blocks the switch', async () => {
    vi.mocked(setActiveSession).mockImplementationOnce(() => {
      throw new Error('blocked write');
    });
    const { renderer } = renderSettingsTab();

    await act(async () => {
      findButtonByAriaLabel(renderer, 'Switch to account Bob (@bob:matrix.org)').props.onClick();
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toBe(
      'Could not update this account. Please try again.'
    );
  });

  it('reports a failed inactive-account removal without closing the switcher', async () => {
    vi.mocked(removeStoredSession).mockRejectedValueOnce(new Error('blocked write'));
    const { renderer } = renderSettingsTab();
    await act(async () => {
      findButtonByAriaLabel(renderer, 'Manage accounts').props.onClick();
    });

    await act(async () => {
      renderer.root.findByProps({ 'data-testid': 'remove-account' }).props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(vi.mocked(removeStoredSession)).toHaveBeenCalledWith(inactiveSession);
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toBe(
      'Could not update this account. Please try again.'
    );
    expect(
      renderer.root.findAll((node) => node.props['data-testid'] === 'account-switcher')
    ).toHaveLength(1);
  });

  it('falls back to home when the stored path is missing or invalid', async () => {
    const { renderer } = renderSettingsTab([
      { ...activeSession },
      { ...inactiveSession, lastKnownPath: 'https://matrix.org/outside' },
    ]);

    await act(async () => {
      findButtonByAriaLabel(renderer, 'Switch to account Bob (@bob:matrix.org)').props.onClick();
    });

    expect(vi.mocked(setActiveSession)).toHaveBeenCalledWith('session-b');
    expect(navigate).toHaveBeenCalledWith(getHomePath());
    expect(vi.mocked(updateSessionProfile)).toHaveBeenCalled();
  });

  it('preserves the active homeserver when opening add account', async () => {
    const localSession = {
      ...activeSession,
      baseUrl: 'http://127.0.0.1:8808',
      userId: '@alice:mindroom.local',
    };
    vi.mocked(useActiveSession).mockReturnValue(localSession);
    vi.mocked(useStoredSessions).mockReturnValue([localSession]);

    const store = createStore();
    store.set(mindroomAccountSettingsAtom, {
      simpleMode: false,
    });
    const renderer = create(
      React.createElement(Provider, { store }, React.createElement(SettingsTab))
    );

    await act(async () => {
      findButtonByAriaLabel(renderer, 'Add account').props.onClick();
    });

    expect(navigate).toHaveBeenCalledWith(
      withAddAccountSearch(getLoginPath('http://127.0.0.1:8808'))
    );
  });

  it('does not refetch the active avatar when the cached avatar data already matches', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.mocked(useUserProfile).mockReturnValue({
      displayName: 'Alice',
      avatarUrl: 'mxc://mindroom.chat/avatar',
      isAvatarResolved: true,
      isDisplayNameResolved: true,
    });

    const sessionWithCachedAvatar = {
      ...activeSession,
      lastKnownAvatarUrl: 'mxc://mindroom.chat/avatar',
      lastKnownAvatarDataUrl: 'data:image/png;base64,cached',
    };

    vi.mocked(useActiveSession).mockReturnValue(sessionWithCachedAvatar);
    vi.mocked(useStoredSessions).mockReturnValue([sessionWithCachedAvatar]);

    await act(async () => {
      create(
        React.createElement(Provider, { store: createStore() }, React.createElement(SettingsTab))
      );
      await Promise.resolve();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses cached avatar data for the active account when the live profile avatar is unavailable', async () => {
    const sessionWithCachedAvatar = {
      ...activeSession,
      lastKnownAvatarUrl: 'mxc://mindroom.chat/avatar',
      lastKnownAvatarDataUrl: 'data:image/png;base64,cached',
    };

    vi.mocked(useUserProfile).mockReturnValue({
      displayName: 'Alice',
      avatarUrl: undefined,
      isAvatarResolved: false,
      isDisplayNameResolved: false,
    });
    vi.mocked(useActiveSession).mockReturnValue(sessionWithCachedAvatar);
    vi.mocked(useStoredSessions).mockReturnValue([sessionWithCachedAvatar]);

    const renderer = create(
      React.createElement(Provider, { store: createStore() }, React.createElement(SettingsTab))
    );
    const activeAvatar = renderer.root.findAll(
      (node) => node.props['data-user-id'] === '@alice:mindroom.chat'
    )[0];

    expect(activeAvatar.props['data-src']).toBe('data:image/png;base64,cached');
  });

  it('preserves cached profile data across rerenders while profile loading is unresolved', async () => {
    let unresolvedSession = {
      ...activeSession,
      lastKnownDisplayName: 'Stored Alice',
      lastKnownAvatarUrl: 'mxc://mindroom.chat/avatar',
      lastKnownAvatarDataUrl: 'data:image/png;base64,cached',
    };
    vi.mocked(useUserProfile).mockReturnValue({
      displayName: '@alice:mindroom.chat',
      avatarUrl: undefined,
      isAvatarResolved: false,
      isDisplayNameResolved: false,
    });
    vi.mocked(useActiveSession).mockImplementation(() => unresolvedSession);
    vi.mocked(useStoredSessions).mockImplementation(() => [unresolvedSession]);

    const store = createStore();
    const renderer = create(
      React.createElement(Provider, { store }, React.createElement(SettingsTab))
    );

    await act(async () => {
      unresolvedSession = { ...unresolvedSession, lastUsedAt: 2 };
      renderer.update(React.createElement(Provider, { store }, React.createElement(SettingsTab)));
      await Promise.resolve();
    });

    const activeAvatar = renderer.root.findAll(
      (node) => node.props['data-user-id'] === '@alice:mindroom.chat'
    )[0];
    expect(activeAvatar.props['data-src']).toBe('data:image/png;base64,cached');
    expect(findButtonByAriaLabel(renderer, 'Open settings for Stored Alice')).toBeDefined();
    vi.mocked(updateSessionProfile).mock.calls.forEach(([, update]) => {
      expect(update).not.toHaveProperty('lastKnownDisplayName');
      expect(update).not.toHaveProperty('lastKnownAvatarUrl');
      expect(update).not.toHaveProperty('lastKnownAvatarDataUrl');
    });
  });

  it('fetches the last known avatar url when the live profile avatar is unavailable', async () => {
    class FileReaderMock {
      result: string | null = null;

      onload: null | (() => void) = null;

      onerror: null | (() => void) = null;

      readAsDataURL() {
        this.result = 'data:image/png;base64,avatar';
        this.onload?.();
      }
    }

    vi.stubGlobal('FileReader', FileReaderMock);
    const fetchSpy = vi.fn(() =>
      Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(['avatar'], { type: 'image/png' })),
      })
    );
    vi.stubGlobal('fetch', fetchSpy);
    vi.mocked(useUserProfile).mockReturnValue({
      displayName: 'Alice',
      avatarUrl: undefined,
      isAvatarResolved: false,
      isDisplayNameResolved: false,
    });

    const sessionWithLastKnownAvatar = {
      ...activeSession,
      lastKnownAvatarUrl: 'mxc://mindroom.chat/avatar',
      lastKnownAvatarDataUrl: undefined,
    };

    vi.mocked(useActiveSession).mockReturnValue(sessionWithLastKnownAvatar);
    vi.mocked(useStoredSessions).mockReturnValue([sessionWithLastKnownAvatar]);

    await act(async () => {
      create(
        React.createElement(Provider, { store: createStore() }, React.createElement(SettingsTab))
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://mindroom.chat/_matrix/media/v3/thumbnail/mindroom.chat/avatar?width=96&height=96&method=crop'
    );
    expect(fetchSpy.mock.calls[0][1]).not.toHaveProperty('headers');
  });

  it('uses the authenticated media endpoint and a bearer header when supported', async () => {
    mediaAuthState.value = true;
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: false }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.mocked(useUserProfile).mockReturnValue({
      displayName: 'Alice',
      avatarUrl: 'mxc://mindroom.chat/avatar',
      isAvatarResolved: true,
      isDisplayNameResolved: true,
    });

    await act(async () => {
      renderSettingsTab([activeSession]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://mindroom.chat/_matrix/client/v1/media/thumbnail/mindroom.chat/avatar?width=96&height=96&method=crop',
      expect.objectContaining({ headers: { Authorization: 'Bearer token-a' } })
    );
  });

  it('never attaches credentials to a path-traversing MXC avatar', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.mocked(useUserProfile).mockReturnValue({
      displayName: 'Alice',
      avatarUrl: 'mxc://../outside-media',
      isAvatarResolved: true,
      isDisplayNameResolved: true,
    });

    await act(async () => {
      renderSettingsTab([activeSession]);
      await Promise.resolve();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not expose an authenticated media URL while the active avatar cache is empty', () => {
    vi.mocked(useUserProfile).mockReturnValue({
      displayName: 'Alice',
      avatarUrl: undefined,
      isAvatarResolved: false,
      isDisplayNameResolved: false,
    });

    const sessionWithLastKnownAvatar = {
      ...activeSession,
      lastKnownAvatarUrl: 'mxc://mindroom.chat/avatar-media-id',
      lastKnownAvatarDataUrl: undefined,
    };

    vi.mocked(useActiveSession).mockReturnValue(sessionWithLastKnownAvatar);
    vi.mocked(useStoredSessions).mockReturnValue([sessionWithLastKnownAvatar]);

    const renderer = create(
      React.createElement(Provider, { store: createStore() }, React.createElement(SettingsTab))
    );
    const activeAvatar = renderer.root.findAll(
      (node) => node.props['data-user-id'] === '@alice:mindroom.chat'
    )[0];

    expect(activeAvatar.props['data-src']).toBeUndefined();
  });

  it('prefers the stored-session copy of the active avatar fields when the active-session hook is stale', () => {
    vi.mocked(useUserProfile).mockReturnValue({
      displayName: 'Alice',
      avatarUrl: undefined,
      isAvatarResolved: false,
      isDisplayNameResolved: false,
    });

    const staleActiveSession = {
      ...activeSession,
      lastKnownAvatarUrl: undefined,
      lastKnownAvatarDataUrl: undefined,
    };
    const refreshedSession = {
      ...activeSession,
      lastKnownAvatarUrl: 'mxc://mindroom.chat/avatar-media-id',
      lastKnownAvatarDataUrl: undefined,
    };

    vi.mocked(useActiveSession).mockReturnValue(staleActiveSession);
    vi.mocked(useStoredSessions).mockReturnValue([refreshedSession]);

    const renderer = create(
      React.createElement(Provider, { store: createStore() }, React.createElement(SettingsTab))
    );
    const activeAvatar = renderer.root.findAll(
      (node) => node.props['data-user-id'] === '@alice:mindroom.chat'
    )[0];

    expect(activeAvatar.props['data-src']).toBeUndefined();
  });
});
