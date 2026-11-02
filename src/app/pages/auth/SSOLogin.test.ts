import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SSOAction } from 'matrix-js-sdk';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { createMatrixClient, createMatrixFetchFn } from '../../mindroom/matrix/matrixClientFactory';
import { hasCloudflareAccess } from '../../mindroom/native/cloudflareAccess';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import { SSOLogin } from './SSOLogin';

const authenticate = vi.fn();
const signInWithApple = vi.fn();

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Avatar: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) =>
      reactModule.createElement('div', props, children),
    AvatarImage: () => reactModule.createElement('img'),
    Box: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) =>
      reactModule.createElement('div', props, children),
    Button: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) =>
      reactModule.createElement('button', props, children),
    Text: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) =>
      reactModule.createElement('span', props, children),
  };
});

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

vi.mock('../../mindroom/matrix/matrixClientFactory', () => ({
  createMatrixClient: vi.fn(),
  createMatrixFetchFn: vi.fn(),
}));

const accessState = vi.hoisted(() => ({ behindAccess: false }));
vi.mock('../../mindroom/native/cloudflareAccess', () => ({
  hasCloudflareAccess: vi.fn(() => accessState.behindAccess),
}));

vi.mock('../../hooks/useAutoDiscoveryInfo', () => ({
  useAutoDiscoveryInfo: vi.fn(),
}));

const findButtonByText = (renderer: ReturnType<typeof create>, text: string) =>
  renderer.root
    .findAllByType('button')
    .find((node) =>
      node.findAllByType('span').some((textNode) => textNode.children.join('') === text)
    );

describe('SSOLogin', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.clearAllMocks();
    authenticate.mockReset();
    signInWithApple.mockReset();
    Object.defineProperty(globalThis, 'window', {
      value: {
        setTimeout: vi.fn(),
      },
      configurable: true,
    });
    vi.mocked(useAutoDiscoveryInfo).mockReturnValue({
      'm.homeserver': {
        base_url: 'https://mindroom.chat',
      },
    });
    vi.mocked(createMatrixClient).mockReturnValue({
      getSsoLoginUrl: vi.fn(() => 'https://mindroom.chat/_matrix/client/v3/login/sso/redirect'),
    } as never);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
      return;
    }

    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
    });
  });

  it('opens SSO inside the in-app browser on native iOS', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Browser.open).mockResolvedValue();

    const renderer = create(
      React.createElement(SSOLogin, {
        redirectUrl: 'mindroom://auth/login/mindroom.chat',
        action: SSOAction.LOGIN,
      })
    );

    const continueButton = findButtonByText(renderer, 'Continue with SSO');
    const preventDefault = vi.fn();

    await act(async () => {
      await continueButton?.props.onClick({ preventDefault });
    });

    expect(continueButton?.props.href).toBeUndefined();
    expect(continueButton?.props.as).toBeUndefined();
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Browser.open)).toHaveBeenCalledWith({
      url: 'https://mindroom.chat/_matrix/client/v3/login/sso/redirect',
      presentationStyle: 'fullscreen',
    });
  });

  it.each([
    [false, 'shares Safari cookies'],
    [true, 'starts without Safari cookies behind Cloudflare Access'],
  ])('runs the iOS SSO session (behind Access: %s) so that it %s', async (behindAccess) => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    authenticate.mockResolvedValue({});
    accessState.behindAccess = behindAccess;

    try {
      const renderer = create(
        React.createElement(SSOLogin, {
          redirectUrl: 'mindroom://auth/login/mindroom.chat',
          action: SSOAction.LOGIN,
        })
      );
      await act(async () => {
        await findButtonByText(renderer, 'Continue with SSO')?.props.onClick({
          preventDefault: vi.fn(),
        });
      });

      expect(hasCloudflareAccess).toHaveBeenCalledWith('https://mindroom.chat');
      expect(authenticate).toHaveBeenCalledWith({
        callbackScheme: 'mindroom',
        ephemeral: behindAccess,
        url: 'https://mindroom.chat/_matrix/client/v3/login/sso/redirect',
      });
    } finally {
      accessState.behindAccess = false;
    }
  });

  it('opens SSO inside the in-app browser on native Android', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
    vi.mocked(Browser.open).mockResolvedValue();

    const renderer = create(
      React.createElement(SSOLogin, {
        redirectUrl: 'mindroom://auth/login/mindroom.chat',
        action: SSOAction.LOGIN,
      })
    );

    const continueButton = findButtonByText(renderer, 'Continue with SSO');
    const preventDefault = vi.fn();

    await act(async () => {
      await continueButton?.props.onClick({ preventDefault });
    });

    expect(continueButton?.props.href).toBeUndefined();
    expect(continueButton?.props.as).toBeUndefined();
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Browser.open)).toHaveBeenCalledWith({
      url: 'https://mindroom.chat/_matrix/client/v3/login/sso/redirect',
      presentationStyle: 'fullscreen',
    });
  });

  it('does not fall back to link navigation when native in-app browser open fails', async () => {
    const error = new Error('native browser unavailable');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Browser.open).mockRejectedValue(error);

    const renderer = create(
      React.createElement(SSOLogin, {
        redirectUrl: 'mindroom://auth/login/mindroom.chat',
        action: SSOAction.LOGIN,
      })
    );

    const continueButton = findButtonByText(renderer, 'Continue with SSO');
    const preventDefault = vi.fn();

    await act(async () => {
      await continueButton?.props.onClick({ preventDefault });
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith('[SSO] Failed to open native browser', error);
    consoleErrorSpy.mockRestore();
  });

  it('keeps default anchor navigation on non-native platforms', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');

    const renderer = create(
      React.createElement(SSOLogin, {
        redirectUrl: 'https://mindroom.chat/login/mindroom.chat',
        action: SSOAction.LOGIN,
      })
    );

    const continueButton = findButtonByText(renderer, 'Continue with SSO');
    const preventDefault = vi.fn();

    await act(async () => {
      await continueButton?.props.onClick({ preventDefault });
    });

    expect(continueButton?.props.href).toBe(
      'https://mindroom.chat/_matrix/client/v3/login/sso/redirect'
    );
    expect(continueButton?.props.as).toBe('a');
    expect(preventDefault).not.toHaveBeenCalled();
    expect(vi.mocked(Browser.open)).not.toHaveBeenCalled();
  });

  it('uses native Sign in with Apple for Apple providers on native iOS', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    signInWithApple.mockResolvedValue({
      authorizationCode: 'apple-code',
      identityToken: 'apple-id-token',
      nonce: 'native-nonce',
    });
    // The exchange goes through the Matrix fetch, which adds a Cloudflare Access token.
    const matrixFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ loginToken: 'matrix-login-token' }),
    });
    vi.mocked(createMatrixFetchFn).mockReturnValue(matrixFetch);
    const replaceState = vi.fn();
    const dispatchEvent = vi.fn();
    Object.defineProperty(globalThis, 'window', {
      value: {
        dispatchEvent,
        history: { replaceState },
        location: { replace: vi.fn() },
        setTimeout: vi.fn(),
      },
      configurable: true,
    });

    const renderer = create(
      React.createElement(SSOLogin, {
        action: SSOAction.LOGIN,
        providers: [
          {
            brand: 'apple',
            id: 'chat.mindroom.matrix.apple',
            name: 'Apple',
          },
        ],
        redirectUrl: 'mindroom://auth/login/mindroom.chat',
      })
    );

    const appleButton = findButtonByText(renderer, 'Sign in with Apple');
    const preventDefault = vi.fn();

    await act(async () => {
      await appleButton?.props.onClick({ preventDefault });
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(signInWithApple).toHaveBeenCalledWith({
      url: 'https://mindroom.chat/_matrix/client/v3/login/sso/redirect',
      callbackScheme: 'mindroom',
      ephemeral: false,
    });
    expect(matrixFetch).toHaveBeenCalledWith(
      'https://mindroom.chat/_matrix/client/unstable/org.mindroom.login/apple',
      expect.objectContaining({ method: 'POST' })
    );
    expect(vi.mocked(Browser.open)).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/login/mindroom.chat?loginToken=matrix-login-token'
    );
  });
  it.each([false, true])(
    'routes an Apple browser callback when native Apple is unavailable (Access: %s)',
    async (behindAccess) => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
      vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
      signInWithApple.mockResolvedValue({
        url: 'mindroom://auth/login/mindroom.chat?loginToken=browser-token',
      });
      const matrixFetch = vi.fn();
      vi.mocked(createMatrixFetchFn).mockReturnValue(matrixFetch);
      const replaceState = vi.fn();
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { history: { replaceState }, dispatchEvent: vi.fn(), setTimeout: vi.fn() },
      });
      accessState.behindAccess = behindAccess;
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const renderer = create(
          React.createElement(SSOLogin, {
            providers: [{ id: 'chat.mindroom.matrix.apple', name: 'Apple', brand: 'apple' }],
            redirectUrl: 'mindroom://auth/login/mindroom.chat',
          })
        );
        await act(async () => {
          await findButtonByText(renderer, 'Sign in with Apple')?.props.onClick({
            preventDefault: vi.fn(),
          });
        });
        expect(replaceState).toHaveBeenCalledWith(
          null,
          '',
          '/login/mindroom.chat?loginToken=browser-token'
        );
        expect(signInWithApple).toHaveBeenCalledWith({
          url: 'https://mindroom.chat/_matrix/client/v3/login/sso/redirect',
          callbackScheme: 'mindroom',
          ephemeral: behindAccess,
        });
        expect(matrixFetch).not.toHaveBeenCalled();
      } finally {
        accessState.behindAccess = false;
        consoleError.mockRestore();
      }
    }
  );
});
