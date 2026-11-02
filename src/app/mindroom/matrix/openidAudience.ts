import { ConnectionError, Method, type IOpenIDToken, type MatrixClient } from 'matrix-js-sdk';
import { specVersions } from '../../cs-api';

// The Tuwunel fork binds the token to this audience (`io.mindroom.openid_audience`); stock homeservers ignore it.
export const OPENID_AUDIENCE_FIELD = 'io.mindroom.audience';

/** The homeserver advertises this in `/versions` while it binds tokens to the audience they were requested for. */
const OPENID_AUDIENCE_FEATURE = 'io.mindroom.openid_audience';

const freshFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });

/**
 * Ask the homeserver now whether it binds tokens, or undefined when it cannot be asked. The client's
 * cached versions can outlive a rollback, so they never decide this.
 */
export const readOpenIdBinding = (mx: MatrixClient): Promise<boolean | undefined> =>
  specVersions(freshFetch, mx.getHomeserverUrl()).then(
    (versions) => versions.unstable_features?.[OPENID_AUDIENCE_FEATURE] === true,
    () => undefined
  );

const assertBinding = async (mx: MatrixClient): Promise<void> => {
  const binds = await readOpenIdBinding(mx);
  if (binds === undefined)
    throw new ConnectionError('The homeserver could not be asked whether it binds sign-in tokens.');
  if (!binds)
    throw new Error('The homeserver does not bind sign-in tokens, so this server is not trusted.');
};

/**
 * Request a token bound to `audience`. With `requireBinding`, as for an origin an agent published,
 * the homeserver must confirm it binds tokens both before the token is requested and after it is
 * issued, so a binding switched off in between cannot hand that origin an unbound token.
 * A homeserver that cannot be asked fails like any unreachable homeserver, so callers may retry.
 */
export const requestAudienceOpenIdToken = async (
  mx: MatrixClient,
  audience: string,
  { requireBinding = false }: { requireBinding?: boolean } = {}
): Promise<IOpenIDToken> => {
  if (requireBinding) await assertBinding(mx);
  const token = await mx.http.authedRequest<IOpenIDToken>(
    Method.Post,
    `/user/${encodeURIComponent(mx.getSafeUserId())}/openid/request_token`,
    undefined,
    { [OPENID_AUDIENCE_FIELD]: audience }
  );
  if (requireBinding) await assertBinding(mx);
  return token;
};
