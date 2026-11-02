import { Capacitor } from '@capacitor/core';
import { describe, expect, it, vi } from 'vitest';

import { MINDROOM_AUTH_BRANDING, getMindroomAuthSsoRedirectUrl } from './authUi';

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: vi.fn(),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
    getPlatform: vi.fn(),
  },
}));

describe('authUi', () => {
  it('exposes MindRoom Chat auth branding in one UI contract', () => {
    expect(MINDROOM_AUTH_BRANDING.appName).toBe('MindRoom Chat');
    expect(MINDROOM_AUTH_BRANDING.deviceDisplayName).toBe('MindRoom Chat Web');
    expect(MINDROOM_AUTH_BRANDING.logoAlt).toBe('MindRoom Chat Logo');
  });

  it('uses web SSO redirects outside native apps', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');

    expect(getMindroomAuthSsoRedirectUrl('https://chat.example/login?addAccount=1')).toBe(
      'https://chat.example/login?addAccount=1'
    );
  });

  it('uses the native redirect scheme inside native Android', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');

    expect(getMindroomAuthSsoRedirectUrl('https://chat.example/login?addAccount=1')).toBe(
      'mindroom://auth/login?addAccount=1'
    );
  });

  it('uses the native iOS redirect scheme inside native iOS', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');

    expect(getMindroomAuthSsoRedirectUrl('https://chat.example/login?addAccount=1')).toBe(
      'mindroom://auth/login?addAccount=1'
    );
  });
});
