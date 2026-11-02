import {
  MINDROOM_APP_NAME,
  MINDROOM_CHAT_SOURCE_URL,
  MINDROOM_DEVICE_DISPLAY_NAME,
  MINDROOM_LOGO_ALT,
  MINDROOM_LOGO_SRC,
} from '../branding/branding';
import {
  buildNativeSsoRedirectUrl,
  isNativeApp,
  isNativeIOS,
  openNativeSsoBrowser,
  signInWithNativeApple,
} from '../native/nativeSso';
import {
  isMindroomHomeserver,
  shouldDisablePasswordLogin,
  shouldRequireAppleProvider,
  shouldUseSsoOnlyRegistration,
} from './authPolicy';

export const MINDROOM_AUTH_BRANDING = {
  appName: MINDROOM_APP_NAME,
  deviceDisplayName: MINDROOM_DEVICE_DISPLAY_NAME,
  logoAlt: MINDROOM_LOGO_ALT,
  logoSrc: MINDROOM_LOGO_SRC,
  poweredBy: [
    { label: MINDROOM_APP_NAME, url: MINDROOM_CHAT_SOURCE_URL },
    { label: 'Matrix', url: 'https://matrix.org' },
    { label: 'Cinny', url: 'https://github.com/ajbura/cinny' },
  ],
} as const;

export const getMindroomAuthSsoRedirectUrl = (webRedirectUrl: string): string =>
  isNativeApp() ? buildNativeSsoRedirectUrl(webRedirectUrl) : webRedirectUrl;

export {
  isNativeApp,
  isMindroomHomeserver,
  isNativeIOS,
  openNativeSsoBrowser,
  signInWithNativeApple,
  shouldDisablePasswordLogin,
  shouldRequireAppleProvider,
  shouldUseSsoOnlyRegistration,
};
