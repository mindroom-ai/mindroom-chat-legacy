import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { loginWithPassword } from './helpers/auth';
import { createThreadFixture, joinRoom, matrixFetch, sendStateEvent } from './helpers/matrix';

// Explicit opt-in to an isolated, disposable local Matrix server with open registration.
const homeserver = process.env.E2E_UI_ACTIONS_HOMESERVER;
test.use({ video: 'off' });

// Point the app at the disposable homeserver.
const routeConfig = (context: BrowserContext) =>
  context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      json: {
        ...config,
        homeserverList: [homeserver],
        defaultHomeserver: 0,
        allowCustomHomeservers: true,
        hashRouter: { enabled: false },
        auth: { allowRegistration: false, disablePasswordLogin: false },
      },
    });
  });

// The header names the end in the default 12-hour clock, with the day when it is not today.
const clock = (timestamp: number) =>
  new Date(timestamp).toLocaleString('en', {
    weekday: new Date(timestamp).toDateString() === new Date().toDateString() ? undefined : 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

test('the thread header says whose tool calls run without approval cards, and until when', async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.skip(!homeserver, 'Set E2E_UI_ACTIONS_HOMESERVER to a disposable local Matrix server.');
  // Two logins and several window sizes.
  test.slow();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = randomUUID();
  const register = (username: string) =>
    matrixFetch<{ access_token: string; user_id: string }>(homeserver!, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
    });
  const username = `approve_viewer_${suffix}`;
  const viewer = await register(username);
  const colleague = await register(`approve_colleague_${suffix}`);
  const router = await register(`mindroom_router_${suffix}`);
  await matrixFetch(homeserver!, `/profile/${encodeURIComponent(colleague.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: colleague.access_token,
    body: JSON.stringify({ displayname: 'Robin' }),
  });
  const fixture = await createThreadFixture(homeserver!, viewer.access_token, {
    name: 'Release prep',
    topic: 'Auto-approve indicator',
    rootBody: 'Write the release notes and tag the build',
    replyBody: 'On it',
    invite: [router.user_id, colleague.user_id],
  });
  await joinRoom(homeserver!, router.access_token, fixture.roomId);
  await joinRoom(homeserver!, colleague.access_token, fixture.roomId);
  // MindRoom's router creates its rooms and so may write this state; here the viewer created the room.
  const powerLevelsPath = `/rooms/${encodeURIComponent(fixture.roomId)}/state/m.room.power_levels`;
  const powerLevels = await matrixFetch<Record<string, unknown>>(homeserver!, powerLevelsPath, {
    accessToken: viewer.access_token,
  });
  await sendStateEvent(
    homeserver!,
    viewer.access_token,
    fixture.roomId,
    'm.room.power_levels',
    '',
    {
      ...powerLevels,
      events: { ...(powerLevels.events as Record<string, number>), 'io.mindroom.auto_approve': 0 },
    }
  );
  type Window = { threadId: string | null; requesterId: string; expiresAt: number };
  const publish = (windows: Window[]) =>
    sendStateEvent(
      homeserver!,
      router.access_token,
      fixture.roomId,
      'io.mindroom.auto_approve',
      router.user_id,
      {
        windows: windows.map(({ threadId, requesterId, expiresAt }) => ({
          thread_id: threadId,
          requester_id: requesterId,
          expires_at: new Date(expiresAt).toISOString(),
        })),
      }
    );
  const ownEnd = Date.now() + 30 * 60_000;
  const colleagueEnd = Date.now() + 2 * 60 * 60_000;
  const own: Window = { threadId: fixture.rootId, requesterId: viewer.user_id, expiresAt: ownEnd };
  const theirs: Window = {
    threadId: fixture.rootId,
    requesterId: colleague.user_id,
    expiresAt: colleagueEnd,
  };
  const elsewhere: Window = { ...own, threadId: '$another-thread' };

  await routeConfig(context);
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginWithPassword(page, { homeserver: homeserver!, username, password });
  await page.goto(
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
  );
  await expect(page.getByText(fixture.replyBody, { exact: true })).toBeVisible();
  await expect(page.getByText(/^Catching up/)).toHaveCount(0);
  const banner = page.locator('[data-thread-context-banner="true"]');
  const chip = banner.getByRole('button', { name: /^Auto-approve/ });

  // A colleague's window is named; the viewer's window in another thread is not this thread's.
  await publish([theirs, elsewhere]);
  await expect(chip).toHaveText('Auto-approve: Robin');
  await expect(chip).toHaveCount(1);

  // The viewer's own window comes first, and the chip opens whose calls run without cards, until when.
  await publish([own, theirs, elsewhere]);
  await expect(chip).toHaveText('Auto-approve');
  await page.screenshot({ path: testInfo.outputPath('desktop-light.png') });
  await chip.click();
  const dialog = page.getByRole('dialog', { name: 'Auto-approve' });
  await expect(
    dialog.getByText(`Until ${clock(ownEnd)}. Send !auto_approve off to end it.`, { exact: true })
  ).toBeVisible();
  await expect(dialog.getByText('Robin', { exact: true })).toBeVisible();
  await expect(dialog.getByText(`Until ${clock(colleagueEnd)}`, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop-dialog-light.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // Closing returns focus to the chip; drop it so the screenshots show the resting look.
  await chip.blur();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: testInfo.outputPath('desktop-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });

  // Beside an active permission and the tags, the chips are the tags' size and share their line.
  for (const tag of ['launch', 'docs', 'qa']) {
    await sendStateEvent(
      homeserver!,
      viewer.access_token,
      fixture.roomId,
      'com.mindroom.thread.tags',
      JSON.stringify([fixture.rootId, tag]),
      { set_by: viewer.user_id, set_at: new Date().toISOString() }
    );
  }
  const grantEnd = new Date(Date.now() + 10 * 60_000).toISOString();
  await matrixFetch(
    homeserver!,
    `/rooms/${encodeURIComponent(fixture.roomId)}/send/io.mindroom.tool_approval/grant-${suffix}`,
    {
      method: 'PUT',
      accessToken: router.access_token,
      body: JSON.stringify({
        msgtype: 'io.mindroom.tool_approval',
        body: 'Approved: save_note',
        approval_id: `grant-${suffix}`,
        tool_name: 'save_note',
        agent_name: 'assistant',
        status: 'approved',
        approvable: true,
        approver_user_id: viewer.user_id,
        requester_id: viewer.user_id,
        arguments: { title: 'Release notes' },
        requested_at: new Date().toISOString(),
        expires_at: grantEnd,
        resolved_at: new Date().toISOString(),
        resolved_by: viewer.user_id,
        auto_approval: { grant_id: `grant-${suffix}`, expires_at: grantEnd, revoked_at: null },
        thread_id: fixture.rootId,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: fixture.rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: fixture.rootId },
        },
      }),
    }
  );
  const permissions = banner.getByRole('button', { name: '1 active permission', exact: true });
  // Tags sort by name, and the desktop row comes before the hidden phone one.
  const firstTag = banner.getByText('docs', { exact: true }).first();
  await expect(permissions).toBeVisible();
  await expect(firstTag).toBeVisible();
  const box = async (locator: typeof chip) => {
    const found = await locator.boundingBox();
    if (!found) throw new Error('not laid out');
    return found;
  };
  const middle = async (locator: typeof chip) => {
    const { y, height } = await box(locator);
    return y + height / 2;
  };
  const fullText = (locator: typeof chip) =>
    locator.evaluate((node) => node.scrollWidth <= node.clientWidth);
  const leftOf = async (locator: typeof chip, control: typeof chip) => {
    const [a, b] = [await box(locator), await box(control)];
    return a.x + a.width <= b.x;
  };
  const tagPill = firstTag.locator('..');
  for (const status of [chip, permissions]) {
    expect(Math.abs((await middle(status)) - (await middle(firstTag)))).toBeLessThan(3);
    expect(Math.abs((await box(status)).height - (await box(tagPill)).height)).toBeLessThan(3);
    expect(await fullText(status)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('desktop-tags-light.png') });

  // On a phone the chips stay clear of the thread actions and read in full, expanded and collapsed.
  const options = banner.getByRole('button', { name: 'Thread options', exact: true });
  const show = banner.getByRole('button', { name: 'Show thread details', exact: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(options).toBeVisible();
  for (const status of [chip, permissions]) {
    expect(await leftOf(status, options)).toBe(true);
    expect(await fullText(status)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('phone-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: testInfo.outputPath('phone-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await options.click();
  await page.getByRole('menuitem', { name: 'Hide thread details' }).click();
  await expect(show).toBeInViewport();
  for (const status of [chip, permissions]) {
    expect(await leftOf(status, show)).toBe(true);
    expect(await fullText(status)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('phone-collapsed-light.png') });
  // On the narrowest phones no control leaves the screen or sits under a chip.
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(show).toBeInViewport();
  for (const status of [chip, permissions]) expect(await leftOf(status, show)).toBe(true);
  await show.click();
  await expect(options).toBeInViewport();
  for (const status of [chip, permissions]) expect(await leftOf(status, options)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('phone-narrow-light.png') });
  await page.setViewportSize({ width: 1280, height: 800 });

  // A phone held sideways puts the chips beside the title, which MindRoom usually sets.
  const title = 'Release notes drafted and the build tag prepared for review';
  await matrixFetch(
    homeserver!,
    `/rooms/${encodeURIComponent(fixture.roomId)}/send/m.room.message/summary-${suffix}`,
    {
      method: 'PUT',
      accessToken: router.access_token,
      body: JSON.stringify({
        msgtype: 'm.notice',
        body: title,
        'io.mindroom.thread_summary': {
          version: 1,
          summary: title,
          generated_at: new Date().toISOString(),
          message_count: 2,
        },
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: fixture.rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: fixture.rootId },
        },
      }),
    }
  );
  const sideways = await browser.newContext({
    viewport: { width: 667, height: 375 },
    hasTouch: true,
  });
  await routeConfig(sideways);
  const landscape = await sideways.newPage();
  await loginWithPassword(landscape, { homeserver: homeserver!, username, password });
  await landscape.goto(
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
  );
  const sidewaysBanner = landscape.locator('[data-thread-context-banner="true"]');
  const sidewaysTitle = sidewaysBanner.getByText('Release notes drafted', { exact: false });
  const sidewaysChip = sidewaysBanner.getByRole('button', { name: /^Auto-approve/ });
  const sidewaysOptions = sidewaysBanner.getByRole('button', {
    name: 'Thread options',
    exact: true,
  });
  await expect(sidewaysTitle).toBeVisible();
  await expect(sidewaysChip).toBeVisible();
  expect(Math.abs((await middle(sidewaysChip)) - (await middle(sidewaysTitle)))).toBeLessThan(3);
  expect(await leftOf(sidewaysChip, sidewaysOptions)).toBe(true);
  expect(await fullText(sidewaysChip)).toBe(true);
  await landscape.screenshot({ path: testInfo.outputPath('phone-landscape-light.png') });
  await sideways.close();

  // A window that ends goes away on its own, and `!auto_approve off` clears the state.
  // Long enough for the publish, the sync and the render to land before it ends on a slow runner.
  await publish([{ ...own, expiresAt: Date.now() + 15_000 }]);
  await expect(chip).toHaveText('Auto-approve');
  await expect(chip).toHaveCount(0, { timeout: 30_000 });
  await publish([own]);
  await expect(chip).toBeVisible();
  await publish([]);
  await expect(chip).toHaveCount(0);
});
