// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientLayout } from './ClientLayout';
import { resolveRootRouteRedirect } from '../routeSessionGuards';
import {
  SESSION_STORE_KEY,
  getActiveSession,
  putSession,
  updateSessionLastPath,
} from '../../state/sessions';

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../hooks/useMatrixClient', () => {
  // The provider hands every render the same client.
  const mx = {};
  return { useMatrixClient: () => mx };
});
vi.mock('../../hooks/useSessionStore', async () => {
  const sessions = await import('../../state/sessions');
  return {
    useActiveSession: () =>
      React.useSyncExternalStore(sessions.subscribeToSessionStore, sessions.getActiveSession),
  };
});

const ROOM_PATH = '/home/!room%3Aexample.org';

const renderers: ReactTestRenderer[] = [];

const visit = async (path: string) => {
  await act(async () => {
    renderers.push(
      create(
        <MemoryRouter initialEntries={[path]}>
          <ClientLayout nav={null}>{null}</ClientLayout>
        </MemoryRouter>
      )
    );
  });
};

afterEach(() => {
  act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
  localStorage.clear();
});

describe('ClientLayout', () => {
  it('remembers the route a session last showed', async () => {
    putSession({
      baseUrl: 'https://matrix.example.org',
      userId: '@alice:example.org',
      deviceId: 'DEVICE',
      accessToken: 'fake',
    });
    await visit(ROOM_PATH);
    expect(getActiveSession()?.lastKnownPath).toBe(ROOM_PATH);
  });

  it.each(['/connections', '/connections/'])(
    'keeps the earlier route through %s, which hands the tab to the portal',
    async (path) => {
      putSession({
        baseUrl: 'https://matrix.example.org',
        userId: '@alice:example.org',
        deviceId: 'DEVICE',
        accessToken: 'fake',
      });
      updateSessionLastPath(getActiveSession()!.sessionId, ROOM_PATH);
      await visit(path);
      expect(getActiveSession()?.lastKnownPath).toBe(ROOM_PATH);
      // Opening Chat's root, as Back from the portal does, returns to the room instead of the hand-off.
      expect(resolveRootRouteRedirect('https://chat.example.org/').redirectTo).toBe(ROOM_PATH);
    }
  );

  it('leaves a route another tab saved, so open tabs do not overwrite each other', async () => {
    putSession({
      baseUrl: 'https://matrix.example.org',
      userId: '@alice:example.org',
      deviceId: 'DEVICE',
      accessToken: 'fake',
    });
    await visit(ROOM_PATH);

    // Every write rewrites the whole account list. Writing this tab's route back
    // on another tab's change ping-pongs between tabs and lets a stale copy
    // restore an account that one of them just signed out.
    const otherTabPath = '/home/!other%3Aexample.org';
    await act(async () => {
      const store = JSON.parse(localStorage.getItem(SESSION_STORE_KEY)!);
      store.sessions[0].lastKnownPath = otherTabPath;
      localStorage.setItem(SESSION_STORE_KEY, JSON.stringify(store));
      window.dispatchEvent(new StorageEvent('storage', { key: SESSION_STORE_KEY }));
    });

    expect(getActiveSession()?.lastKnownPath).toBe(otherTabPath);
  });
});
