import { useCallback } from 'react';
import type { IOpenIDToken } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { requestAudienceOpenIdToken } from '../matrix/openidAudience';
import { openConnectionsPortal, submitConnectionsHandoff } from './openConnections';

/**
 * A Matrix OpenID token for the current user, bound to a backend origin.
 * `discovered` marks backends that agents published, whose token waits for a fresh binding check.
 */
const useConnectionsOpenIdToken = (discovered: boolean) => {
  const mx = useMatrixClient();
  return useCallback(
    async (audience: string): Promise<IOpenIDToken> => {
      // An account switch stops this client but not the portal session, so a stopped client never answers.
      if (!mx.clientRunning) throw new Error('Matrix client stopped');
      const token = await requestAudienceOpenIdToken(mx, audience, { requireBinding: discovered });
      if (!mx.clientRunning) throw new Error('Matrix client stopped');
      return token;
    },
    [mx, discovered]
  );
};

/**
 * Open a backend's Connections portal signed in as the current Matrix user, optionally to open an agent link there.
 * Call the returned function synchronously from a click handler so popup blockers allow the window.
 */
export const useOpenConnectionsPortal = (discovered: boolean) => {
  const getOpenIdToken = useConnectionsOpenIdToken(discovered);
  return useCallback(
    (backendUrl: string, next?: string) =>
      openConnectionsPortal({ backendUrl, next, getOpenIdToken }),
    [getOpenIdToken]
  );
};

/**
 * Sign this tab in to a backend's Connections portal and open it there, without a pop-up window.
 * An abort before the token arrives submits nothing, so leaving the page never navigates away later.
 */
export const useConnectionsHandoff = (discovered: boolean) => {
  const getOpenIdToken = useConnectionsOpenIdToken(discovered);
  return useCallback(
    async (backendUrl: string, signal: AbortSignal, returnTo?: string) => {
      const token = await getOpenIdToken(new URL(backendUrl).origin);
      if (!signal.aborted) submitConnectionsHandoff(backendUrl, token, returnTo);
    },
    [getOpenIdToken]
  );
};
