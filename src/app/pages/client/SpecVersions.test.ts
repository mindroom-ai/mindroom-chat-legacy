import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCacheAndReload, removeSessionAndReload } from '../../../client/initMatrix';
import { SpecVersions } from './SpecVersions';
import { useActiveSession } from '../../hooks/useSessionStore';
import { specVersions } from '../../cs-api';
import { readCachedSpecVersions, writeCachedSpecVersions } from '../../state/cachedSpecVersions';
import { useSpecVersions } from '../../hooks/useSpecVersions';

let specVersionsLoaderMode: 'fallback' | 'error' | 'success' = 'success';
let loadedSpecVersions = { versions: [] as string[] };
let specVersionsLoaderRenderCount = 0;
const storageState = new Map<string, string>();

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Box: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Dialog: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Text: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    Button: ({
      children,
      onClick,
      disabled,
      before,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
      disabled?: boolean;
      before?: React.ReactNode;
    }) => reactModule.createElement('button', { onClick, disabled }, before, children),
    Spinner: () => reactModule.createElement('div', null, 'spinner'),
    config: {
      space: {
        S400: '16px',
      },
    },
  };
});

vi.mock('../../components/splash-screen', () => ({
  SplashScreen: ({
    children,
    background,
  }: {
    children: React.ReactNode;
    background?: React.ReactNode;
  }) => React.createElement('div', { 'data-has-background': Boolean(background) }, children),
  MindRoomSplashScreen: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-mindroom-splash': true }, children),
}));

vi.mock('../../components/SpecVersionsLoader', () => ({
  SpecVersionsLoader: ({
    fallback,
    error,
    children,
  }: {
    fallback?: () => React.ReactNode;
    error?: (err: unknown, retry: () => void, ignore: () => void) => React.ReactNode;
    children: (versions: { versions: string[] }) => React.ReactNode;
  }) => {
    specVersionsLoaderRenderCount += 1;
    const [ignoreError, setIgnoreError] = React.useState(false);
    if (specVersionsLoaderMode === 'fallback') return fallback?.() ?? null;
    if (specVersionsLoaderMode === 'error' && !ignoreError) {
      return (
        error?.(
          new Error('request failed'),
          () => undefined,
          () => setIgnoreError(true)
        ) ?? null
      );
    }
    return children(specVersionsLoaderMode === 'error' ? { versions: [] } : loadedSpecVersions);
  },
}));

vi.mock('../../cs-api', () => ({
  specVersions: vi.fn(),
}));

vi.mock('../../../client/initMatrix', () => ({
  clearAllCacheAndReload: vi.fn(() => Promise.resolve()),
  removeSessionAndReload: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../hooks/useSessionStore', () => ({
  useActiveSession: vi.fn(),
}));

describe('SpecVersions', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    storageState.clear();
    loadedSpecVersions = { versions: [] };
    specVersionsLoaderRenderCount = 0;
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storageState.get(key) ?? null),
      removeItem: vi.fn((key: string) => {
        storageState.delete(key);
      }),
      setItem: vi.fn((key: string, value: string) => {
        storageState.set(key, value);
      }),
    } as unknown as Storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    specVersionsLoaderMode = 'success';

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }
  });

  it('shows cached content before versions arrive and updates capabilities without losing its draft', async () => {
    specVersionsLoaderMode = 'fallback';
    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    });
    let resolveRefresh!: (versions: { versions: string[] }) => void;
    vi.mocked(specVersions).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        })
    );
    let mounts = 0;
    const CachedRoom = () => {
      const { versions } = useSpecVersions();
      const [draft, setDraft] = React.useState('');
      React.useEffect(() => {
        mounts += 1;
      }, []);
      return React.createElement('input', {
        value: draft,
        'data-versions': versions.join(','),
        onChange: (value: string) => setDraft(value),
      });
    };
    const render = (allowCachedContent: boolean) =>
      React.createElement(
        SpecVersions,
        { baseUrl: 'https://example.com', allowCachedContent },
        React.createElement(CachedRoom)
      );
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(render(false));
    });
    expect(renderer.root.findAllByType('input')).toHaveLength(0);

    await act(async () => {
      renderer.update(render(true));
    });
    expect(renderer.root.findByType('input').props['data-versions']).toBe('');
    act(() => {
      renderer.root.findByType('input').props.onChange('unsent draft');
    });

    await act(async () => {
      resolveRefresh({ versions: ['v1.11'] });
    });

    expect(renderer.root.findByType('input').props['data-versions']).toBe('v1.11');
    expect(renderer.root.findByType('input').props.value).toBe('unsent draft');
    expect(mounts).toBe(1);
    expect(readCachedSpecVersions('https://example.com', '@alice:example.com')).toEqual({
      versions: ['v1.11'],
    });
    act(() => {
      renderer.unmount();
    });
  });

  it.each(['empty', 'failed'])(
    'keeps cached content visible after a %s versions refresh',
    async (result) => {
      specVersionsLoaderMode = 'fallback';
      vi.mocked(useActiveSession).mockReturnValue({
        sessionId: 'session-a',
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE',
        accessToken: 'token',
        lastUsedAt: 1,
      });
      if (result === 'empty') vi.mocked(specVersions).mockResolvedValue({ versions: [] });
      else vi.mocked(specVersions).mockRejectedValue(new Error('offline'));
      const CachedRoom = () => {
        const { versions } = useSpecVersions();
        return React.createElement(
          'article',
          { 'data-versions': versions.join(',') },
          'cached messages'
        );
      };
      let renderer!: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(
          React.createElement(
            SpecVersions,
            { baseUrl: 'https://example.com', allowCachedContent: true },
            React.createElement(CachedRoom)
          )
        );
      });

      expect(renderer.root.findByType('article').children).toEqual(['cached messages']);
      expect(renderer.root.findByType('article').props['data-versions']).toBe('');
      expect(readCachedSpecVersions('https://example.com', '@alice:example.com')).toBeUndefined();
      act(() => {
        renderer.unmount();
      });
    }
  );

  it('renders cached versions immediately and refreshes only the stored copy', async () => {
    const fetchMock = vi.fn().mockResolvedValue({} as Response);
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    });
    writeCachedSpecVersions('https://example.com', '@alice:example.com', {
      versions: ['v1.10'],
    });
    let resolveRefresh:
      | ((versions: { versions: string[]; unstable_features?: Record<string, boolean> }) => void)
      | undefined;
    vi.mocked(specVersions).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        })
    );
    const VersionText = () => {
      const { versions } = useSpecVersions();
      return React.createElement('div', null, versions.join(','));
    };

    const renderer = create(
      React.createElement(
        SpecVersions,
        {
          baseUrl: 'https://example.com',
        },
        React.createElement(VersionText)
      )
    );

    expect(renderer.root.findByType('div').children).toEqual(['v1.10']);
    expect(specVersionsLoaderRenderCount).toBe(0);

    await act(async () => {
      await Promise.resolve();
    });
    expect(specVersions).toHaveBeenCalledWith(expect.any(Function), 'https://example.com');
    expect(specVersions).toHaveBeenCalledTimes(1);
    const request = vi.mocked(specVersions).mock.calls[0]?.[0];
    await request?.('https://example.com/_matrix/client/versions', { method: 'GET' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/_matrix/client/versions',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Authorization: 'Bearer token',
        },
      })
    );

    await act(async () => {
      resolveRefresh?.({ versions: ['v1.11'] });
      await Promise.resolve();
    });

    expect(readCachedSpecVersions('https://example.com', '@alice:example.com')).toEqual({
      versions: ['v1.11'],
    });
    expect(renderer.root.findByType('div').children).toEqual(['v1.10']);

    act(() => {
      renderer.update(
        React.createElement(
          SpecVersions,
          {
            baseUrl: 'https://example.com',
          },
          React.createElement(VersionText)
        )
      );
    });
    expect(specVersions).toHaveBeenCalledTimes(1);
  });

  it('keeps last-known-good versions when the background refresh returns empty versions', async () => {
    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    });
    const cached = { versions: ['v1.10'] };
    writeCachedSpecVersions('https://example.com', '@alice:example.com', cached);
    vi.mocked(specVersions).mockResolvedValue({ versions: [] });

    await act(async () => {
      create(
        React.createElement(
          SpecVersions,
          {
            baseUrl: 'https://example.com',
          },
          React.createElement('div', null, 'child')
        )
      );
      await Promise.resolve();
    });

    expect(readCachedSpecVersions('https://example.com', '@alice:example.com')).toEqual(cached);
  });

  it('falls back to the loader and removes a JSON-valid wrong-shape cache entry', () => {
    specVersionsLoaderMode = 'fallback';
    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    });
    const key = 'cinny_spec_versions::https://example.com::@alice:example.com';
    storageState.set(key, '{"versions":1}');

    const renderer = create(
      React.createElement(
        SpecVersions,
        {
          baseUrl: 'https://example.com',
        },
        React.createElement('div', null, 'child')
      )
    );

    expect(renderer.root.findByProps({ 'data-mindroom-splash': true })).toBeDefined();
    expect(storageState.has(key)).toBe(false);
  });

  it('keeps the loader path and writes successful versions on a cache miss', async () => {
    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    });
    loadedSpecVersions = { versions: ['v1.11'] };

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        React.createElement(
          SpecVersions,
          {
            baseUrl: 'https://example.com',
          },
          React.createElement('div', null, 'child')
        )
      );
      await Promise.resolve();
    });

    expect(renderer?.root.findByType('div').children).toEqual(['child']);
    expect(specVersionsLoaderRenderCount).toBe(1);
    expect(readCachedSpecVersions('https://example.com', '@alice:example.com')).toEqual({
      versions: ['v1.11'],
    });
    expect(specVersions).not.toHaveBeenCalled();
  });

  it('keeps loaded versions when cached content becomes available after a fresh login', async () => {
    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    });
    loadedSpecVersions = { versions: ['v1.11'] };
    vi.mocked(specVersions).mockReturnValue(
      new Promise(() => {
        // The background refresh stays pending, so only the loaded versions can be provided.
      })
    );
    const Client = () =>
      React.createElement('main', { 'data-versions': useSpecVersions().versions.join(',') });
    const render = (allowCachedContent: boolean) =>
      React.createElement(
        SpecVersions,
        { baseUrl: 'https://example.com', allowCachedContent },
        React.createElement(Client)
      );
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(render(false));
    });
    expect(renderer.root.findByType('main').props['data-versions']).toBe('v1.11');

    // The first sync adds rooms, so ClientRoot allows cached content; the client must not lose the versions it loaded.
    await act(async () => {
      renderer.update(render(true));
    });
    expect(renderer.root.findByType('main').props['data-versions']).toBe('v1.11');
    act(() => {
      renderer.unmount();
    });
  });

  it('does not refresh again when cached content becomes allowed', async () => {
    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    });
    writeCachedSpecVersions('https://example.com', '@alice:example.com', { versions: ['v1.10'] });
    vi.mocked(specVersions).mockReturnValue(
      new Promise(() => {
        // Keep the refresh pending; only the number of requests matters here.
      })
    );
    const render = (allowCachedContent: boolean) =>
      React.createElement(
        SpecVersions,
        { baseUrl: 'https://example.com', allowCachedContent },
        React.createElement('div', null, 'child')
      );
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(render(false));
    });
    await act(async () => {
      renderer.update(render(true));
    });

    expect(specVersions).toHaveBeenCalledTimes(1);
    act(() => {
      renderer.unmount();
    });
  });

  it('does not cache the empty versions fallback used after an ignored loader error', async () => {
    specVersionsLoaderMode = 'error';
    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    });

    const renderer = create(
      React.createElement(
        SpecVersions,
        {
          baseUrl: 'https://example.com',
        },
        React.createElement('div', null, 'child')
      )
    );

    const continueButton = renderer.root
      .findAllByType('button')
      .find((node) =>
        node.findAllByType('span').some((textNode) => textNode.children.join('') === 'Continue')
      );

    await act(async () => {
      continueButton?.props.onClick();
      await Promise.resolve();
    });

    expect(readCachedSpecVersions('https://example.com', '@alice:example.com')).toBeUndefined();
  });

  it('does not serve another account cached versions on the same homeserver', () => {
    specVersionsLoaderMode = 'fallback';
    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-b',
      baseUrl: 'https://example.com',
      userId: '@bob:example.com',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    });
    writeCachedSpecVersions('https://example.com', '@alice:example.com', {
      versions: ['v1.11'],
    });

    const renderer = create(
      React.createElement(
        SpecVersions,
        {
          baseUrl: 'https://example.com',
        },
        React.createElement('div', null, 'child')
      )
    );

    expect(renderer.root.findByProps({ 'data-mindroom-splash': true })).toBeDefined();
    expect(specVersionsLoaderRenderCount).toBe(1);
    expect(specVersions).not.toHaveBeenCalled();
  });

  it('supports canceling from connecting state', async () => {
    specVersionsLoaderMode = 'fallback';
    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    });

    const renderer = create(
      React.createElement(
        SpecVersions,
        {
          baseUrl: 'https://example.com',
        },
        React.createElement('div', null, 'child')
      )
    );

    const cancelButton = renderer.root
      .findAllByType('button')
      .find((node) =>
        node
          .findAllByType('span')
          .some((textNode) => textNode.children.join('') === 'Cancel and return to sign in')
      );

    expect(cancelButton).toBeDefined();

    await act(async () => {
      cancelButton?.props.onClick();
    });

    expect(vi.mocked(removeSessionAndReload)).toHaveBeenCalledTimes(1);
  });

  it('uses the particle background while connecting to the server', () => {
    specVersionsLoaderMode = 'fallback';
    vi.mocked(useActiveSession).mockReturnValue(undefined);

    const renderer = create(
      React.createElement(
        SpecVersions,
        {
          baseUrl: 'https://example.com',
        },
        React.createElement('div', null, 'child')
      )
    );

    expect(renderer.root.findByProps({ 'data-mindroom-splash': true })).toBeDefined();
  });

  it('shows clear-cache recovery on connection error', async () => {
    specVersionsLoaderMode = 'error';
    vi.mocked(useActiveSession).mockReturnValue(undefined);

    const renderer = create(
      React.createElement(
        SpecVersions,
        {
          baseUrl: 'https://example.com',
        },
        React.createElement('div', null, 'child')
      )
    );

    const clearCacheButton = renderer.root
      .findAllByType('button')
      .find((node) =>
        node
          .findAllByType('span')
          .some((textNode) => textNode.children.join('') === 'Clear Cache and Reload')
      );

    expect(clearCacheButton).toBeDefined();

    await act(async () => {
      clearCacheButton?.props.onClick();
    });

    expect(vi.mocked(clearAllCacheAndReload)).toHaveBeenCalledTimes(1);
  });

  it('disables the clear-cache action and shows progress while clearing', () => {
    specVersionsLoaderMode = 'error';
    vi.mocked(useActiveSession).mockReturnValue(undefined);

    let resolveClear: (() => void) | undefined;
    vi.mocked(clearAllCacheAndReload).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveClear = resolve;
        })
    );

    const renderer = create(
      React.createElement(
        SpecVersions,
        {
          baseUrl: 'https://example.com',
        },
        React.createElement('div', null, 'child')
      )
    );

    const getButtonByLabel = (label: string) =>
      renderer.root
        .findAllByType('button')
        .find((node) =>
          node.findAllByType('span').some((textNode) => textNode.children.join('') === label)
        );

    const initialButton = getButtonByLabel('Clear Cache and Reload');

    expect(initialButton?.props.disabled).toBeFalsy();

    act(() => {
      initialButton?.props.onClick();
    });

    const clearingButton = getButtonByLabel('Clearing...');

    expect(vi.mocked(clearAllCacheAndReload)).toHaveBeenCalledTimes(1);
    expect(clearingButton).toBeDefined();
    expect(clearingButton?.props.disabled).toBe(true);

    act(() => {
      clearingButton?.props.onClick();
    });

    expect(vi.mocked(clearAllCacheAndReload)).toHaveBeenCalledTimes(1);

    act(() => {
      resolveClear?.();
    });
  });
});
