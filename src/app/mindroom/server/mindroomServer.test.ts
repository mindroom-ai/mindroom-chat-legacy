import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  MINDROOM_SERVER_EVENT,
  distinctServerUrls,
  isLoopbackOrigin,
  parseMindroomServer,
  selectMindroomServers,
} from './mindroomServer';

const agent = '@mindroom_code:example.org';

const serverEvent = (
  content: Record<string, unknown>,
  { sender = agent, ts = 1 }: { sender?: string; ts?: number } = {}
) =>
  new MatrixEvent({
    type: MINDROOM_SERVER_EVENT,
    state_key: sender,
    sender,
    room_id: '!room:example.org',
    event_id: `$server${ts}`,
    origin_server_ts: ts,
    content,
  });

describe('MindRoom server state', () => {
  it('reads the origin and computer an agent publishes', () => {
    expect(
      parseMindroomServer(serverEvent({ api_origin: 'http://localhost:8765', computer: true }))
    ).toEqual({ agentUserId: agent, apiUrl: 'http://localhost:8765', computer: true, ts: 1 });
    expect(
      parseMindroomServer(serverEvent({ api_origin: 'https://mind.example.org', computer: 'yes' }))
        ?.computer
    ).toBe(false);
  });

  it.each([
    ['a public plain HTTP origin', { api_origin: 'http://mind.example.org' }],
    ['an origin with a path', { api_origin: 'https://mind.example.org/app' }],
    ['no origin', {}],
  ])('ignores %s', (_case, content) => {
    expect(parseMindroomServer(serverEvent(content))).toBeUndefined();
  });

  it('orders the servers newest first', () => {
    const servers = selectMindroomServers([
      serverEvent({ api_origin: 'http://localhost:8765' }, { ts: 1 }),
      serverEvent(
        { api_origin: 'https://mind.example.org' },
        { sender: '@mindroom_web:example.org', ts: 2 }
      ),
      serverEvent({}, { sender: '@mindroom_bad:example.org', ts: 3 }),
    ]);
    expect(servers.map((server) => server.apiUrl)).toEqual([
      'https://mind.example.org',
      'http://localhost:8765',
    ]);
  });

  it('lists each origin once, newest first', () => {
    const server = (apiUrl: string, ts: number) => ({
      agentUserId: agent,
      apiUrl,
      computer: false,
      ts,
    });
    expect(
      distinctServerUrls([
        server('http://localhost:8765', 1),
        server('https://mind.example.org', 3),
        server('http://localhost:8765', 2),
      ])
    ).toEqual(['https://mind.example.org', 'http://localhost:8765']);
  });

  it.each([
    ['http://localhost:8765', true],
    ['http://127.0.0.1:8765', true],
    ['http://[::1]:8765', true],
    ['http://[::ffff:127.0.0.1]:8765', true],
    ['https://localhost.:8765', true],
    ['https://127.example.org', false],
    ['http://192.168.1.50:8765', false],
    ['https://mind.example.org', false],
  ])('tells whether %s is this device', (origin, loopback) => {
    expect(isLoopbackOrigin(origin)).toBe(loopback);
  });
});
