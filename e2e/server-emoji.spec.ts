import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, getSecondaryCredentials } from './env';
import {
  expectLoggedInShellStable,
  loginWithPassword,
  setFullInterfaceModeForCredentials,
} from './helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from './helpers/browserDiagnostics';
import {
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  sendStateEvent,
  type MatrixSession,
} from './helpers/matrix';

type PackContent = { images?: Record<string, { url: string }> };

type PowerLevels = { events?: Record<string, number>; events_default?: number };

type Annotations = {
  chunk: Array<{ sender: string; content: { 'm.relates_to'?: { key?: string } } }>;
};

// A 32x32 PNG of a yellow face.
const EMOJI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAvUlEQVR42u2XzQ2AIAyFGcKz8eiIjuUg7oQnjVEKr39SE0l6a30fUEub0pfWuqSMmLto3qaimcMgogiMSpwrTIF0ERdBWIuzILzEIQhv8SZECIBa4DwOp2l8DgjW7q8fpgQQH/IUQgCgx28B8LgGJPksc0AE4PE3/ACxAO4QaDKhySuqA1oIKr5Yjt8GgB8jKQRr9wgAB6IWI+oJ0BLb8lN3RaV6j74Bpn0hR7h7Z2wyG3QZTEKMZiGGU++1A80Cfm5xLM63AAAAAElFTkSuQmCC',
  'base64'
);

// The client reads the emoji room from the well-known of the user's server name
// (`matrix.localhost`), which does not resolve in the Docker stack.
const serveEmojiWellKnown = async (context: BrowserContext, homeserver: string, room: string) => {
  await context.route('**/.well-known/matrix/client', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        'm.homeserver': { base_url: homeserver },
        'io.mindroom.emoji': { room },
      }),
    })
  );
};

const joinedRoomIds = async (homeserver: string, session: MatrixSession) =>
  (
    await matrixFetch<{ joined_rooms: string[] }>(homeserver, '/joined_rooms', {
      accessToken: session.accessToken,
    })
  ).joined_rooms;

const openSharedRoom = async (page: Page, roomId: string, userId: string) => {
  // Classic view renders the message as a plain timeline row with the hover toolbar.
  await seedRoomOverviewState({ page, roomId, userId, viewMode: 'classic' });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
};

const openReactionPicker = async (page: Page, messageId: string) => {
  const row = page.locator(`[data-message-id="${messageId}"]`);
  await row.hover();
  await row.getByRole('button', { name: 'Add Reaction', exact: true }).click();
};

test("an emoji one user adds is in everyone's picker without setup", async ({ browser }) => {
  const secondaryCredentials = getSecondaryCredentials();
  test.skip(
    !secondaryCredentials,
    'Set E2E_SECOND_USERNAME and E2E_SECOND_PASSWORD to run the server emoji e2e flow.'
  );
  test.slow();
  const homeserver = getHomeserver();
  const primaryCredentials = getPrimaryCredentials();
  const primary = await loginToMatrix(
    homeserver,
    primaryCredentials.username,
    primaryCredentials.password
  );
  const secondary = await loginToMatrix(
    homeserver,
    secondaryCredentials!.username,
    secondaryCredentials!.password
  );
  await Promise.all([
    setFullInterfaceModeForCredentials(homeserver, primaryCredentials),
    setFullInterfaceModeForCredentials(homeserver, secondaryCredentials!),
  ]);

  // The room an operator creates for a homeserver: typed, local, with an empty pack that
  // everyone may add to, and posting limited to moderators. Its other power levels are read
  // and kept, since an override at creation would replace the server's defaults.
  const stamp = Date.now();
  const server = primary.userId.slice(primary.userId.indexOf(':') + 1);
  const emojiRoomAlias = `#emoji-${stamp}:${server}`;
  const emojiRoomName = `Emoji ${stamp}`;
  const { room_id: emojiRoomId } = await matrixFetch<{ room_id: string }>(
    homeserver,
    '/createRoom',
    {
      method: 'POST',
      accessToken: primary.accessToken,
      body: JSON.stringify({
        name: emojiRoomName,
        room_alias_name: `emoji-${stamp}`,
        preset: 'public_chat',
        visibility: 'private',
        creation_content: { type: 'io.mindroom.emoji', 'm.federate': false },
        initial_state: [
          {
            type: 'im.ponies.room_emotes',
            state_key: '',
            content: { pack: { display_name: 'Example Emoji', usage: ['emoticon'] }, images: {} },
          },
        ],
      }),
    }
  );
  const powerLevels = await matrixFetch<PowerLevels>(
    homeserver,
    `/rooms/${encodeURIComponent(emojiRoomId)}/state/m.room.power_levels/`,
    { accessToken: primary.accessToken }
  );
  await sendStateEvent(homeserver, primary.accessToken, emojiRoomId, 'm.room.power_levels', '', {
    ...powerLevels,
    events: { ...powerLevels.events, 'im.ponies.room_emotes': 0 },
    events_default: Math.max(powerLevels.events_default ?? 0, 50),
  });
  const readPack = () =>
    matrixFetch<PackContent>(
      homeserver,
      `/rooms/${encodeURIComponent(emojiRoomId)}/state/im.ponies.room_emotes/`,
      { accessToken: primary.accessToken }
    );

  // A room the two users share, with one message to react to.
  const sharedRoomName = `Shared ${stamp}`;
  const sharedRoomId = await createPrivateRoom(homeserver, primary.accessToken, {
    name: sharedRoomName,
    topic: 'Live fixture for server emoji.',
    invite: [secondary.userId],
  });
  await joinRoom(homeserver, secondary.accessToken, sharedRoomId);
  const messageId = await sendRoomMessage(
    homeserver,
    primary.accessToken,
    sharedRoomId,
    { msgtype: 'm.text', body: `server emoji e2e ${stamp}` },
    'server-emoji-e2e'
  );

  let primaryContext: BrowserContext | undefined;
  let secondaryContext: BrowserContext | undefined;
  try {
    primaryContext = await browser.newContext();
    await serveEmojiWellKnown(primaryContext, homeserver, emojiRoomAlias);
    const primaryPage = await primaryContext.newPage();
    const primaryDiagnostics = attachBrowserDiagnostics(primaryPage);
    await loginWithPassword(primaryPage, { homeserver, ...primaryCredentials });
    await expectLoggedInShellStable(primaryPage);
    await openSharedRoom(primaryPage, sharedRoomId, primary.userId);

    // The primary user adds an emoji from the reaction picker; the form says who can use it.
    await openReactionPicker(primaryPage, messageId);
    const fileChooser = primaryPage.waitForEvent('filechooser');
    await primaryPage.getByRole('button', { name: 'Add custom emoji', exact: true }).click();
    await (
      await fileChooser
    ).setFiles({ name: 'party parrot.png', mimeType: 'image/png', buffer: EMOJI_PNG });
    await expect(
      primaryPage.getByText(`Everyone on ${server} can use it in every room.`)
    ).toBeVisible();
    await primaryPage.getByRole('button', { name: 'Add', exact: true }).click();

    // The server pack now holds it.
    await expect
      .poll(async () => (await readPack()).images?.['party-parrot']?.url ?? '', {
        timeout: 30_000,
      })
      .toMatch(/^mxc:\/\//);
    const emojiUrl = (await readPack()).images!['party-parrot'].url;

    // The secondary user has done nothing: their client joins the room and the emoji is in
    // their picker.
    secondaryContext = await browser.newContext();
    await serveEmojiWellKnown(secondaryContext, homeserver, emojiRoomAlias);
    const secondaryPage = await secondaryContext.newPage();
    const secondaryDiagnostics = attachBrowserDiagnostics(secondaryPage);
    await loginWithPassword(secondaryPage, { homeserver, ...secondaryCredentials! });
    await expectLoggedInShellStable(secondaryPage);
    // The join is asynchronous and opening the shared room reloads the app, so wait for the join
    // first; the reloaded app then starts with the emoji room already joined.
    await expect
      .poll(async () => (await joinedRoomIds(homeserver, secondary)).includes(emojiRoomId), {
        timeout: 30_000,
      })
      .toBe(true);
    await openSharedRoom(secondaryPage, sharedRoomId, secondary.userId);
    await openReactionPicker(secondaryPage, messageId);
    await secondaryPage.getByPlaceholder('Search or Text Reaction').fill('party-parrot');
    const emojiButton = secondaryPage.getByRole('button', { name: 'party-parrot emoji' }).first();
    await expect(emojiButton).toBeVisible();
    await emojiButton.click();

    await expect
      .poll(
        async () => {
          const { chunk } = await matrixFetch<Annotations>(
            homeserver,
            `/rooms/${encodeURIComponent(sharedRoomId)}/relations/${encodeURIComponent(
              messageId
            )}/m.annotation`,
            { accessToken: secondary.accessToken, apiVersion: 'v1' }
          );
          return chunk
            .filter((event) => event.sender === secondary.userId)
            .map((event) => event.content['m.relates_to']?.key);
        },
        { timeout: 30_000 }
      )
      .toEqual([emojiUrl]);

    // The custom emoji is now among the secondary user's quick reactions in the message menu.
    const row = secondaryPage.locator(`[data-message-id="${messageId}"]`);
    await row.hover();
    await row.getByRole('button', { name: 'More Options', exact: true }).click();
    const quickReaction = secondaryPage.getByRole('button', { name: 'party-parrot', exact: true });
    await expect(quickReaction).toBeVisible();
    await expect(quickReaction.locator('img')).toHaveAttribute('alt', 'party-parrot');
    await secondaryPage.keyboard.press('Escape');

    // Both users are in the emoji room, and neither sidebar lists it next to the shared room.
    for (const [page, session] of [
      [primaryPage, primary],
      [secondaryPage, secondary],
    ] as const) {
      expect(await joinedRoomIds(homeserver, session)).toContain(emojiRoomId);
      await expect(page.getByRole('link', { name: sharedRoomName, exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: emojiRoomName, exact: true })).toHaveCount(0);
    }

    const emojiWarnings = [
      ...primaryDiagnostics.consoleWarnings,
      ...secondaryDiagnostics.consoleWarnings,
    ].filter((message) => message.includes('[server-emoji]'));
    expect(emojiWarnings).toEqual([]);
    await expectNoUnexpectedBrowserDiagnostics(primaryDiagnostics, 'server emoji adder');
    await expectNoUnexpectedBrowserDiagnostics(secondaryDiagnostics, 'server emoji user');
  } finally {
    await secondaryContext?.close();
    await primaryContext?.close();
  }
});
