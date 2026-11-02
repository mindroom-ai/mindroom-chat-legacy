import React from 'react';
import { createRoot } from 'react-dom/client';
import { Box } from 'folds';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import i18n from '../../src/app/i18n';
import { LightTheme } from '../../src/app/hooks/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { MatrixClientProvider } from '../../src/app/hooks/useMatrixClient';
import { InviteCard, makeInviteData } from '../../src/app/pages/client/inbox/Invites';

// Bidi fixture for invite cards: each inviter's display name could reorder
// the real Matrix ID shown after it, in a left-to-right or right-to-left locale.
// Query parameter: `lang` (default en).

applyThemeToDom(LightTheme);

const myUserId = '@me:matrix.localhost';
const mx = createClient({ baseUrl: 'https://matrix.example', userId: myUserId });

const inviters: Array<[userId: string, displayName: string]> = [
  ['@maya:matrix.localhost', 'Maya'],
  ['@maya:matrix.localhost', 'مايا'],
  ['@mallory:evil.example', '⁧Maya (@maya:matrix.localhost)‎‏'],
  ['@mallory:evil.example', '⁩‫Maya (@maya:matrix.localhost)'],
  ['@mallory:evil.example', 'Maya (@maya:matrix.localhost)\u0085\u2029\u200F'],
];

const invites = inviters.map(([inviterId, displayname], index) => {
  const roomId = `!invite-${index}:matrix.localhost`;
  const room = new Room(roomId, mx, myUserId);
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
  return makeInviteData(mx, room, false);
});

function Fixture() {
  return (
    <MatrixClientProvider value={mx}>
      <Box direction="Column" gap="200" style={{ padding: 16, maxWidth: 720 }}>
        {invites.map((invite) => (
          <InviteCard
            key={invite.roomId}
            invite={invite}
            hour24Clock={false}
            dateFormatString="D MMM YYYY"
            onNavigate={() => undefined}
            hideAvatar={false}
          />
        ))}
      </Box>
    </MatrixClientProvider>
  );
}

i18n.changeLanguage(new URLSearchParams(window.location.search).get('lang') ?? 'en').then(() => {
  createRoot(document.getElementById('root')!).render(<Fixture />);
});
