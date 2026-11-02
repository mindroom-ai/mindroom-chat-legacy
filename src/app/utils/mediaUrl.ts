import { MatrixClient } from 'matrix-js-sdk';
import { validMediaRequest } from '../../swMediaAuth';
import { trimTrailingSlash } from './common';
import type { SpecVersions } from '../cs-api';

const AUTHENTICATED_MEDIA_SPEC_VERSION = 'v1.11';
const AUTHENTICATED_MEDIA_UNSTABLE_FEATURE = 'org.matrix.msc3916.stable';

export const supportsAuthenticatedMedia = ({
  versions,
  unstable_features: unstableFeatures,
}: SpecVersions): boolean =>
  unstableFeatures?.[AUTHENTICATED_MEDIA_UNSTABLE_FEATURE] === true ||
  versions.includes(AUTHENTICATED_MEDIA_SPEC_VERSION);

const rebaseMediaUrlToHomeserverPath = (mx: MatrixClient, mediaUrl: string): string => {
  try {
    const homeserverUrl = new URL(mx.getHomeserverUrl());
    const parsedMediaUrl = new URL(mediaUrl);

    if (parsedMediaUrl.origin !== homeserverUrl.origin) return mediaUrl;
    if (!parsedMediaUrl.pathname.startsWith('/_matrix/')) return mediaUrl;

    const homeserverPath = trimTrailingSlash(homeserverUrl.pathname);
    if (!homeserverPath) return mediaUrl;
    if (parsedMediaUrl.pathname.startsWith(`${homeserverPath}/_matrix/`)) return mediaUrl;

    parsedMediaUrl.pathname = `${homeserverPath}${parsedMediaUrl.pathname}`;
    return parsedMediaUrl.toString();
  } catch {
    return mediaUrl;
  }
};

/** Options that send the access token with the client's own request to a media URL on its homeserver. */
export const authenticatedMediaRequestInit = (
  mx: MatrixClient,
  url: string
): RequestInit | undefined => {
  const token = mx.getAccessToken();
  // A URL that already carries the token in its query, as in the iOS and Mac apps (`capacitor://`),
  // must not also carry it in a header: Synapse refuses a request that sends both.
  return token &&
    validMediaRequest(url, mx.getHomeserverUrl()) &&
    !new URL(url).searchParams.has('access_token')
    ? { headers: { Authorization: `Bearer ${token}` } }
    : undefined;
};

export const mxcUrlToHttp = (
  mx: MatrixClient,
  mxcUrl: string,
  useAuthentication?: boolean,
  width?: number,
  height?: number,
  resizeMethod?: string,
  allowDirectLinks?: boolean,
  allowRedirects?: boolean
): string | null => {
  const rawMediaUrl = mx.mxcUrlToHttp(
    mxcUrl,
    width,
    height,
    resizeMethod,
    allowDirectLinks,
    allowRedirects,
    useAuthentication
  );
  const mediaUrl = rawMediaUrl ? rebaseMediaUrlToHomeserverPath(mx, rawMediaUrl) : rawMediaUrl;

  if (!mediaUrl || !useAuthentication) return mediaUrl;
  if (typeof window === 'undefined') return mediaUrl;
  const isCapacitor = window.location?.protocol === 'capacitor:';

  // Browser URLs stay token-free even before service-worker takeover. Startup
  // waits briefly for control, and a failed media request is preferable to
  // exposing a bearer token in DOM attributes, history, or logs.
  if (!isCapacitor) return mediaUrl;

  const accessToken = mx.getAccessToken();
  if (!accessToken) return mediaUrl;
  if (!validMediaRequest(mediaUrl, mx.getHomeserverUrl())) return mediaUrl;

  // Capacitor iOS lacks service workers, so native media elements cannot receive
  // Authorization headers. Use a query token fallback for authenticated media.
  // validMediaRequest already ruled out unparseable URLs.
  const urlObj = new URL(mediaUrl);
  urlObj.searchParams.set('access_token', accessToken);
  return urlObj.toString();
};
