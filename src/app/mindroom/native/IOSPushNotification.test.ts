import React from 'react';
import { act, create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import en from '../../locales/en.json';

const nativeState = vi.hoisted(() => ({
  native: false,
  failed: false,
  pushAllowed: true,
  toggle: vi.fn<(enabled: boolean) => Promise<void>>(),
}));

vi.mock('../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('section', null, children),
}));

vi.mock('../../components/setting-tile', () => ({
  SettingTile: ({ description, after }: { description: React.ReactNode; after: React.ReactNode }) =>
    React.createElement('div', { 'data-renderer': 'setting-tile' }, description, after),
}));

vi.mock('../../features/settings/styles.css', () => ({
  SequenceCardStyle: 'sequence-card',
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getHomeserverUrl: () => 'https://hs.example' }),
}));

vi.mock('./cloudflareAccess', () => ({
  cloudflareAccessAllowsPush: () => nativeState.pushAllowed,
}));

vi.mock('../../hooks/useClientConfig', () => ({
  useClientConfig: () => ({}),
}));

vi.mock('../../hooks/useSessionStore', () => ({
  useActiveSession: () => ({ sessionId: 'session-a' }),
}));

vi.mock('../../hooks/useAsyncCallback', () => ({
  AsyncStatus: {
    Error: 'error',
    Loading: 'loading',
  },
  useAsyncCallback: () => [
    {
      status: nativeState.failed ? 'error' : 'idle',
      error: new Error('Internal native registration error'),
    },
    nativeState.toggle,
  ],
}));

vi.mock('./useIOSPushEnabled', () => ({
  useIOSPushEnabled: () => false,
}));

vi.mock('./iosPush', () => ({
  checkIOSPushPermission: vi.fn().mockResolvedValue('prompt'),
  disableIOSPushPusher: vi.fn().mockResolvedValue(undefined),
  isNativeIOSPlatform: () => nativeState.native,
  requestIOSPushPermission: vi.fn().mockResolvedValue('prompt'),
  resolveIOSPushConfig: vi.fn(() => (nativeState.native ? {} : undefined)),
  setIOSPushEnabled: vi.fn(),
  unregisterIOSPush: vi.fn().mockResolvedValue(undefined),
}));

describe('IOSPushNotification', () => {
  it('does not render outside native iOS', async () => {
    const { IOSPushNotification } = await import('./IOSPushNotification');

    const renderer = create(React.createElement(IOSPushNotification));

    expect(renderer.toJSON()).toBeNull();

    renderer.unmount();
  });

  it('does not render for a server that turns push off', async () => {
    const { IOSPushNotification } = await import('./IOSPushNotification');
    nativeState.native = true;
    nativeState.pushAllowed = false;
    let renderer: ReturnType<typeof create> | undefined;
    try {
      renderer = create(React.createElement(IOSPushNotification));

      expect(renderer.toJSON()).toBeNull();
    } finally {
      act(() => renderer?.unmount());
      nativeState.native = false;
      nativeState.pushAllowed = true;
    }
  });
});

it.each([new Error('Native permission registration failed'), 'Matrix pusher request failed'])(
  'retains the toggle failure for diagnostics without retrying: %s',
  async (failure) => {
    const { IOSPushNotification } = await import('./IOSPushNotification');
    const { checkIOSPushPermission } = await import('./iosPush');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    nativeState.native = true;
    nativeState.failed = false;
    nativeState.toggle.mockReset().mockRejectedValueOnce(failure);
    vi.mocked(checkIOSPushPermission).mockClear();
    let renderer!: ReturnType<typeof create>;
    try {
      await act(async () => {
        renderer = create(React.createElement(IOSPushNotification));
      });
      await act(async () => {
        renderer.root.findByType('button').props.onClick();
      });

      expect(nativeState.toggle).toHaveBeenCalledTimes(1);
      expect(nativeState.toggle).toHaveBeenCalledWith(true);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(
        '[IOSPushNotification] Failed to update native push settings:',
        failure
      );
      expect(checkIOSPushPermission).toHaveBeenCalledTimes(2);
    } finally {
      act(() => renderer?.unmount());
      errorLog.mockRestore();
      nativeState.native = false;
    }
  }
);

it('renders a localized native failure and refreshes it after a language change', async () => {
  const { IOSPushNotification } = await import('./IOSPushNotification');
  const language = createInstance();
  await language.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
      de: {
        translation: {
          mindroomUi: {
            native: {
              iOSPushNotification: {
                failedToUpdateNativePushSettings:
                  'Push-Einstellungen konnten nicht aktualisiert werden.',
              },
            },
          },
        },
      },
    },
  });
  nativeState.native = true;
  nativeState.failed = true;
  let renderer: ReturnType<typeof create>;
  try {
    await act(async () => {
      renderer = create(
        React.createElement(
          I18nextProvider,
          { i18n: language },
          React.createElement(IOSPushNotification)
        )
      );
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain('Failed to update native push settings.');
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('Internal native');
    await act(async () => {
      await language.changeLanguage('de');
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      'Push-Einstellungen konnten nicht aktualisiert werden.'
    );
    act(() => renderer!.unmount());
  } finally {
    nativeState.native = false;
    nativeState.failed = false;
  }
});
