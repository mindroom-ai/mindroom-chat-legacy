import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';

/** The room's open `!auto_approve` windows, as state the MindRoom router keys by its own user ID. */
export const MINDROOM_AUTO_APPROVE_EVENT = 'io.mindroom.auto_approve';

/** One person's window in which their tool calls in a thread run without approval cards. */
export type AutoApproveWindow = {
  threadId: string | null;
  requesterId: string;
  expiresAt: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseWindow = (value: unknown): AutoApproveWindow | undefined => {
  if (!isRecord(value)) return undefined;
  const { thread_id: threadId, requester_id: requesterId, expires_at: expiresAt } = value;
  if (
    !(typeof threadId === 'string' || threadId === null) ||
    typeof requesterId !== 'string' ||
    typeof expiresAt !== 'string'
  ) {
    return undefined;
  }
  const timestamp = Date.parse(expiresAt);
  return Number.isNaN(timestamp) ? undefined : { threadId, requesterId, expiresAt: timestamp };
};

/** Read one router's windows from state `agentRoomState` already checked the router published about itself. */
export const parseAutoApproveStateEvent = (event: MatrixEvent): AutoApproveWindow[] => {
  const windows = event.getContent().windows;
  if (!Array.isArray(windows)) return [];
  return windows.flatMap((value) => parseWindow(value) ?? []);
};

/** Every window of the routers' auto-approve state. */
export const selectAutoApproveWindows = (events: MatrixEvent[]): AutoApproveWindow[] =>
  events.flatMap(parseAutoApproveStateEvent);

/** The windows still open in one thread, the earliest-ending first. */
export const openAutoApproveWindowsInThread = (
  windows: AutoApproveWindow[],
  threadId: string,
  now: number
): AutoApproveWindow[] =>
  windows
    .filter((window) => window.threadId === threadId && window.expiresAt > now)
    .sort((a, b) => a.expiresAt - b.expiresAt);
