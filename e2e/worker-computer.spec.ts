import { readFileSync } from 'node:fs';
import { expect, test, type WebSocket } from '@playwright/test';
import { loginWithPassword } from './helpers/auth';
import { openSettingsFromAccountRail } from './helpers/accounts';

// Only this explicit fixture file enables the spec. Never use the default homeserver.
const fixturePath = process.env.E2E_COMPUTER_FIXTURE;
type Fixture = {
  api_origin: string;
  ui_origin: string;
  homeserver: string;
  room_id: string;
  thread_id: string;
  agent_user_id: string;
  viewer: { username: string; password: string; access_token: string; user_id: string };
};

const requireLoopback = (origin: string) => {
  const url = new URL(origin);
  expect(url.protocol).toBe('http:');
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname);
};

test('watch, type, resume in the originating thread, and recover on desktop/mobile', async ({
  page,
  context,
  request,
}, testInfo) => {
  test.skip(!fixturePath, 'Set E2E_COMPUTER_FIXTURE to the isolated local gateway fixture JSON.');
  const fixture = JSON.parse(readFileSync(fixturePath!, 'utf8')) as Fixture;
  [fixture.api_origin, fixture.ui_origin, fixture.homeserver].forEach(requireLoopback);
  expect(testInfo.project.use.baseURL).toBe(fixture.ui_origin);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  // The computer's display WebSockets, so a layout change can be checked for a reconnect.
  const streams: WebSocket[] = [];
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).host === new URL(fixture.api_origin).host) streams.push(socket);
  });
  const continuations: { eventId: string; content: Record<string, unknown> }[] = [];
  page.on('response', async (response) => {
    if (!response.url().includes('/send/m.room.message/') || !response.ok()) return;
    const content = response.request().postDataJSON() as Record<string, unknown>;
    const { event_id: eventId } = await response.json();
    continuations.push({ eventId, content });
  });
  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      json: {
        ...config,
        homeserverList: [fixture.homeserver],
        defaultHomeserver: 0,
        allowCustomHomeservers: true,
        hashRouter: { enabled: false },
        auth: { allowRegistration: false, disablePasswordLogin: false },
        mindroom: { ...config.mindroom, computers: { apiUrl: '' } },
      },
    });
  });
  await loginWithPassword(page, { homeserver: fixture.homeserver, ...fixture.viewer });
  await page.goto(
    '/home/' +
      encodeURIComponent(fixture.room_id) +
      '?threadId=' +
      encodeURIComponent(fixture.thread_id)
  );
  // No agent showed this computer, so only the room menu offers it; the header button follows once it is open.
  const showComputer = page.getByRole('button', { name: 'Show Computer', exact: true });
  const showComputerFromMenu = async () => {
    await page.getByRole('button', { name: 'More Options', exact: true }).click();
    await showComputer.click();
  };
  // Leave Room is always in the menu, so an absent entry is not just a menu that has not rendered.
  const expectNoShowComputerInMenu = async () => {
    await page.getByRole('button', { name: 'More Options', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Leave Room', exact: true })).toBeVisible();
    await expect(showComputer).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Leave Room', exact: true })).toHaveCount(0);
  };
  await expectNoShowComputerInMenu();
  await openSettingsFromAccountRail(page);
  await page.getByRole('button', { name: 'General', exact: true }).click();
  const serviceInput = page.getByRole('textbox', { name: 'Computer service URL', exact: true });
  await serviceInput.fill(fixture.api_origin);
  await page.getByRole('button', { name: 'Save computer service', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Computer service saved.' })
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'More Options', exact: true }).click();
  await expect(showComputer).toBeVisible();
  await showComputer.click();
  const panel = page.getByRole('complementary', { name: 'Computer panel' });
  await expect(panel.getByText('Watch mode', { exact: true })).toBeVisible();
  const canvas = panel.locator('[data-mindroom-computer-input] canvas');
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const c = element as HTMLCanvasElement;
        return Array.from(c.getContext('2d')!.getImageData(1200, 700, 1, 1).data);
      })
    )
    .toEqual([17, 51, 85, 255]);
  const desktop = await panel.boundingBox();
  expect(desktop!.x).toBeGreaterThan(500);
  expect(desktop!.width).toBeLessThan(800);
  expect(desktop!.x + desktop!.width).toBeLessThanOrEqual(1600);
  await page.screenshot({ path: testInfo.outputPath('desktop-watch.png') });

  await panel.getByRole('button', { name: 'Take control', exact: true }).click();
  await expect(panel.getByText('You have control', { exact: true })).toBeVisible();
  const clickRemoteInput = async () => {
    const bounds = await canvas.boundingBox();
    // The fixture input lies at these framebuffer coordinates, before noVNC scaling.
    await page.mouse.click(
      bounds!.x + (150 * bounds!.width) / 1280,
      bounds!.y + (440 * bounds!.height) / 800
    );
  };
  await clickRemoteInput();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('typed-through-chat');
  await panel.getByRole('button', { name: 'Resume agent', exact: true }).click();
  await expect(panel.getByText('Watch mode', { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const response = await request.get(fixture.api_origin + '/fixture/text');
      expect(response.ok()).toBe(true);
      const readback = await response.json();
      return {
        value: readback.value,
        snapshotHasTypedValue: readback.snapshot.includes('typed-through-chat'),
      };
    })
    .toEqual({ value: 'typed-through-chat', snapshotHasTypedValue: true });
  // Capture the completed native input after the agent sees it and Watch reconnects.
  await page.screenshot({ path: testInfo.outputPath('desktop-resumed.png') });
  await panel.getByRole('button', { name: 'Take control', exact: true }).click();
  await expect(panel.getByText('You have control', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop-control.png') });

  // Every status the panel shows from here on, so a brief reconnect cannot slip between checks.
  type StatusLog = { statuses: string[]; observer: MutationObserver };
  await panel.getByRole('status').evaluate((element) => {
    const statuses = [element.textContent ?? ''];
    const observer = new MutationObserver(() => {
      const text =
        document.querySelector('[aria-label="Computer panel"] [role="status"]')?.textContent ?? '';
      if (statuses[statuses.length - 1] !== text) statuses.push(text);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    (window as unknown as { computerStatusLog: StatusLog }).computerStatusLog = {
      statuses,
      observer,
    };
  });
  const stopStatusLog = () =>
    page.evaluate(() => {
      const log = (window as unknown as { computerStatusLog: StatusLog }).computerStatusLog;
      log.observer.disconnect();
      return log.statuses;
    });
  expect(streams.length).toBeGreaterThan(0);
  const streamCount = streams.length;
  const stream = streams[streamCount - 1];
  expect(stream.isClosed()).toBe(false);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const writeLocalClipboard = (text: string) =>
    page.evaluate((value) => navigator.clipboard.writeText(value), text);
  const readLocalClipboard = () => page.evaluate(() => navigator.clipboard.readText());
  // The check mark is outside Latin-1, so only the extended clipboard's UTF-8 can carry it.
  const pasted = 'pasted from chat ✓';
  await writeLocalClipboard(pasted);
  await clickRemoteInput();
  // The local shortcut is Cmd on a Mac, which the bridge maps to Ctrl on the Linux computer.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+v');
  await page.screenshot({ path: testInfo.outputPath('desktop-pasted.png') });
  // A different local clipboard shows that the copy below carries the computer's text back.
  await writeLocalClipboard('local text before the copy');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(readLocalClipboard).toBe(pasted);

  const separator = page.getByRole('separator', { name: 'Resize computer panel', exact: true });
  const handle = await separator.boundingBox();
  const narrowFrom = (await panel.boundingBox())!.width;
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2 + 200, handle!.y + handle!.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(narrowFrom - 200);
  const expand = panel.getByRole('button', { name: 'Expand computer', exact: true });
  await expand.click();
  await expect(expand).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(narrowFrom);
  await expect(panel.getByText('You have control', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop-expanded.png') });
  await expand.click();
  await expect(expand).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(narrowFrom - 200);
  await expect(panel.getByText('You have control', { exact: true })).toBeVisible();
  expect(await stopStatusLog()).toEqual(['You have control']);
  expect(streams).toHaveLength(streamCount);
  expect(stream.isClosed()).toBe(false);
  await expect.poll(() => continuations.length).toBe(1);
  const continuation = continuations[0];
  expect(continuation.content['m.mentions']).toEqual({ user_ids: [fixture.agent_user_id] });
  expect(continuation.content['m.relates_to']).toMatchObject({
    rel_type: 'm.thread',
    event_id: fixture.thread_id,
  });
  const eventResponse = await request.get(
    fixture.homeserver +
      '/_matrix/client/v3/rooms/' +
      encodeURIComponent(fixture.room_id) +
      '/event/' +
      encodeURIComponent(continuation.eventId),
    { headers: { Authorization: 'Bearer ' + fixture.viewer.access_token } }
  );
  expect(eventResponse.ok()).toBe(true);
  expect((await eventResponse.json()).sender).toBe(fixture.viewer.user_id);
  await panel.getByRole('button', { name: 'Close computer', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await showComputerFromMenu();
  await expect(panel.getByText('Watch mode', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await panel.boundingBox();
  expect(mobile!.x).toBe(0);
  expect(mobile!.y).toBe(0);
  expect(mobile!.width).toBe(390);
  expect(mobile!.height).toBe(844);
  await expect(panel.getByRole('button', { name: 'Close computer', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile-watch.png') });
  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(panel.getByText('Computer stopped', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Start computer', exact: true }).click();
  await expect(panel.getByText('Watch mode', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Close computer', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openSettingsFromAccountRail(page);
  await page.getByRole('button', { name: 'General', exact: true }).click();
  await expect(serviceInput).toHaveValue(fixture.api_origin);
  await serviceInput.fill('');
  await page.getByRole('button', { name: 'Save computer service', exact: true }).click();
  await page.reload();
  await expect(page.locator('[data-slate-editor="true"]').first()).toBeVisible();
  await expectNoShowComputerInMenu();
  expect(continuations).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});
