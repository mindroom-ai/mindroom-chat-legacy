import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { color, configClass, varsClass } from 'folds';
import '@fontsource/inter/variable.css';
import 'folds/dist/style.css';
import '../../src/index.css';
import '../../src/app/i18n';
import { darkTheme, lightTheme } from '../../src/colors.css';
import { RoomSchedulesButton } from '../../src/app/mindroom/schedules/RoomSchedulesButton';
import { MINDROOM_SCHEDULED_TASK_EVENT } from '../../src/app/mindroom/threads/scheduledTaskContract';
import { MatrixClientProvider } from '../../src/app/hooks/useMatrixClient';
import { useRoomEscapeReadReceipts } from '../../src/app/mindroom/threads/useRoomEscapeReadReceipts';

const params = new URLSearchParams(window.location.search);
const dark = params.has('dark');
document.documentElement.className = `${configClass} ${varsClass} ${dark ? darkTheme : lightTheme}`;
const client = createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
const room = new Room('!schedules:example.org', client, '@alice:example.org');
const emptyRoom = new Room('!empty:example.org', client, '@alice:example.org');
client.store.storeRoom(room);
client.sendReceipt = async () => {
  window.dispatchEvent(new Event('fixture-receipt'));
  return {};
};
room.addLiveEvents(
  [
    new MatrixEvent({
      type: 'm.room.message',
      room_id: room.roomId,
      event_id: '$unread',
      sender: '@bob:example.org',
      origin_server_ts: 1,
      content: { msgtype: 'm.text', body: 'Unread fixture message' },
    }),
  ],
  { addToState: false }
);
const schedule = (
  id: string,
  workflow: Record<string, unknown>,
  status = 'pending',
  cron?: string
) =>
  new MatrixEvent({
    type: MINDROOM_SCHEDULED_TASK_EVENT,
    room_id: room.roomId,
    state_key: id,
    event_id: `$${id}-${status}`,
    sender: '@mindroom_agent:example.org',
    origin_server_ts: Date.now(),
    content: {
      status,
      created_at: '2026-09-15T12:00:00Z',
      updated_at:
        id === 'morning' ? '2026-09-16T12:00:00Z' : id === 'future' ? 'invalid' : undefined,
      cron_description: cron,
      workflow: JSON.stringify({ created_by: '@alice:example.org', ...workflow }),
    },
  });
room.currentState.setStateEvents([
  new MatrixEvent({
    type: 'm.room.member',
    room_id: room.roomId,
    state_key: '@alice:example.org',
    content: {
      membership: 'join',
      displayname: params.has('stress') ? 'Long display name '.repeat(20) : 'Alice',
    },
  }),
  schedule(
    'morning',
    {
      schedule_type: 'cron',
      message: 'Check the inbox.\nSummarize urgent messages.',
      description: 'Morning inbox',
      model: params.has('stress') ? 'custom-model-'.repeat(40) : 'cheap',
      cron_schedule: {
        minute: params.has('stress') ? Array.from({ length: 60 }, (_, i) => i).join(',') : '30',
        hour: '16',
        day: '*',
        month: '*',
        weekday: '1-5',
      },
      silent: true,
      history_limit: 0,
      thread_id: '$inbox',
    },
    'pending',
    'At 09:30, Monday through Friday (America/Los_Angeles)'
  ),
  schedule('overdue', {
    schedule_type: 'once',
    execute_at: '2000-01-01T12:00:00Z',
    message: 'Send the report',
    description: 'Report reminder',
    history_limit: null,
  }),
  schedule('future', {
    schedule_type: 'once',
    execute_at: '2099-01-01T12:00:00Z',
    new_thread: true,
    thread_id: '$previous-thread',
    message: `Review https://example.org/${'long-path-'.repeat(30)}\nThen post findings.`,
    description: 'Project review',
    history_limit: 12,
  }),
  schedule('cancelled', { description: 'Cancelled reminder' }, 'cancelled'),
  schedule('completed', { description: 'Completed reminder' }, 'completed'),
]);

function Fixture() {
  const [activeRoom, setActiveRoom] = useState(room);
  const [openedThread, setOpenedThread] = useState('');
  const [receiptCount, setReceiptCount] = useState(0);
  useRoomEscapeReadReceipts({ roomId: activeRoom.roomId, hideActivity: false });
  useEffect(() => {
    const receipt = () => setReceiptCount((count) => count + 1);
    const cancel = () => room.currentState.setStateEvents([schedule('overdue', {}, 'cancelled')]);
    const switchRoom = () => setActiveRoom(emptyRoom);
    window.addEventListener('cancel-schedule', cancel);
    window.addEventListener('switch-room', switchRoom);
    window.addEventListener('fixture-receipt', receipt);
    return () => {
      window.removeEventListener('cancel-schedule', cancel);
      window.removeEventListener('switch-room', switchRoom);
      window.removeEventListener('fixture-receipt', receipt);
    };
  }, []);
  return (
    <main style={{ padding: 16, color: color.Surface.OnContainer }}>
      <RoomSchedulesButton
        key={activeRoom.roomId}
        room={activeRoom}
        onOpenThread={(id) => setOpenedThread(`Opened ${id}`)}
      />
      <p role="status">{openedThread}</p>
      <output aria-label="Read receipts sent">{receiptCount}</output>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <MatrixClientProvider value={client}>
    <MemoryRouter>
      <Fixture />
    </MemoryRouter>
  </MatrixClientProvider>
);
