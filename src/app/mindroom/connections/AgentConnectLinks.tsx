import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { useComputerApiUrls } from '../computer/useComputerApiUrl';
import { useOpenConnectionsPortal } from './useOpenConnectionsPortal';

const AGENT_LINK_PATH = /^\/api\/oauth\/[^/]+\/(authorize|reset)$/;
const LINK_TOKEN = { authorize: 'connect_token', reset: 'reset_token' } as const;
const PERSONAL_SCOPES = new Set(['user', 'user_agent']);

/**
 * The backend from `backendUrls` that an agent's personal connect or reset link at `href` points at, or `undefined`.
 * Such a link works only in a browser signed in as the person the agent gave it to.
 * Shared links need no sign-in and other OAuth links use the dashboard login, so they are not matched.
 */
export function agentLinkBackend(href: string, backendUrls: string[]): string | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  const action = AGENT_LINK_PATH.exec(url.pathname)?.[1] as keyof typeof LINK_TOKEN | undefined;
  if (!action || !url.searchParams.get(LINK_TOKEN[action])) return undefined;
  if (!PERSONAL_SCOPES.has(url.searchParams.get('execution_scope') ?? '')) return undefined;
  return backendUrls.find((backendUrl) => new URL(backendUrl).origin === url.origin);
}

/**
 * Open a clicked connect or reset link from an agent through the backend's Connections portal, which signs the
 * browser in as the Chat user and then opens the link, instead of a page asking for the dashboard login.
 * Clicks meant for a new tab or window, and every other link, are left to the browser.
 */
export function AgentConnectLinkFeature() {
  const { urls, discovered } = useComputerApiUrls();
  const openPortal = useOpenConnectionsPortal(discovered);
  const latest = useRef({ urls, openPortal });
  latest.current = { urls, openPortal };

  useEffect(() => {
    // The native shells have no pop-up window to hand a token to.
    if (Capacitor.isNativePlatform()) return undefined;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const backendUrl = agentLinkBackend(anchor.href, latest.current.urls);
      if (!backendUrl) return;
      const link = new URL(anchor.href);
      // A blocked window leaves the click to the browser, which opens the link itself.
      if (latest.current.openPortal(backendUrl, `${link.pathname}${link.search}`) === 'opened') {
        event.preventDefault();
      }
    };
    // Capture runs before message renderers, which may stop the click from bubbling.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return null;
}
