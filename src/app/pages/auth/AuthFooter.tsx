import { Trans, useTranslation } from 'react-i18next';
import React from 'react';
import { Box, Text } from 'folds';
import * as css from './styles.css';
import { useClientConfig } from '../../hooks/useClientConfig';
import { MINDROOM_AUTH_BRANDING } from '../../mindroom/auth/authUi';

export function AuthFooter() {
  const { t, i18n } = useTranslation();
  const { auth } = useClientConfig();
  const poweredBy = auth?.poweredBy ?? MINDROOM_AUTH_BRANDING.poweredBy;
  // The locale picks separators from the labels (Spanish "e" before "Inkscape"); list
  // patterns keep item order, so each element part is the next link.
  let nextLink = 0;
  const poweredByLinks = new Intl.ListFormat(i18n.resolvedLanguage ?? i18n.language, {
    type: 'conjunction',
  })
    .formatToParts(poweredBy.map((item) => item.label))
    .map((part) => {
      if (part.type === 'literal') return part.value;
      const item = poweredBy[nextLink];
      nextLink += 1;
      return (
        <a key={nextLink} href={item.url} target="_blank" rel="noreferrer" dir="auto">
          {item.label}
        </a>
      );
    });

  const optionalLinks = [
    auth?.supportUrl
      ? { label: t('sharedUi.authFooter.support'), href: auth.supportUrl }
      : undefined,
    auth?.privacyPolicyUrl
      ? { label: t('sharedUi.authFooter.privacy'), href: auth.privacyPolicyUrl }
      : undefined,
    auth?.termsUrl ? { label: t('sharedUi.authFooter.terms'), href: auth.termsUrl } : undefined,
  ].filter((item): item is { label: string; href: string } => Boolean(item));

  return (
    <Box className={css.AuthFooter} justifyContent="Center" gap="400" wrap="Wrap">
      {poweredBy.length > 0 && (
        <Text size="T300">
          <Trans
            t={t}
            i18nKey="sharedUi.authFooter.poweredBy"
            components={{ links: <>{poweredByLinks}</> }}
          />
        </Text>
      )}
      {optionalLinks.map((link) => (
        <Text key={link.label} size="T300">
          <a href={link.href} target="_blank" rel="noreferrer">
            {link.label}
          </a>
        </Text>
      ))}
    </Box>
  );
}
