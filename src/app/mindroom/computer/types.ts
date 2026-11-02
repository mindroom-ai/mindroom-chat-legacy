import type { IOpenIDToken } from 'matrix-js-sdk';

export type ComputerState = 'starting' | 'ready' | 'stopped';
export type ComputerMode = 'view' | 'control';
export type ComputerControlAction = 'take' | 'release' | 'stop';

export type ComputerStatus = {
  session_id: string;
  state: ComputerState;
  mode: ComputerMode;
  expires_at: number;
};

export type ComputerSession = ComputerStatus & {
  session_token: string;
};

export type ComputerStreamTicket = {
  ticket: string;
  expires_at: number;
};

export type ComputerStreamConnection = {
  url: string;
  protocols: [string, string];
};

export type CreateComputerSessionRequest = {
  openid_token: IOpenIDToken;
  room_id: string;
  agent_user_id: string;
};

export type ComputerAgent = {
  userId: string;
  name: string;
  /** The server this agent published, when Chat found it there rather than in a configured URL. */
  serverUrl?: string;
};
