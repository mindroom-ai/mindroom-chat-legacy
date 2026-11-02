import { useAtomValue } from 'jotai';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useMindroomServerUrls } from '../server/useMindroomServers';
import { resolveComputerApiUrl } from './api';
import {
  computerServicePreferenceAtom,
  resolveComputerServiceUrl,
} from './computerServiceSettings';

/**
 * The MindRoom server origin: the user's setting, else the deployment's, else `discoveredUrl`, one that
 * the room's agents published. A user who turned computers off keeps them off.
 */
export const useComputerApiUrl = (discoveredUrl?: string): string | undefined => {
  const preference = useAtomValue(computerServicePreferenceAtom);
  const config = useClientConfig();
  // An unusable deployment value counts as unset, as it does in Settings.
  const deploymentUrl = resolveComputerApiUrl(config.mindroom?.computers?.apiUrl);
  return resolveComputerServiceUrl(preference, deploymentUrl ?? discoveredUrl);
};

/**
 * Every MindRoom server to offer outside a room: the configured one, else each one agents published,
 * which `discovered` marks so a token for one is requested only after the homeserver confirms binding.
 */
export const useComputerApiUrls = (): { urls: string[]; discovered: boolean } => {
  const discoveredUrls = useMindroomServerUrls();
  const preference = useAtomValue(computerServicePreferenceAtom);
  const configured = useComputerApiUrl();
  if (configured) return { urls: [configured], discovered: false };
  return { urls: preference === null ? discoveredUrls : [], discovered: true };
};
