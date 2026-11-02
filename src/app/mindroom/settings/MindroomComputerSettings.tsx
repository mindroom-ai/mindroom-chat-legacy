import React, { useEffect, useState } from 'react';
import { Box, Button, Input, Text, color } from 'folds';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import { useClientConfig } from '../../hooks/useClientConfig';
import { resolveComputerApiUrl } from '../computer/api';
import {
  computerServicePreferenceAtom,
  resolveComputerServiceUrl,
} from '../computer/computerServiceSettings';
import { useComputerApiUrl, useComputerApiUrls } from '../computer/useComputerApiUrl';

export function MindroomComputerSettings({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [preference, savePreference] = useAtom(computerServicePreferenceAtom);
  const apiUrl = useComputerApiUrl();
  // While the setting follows the default, the field shows the server found from the agents, if any.
  const found = useComputerApiUrls();
  const foundUrl = found.discovered ? found.urls[0] : undefined;
  const deploymentUrl = useClientConfig().mindroom?.computers?.apiUrl;
  const [input, setInput] = useState(apiUrl ?? '');
  const [message, setMessage] = useState<'invalidUrl' | 'saveFailed' | 'saved'>();
  useEffect(() => {
    setInput(apiUrl ?? '');
  }, [apiUrl, preference]);

  const save = (next: string | null) => {
    if (next !== null && next.trim() && !resolveComputerApiUrl(next)) {
      setMessage('invalidUrl');
      return;
    }
    if (savePreference(next)) {
      setInput(resolveComputerServiceUrl(next, deploymentUrl) ?? '');
      setMessage('saved');
    } else {
      setMessage('saveFailed');
    }
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('settings.general.computers.sectionTitle')}</Text>
      <SequenceCard className={className} variant="SurfaceVariant" direction="Column" gap="400">
        <SettingTile
          title={t('settings.general.computers.apiUrl')}
          description={t('settings.general.computers.description')}
        >
          <Box direction="Column" gap="200">
            <Input
              aria-label={t('settings.general.computers.apiUrl')}
              type="url"
              size="400"
              variant="Background"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={input}
              placeholder={foundUrl}
              onChange={(event) => {
                setInput(event.currentTarget.value);
                setMessage(undefined);
              }}
            />
            {resolveComputerApiUrl(input)?.startsWith('http:') && (
              <Text size="T200" role="note">
                {t('settings.general.computers.httpNotice')}
              </Text>
            )}
            <Box gap="200" wrap="Wrap">
              <Button
                size="300"
                variant="Primary"
                fill="Soft"
                outlined
                radii="300"
                onClick={() => save(input)}
              >
                <Text size="B300">{t('settings.general.computers.save')}</Text>
              </Button>
              <Button
                size="300"
                variant="Secondary"
                fill="Soft"
                outlined
                radii="300"
                onClick={() => save(null)}
              >
                <Text size="B300">{t('settings.general.computers.reset')}</Text>
              </Button>
            </Box>
            {message && (
              <Text
                size="T200"
                role={message === 'saved' ? 'status' : 'alert'}
                style={message === 'saved' ? undefined : { color: color.Critical.Main }}
              >
                {t(`settings.general.computers.${message}`)}
              </Text>
            )}
          </Box>
        </SettingTile>
      </SequenceCard>
    </Box>
  );
}
