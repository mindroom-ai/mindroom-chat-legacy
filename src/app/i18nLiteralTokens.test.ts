import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_LANGUAGE_CODES } from './i18nLanguages';

type LocaleTree = { [key: string]: string | LocaleTree };

const localeDirectory = fileURLToPath(new URL('./locales/', import.meta.url));
const readLocale = (code: string): LocaleTree =>
  JSON.parse(readFileSync(`${localeDirectory}${code}.json`, 'utf8'));

const getMessage = (locale: LocaleTree, path: string): string | undefined => {
  const value = path.split('.').reduce<string | LocaleTree | undefined>((node, key) => {
    if (typeof node !== 'object') return undefined;
    return node[key];
  }, locale);
  return typeof value === 'string' ? value : undefined;
};

const LITERAL_TOKENS: Readonly<Record<string, readonly string[]>> = {
  'settings.general.appearance.twitterEmoji': ['Twitter'],
  'sharedUi.backupRestore.nil': ['NIL'],
  'sharedUi.callEmbedProvider.yourBrowserDoesNotSupportWebrtcWhichIsRequiredForCalling': ['WebRTC'],
  'sharedUi.sSOStage.ssoLogin': ['SSO'],
  'sharedUi.sSOStage.toPerformThisActionYouNeedToAuthenticateYourselfBySsoLogin': ['SSO'],
  'sharedUi.sSOStage.continueWithSso': ['SSO'],
  'sharedUi.sSOLogin.continueWithSso': ['SSO'],
  'sharedUi.login.thisClientRequiresSignInWithAppleConfigureTheHomeserverSsoProvider': [
    'Apple',
    'SSO',
  ],
  'sharedUi.login.passwordLoginIsDisabledOnValue1UseSsoToSignIn': ['SSO'],
  'sharedUi.login.thisClientDoesNotSupportLoginOnValue1ServerPasswordAndSso': ['SSO'],
  'sharedUi.register.thisClientRequiresSignInWithAppleConfigureTheHomeserverSsoProvider': [
    'Apple',
    'SSO',
  ],
  'sharedUi.register.thisHomeserverOnlyAllowsSignUpWithAppleGoogleOrGithub': [
    'Apple',
    'Google',
    'GitHub',
  ],
  'sharedUi.register.ssoRegistrationIsRequiredOnThisHomeserverButNoSsoProvidersWere': ['SSO'],
  'sharedUi.ssoProviders.signUpApple': ['Apple'],
  'sharedUi.ssoProviders.signInApple': ['Apple'],
  'sharedUi.ssoProviders.continueGoogle': ['Google'],
  'sharedUi.ssoProviders.continueGithub': ['GitHub'],
  'sharedUi.commands.CommandShrug': ['¯\\_(ツ)_/¯'],
  'sharedUi.commands.CommandMyRoomAvatar': ['/myroomavatar', 'mxc://xyzabc'],
  'sharedUi.commands.CommandDelete': ['/delete', 'm.room.message'],
  'featureUi.call.callView.yourBrowserDoesNotSupportWebrtcWhich': ['WebRTC'],
  'mindroomUi.calls.agentCallButton.browserUnsupported': ['WebRTC'],
  'mindroomUi.autoApprove.ownUntil': ['!auto_approve off'],
  'featureUi.roomSettings.permissions.pingRoom': ['@room'],
  'featureUi.settings.devices.otherDevices.manageYourDevicesOnOidcDashboard': ['OIDC'],
  'featureUi.settings.notifications.specialMessages.mentionRoom': ['@room'],
  'featureUi.settings.notifications.specialMessages.containsRoom': ['@room'],
  'featureUi.settings.about.emojiArtCredit': ['Twemoji', 'Twitter, Inc', 'CC-BY 4.0'],
  'featureUi.settings.about.emojiFontCredit': ['twemoji-colr', 'Mozilla Foundation', 'Apache 2.0'],
  'featureUi.settings.about.matrixSdkCredit': [
    'matrix-js-sdk',
    'Matrix.org Foundation C.I.C',
    'Apache 2.0',
  ],
  'featureUi.settings.about.soundResourcesCredit': ['Google', 'CC-BY 4.0'],
};

describe('literal translation tokens', () => {
  APP_LANGUAGE_CODES.forEach((code) => {
    it(`${code}.json preserves protocol, product, and code tokens`, () => {
      const locale = readLocale(code);
      Object.entries(LITERAL_TOKENS).forEach(([path, tokens]) => {
        const message = getMessage(locale, path);
        expect(message, `${code}: ${path}`).toBeDefined();
        tokens.forEach((token) => expect(message, `${code}: ${path} -> ${token}`).toContain(token));
      });
    });
  });

  it('isolates every Arabic interpolation value from surrounding RTL text', () => {
    const arabic = readLocale('ar');
    const visit = (node: LocaleTree, path = '') => {
      Object.entries(node).forEach(([key, value]) => {
        const nextPath = path ? `${path}.${key}` : key;
        if (typeof value === 'object') {
          visit(value, nextPath);
          return;
        }
        for (const match of value.matchAll(/\{\{[^}]+\}\}/g)) {
          expect(value[match.index - 1], nextPath).toBe('\u2068');
          expect(value[match.index + match[0].length], nextPath).toBe('\u2069');
        }
      });
    };
    visit(arabic);
  });
});
