import { useClientConfig } from '../../hooks/useClientConfig';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { resolveMindroomProvisioningRequest } from './mindroom';

// Local MindRoom pairs through the provisioning service, which only accounts on
// its homeserver can authenticate to, so other accounts get no entry point.
export const useShowLocalMindroom = (): boolean => {
  const mx = useMatrixClient();
  const { sidebar } = useClientConfig();
  if (!(sidebar?.showMindRoom ?? true)) return false;

  return resolveMindroomProvisioningRequest({
    sessionHomeserverUrl: mx.getHomeserverUrl(),
    provisioningOverrideUrl: sidebar?.mindRoomProvisioningUrl,
    accessToken: mx.getAccessToken() ?? undefined,
  }).canAuthenticate;
};
