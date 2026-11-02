// @vitest-environment jsdom

import React from 'react';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../../hooks/useMatrixClient';
import { InviteCard, makeInviteData } from './Invites';

vi.mock('../../../components/page', () => ({}));
vi.mock('../../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../../components/room-avatar', () => ({ RoomAvatar: () => null }));
vi.mock('../../../components/room-topic-viewer', () => ({ RoomTopicViewer: () => null }));
vi.mock('../../../components/message', () => ({ Time: () => null }));

// Bidi isolates: the card isolates the name (FSI...PDI) and keeps the ID left-to-right (LRI...PDI).
const FSI = '\u2068';
const LRI = '\u2066';
const PDI = '\u2069';

it.each([
  [
    'a display name',
    '@maya:matrix.localhost',
    'Maya',
    `${FSI}Maya${PDI} (${LRI}@maya:matrix.localhost${PDI})`,
  ],
  ['no display name', '@maya:matrix.localhost', undefined, '@maya:matrix.localhost'],
  // A display name shaped like someone else's ID still shows the real ID.
  [
    'an ID-shaped name',
    '@mallory:evil.example',
    '@maya:matrix.localhost',
    `${FSI}@maya:matrix.localhost${PDI} (${LRI}@mallory:evil.example${PDI})`,
  ],
  // Bidi controls in the name would reorder the ID; a leading PDI would close the isolate early.
  [
    'a name with bidi controls',
    '@mallory:evil.example',
    `${PDI}\u202B\u2067Maya (@maya:matrix.localhost)\u200E\u200F`,
    `${FSI}Maya (@maya:matrix.localhost)\u200E\u200F${PDI} (${LRI}@mallory:evil.example${PDI})`,
  ],
  // A paragraph separator in the name would end every isolate around it.
  [
    'paragraph separators in the name',
    '@mallory:evil.example',
    'Maya (@maya:matrix.localhost)\u0085\u2029\u200F',
    `${FSI}Maya (@maya:matrix.localhost)\u200F${PDI} (${LRI}@mallory:evil.example${PDI})`,
  ],
  // A long name would push the real ID off-screen; it is cut at 64 characters.
  [
    'a long name',
    '@mallory:evil.example',
    `Maya (@maya:matrix.localhost)${' \u2800'.repeat(3000)}`,
    `${FSI}Maya (@maya:matrix.localhost)${' \u2800'.repeat(
      17
    )} …${PDI} (${LRI}@mallory:evil.example${PDI})`,
  ],
])('shows an inviter with %s next to the real ID', (_case, inviterId, displayname, expected) => {
  const myUserId = '@me:matrix.localhost';
  const mx = createClient({ baseUrl: 'https://matrix.example', userId: myUserId });
  const roomId = '!invite:matrix.localhost';
  const room = new Room(roomId, mx, myUserId);
  // Stripped invite state: the server includes the inviter's member event.
  room.currentState.setStateEvents([
    new MatrixEvent({
      room_id: roomId,
      type: 'm.room.member',
      state_key: inviterId,
      sender: inviterId,
      content: { membership: 'join', displayname },
    }),
    new MatrixEvent({
      room_id: roomId,
      type: 'm.room.member',
      state_key: myUserId,
      sender: inviterId,
      content: { membership: 'invite' },
    }),
  ]);

  const renderer = create(
    <MatrixClientProvider value={mx}>
      <InviteCard
        invite={makeInviteData(mx, room, false)}
        hour24Clock={false}
        dateFormatString="D MMM YYYY"
        onNavigate={vi.fn()}
        hideAvatar={false}
      />
    </MatrixClientProvider>
  );

  const sender = renderer.root.find((node) => node.type === 'b' && node.props.title !== undefined);
  expect(sender.children).toEqual([expected]);
  expect(sender.props.title).toBe(inviterId);
});
