import { createContext, useContext } from 'react';

export type HashRouterConfig = {
  enabled?: boolean;
  basename?: string;
};

export type ClientConfig = {
  defaultHomeserver?: number;
  homeserverList?: string[];
  allowCustomHomeservers?: boolean;

  push?: {
    ios?: {
      enabled?: boolean;
      appId?: string;
      gatewayUrl?: string;
      appDisplayName?: string;
      deviceDisplayName?: string;
      profileTag?: string;
      append?: boolean;
      format?: 'event_id_only' | 'full';
      lang?: string;
    };
  };

  featuredCommunities?: {
    openAsDefault?: boolean;
    spaces?: string[];
    rooms?: string[];
    servers?: string[];
  };

  hashRouter?: HashRouterConfig;

  splash?: {
    loadingMessages?: string[];
  };

  mindroom?: {
    thinkingPlaceholderMessages?: string[];
    computers?: {
      apiUrl?: string;
    };
    uiActions?: {
      /** Exact Matrix server names allowed to open UI automatically. Empty or absent disables it. */
      autoOpenFromHomeservers?: string[];
    };
    canvas?: {
      /**
       * Run agent-made interactive panels. Absent or false keeps them as fallback text.
       * Panels cannot reach the Matrix session, but WebRTC can still leak what a user types into one.
       */
      enabled?: boolean;
      /** Let panels load scripts, styles, and fonts from jsDelivr's npm CDN. Absent or false blocks them. */
      libraries?: boolean;
    };
  };

  messageRendering?: {
    additionalAllowedUriSchemes?: string[];
  };

  sidebar?: {
    showThreads?: boolean;
    /** Show Explorer in the full interface. Defaults to true. */
    showExploreCommunity?: boolean;
    /** Show Explorer in Simple Mode. Defaults to false. */
    showExploreCommunityInSimpleMode?: boolean;
    showAddSpace?: boolean;
    showMindRoom?: boolean;
    mindRoomUrl?: string;
    mindRoomProvisioningUrl?: string;
  };

  auth?: {
    hideServerPickerWhenSingle?: boolean;
    allowRegistration?: boolean;
    disablePasswordLogin?: boolean;
    requireAppleProvider?: boolean;
    supportUrl?: string;
    privacyPolicyUrl?: string;
    termsUrl?: string;
    /** Sign-in footer credits. Absent shows MindRoom Chat, Matrix, and Cinny; empty hides them. */
    poweredBy?: {
      label: string;
      url: string;
    }[];
  };

  createRoom?: {
    showEncryptionOption?: boolean;
    defaultEncryption?: boolean;
    showFederationOption?: boolean;
    defaultFederation?: boolean;
  };

  welcome?: {
    title?: string;
    subtitle?: string;
    sourceLabel?: string;
    sourceUrl?: string;
    docsLabel?: string;
    docsUrl?: string;
    poweredBy?: {
      label: string;
      url: string;
    }[];
  };
};

const ClientConfigContext = createContext<ClientConfig | null>(null);

export const ClientConfigProvider = ClientConfigContext.Provider;

export function useClientConfig(): ClientConfig {
  const config = useContext(ClientConfigContext);
  if (!config) throw new Error('Client config are not provided!');
  return config;
}

export const clientDefaultServer = (clientConfig: ClientConfig): string =>
  clientConfig.homeserverList?.[clientConfig.defaultHomeserver ?? 0] ?? 'matrix.org';

export const clientAllowedServer = (clientConfig: ClientConfig, server: string): boolean => {
  const { homeserverList, allowCustomHomeservers } = clientConfig;

  if (allowCustomHomeservers) return true;

  return homeserverList?.includes(server) === true;
};
