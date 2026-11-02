import { useTranslation } from 'react-i18next';
import React, { ReactNode, useEffect, useState } from 'react';
import { Box, Button, Text, color } from 'folds';
import {
  discoverCloudflareAccess,
  isCloudflareAccessSupported,
  signInToCloudflareAccess,
  useCloudflareAccessSignInRequired,
} from './cloudflareAccess';

/** Explains that the server needs the organization's sign-in and starts it. */
export function CloudflareAccessSignIn({ baseUrl }: { baseUrl: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'idle' | 'busy' | 'failed'>('idle');

  const signIn = () => {
    setStatus('busy');
    signInToCloudflareAccess(baseUrl).then(
      () => setStatus('idle'),
      () => setStatus('failed')
    );
  };

  return (
    <Box direction="Column" alignItems="Center" gap="200">
      <Text align="Center" size="T300">
        {t('mindroomUi.native.cloudflareAccess.signInRequired', {
          value1: new URL(baseUrl).host,
        })}
      </Text>
      {status === 'failed' && (
        <Text align="Center" size="T300" style={{ color: color.Critical.Main }}>
          {t('mindroomUi.native.cloudflareAccess.signInFailed')}
        </Text>
      )}
      <Button
        variant="Primary"
        size="400"
        radii="300"
        disabled={status === 'busy'}
        onClick={signIn}
      >
        <Text as="span" size="B400">
          {t('mindroomUi.native.cloudflareAccess.continue')}
        </Text>
      </Button>
    </Box>
  );
}

type CloudflareAccessLoginGateProps = {
  baseUrl: string;
  fallback: () => ReactNode;
  children: ReactNode;
};

/** Holds back the login form of a server behind Cloudflare Access until the app has a token. */
export function CloudflareAccessLoginGate({
  baseUrl,
  fallback,
  children,
}: CloudflareAccessLoginGateProps) {
  const supported = isCloudflareAccessSupported();
  const [advertised, setAdvertised] = useState<boolean>();
  const signInRequired = useCloudflareAccessSignInRequired(baseUrl);

  useEffect(() => {
    if (!supported) return undefined;
    let current = true;
    setAdvertised(undefined);
    discoverCloudflareAccess(baseUrl).then((found) => {
      if (current) setAdvertised(found);
    });
    return () => {
      current = false;
    };
  }, [baseUrl, supported]);

  if (!supported) return children;
  if (advertised === undefined) return fallback();
  if (advertised && signInRequired) return <CloudflareAccessSignIn baseUrl={baseUrl} />;
  return children;
}
