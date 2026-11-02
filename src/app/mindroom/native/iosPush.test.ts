import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildIOSPushPusherRequest,
  clearIOSPushState,
  getIOSPushEnabled,
  getStoredIOSPushToken,
  migrateLegacyIOSPushEnabled,
  resolveIOSPushConfig,
  setIOSPushEnabled,
  upsertIOSPushPusher,
} from './iosPush';
import { hasCloudflareAccess } from './cloudflareAccess';

vi.mock('./cloudflareAccess', () => ({ hasCloudflareAccess: vi.fn(() => false) }));

describe('resolveIOSPushConfig', () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;

  afterEach(() => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }

    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      });
    }
  });

  it('returns undefined when iOS push is disabled', () => {
    expect(
      resolveIOSPushConfig({
        push: {
          ios: {
            enabled: false,
            appId: 'com.mindroom-ios',
            gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
          },
        },
      })
    ).toBeUndefined();
  });

  it('returns undefined when required fields are missing', () => {
    expect(
      resolveIOSPushConfig({
        push: {
          ios: {
            enabled: true,
            appId: '',
            gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
          },
        },
      })
    ).toBeUndefined();
  });

  it('returns undefined when gatewayUrl is invalid', () => {
    expect(
      resolveIOSPushConfig({
        push: {
          ios: {
            enabled: true,
            appId: 'com.mindroom-ios',
            gatewayUrl: 'not-a-url',
          },
        },
      })
    ).toBeUndefined();
  });

  it('returns undefined when gatewayUrl is not https', () => {
    expect(
      resolveIOSPushConfig({
        push: {
          ios: {
            enabled: true,
            appId: 'com.mindroom-ios',
            gatewayUrl: 'http://push.example.com/_matrix/push/v1/notify',
          },
        },
      })
    ).toBeUndefined();
  });

  it('normalizes optional values and uses defaults', () => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      value: {
        dispatchEvent: () => true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
      },
      configurable: true,
    });

    const config = resolveIOSPushConfig({
      push: {
        ios: {
          enabled: true,
          appId: 'com.mindroom-ios',
          gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
          appDisplayName: '',
          deviceDisplayName: '',
          format: 'event_id_only',
          append: true,
          lang: 'en',
        },
      },
    });

    expect(config).toBeDefined();
    expect(config?.appId).toBe('com.mindroom-ios');
    expect(config?.gatewayUrl).toBe('https://push.example.com/_matrix/push/v1/notify');
    expect(config?.appDisplayName).toBe('MindRoom Chat iOS');
    expect(config?.deviceDisplayName).toBe('MindRoom Chat iOS');
    expect(config?.format).toBe('event_id_only');
    expect(config?.append).toBe(true);
    expect(config?.profileTag).toEqual(expect.any(String));
    expect(config?.profileTag?.length).toBeGreaterThan(0);
  });

  it('uses event-id-only as the privacy-preserving fallback when format is omitted', () => {
    const config = resolveIOSPushConfig({
      push: {
        ios: {
          enabled: true,
          appId: 'com.mindroom-ios',
          gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
        },
      },
    });

    expect(config?.format).toBe('event_id_only');
  });

  it('uses the app language unless deployment config explicitly overrides it', () => {
    const baseConfig = {
      push: {
        ios: {
          enabled: true,
          appId: 'com.mindroom-ios',
          gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
        },
      },
    };

    expect(resolveIOSPushConfig(baseConfig, undefined, 'de')?.lang).toBe('de');
    expect(
      resolveIOSPushConfig(
        {
          push: { ios: { ...baseConfig.push.ios, lang: 'en-GB' } },
        },
        undefined,
        'de'
      )?.lang
    ).toBe('en-GB');
  });

  it('keeps push tokens and enabled state separate per session', async () => {
    const storage = new Map<string, string>();
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: () => true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });

    const mx = {
      setPusher: async () => undefined,
      getHomeserverUrl: () => 'https://matrix.example',
    };
    const pushConfig = {
      appId: 'com.mindroom-ios',
      gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
      appDisplayName: 'MindRoom Chat iOS',
      deviceDisplayName: 'iPhone',
      profileTag: 'profile-1',
      append: true,
      format: 'event_id_only' as const,
      lang: 'en',
    };

    await upsertIOSPushPusher(mx, pushConfig, 'token-a', 'session-a');
    await upsertIOSPushPusher(mx, pushConfig, 'token-b', 'session-b');
    setIOSPushEnabled(false, 'session-a');

    expect(getStoredIOSPushToken('session-a')).toBe('token-a');
    expect(getStoredIOSPushToken('session-b')).toBe('token-b');
    expect(getIOSPushEnabled('session-a')).toBe(false);
    expect(getIOSPushEnabled('session-b')).toBe(true);
  });

  it('migrates the legacy preference before a generic settings write drops it', async () => {
    const storage = new Map<string, string>([
      ['settings', JSON.stringify({ nativePushNotifications: false })],
    ]);
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: () => true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });

    migrateLegacyIOSPushEnabled();
    const { getSettings, setSettings } = await import('../../state/settings');
    setSettings({ ...getSettings(), pageZoom: 90 });

    expect(JSON.parse(storage.get('settings') ?? '{}')).not.toHaveProperty(
      'nativePushNotifications'
    );
    expect(storage.get('mindroom_ios_push_enabled')).toBe('0');
    expect(getIOSPushEnabled('session-a')).toBe(false);
    expect(getIOSPushEnabled('session-b')).toBe(false);

    setIOSPushEnabled(true, 'session-a');

    expect(getIOSPushEnabled('session-a')).toBe(true);
    expect(getIOSPushEnabled('session-b')).toBe(false);
  });

  it('does not overwrite an existing migrated global push preference', () => {
    const storage = new Map<string, string>([
      ['settings', JSON.stringify({ nativePushNotifications: false })],
      ['mindroom_ios_push_enabled', '1'],
    ]);
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: () => true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });

    migrateLegacyIOSPushEnabled();

    expect(storage.get('mindroom_ios_push_enabled')).toBe('1');
    expect(getIOSPushEnabled('session-a')).toBe(true);
  });

  it('attempts every push-state removal when one key is blocked', () => {
    const storage = new Map<string, string>([
      ['mindroom_ios_push_token::session-a', 'token'],
      ['mindroom_ios_push_profile_tag::session-a', 'profile'],
      ['mindroom_ios_push_enabled::session-a', '1'],
    ]);
    const removeItem = vi.fn((key: string) => {
      if (key.includes('profile_tag')) throw new Error('blocked');
      storage.delete(key);
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: { removeItem },
        dispatchEvent: () => true,
      },
      configurable: true,
    });

    expect(() => clearIOSPushState('session-a')).not.toThrow();
    expect(removeItem).toHaveBeenCalledTimes(3);
    expect(storage.has('mindroom_ios_push_token::session-a')).toBe(false);
    expect(storage.has('mindroom_ios_push_enabled::session-a')).toBe(false);
    expect(storage.has('mindroom_ios_push_profile_tag::session-a')).toBe(true);
  });
});

describe('buildIOSPushPusherRequest', () => {
  it('builds a visible fallback for event-id-only pushes', () => {
    const request = buildIOSPushPusherRequest('token-123', {
      appId: 'com.mindroom-ios',
      gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
      appDisplayName: 'MindRoom Chat iOS',
      deviceDisplayName: 'iPhone',
      profileTag: 'profile-1',
      append: true,
      format: 'event_id_only',
      lang: 'en',
    });

    expect(request).toEqual({
      kind: 'http',
      app_id: 'com.mindroom-ios',
      pushkey: 'token-123',
      app_display_name: 'MindRoom Chat iOS',
      device_display_name: 'iPhone',
      profile_tag: 'profile-1',
      append: true,
      lang: 'en',
      data: {
        url: 'https://push.example.com/_matrix/push/v1/notify',
        format: 'event_id_only',
        default_payload: {
          aps: {
            alert: {
              title: 'MindRoom Chat iOS',
              body: 'New message',
            },
            sound: 'default',
          },
        },
      },
    });
  });

  it('leaves the full-format alert to Sygnal for sender and message previews', () => {
    const request = buildIOSPushPusherRequest('token-123', {
      appId: 'com.mindroom-ios',
      gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
      appDisplayName: 'MindRoom Chat iOS',
      deviceDisplayName: 'iPhone',
      profileTag: 'profile-1',
      append: true,
      format: 'full',
      lang: 'en',
    });

    expect(request.data).toEqual({
      url: 'https://push.example.com/_matrix/push/v1/notify',
      format: 'full',
      default_payload: {
        aps: {
          sound: 'default',
        },
      },
    });
  });
});

describe('upsertIOSPushPusher', () => {
  it('keeps the configured format for a server without Cloudflare Access', async () => {
    vi.mocked(hasCloudflareAccess).mockReturnValue(false);
    const mx = { setPusher: vi.fn(), getHomeserverUrl: () => 'https://public.example' };

    await upsertIOSPushPusher(
      mx,
      {
        appId: 'chat.example',
        gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
        appDisplayName: 'Chat',
        deviceDisplayName: 'iPhone',
        profileTag: 'profile-1',
        append: true,
        format: 'full',
        lang: 'en',
      },
      'apns-token'
    );

    expect(mx.setPusher).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ format: 'full' }) })
    );
  });

  it('registers content-free pushes for a server behind Cloudflare Access', async () => {
    vi.mocked(hasCloudflareAccess).mockImplementation((url) => url === 'https://private.example');
    const mx = { setPusher: vi.fn(), getHomeserverUrl: () => 'https://private.example' };

    await upsertIOSPushPusher(
      mx,
      {
        appId: 'chat.example',
        gatewayUrl: 'https://push.example.com/_matrix/push/v1/notify',
        appDisplayName: 'Chat',
        deviceDisplayName: 'iPhone',
        profileTag: 'profile-1',
        append: true,
        format: 'full',
        lang: 'en',
      },
      'apns-token'
    );

    expect(mx.setPusher).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          format: 'event_id_only',
          default_payload: {
            aps: { sound: 'default', alert: { title: 'Chat', body: 'New message' } },
          },
        }),
      })
    );
    expect(hasCloudflareAccess).toHaveBeenCalledWith('https://private.example');
  });
});
