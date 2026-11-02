import { useTranslation } from 'react-i18next';
import React, { ReactNode } from 'react';
import { Box, config, Text, Button, Spinner } from 'folds';
import { Dialog } from '../../components/glass/GlassPrimitives';
import { SpecVersionsLoader } from '../../components/SpecVersionsLoader';
import { SpecVersionsProvider } from '../../hooks/useSpecVersions';
import { MindRoomSplashScreen, SplashScreen } from '../../components/splash-screen';
import { clearAllCacheAndReload, removeSessionAndReload } from '../../../client/initMatrix';
import { useActiveSession } from '../../hooks/useSessionStore';
import { specVersions, type SpecVersions as SpecVersionsResponse } from '../../cs-api';
import { readCachedSpecVersions, writeCachedSpecVersions } from '../../state/cachedSpecVersions';

const UNKNOWN_SPEC_VERSIONS: SpecVersionsResponse = { versions: [] };

function LoadedSpecVersions({
  baseUrl,
  userId,
  versions,
  children,
}: {
  baseUrl: string;
  userId?: string;
  versions: SpecVersionsResponse;
  children: ReactNode;
}) {
  React.useEffect(() => {
    if (!userId) return;
    writeCachedSpecVersions(baseUrl, userId, versions);
  }, [baseUrl, userId, versions]);

  return <SpecVersionsProvider value={versions}>{children}</SpecVersionsProvider>;
}

export function SpecVersions({
  baseUrl,
  allowCachedContent = false,
  children,
}: {
  baseUrl: string;
  allowCachedContent?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const activeSession = useActiveSession();
  const userId = activeSession?.userId;
  const accessToken = activeSession?.accessToken;
  const request = React.useCallback<typeof fetch>(
    (input, init) =>
      fetch(
        input,
        accessToken
          ? {
              ...init,
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            }
          : init
      ),
    [accessToken]
  );
  // Re-read when cached content becomes allowed: after a fresh login the loader has just cached
  // the versions it loaded, and the client must not switch to unknown versions (legacy media URLs).
  const cachedVersions = React.useMemo(
    () => (userId ? readCachedSpecVersions(baseUrl, userId) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseUrl, userId, allowCachedContent]
  );
  const [clearing, setClearing] = React.useState(false);
  const [refreshedVersions, setRefreshedVersions] = React.useState<SpecVersionsResponse>();
  const hasCachedVersions = cachedVersions !== undefined;
  const canRenderCachedContent = hasCachedVersions || allowCachedContent;

  React.useEffect(() => {
    if (!canRenderCachedContent || !userId) return undefined;
    let disposed = false;

    specVersions(request, baseUrl)
      .then((versions) => {
        if (disposed || versions.versions.length === 0) return;
        writeCachedSpecVersions(baseUrl, userId, versions);
        if (!hasCachedVersions) setRefreshedVersions(versions);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [baseUrl, canRenderCachedContent, hasCachedVersions, request, userId]);

  const handleClearCache = async () => {
    if (clearing) return;

    setClearing(true);

    try {
      await clearAllCacheAndReload();
    } catch {
      setClearing(false);
    }
  };

  if (canRenderCachedContent) {
    return (
      <SpecVersionsProvider value={cachedVersions ?? refreshedVersions ?? UNKNOWN_SPEC_VERSIONS}>
        {children}
      </SpecVersionsProvider>
    );
  }

  return (
    <SpecVersionsLoader
      baseUrl={baseUrl}
      request={request}
      fallback={() => (
        <MindRoomSplashScreen message={t('sharedUi.specVersions.connectingToServer')}>
          <Button
            variant="Critical"
            fill="Soft"
            onClick={() => {
              if (activeSession) {
                removeSessionAndReload(activeSession).catch(() => undefined);
                return;
              }
              window.location.reload();
            }}
            outlined
            radii="300"
          >
            <Text as="span" size="B400">
              {t('sharedUi.specVersions.cancelAndReturnToSignIn')}
            </Text>
          </Button>
        </MindRoomSplashScreen>
      )}
      error={(err, retry, ignore) => (
        <SplashScreen>
          <Box direction="Column" grow="Yes" alignItems="Center" justifyContent="Center" gap="400">
            <Dialog>
              <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
                <Text>
                  {t(
                    'sharedUi.specVersions.unableToConnectToTheHomeserverTheHomeserverOrYourInternetConnection'
                  )}
                </Text>
                <Button variant="Primary" onClick={retry} fill="Soft" outlined radii="300">
                  <Text as="span" size="B400">
                    {t('sharedUi.specVersions.retry')}
                  </Text>
                </Button>
                <Button
                  variant="Secondary"
                  fill="Soft"
                  onClick={handleClearCache}
                  disabled={clearing}
                  before={clearing && <Spinner size="200" variant="Secondary" fill="Soft" />}
                  outlined
                  radii="300"
                >
                  <Text as="span" size="B400">
                    {clearing
                      ? t('sharedUi.specVersions.clearing')
                      : t('sharedUi.specVersions.clearCacheAndReload')}
                  </Text>
                </Button>
                <Button variant="Critical" onClick={ignore} fill="Soft" outlined radii="300">
                  <Text as="span" size="B400">
                    {t('sharedUi.specVersions.continue')}
                  </Text>
                </Button>
              </Box>
            </Dialog>
          </Box>
        </SplashScreen>
      )}
    >
      {(versions) => (
        <LoadedSpecVersions baseUrl={baseUrl} userId={userId} versions={versions}>
          {children}
        </LoadedSpecVersions>
      )}
    </SpecVersionsLoader>
  );
}
