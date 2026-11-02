// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientLayout } from './ClientLayout';
import { resolveRootRouteRedirect } from '../routeSessionGuards';
import { getActiveSession, putSession, updateSessionLastPath } from '../../state/sessions';

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../../hooks/useSessionStore', async () => {
  const sessions = await import('../../state/sessions');
  return { useActiveSession: () => sessions.getActiveSession() };
});

const ROOM_PATH = '/home/!room%3Aexample.org';

const visit = async (path: string) => {
  await act(async () => {
    create(
      <MemoryRouter initialEntries={[path]}>
        <ClientLayout nav={null}>{null}</ClientLayout>
      </MemoryRouter>
    );
  });
};

afterEach(() => localStorage.clear());

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
});
