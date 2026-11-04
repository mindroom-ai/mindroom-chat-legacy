import { expect, test } from '@playwright/test';
import {
  getHomeserver,
  getPrimaryCredentials,
  getSecondaryCredentials,
  hasPrimaryCredentials,
} from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  setAccountData,
} from '../helpers/matrix';

for (const [themeId, width] of [
  ['dark-theme', 390],
  ['silver-theme', 1100],
] as const) {
  test('composer glass and live typing in ' + themeId, async ({ page }, testInfo) => {
    test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
    const secondary = getSecondaryCredentials();
    test.skip(!secondary, 'A second local Matrix account is required');
    if (!secondary) return;

    const homeserver = getHomeserver();
    test.skip(
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(homeserver).hostname),
      'Local fixture only'
    );
    const primary = getPrimaryCredentials();
    const [author, reader] = await Promise.all([
      loginToMatrix(homeserver, primary.username, primary.password),
      loginToMatrix(homeserver, secondary.username, secondary.password),
    ]);
    expect(reader.userId).not.toBe(author.userId);
    const accountSettings = await matrixFetch<Record<string, unknown>>(
      homeserver,
      `/user/${encodeURIComponent(author.userId)}/account_data/io.mindroom.settings`,
      { accessToken: author.accessToken }
    ).catch((error: Error) => {
      if (error.message.startsWith('Matrix API 404')) return {};
      throw error;
    });
    const roomId = await createPrivateRoom(homeserver, author.accessToken, {
      name: 'Design studio',
      topic: 'Planning the next design review',
      invite: [reader.userId],
    });
    let readerJoined = false;

    try {
      await setAccountData(homeserver, author.accessToken, author.userId, 'io.mindroom.settings', {
        ...accountSettings,
        simpleMode: false,
      });
      await joinRoom(homeserver, reader.accessToken, roomId);
      readerJoined = true;
      // Keep the sample name local to this room instead of changing the account profile.
      await matrixFetch(
        homeserver,
        `/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(
          reader.userId
        )}`,
        {
          method: 'PUT',
          accessToken: reader.accessToken,
          body: JSON.stringify({ membership: 'join', displayname: 'Avery' }),
        }
      );
      for (let index = 1; index <= 8; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        await sendRoomMessage(homeserver, author.accessToken, roomId, {
          msgtype: 'm.text',
          body: `Design note ${index}: Keep the conversation easy to follow.\nReview the details together before choosing the next step.\nLeave room for questions and a second pair of eyes.`,
        });
      }
      const firstBody = 'The draft is ready for another pair of eyes.';
      const firstEvent = await sendRoomMessage(homeserver, author.accessToken, roomId, {
        msgtype: 'm.text',
        body: firstBody,
      });
      const markRead = (accessToken: string, eventId: string) =>
        matrixFetch(
          homeserver,
          `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`,
          { method: 'POST', accessToken, body: '{}' }
        );
      await markRead(author.accessToken, firstEvent);

      await page.setViewportSize({ width, height: 844 });
      await page.route('**/v1/local-mindroom/connections', (route) =>
        route.fulfill({ json: { connections: [] } })
      );
      await page.addInitScript((selectedTheme) => {
        const settings = JSON.parse(localStorage.getItem('settings') ?? '{}');
        localStorage.setItem(
          'settings',
          JSON.stringify({
            ...settings,
            useSystemTheme: false,
            themeId: selectedTheme,
            isPeopleDrawer: false,
            hideActivity: settings.hideActivity ?? false,
          })
        );
      }, themeId);
      await loginWithPassword(page, { homeserver, ...primary });
      const roomPath = `/home/${encodeURIComponent(roomId)}`;
      await seedRoomOverviewState({ page, roomId, userId: author.userId, viewMode: 'classic' });
      await page.goto(roomPath);
      await expect.poll(() => new URL(page.url()).pathname).toBe(roomPath);
      await expect(page.getByTestId('room-virtual-inner')).toBeVisible();
      await expect(page.locator('[data-room-thread-overview="true"]')).toHaveCount(0);
      await expect(page.getByText(firstBody, { exact: true })).toBeVisible();
      // Initial catchup may need another 30-second Matrix long-poll cycle.
      await expect(page.getByText('Catching up...', { exact: true })).toHaveCount(0, {
        timeout: 60_000,
      });

      const editor = page.locator('[data-editable-name="RoomInput"]');
      const composer = editor.locator('xpath=../../..');
      const buttons = composer.getByRole('button');
      const buttonCount = width < 500 ? 5 : 6;
      await expect(buttons).toHaveCount(buttonCount);
      const typing = page.getByText('Avery is typing...', { exact: true });
      const setTyping = async (active: boolean) => {
        // Await the actual client sync so opposite updates cannot coalesce,
        // especially after local dismissal leaves SDK member.typing unchanged.
        const synced = page.waitForResponse(async (response) => {
          if (!response.url().includes('/sync?') || response.status() !== 200) return false;
          const data = await response.json();
          return data.rooms?.join?.[roomId]?.ephemeral?.events?.some(
            (event: { type: string; content: { user_ids?: string[] } }) =>
              event.type === 'm.typing' &&
              (event.content.user_ids ?? []).includes(reader.userId) === active
          );
        });
        await matrixFetch(
          homeserver,
          '/rooms/' + encodeURIComponent(roomId) + '/typing/' + encodeURIComponent(reader.userId),
          {
            method: 'PUT',
            accessToken: reader.accessToken,
            body: JSON.stringify({ typing: active, timeout: 60000 }),
          }
        );
        await synced;
      };
      const typingBar = typing.locator('..');
      const scrollBox = (await page.getByTestId('room-virtual-inner').boundingBox())!;
      await page.mouse.move(scrollBox.x + scrollBox.width / 2, 400);
      // A short room may still be loading its older rows above the reader,
      // so one wheel step need not leave the bottom yet.
      await expect(async () => {
        await page.mouse.wheel(0, -180);
        await expect(page.getByRole('button', { name: 'Jump to Latest', exact: true })).toBeVisible(
          { timeout: 2_000 }
        );
      }).toPass({ timeout: 30_000 });
      await page.mouse.move(0, 0);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await setTyping(true);
      await expect(typing).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('composer-typing.png') });

      // The live typing strip must float above the editor without covering it or
      // extending to the viewport edges, including after its entry animation.
      await expect
        .poll(async () => {
          const bar = (await typingBar.boundingBox())!;
          const input = (await composer.boundingBox())!;
          return {
            inset: bar.x > 0 && bar.x + bar.width < width,
            gap: input.y - bar.y - bar.height > 0,
          };
        })
        .toEqual({ inset: true, gap: true });
      expect(
        await typingBar.evaluate((el) => parseFloat(getComputedStyle(el).borderRadius))
      ).toBeGreaterThan(0);
      expect(await typingBar.evaluate((el) => getComputedStyle(el).backdropFilter)).not.toBe(
        'none'
      );
      expect(await typingBar.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(
        /(?:rgba|color\().*(?:0\.[0-9]+\))$/
      );
      // Only Send keeps the raised control material, both its blur and its highlight.
      // Attachment, voice, format, sticker, emoji and formatting-toolbar controls sit
      // flat on the composer's glass, with neither; failures include the offending styles.
      const materialMismatches = () =>
        buttons.evaluateAll((nodes) =>
          nodes.flatMap((node, index) => {
            const css = getComputedStyle(node);
            const send = node.getAttribute('aria-label') === 'Send message';
            const blur = css.backdropFilter !== 'none';
            const highlight = css.backgroundImage !== 'none';
            return blur === send && highlight === send
              ? []
              : [
                  {
                    index,
                    label: node.getAttribute('aria-label'),
                    blur: css.backdropFilter,
                    highlight: css.backgroundImage,
                  },
                ];
          })
        );
      expect(await materialMismatches()).toEqual([]);

      // The notice stays while the server reports typing, so only the button can hide it.
      await page.getByRole('button', { name: 'Drop Typing Status' }).click();
      await expect(typing).toHaveCount(0);
      // A new remote update should restore the strip after local dismissal.
      await setTyping(false);
      await setTyping(true);
      await expect(typing).toBeVisible();
      await setTyping(false);
      await expect(typing).toHaveCount(0);
      await buttons.nth(2).click();
      await expect.poll(() => buttons.count()).toBeGreaterThan(buttonCount);
      expect(await materialMismatches()).toEqual([]);
      // A pressed toggle (here Formatting) is filled while plain actions stay bare,
      // so its state reads at a glance. Move off it first: hover fills any button.
      await page.mouse.move(0, 0);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await expect(buttons.nth(2)).toHaveAttribute('aria-pressed', 'true');
      await expect(buttons.nth(0)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(buttons.nth(2)).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      // Markdown, the toolbar's last button and on by default, shows the same fill
      // and loses it when turned off.
      const markdown = buttons.last();
      await expect(markdown).toHaveAttribute('aria-pressed', 'true');
      await expect(markdown).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await markdown.click();
      await page.mouse.move(0, 0);
      await expect(markdown).toHaveAttribute('aria-pressed', 'false');
      await expect(markdown).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await markdown.click();
      await page.mouse.move(0, 0);
      await expect(markdown).toHaveAttribute('aria-pressed', 'true');
      await page.screenshot({ path: testInfo.outputPath('composer-formatting.png') });
      await buttons.nth(2).click();
      await expect(buttons).toHaveCount(buttonCount);
      await page.getByRole('button', { name: 'Jump to Latest', exact: true }).click();
      const body = 'The glass controls keep the conversation moving.';
      await editor.fill(body);
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      await expect(editor.locator('[data-slate-string]')).toHaveCount(0);
      await expect(page.getByText(body, { exact: true })).toBeVisible();
    } finally {
      const sessions = readerJoined ? [reader, author] : [author];
      const results = await Promise.allSettled([
        setAccountData(
          homeserver,
          author.accessToken,
          author.userId,
          'io.mindroom.settings',
          accountSettings
        ),
        ...sessions.map(async ({ accessToken }) => {
          await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/leave`, {
            method: 'POST',
            accessToken,
            body: '{}',
          });
          await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/forget`, {
            method: 'POST',
            accessToken,
            body: '{}',
          });
        }),
      ]);
      expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
    }
  });
}
