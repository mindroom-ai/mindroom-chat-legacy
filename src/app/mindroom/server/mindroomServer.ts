import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { resolveComputerApiUrl } from '../computer/api';

/** Each MindRoom agent's server in a room, as state keyed by the agent's own user ID. */
export const MINDROOM_SERVER_EVENT = 'io.mindroom.server';

export type MindroomServer = {
  agentUserId: string;
  apiUrl: string;
  computer: boolean;
  ts: number;
};

/** Read one agent's server from state `agentRoomState` already checked the agent published about itself. */
export const parseMindroomServer = (event: MatrixEvent): MindroomServer | undefined => {
  const { api_origin: origin, computer } = event.getContent();
  const apiUrl = typeof origin === 'string' ? resolveComputerApiUrl(origin) : undefined;
  if (!apiUrl) return undefined;
  return {
    agentUserId: event.getSender()!,
    apiUrl,
    computer: computer === true,
    ts: event.getTs(),
  };
};

/** The servers the agents' state names, newest first. */
export const selectMindroomServers = (events: MatrixEvent[]): MindroomServer[] =>
  events.flatMap((event) => parseMindroomServer(event) ?? []).sort((a, b) => b.ts - a.ts);

/** Whether an origin is this device itself, which a published server must not be for a phone. */
export const isLoopbackOrigin = (origin: string): boolean => {
  // A trailing dot names the same host, as in localhost.
  const hostname = new URL(origin).hostname.replace(/\.$/, '');
  // URL parsing writes an IPv4-mapped loopback such as [::ffff:127.0.0.1] as [::ffff:7f..].
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname.startsWith('[::ffff:7f') ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
};

/** Each distinct server origin, newest first. */
export const distinctServerUrls = (servers: MindroomServer[]): string[] => [
  ...new Set([...servers].sort((a, b) => b.ts - a.ts).map((server) => server.apiUrl)),
];
