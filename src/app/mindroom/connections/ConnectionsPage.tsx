import React, { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { useHref } from 'react-router-dom';
import { Page, PageContent } from '../../components/page';
import { ROOT_PATH } from '../../pages/paths';
import { useComputerApiUrls } from '../computer/useComputerApiUrl';
import { MindroomConnectionsSettings } from '../settings/MindroomConnectionsSettings';
import { connectionsHandoffSupported } from './openConnections';
import { useConnectionsHandoff } from './useOpenConnectionsPortal';

/**
 * `/connections` in Chat: with one MindRoom server, sign in to its Connections portal and open it in this tab.
 * The Settings card stays on the page, for several servers, none, an HTTP server behind HTTPS Chat, or a failed sign-in.
 */
export function ConnectionsPage() {
  const { urls, discovered } = useComputerApiUrls();
  const handOff = useConnectionsHandoff(discovered);
  const onlyBackend = urls.length === 1 ? urls[0] : undefined;
  // Back from the portal opens Chat, not this page, which would hand off again.
  const returnTo = useHref(ROOT_PATH);

  useEffect(() => {
    // The native shells keep the portal out of their web view.
    if (!onlyBackend || Capacitor.isNativePlatform() || !connectionsHandoffSupported(onlyBackend)) {
      return undefined;
    }
    const controller = new AbortController();
    // A failed token request leaves the card, whose button opens the portal in a window instead.
    handOff(onlyBackend, controller.signal, returnTo).catch(() => undefined);
    return () => controller.abort();
  }, [handOff, onlyBackend, returnTo]);

  return (
    <Page>
      <PageContent>
        <MindroomConnectionsSettings />
      </PageContent>
    </Page>
  );
}
