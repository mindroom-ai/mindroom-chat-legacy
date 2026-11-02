import { describe, expect, it, vi } from 'vitest';
import type { IOpenIDToken } from 'matrix-js-sdk';
import { createComputerSession, resolveComputerApiUrl } from './api';

const openIdToken: IOpenIDToken = {
  access_token: 'short-lived-openid-token',
  token_type: 'Bearer',
  matrix_server_name: 'example.org',
  expires_in: 3600,
};

const response = (status: number, body?: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);

describe('computer api URL', () => {
  it.each([
    ['https://computer.example.org', 'https://computer.example.org'],
    ['https://computer.example.org/', 'https://computer.example.org'],
    ['http://localhost:8766', 'http://localhost:8766'],
    ['http://127.0.0.1:8766', 'http://127.0.0.1:8766'],
    ['http://[::1]:8766', 'http://[::1]:8766'],
    ['http://10.0.0.1:8766', 'http://10.0.0.1:8766'],
    ['http://172.16.0.1', 'http://172.16.0.1'],
    ['http://172.31.255.254', 'http://172.31.255.254'],
    ['http://192.168.1.50:8765/', 'http://192.168.1.50:8765'],
    ['http://[fc00::1]:8766', 'http://[fc00::1]:8766'],
    ['http://[fd12:3456::1]', 'http://[fd12:3456::1]'],
  ])('accepts an exact trusted origin: %s', (configured, expected) => {
    expect(resolveComputerApiUrl(configured)).toBe(expected);
  });

  it.each([
    undefined,
    '',
    'http://computer.example.org',
    'http://computer.local',
    'http://10.0.0.example',
    'http://10.0.0.-1',
    'http://10.0.0.+1',
    'http://10.0.0.1e1',
    'http://8.8.8.8',
    'http://172.15.255.255',
    'http://172.32.0.1',
    'http://192.167.1.1',
    'http://192.169.1.1',
    'http://100.64.0.1',
    'http://169.254.169.254',
    'http://[2001:db8::1]',
    'http://[fd::1]',
    'http://[fe80::1]',
    'http://user:password@192.168.1.50',
    'http://192.168.1.50/api',
    'http://192.168.1.50/?token=secret',
    'http://192.168.1.50/#fragment',
    'https://user:password@computer.example.org',
    'https://computer.example.org/api',
    'https://computer.example.org/?token=secret',
    'https://computer.example.org/#fragment',
    'ws://computer.example.org',
    'not a url',
  ])('rejects a missing, malformed, or insecure remote origin: %s', (configured) => {
    expect(resolveComputerApiUrl(configured)).toBeUndefined();
  });
});

describe('computer session client', () => {
  it.each([
    ['https://computer.example.org', 'wss://computer.example.org'],
    ['http://192.168.1.50:8765', 'ws://192.168.1.50:8765'],
  ])(
    'uses OpenID then session credentials, with the matching stream protocol: %s',
    async (apiUrl, streamUrl) => {
      const request = vi
        .fn()
        .mockResolvedValueOnce(
          response(200, {
            session_id: 'session-1',
            session_token: 'session-secret',
            state: 'ready',
            mode: 'view',
            expires_at: 2_000_000_000,
          })
        )
        .mockResolvedValueOnce(
          response(200, {
            ticket: 'one-use-ticket',
            expires_at: 2_000_000_000,
          })
        );

      const client = await createComputerSession({
        apiUrl,
        agentUserId: '@mindroom_helper:example.org',
        openIdToken,
        request: request as unknown as typeof fetch,
        roomId: '!room:example.org',
      });
      const stream = await client.createStream();

      const createCall = request.mock.calls[0];
      expect(createCall[0]).toBe(`${apiUrl}/api/computers/sessions`);
      expect(createCall[1]).toMatchObject({
        cache: 'no-store',
        credentials: 'same-origin',
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });
      expect(JSON.parse(createCall[1].body)).toEqual({
        openid_token: openIdToken,
        room_id: '!room:example.org',
        agent_user_id: '@mindroom_helper:example.org',
      });
      expect(JSON.stringify(createCall)).not.toContain('matrix-session-token');

      expect(request.mock.calls[1]).toEqual([
        `${apiUrl}/api/computers/sessions/session-1/stream-ticket`,
        {
          cache: 'no-store',
          credentials: 'same-origin',
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: 'Bearer session-secret',
          },
        },
      ]);
      expect(stream).toEqual({
        protocols: ['binary', 'mindroom-ticket.one-use-ticket'],
        url: `${streamUrl}/api/computers/sessions/session-1/stream`,
      });
    }
  );

  it('reports control only after this client took it', async () => {
    const controlStatus = {
      session_id: 'session-1',
      state: 'ready',
      mode: 'control',
      expires_at: 1,
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(200, { ...controlStatus, session_token: 'session-secret' }))
      .mockResolvedValue(response(200, controlStatus));
    const client = await createComputerSession({
      apiUrl: 'https://computer.example.org',
      agentUserId: '@mindroom_helper:example.org',
      openIdToken,
      request: request as unknown as typeof fetch,
      roomId: '!room:example.org',
    });

    expect(client.status.mode).toBe('view');
    expect((await client.refreshStatus()).mode).toBe('view');
    expect((await client.control('take')).mode).toBe('control');
    expect((await client.refreshStatus()).mode).toBe('control');
    expect((await client.control('release')).mode).toBe('view');
    expect(client.status.mode).toBe('view');
  });
});
