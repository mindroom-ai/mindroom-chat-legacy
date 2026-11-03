import React, { ReactNode, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Box } from 'folds';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useActiveSession } from '../../hooks/useSessionStore';
import { updateSessionLastPath } from '../../state/sessions';
import { buildSessionLastKnownPath } from './sessionRouteRestore';
import { CONNECTIONS_PATH } from '../paths';
import {
  canonicalizeSessionPathname,
  pathnameContainsAliasRoute,
  resolveCanonicalizedPathname,
} from '../../mindroom/routing/clientRouteRestore';

type ClientLayoutProps = {
  nav: ReactNode;
  children: ReactNode;
};

export function ClientLayout({ nav, children }: ClientLayoutProps) {
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { hash, pathname, search } = location;
  // The effects below key on the session ID, not the record: every write to the
  // account list in another tab replaces the record object here. Saving this
  // tab's route again on that ping-pongs whole account lists between tabs, so
  // a stale copy can restore an account another tab just signed out.
  const activeSessionId = useActiveSession()?.sessionId;
  const pathnameHasAliasRoute = useMemo(() => pathnameContainsAliasRoute(pathname), [pathname]);
  const [isCanonicalizingCurrentRoute, setIsCanonicalizingCurrentRoute] =
    useState(pathnameHasAliasRoute);

  useLayoutEffect(() => {
    if (!activeSessionId) {
      setIsCanonicalizingCurrentRoute(false);
      return;
    }

    if (!pathnameHasAliasRoute) {
      setIsCanonicalizingCurrentRoute(false);
      return;
    }

    let disposed = false;
    setIsCanonicalizingCurrentRoute(true);

    resolveCanonicalizedPathname(mx, pathname)
      .then((canonicalizedPathname) => {
        if (disposed) return;

        const canonicalizedLocation = buildSessionLastKnownPath({
          pathname: canonicalizedPathname,
          search,
          hash,
        });
        const currentLocation = buildSessionLastKnownPath({ pathname, search, hash });

        if (canonicalizedLocation !== currentLocation) {
          navigate(canonicalizedLocation, { replace: true });
          return;
        }

        setIsCanonicalizingCurrentRoute(false);
      })
      .catch(() => {
        if (disposed) return;
        setIsCanonicalizingCurrentRoute(false);
      });

    return () => {
      disposed = true;
    };
  }, [activeSessionId, hash, mx, navigate, pathname, pathnameHasAliasRoute, search]);

  useEffect(() => {
    // `/connections` hands the tab to the Connections portal, so restoring it would leave Chat again.
    if (!activeSessionId || matchPath(CONNECTIONS_PATH, pathname)) return;

    updateSessionLastPath(
      activeSessionId,
      buildSessionLastKnownPath({
        pathname: canonicalizeSessionPathname(mx, pathname),
        search,
        hash,
      })
    );
  }, [activeSessionId, hash, mx, pathname, search]);

  return (
    <Box grow="Yes">
      <Box shrink="No">{nav}</Box>
      <Box grow="Yes">{isCanonicalizingCurrentRoute ? null : children}</Box>
    </Box>
  );
}
