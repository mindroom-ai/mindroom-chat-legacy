import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { describe, expect, it } from 'vitest';
import {
  MINDROOM_AUTO_APPROVE_EVENT,
  openAutoApproveWindowsInThread,
  parseAutoApproveStateEvent,
  type AutoApproveWindow,
} from './autoApproveContract';

const ROUTER = '@mindroom_router:example.org';
const ALICE = '@alice:example.org';

const window = (overrides: Record<string, unknown> = {}) => ({
  thread_id: '$thread',
  requester_id: ALICE,
  // The router writes Python's isoformat(), with microseconds.
  expires_at: '2026-10-22T15:30:00.123456+00:00',
  ...overrides,
});

const windowsEvent = (windows: unknown) =>
  new MatrixEvent({
    content: { windows },
    event_id: '$windows',
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: ROUTER,
    state_key: ROUTER,
    type: MINDROOM_AUTO_APPROVE_EVENT,
  });

describe('parseAutoApproveStateEvent', () => {
  it('parses each listed window with its end as a timestamp', () => {
    expect(
      parseAutoApproveStateEvent(windowsEvent([window(), window({ thread_id: null })]))
    ).toEqual([
      {
        threadId: '$thread',
        requesterId: ALICE,
        expiresAt: Date.parse('2026-10-22T15:30:00.123Z'),
      },
      { threadId: null, requesterId: ALICE, expiresAt: Date.parse('2026-10-22T15:30:00.123Z') },
    ]);
  });

  it('drops malformed windows and keeps the rest', () => {
    const windows = [
      window(),
      window({ expires_at: 'soon' }),
      window({ requester_id: 7 }),
      window({ thread_id: undefined }),
      'nonsense',
    ];
    expect(parseAutoApproveStateEvent(windowsEvent(windows))).toHaveLength(1);
    expect(parseAutoApproveStateEvent(windowsEvent('nonsense'))).toEqual([]);
  });
});

describe('openAutoApproveWindowsInThread', () => {
  const at = (iso: string) => Date.parse(iso);
  const windows: AutoApproveWindow[] = [
    { threadId: '$thread', requesterId: '@bob:example.org', expiresAt: at('2026-10-22T16:00:00Z') },
    { threadId: '$thread', requesterId: ALICE, expiresAt: at('2026-10-22T15:30:00Z') },
    { threadId: '$other', requesterId: ALICE, expiresAt: at('2026-10-22T16:00:00Z') },
    {
      threadId: '$thread',
      requesterId: '@carol:example.org',
      expiresAt: at('2026-10-22T15:00:00Z'),
    },
  ];

  it('keeps the thread’s windows that have not ended, the earliest-ending first', () => {
    const open = openAutoApproveWindowsInThread(windows, '$thread', at('2026-10-22T15:00:00Z'));
    expect(open.map((item) => item.requesterId)).toEqual([ALICE, '@bob:example.org']);
  });
});
