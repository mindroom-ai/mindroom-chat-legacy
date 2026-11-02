import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Browser } from '@capacitor/browser';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { readFileSync } from 'fs';
import {
  buildNativeSsoRedirectUrl,
  getAppPathFromNativeSsoUrl,
  isIOSStandaloneWebApp,
  isNativeApp,
  isNativeIOS,
  openNativeSsoBrowser,
  registerNativeAppUrlCallbacks,
  routeNativeSsoCallback,
  signInWithNativeApple,
} from './nativeSso';

const authenticate = vi.fn();
const signInWithApple = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isPluginAvailable: vi.fn(),
    isNativePlatform: vi.fn(),
    getPlatform: vi.fn(),
  },
  registerPlugin: vi.fn(() => ({
    authenticate,
    signInWithApple,
  })),
}));

vi.mock('@capacitor/browser', () => ({
  Browser: {
    close: vi.fn(),
    open: vi.fn(),
  },
}));

describe('nativeSso', () => {
  const originalWindow = globalThis.window;

  const setWindow = (navigatorOverrides: Record<string, unknown>, standalone = false) => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        matchMedia: vi.fn(() => ({ matches: standalone })),
        navigator: {
          maxTouchPoints: 0,
          platform: 'MacIntel',
          standalone: false,
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4)',
          ...navigatorOverrides,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authenticate.mockReset();
    signInWithApple.mockReset();
    vi.mocked(Capacitor.isPluginAvailable).mockReset();
    vi.mocked(Capacitor.isNativePlatform).mockReset();
    vi.mocked(Capacitor.getPlatform).mockReset();
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it('builds native redirect url from web redirect url', () => {
    expect(buildNativeSsoRedirectUrl('https://mindroom.chat/login/mindroom.chat')).toBe(
      'mindroom://auth/login/mindroom.chat'
    );
  });

  it('extracts app path from native callback url', () => {
    expect(
      getAppPathFromNativeSsoUrl('mindroom://auth/login/mindroom.chat?loginToken=abc123')
    ).toBe('/login/mindroom.chat?loginToken=abc123');
  });

  it('extracts app path from hostless native callback url', () => {
    expect(getAppPathFromNativeSsoUrl('mindroom:/auth/login/mindroom.chat?loginToken=abc123')).toBe(
      '/login/mindroom.chat?loginToken=abc123'
    );
  });

  it('extracts app path from triple-slash hostless native callback url', () => {
    expect(
      getAppPathFromNativeSsoUrl('mindroom:///auth/login/mindroom.chat?loginToken=abc123')
    ).toBe('/login/mindroom.chat?loginToken=abc123');
  });

  it('extracts app path from compact hostless native callback url', () => {
    expect(getAppPathFromNativeSsoUrl('mindroom:auth/login/mindroom.chat?loginToken=abc123')).toBe(
      '/login/mindroom.chat?loginToken=abc123'
    );
  });

  it('normalizes extra slashes in native callback path', () => {
    expect(
      getAppPathFromNativeSsoUrl('mindroom://auth//login//mindroom.chat?loginToken=abc123')
    ).toBe('/login/mindroom.chat?loginToken=abc123');
  });

  it('ignores non-native callback urls', () => {
    expect(getAppPathFromNativeSsoUrl('https://mindroom.chat/login/mindroom.chat')).toBeUndefined();
  });

  it('ignores native callback urls with unsupported host', () => {
    expect(getAppPathFromNativeSsoUrl('mindroom://wrong/login/mindroom.chat')).toBeUndefined();
  });

  it('detects native iOS platform', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');

    expect(isNativeIOS()).toBe(true);
  });

  it('detects native Android platform as a native app', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');

    expect(isNativeApp()).toBe(true);
  });

  it('ignores unsupported native platforms', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('electron');

    expect(isNativeApp()).toBe(false);
  });

  it('detects iOS standalone web apps from display mode and navigator.standalone', () => {
    setWindow(
      {
        maxTouchPoints: 5,
        platform: 'iPhone',
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      },
      true
    );
    expect(isIOSStandaloneWebApp()).toBe(true);

    setWindow({
      maxTouchPoints: 5,
      platform: 'iPhone',
      standalone: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    });
    expect(isIOSStandaloneWebApp()).toBe(true);
  });

  it('ignores desktop standalone mode and native iOS wrappers', () => {
    setWindow({}, true);
    expect(isIOSStandaloneWebApp()).toBe(false);

    setWindow({
      maxTouchPoints: 5,
      platform: 'iPhone',
      standalone: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    });
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    expect(isIOSStandaloneWebApp()).toBe(false);
  });

  it('opens the native SSO browser in fullscreen mode', async () => {
    vi.mocked(Browser.open).mockResolvedValue();

    await openNativeSsoBrowser('https://mindroom.chat/_matrix/client/v3/login/sso/redirect');

    expect(vi.mocked(Browser.open)).toHaveBeenCalledWith({
      url: 'https://mindroom.chat/_matrix/client/v3/login/sso/redirect',
      presentationStyle: 'fullscreen',
    });
  });

  it('uses the native iOS web authentication session when available', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    authenticate.mockResolvedValue({
      url: 'mindroom://auth/login/mindroom.chat?loginToken=abc123',
    });
    const replaceState = vi.fn();
    const dispatchEvent = vi.fn();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent,
        history: { replaceState },
        location: { replace: vi.fn() },
      },
    });

    await openNativeSsoBrowser('https://mindroom.chat/_matrix/client/v3/login/sso/redirect');

    expect(registerPlugin).toHaveBeenCalledWith('MindRoomAuth');
    expect(authenticate).toHaveBeenCalledWith({
      callbackScheme: 'mindroom',
      ephemeral: false,
      url: 'https://mindroom.chat/_matrix/client/v3/login/sso/redirect',
    });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/login/mindroom.chat?loginToken=abc123');
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'popstate' }));
    expect(Browser.open).not.toHaveBeenCalled();
  });

  it('falls back to the Capacitor browser when the native auth plugin is unavailable', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
    vi.mocked(Browser.open).mockResolvedValue();

    await openNativeSsoBrowser('https://mindroom.chat/_matrix/client/v3/login/sso/redirect');

    expect(authenticate).not.toHaveBeenCalled();
    expect(Browser.open).toHaveBeenCalledWith({
      url: 'https://mindroom.chat/_matrix/client/v3/login/sso/redirect',
      presentationStyle: 'fullscreen',
    });
  });

  it('routes native SSO callbacks through the SPA router', () => {
    const replaceState = vi.fn();
    const dispatchEvent = vi.fn();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent,
        history: { replaceState },
        location: { replace: vi.fn() },
      },
    });

    expect(routeNativeSsoCallback('mindroom://auth/login/mindroom.chat?loginToken=abc123')).toBe(
      true
    );

    expect(Browser.close).toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/login/mindroom.chat?loginToken=abc123');
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'popstate' }));
  });

  it('registers native SSO callbacks through the native app plugin', async () => {
    const replaceState = vi.fn();
    const dispatchEvent = vi.fn();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent,
        history: { replaceState },
        location: { replace: vi.fn() },
      },
    });
    let appUrlOpenListener: ((event: { url?: string }) => void) | undefined;
    const nativeAppPlugin = {
      getLaunchUrl: vi.fn().mockResolvedValue({
        url: 'mindroom://auth/login/mindroom.chat?loginToken=launch-token',
      }),
      addListener: vi.fn((eventName: string, listener: (event: { url?: string }) => void) => {
        appUrlOpenListener = listener;
        return Promise.resolve();
      }),
    };

    registerNativeAppUrlCallbacks(nativeAppPlugin);
    await nativeAppPlugin.getLaunchUrl.mock.results[0]?.value;

    expect(nativeAppPlugin.addListener).toHaveBeenCalledWith('appUrlOpen', expect.any(Function));
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/login/mindroom.chat?loginToken=launch-token'
    );

    appUrlOpenListener?.({
      url: 'mindroom://auth/login/mindroom.chat?loginToken=open-token',
    });

    expect(replaceState).toHaveBeenLastCalledWith(
      null,
      '',
      '/login/mindroom.chat?loginToken=open-token'
    );
  });

  it('does not route the launch URL again after the page reloads', async () => {
    const getEntriesByType = vi
      .spyOn(performance, 'getEntriesByType')
      .mockReturnValue([{ type: 'reload' } as PerformanceNavigationTiming]);
    const replaceState = vi.fn();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: vi.fn(),
        history: { replaceState },
        location: { replace: vi.fn() },
      },
    });
    let appUrlOpenListener: ((event: { url?: string }) => void) | undefined;
    // Capacitor keeps returning the last opened URL after a reload.
    const nativeAppPlugin = {
      getLaunchUrl: vi.fn().mockResolvedValue({
        url: 'https://chat.mindroom.chat/connect?code=ABCD',
      }),
      addListener: vi.fn((eventName: string, listener: (event: { url?: string }) => void) => {
        appUrlOpenListener = listener;
        return Promise.resolve();
      }),
    };

    try {
      registerNativeAppUrlCallbacks(nativeAppPlugin);
      await nativeAppPlugin.getLaunchUrl.mock.results[0]?.value;
      await Promise.resolve();
      expect(getEntriesByType).toHaveBeenCalledWith('navigation');
      expect(replaceState).not.toHaveBeenCalled();

      // A URL opened after the reload is still routed.
      appUrlOpenListener?.({ url: 'mindroom://auth/login/mindroom.chat?loginToken=open-token' });
      expect(replaceState).toHaveBeenLastCalledWith(
        null,
        '',
        '/login/mindroom.chat?loginToken=open-token'
      );
    } finally {
      getEntriesByType.mockRestore();
    }
  });

  it('exchanges native Apple credentials for a Matrix login token and routes it', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    signInWithApple.mockResolvedValue({
      authorizationCode: 'apple-code',
      identityToken: 'apple-id-token',
      nonce: 'native-nonce',
      user: 'apple-user',
    });
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ loginToken: 'matrix-login-token' }),
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetch,
    });
    const replaceState = vi.fn();
    const dispatchEvent = vi.fn();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent,
        history: { replaceState },
        location: { replace: vi.fn() },
      },
    });

    await signInWithNativeApple({
      ssoUrl: 'https://mindroom.chat/_matrix/client/v3/login/sso/redirect',
      baseUrl: 'https://mindroom.chat/',
      providerId: 'chat.mindroom.matrix.apple',
      redirectUrl: 'mindroom://auth/login/mindroom.chat',
    });

    expect(signInWithApple).toHaveBeenCalledWith({
      url: 'https://mindroom.chat/_matrix/client/v3/login/sso/redirect',
      callbackScheme: 'mindroom',
      ephemeral: false,
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://mindroom.chat/_matrix/client/unstable/org.mindroom.login/apple',
      {
        body: JSON.stringify({
          authorizationCode: 'apple-code',
          identityToken: 'apple-id-token',
          nonce: 'native-nonce',
          providerId: 'chat.mindroom.matrix.apple',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }
    );
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/login/mindroom.chat?loginToken=matrix-login-token'
    );
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'popstate' }));
  });

  it('rejects native Apple sign-in when the Matrix exchange does not return a login token', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    signInWithApple.mockResolvedValue({
      identityToken: 'apple-id-token',
      nonce: 'native-nonce',
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      }),
    });

    await expect(
      signInWithNativeApple({
        ssoUrl: 'https://mindroom.chat/_matrix/client/v3/login/sso/redirect',
        baseUrl: 'https://mindroom.chat',
        providerId: 'chat.mindroom.matrix.apple',
        redirectUrl: 'mindroom://auth/login/mindroom.chat',
      })
    ).rejects.toThrow('login token');
  });

  it('registers the Android native SSO callback intent filter', () => {
    const manifestSource = readFileSync(
      new URL('../../../../android/app/src/main/AndroidManifest.xml', import.meta.url),
      'utf8'
    );

    expect(manifestSource).toContain('<action android:name="android.intent.action.VIEW" />');
    expect(manifestSource).toContain('<category android:name="android.intent.category.DEFAULT" />');
    expect(manifestSource).toContain(
      '<category android:name="android.intent.category.BROWSABLE" />'
    );
    expect(manifestSource).toContain('android:scheme="mindroom"');
    expect(manifestSource).toContain('android:host="auth"');
    expect(manifestSource).toContain('android:pathPrefix="/login"');
  });
});
