import { useTranslation } from 'react-i18next';
import { Avatar, AvatarImage, Box, Button, Text } from 'folds';
import { IIdentityProvider, SSOAction } from 'matrix-js-sdk';
import React, { useMemo, useRef } from 'react';
import { createMatrixClient, createMatrixFetchFn } from '../../mindroom/matrix/matrixClientFactory';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import {
  getSSOProviderButtonTitle,
  hasAppleIdentityProvider,
  isAppleIdentityProvider,
  isGitHubIdentityProvider,
  isGoogleIdentityProvider,
  sortIdentityProviders,
} from './ssoProviders';
import AppleLogo from '../../../../public/res/svg/sso-apple-white.svg';
import GoogleLogo from '../../../../public/res/svg/sso-google.svg';
import GitHubLogo from '../../../../public/res/svg/sso-github.svg';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import {
  isMindroomHomeserver,
  isNativeApp,
  isNativeIOS,
  openNativeSsoBrowser,
  signInWithNativeApple,
} from '../../mindroom/auth/authUi';
import { hasCloudflareAccess } from '../../mindroom/native/cloudflareAccess';

type SSOLoginProps = {
  providers?: IIdentityProvider[];
  redirectUrl: string;
  action?: SSOAction;
  saveScreenSpace?: boolean;
};
export function SSOLogin({ providers, redirectUrl, action, saveScreenSpace }: SSOLoginProps) {
  const { t } = useTranslation();
  const discovery = useAutoDiscoveryInfo();
  const baseUrl = discovery['m.homeserver'].base_url;
  const mx = useMemo(() => createMatrixClient({ baseUrl }), [baseUrl]);
  const orderedProviders = sortIdentityProviders(providers);
  const appleProviderAvailable = hasAppleIdentityProvider(orderedProviders);
  const nativeApp = isNativeApp();
  const nativeIOS = isNativeIOS();
  const openingNativeSSORef = useRef(false);

  const handleSSONavigate =
    (url: string, provider?: IIdentityProvider) =>
    async (evt: React.MouseEvent<HTMLElement>): Promise<void> => {
      if (!nativeApp) return;

      evt.preventDefault();
      if (openingNativeSSORef.current) return;
      openingNativeSSORef.current = true;
      try {
        if (
          nativeIOS &&
          provider &&
          isAppleIdentityProvider(provider) &&
          isMindroomHomeserver(baseUrl)
        ) {
          await signInWithNativeApple({
            baseUrl,
            ssoUrl: url,
            ephemeral: hasCloudflareAccess(baseUrl),
            providerId: provider.id,
            redirectUrl,
            // Carries the Cloudflare Access token of a server behind Access.
            request: createMatrixFetchFn(),
          });
        } else {
          // The SSO redirect of a server behind Access also logs in to Access, which fails in
          // Safari's shared cookies, so it runs in an ephemeral session too.
          await openNativeSsoBrowser(url, hasCloudflareAccess(baseUrl));
        }
      } catch (error) {
        console.error('[SSO] Failed to open native browser', error);
      } finally {
        // Avoid multiple rapid taps creating overlapping SSO sessions/states.
        window.setTimeout(() => {
          openingNativeSSORef.current = false;
        }, 2000);
      }
    };

  const getProviderIconUrl = (provider: IIdentityProvider): string | undefined => {
    if (isAppleIdentityProvider(provider)) return AppleLogo;
    if (isGoogleIdentityProvider(provider)) return GoogleLogo;
    if (isGitHubIdentityProvider(provider)) return GitHubLogo;
    const homeserverIcon =
      provider.icon && mxcUrlToHttp(mx, provider.icon, false, 96, 96, 'crop', false);
    if (homeserverIcon) return homeserverIcon;

    return undefined;
  };

  const getSSOIdUrl = (ssoId?: string): string =>
    mx.getSsoLoginUrl(redirectUrl, 'sso', ssoId, action);

  const withoutIcon = providers
    ? orderedProviders.find((provider) => !getProviderIconUrl(provider))
    : true;

  const renderAsIcons = withoutIcon
    ? false
    : !appleProviderAvailable && saveScreenSpace && providers && providers.length > 2;

  return (
    <Box justifyContent="Center" gap="600" wrap="Wrap">
      {providers ? (
        orderedProviders.map((provider) => {
          const { id, name } = provider;
          const ssoUrl = getSSOIdUrl(id);
          const iconUrl = getProviderIconUrl(provider);
          const appleProvider = isAppleIdentityProvider(provider);
          const buttonTitle = getSSOProviderButtonTitle(provider, t, action);
          const navigationProps = nativeApp ? {} : { as: 'a' as const, href: ssoUrl };

          if (renderAsIcons) {
            return (
              <Avatar
                style={{ cursor: 'pointer' }}
                key={id}
                {...navigationProps}
                onClick={handleSSONavigate(ssoUrl, provider)}
                aria-label={buttonTitle}
                size="300"
                radii="300"
              >
                <AvatarImage src={iconUrl!} alt={name} title={buttonTitle} />
              </Avatar>
            );
          }

          return (
            <Button
              style={
                appleProvider
                  ? { width: '100%', backgroundColor: '#000', borderColor: '#000' }
                  : { width: '100%' }
              }
              key={id}
              {...navigationProps}
              onClick={handleSSONavigate(ssoUrl, provider)}
              size="500"
              variant={appleProvider ? 'Primary' : 'Secondary'}
              fill={appleProvider ? 'Solid' : 'Soft'}
              outlined={!appleProvider}
              before={
                iconUrl && (
                  <img src={iconUrl} alt="" width={18} height={18} style={{ display: 'block' }} />
                )
              }
            >
              <Text
                align="Center"
                size="B500"
                truncate
                style={appleProvider ? { color: '#fff' } : undefined}
              >
                {buttonTitle}
              </Text>
            </Button>
          );
        })
      ) : (
        <Button
          style={{ width: '100%' }}
          {...(nativeApp ? {} : { as: 'a' as const, href: getSSOIdUrl() })}
          onClick={handleSSONavigate(getSSOIdUrl())}
          size="500"
          variant="Secondary"
          fill="Soft"
          outlined
        >
          <Text align="Center" size="B500" truncate>
            {t('sharedUi.sSOLogin.continueWithSso')}
          </Text>
        </Button>
      )}
    </Box>
  );
}
