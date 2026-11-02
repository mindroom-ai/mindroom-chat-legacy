import { useTranslation } from 'react-i18next';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, color, Spinner, Switch, Text } from 'folds';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import { useActiveSession } from '../../hooks/useSessionStore';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClientConfig } from '../../hooks/useClientConfig';
import { SequenceCardStyle } from '../../features/settings/styles.css';
import { MINDROOM_APP_NAME } from '../branding/branding';
import {
  NativePushPermission,
  checkIOSPushPermission,
  disableIOSPushPusher,
  isNativeIOSPlatform,
  requestIOSPushPermission,
  resolveIOSPushConfig,
  setIOSPushEnabled,
  unregisterIOSPush,
} from './iosPush';
import { useIOSPushEnabled } from './useIOSPushEnabled';
import { cloudflareAccessAllowsPush } from './cloudflareAccess';

export function IOSPushNotification() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const clientConfig = useClientConfig();
  const activeSession = useActiveSession();
  const language = useAppLanguageCode();
  const sessionId = activeSession?.sessionId;
  const nativePushNotifications = useIOSPushEnabled(sessionId);
  const iosPushConfig = useMemo(
    () => resolveIOSPushConfig(clientConfig, sessionId, language),
    [clientConfig, language, sessionId]
  );
  const [permission, setPermission] = useState<NativePushPermission>('prompt');

  const refreshPermission = useCallback(async () => {
    try {
      setPermission(await checkIOSPushPermission());
    } catch {
      setPermission('denied');
    }
  }, []);

  useEffect(() => {
    if (!isNativeIOSPlatform()) return;
    refreshPermission();
  }, [refreshPermission]);

  const [toggleState, togglePush] = useAsyncCallback(
    useCallback(
      async (enabled: boolean) => {
        if (!iosPushConfig) {
          throw new Error(
            'Native push is not configured. Set push.ios.enabled/appId/gatewayUrl in config.json.'
          );
        }

        if (!enabled) {
          setIOSPushEnabled(false, sessionId);
          await disableIOSPushPusher(mx, iosPushConfig, sessionId);
          await unregisterIOSPush().catch(() => undefined);
          return;
        }

        let nextPermission = await checkIOSPushPermission();
        if (nextPermission !== 'granted') {
          nextPermission = await requestIOSPushPermission();
        }

        setPermission(nextPermission);
        if (nextPermission !== 'granted') {
          setIOSPushEnabled(false, sessionId);
          return;
        }

        setIOSPushEnabled(true, sessionId);
      },
      [iosPushConfig, mx, sessionId]
    )
  );

  // A server that turns push off in its Cloudflare Access advert gets no push setting.
  if (!isNativeIOSPlatform() || !cloudflareAccessAllowsPush(mx.getHomeserverUrl())) return null;

  const handleToggle = (enabled: boolean) => {
    togglePush(enabled)
      .catch((error: unknown) => {
        // Keep the localized UI concise while preserving the original failure and stack.
        // eslint-disable-next-line no-console
        console.error('[IOSPushNotification] Failed to update native push settings:', error);
      })
      .finally(() => {
        refreshPermission();
      });
  };

  const description = (
    <>
      {!iosPushConfig && (
        <Text as="span" style={{ color: color.Critical.Main }} size="T200">
          {t(
            'mindroomUi.native.iOSPushNotification.nativeIosPushIsNotConfiguredByTheDeploymentAdd'
          )}
        </Text>
      )}
      {iosPushConfig && toggleState.status === AsyncStatus.Error && (
        <Text as="span" style={{ color: color.Critical.Main }} size="T200">
          {t('mindroomUi.native.iOSPushNotification.failedToUpdateNativePushSettings')}
        </Text>
      )}
      {iosPushConfig && toggleState.status !== AsyncStatus.Error && permission === 'denied' && (
        <Text as="span" style={{ color: color.Critical.Main }} size="T200">
          {t('mindroomUi.native.iOSPushNotification.permissionDenied', {
            appName: MINDROOM_APP_NAME,
          })}
        </Text>
      )}
      {iosPushConfig && toggleState.status !== AsyncStatus.Error && permission === 'prompt' && (
        <span>
          {t(
            'mindroomUi.native.iOSPushNotification.allowNativeIosPushNotificationsForBackgroundMessageAlerts'
          )}
        </span>
      )}
      {iosPushConfig &&
        toggleState.status !== AsyncStatus.Error &&
        permission === 'granted' &&
        nativePushNotifications && (
          <span>
            {t(
              'mindroomUi.native.iOSPushNotification.deviceRegisteredForNativeIosPushNotifications'
            )}
          </span>
        )}
      {iosPushConfig &&
        toggleState.status !== AsyncStatus.Error &&
        permission === 'granted' &&
        !nativePushNotifications && (
          <span>
            {t('mindroomUi.native.iOSPushNotification.nativeIosPushIsDisabledForThisDevice')}
          </span>
        )}
    </>
  );

  let control = <Text size="T200">{t('mindroomUi.native.iOSPushNotification.unavailable')}</Text>;
  if (toggleState.status === AsyncStatus.Loading) {
    control = <Spinner variant="Secondary" />;
  } else if (iosPushConfig) {
    if (permission === 'prompt' && !nativePushNotifications) {
      control = (
        <Button size="300" radii="300" onClick={() => handleToggle(true)} fill="Soft" outlined>
          <Text size="B300">{t('mindroomUi.native.iOSPushNotification.enable')}</Text>
        </Button>
      );
    } else {
      control = <Switch value={nativePushNotifications} onChange={handleToggle} />;
    }
  }

  return (
    <SequenceCard
      className={SequenceCardStyle}
      variant="SurfaceVariant"
      direction="Column"
      gap="400"
    >
      <SettingTile
        title={t('mindroomUi.native.iOSPushNotification.iosPushNotifications')}
        description={description}
        after={control}
      />
    </SequenceCard>
  );
}
