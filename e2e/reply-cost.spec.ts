import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext } from '@playwright/test';
import { loginWithPassword } from './helpers/auth';
import { createThreadFixture, joinRoom, matrixFetch, sendRoomMessage } from './helpers/matrix';

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

const aiRun = (usd: string) => ({
  version: 1,
  status: 'completed',
  run_id: '6f1c2b0e-93d4-4c3a-8e57-2d9a1f4b7c60',
  session_id: '!kWzQpLmNoRsTuVwXyZaB:localhost:$Rk3fJ9sQx2LmVb7NcT0pYwZa4Ue8Hd1Gi6Oj5Ks',
  model: { config: 'luna', display_name: 'Luna', id: 'gpt-6-luna', provider: 'openai' },
  usage: {
    input_tokens: 1674,
    output_tokens: 31,
    total_tokens: 1705,
    cache_read_tokens: 1408,
    uncached_input_tokens: 266,
    time_to_first_token: '0.412',
  },
  context: {
    input_tokens: 51663,
    window_tokens: 258000,
    cache_read_input_tokens: 49886,
    uncached_input_tokens: 1777,
  },
  tools: { count: 2 },
  cost: { usd },
});

test('reply details show what a reply and the conversation so far cost', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!homeserver, 'Set E2E_UI_ACTIONS_HOMESERVER to a disposable local Matrix server.');
  // Several window sizes and color schemes.
  test.slow();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = randomUUID();
  const register = (username: string) =>
    matrixFetch<{ access_token: string; user_id: string }>(homeserver!, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
    });
  const username = `cost_viewer_${suffix}`;
  const viewer = await register(username);
  const agent = await register(`mindroom_code_${suffix}`);
  await matrixFetch(homeserver!, `/profile/${encodeURIComponent(agent.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: agent.access_token,
    body: JSON.stringify({ displayname: 'Code' }),
  });
  const fixture = await createThreadFixture(homeserver!, viewer.access_token, {
    name: 'Cost check',
    topic: 'Reply costs',
    rootBody: 'Plan the release',
    replyBody: 'Keep it short',
    invite: [agent.user_id],
  });
  await joinRoom(homeserver!, agent.access_token, fixture.roomId);
  const inThread = {
    rel_type: 'm.thread',
    event_id: fixture.rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: fixture.rootId },
  };
  await sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Cut the branch first.',
    'io.mindroom.ai_run': aiRun('0.0034'),
    'm.relates_to': inThread,
  });
  await sendRoomMessage(homeserver!, viewer.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'And then?',
    'm.relates_to': inThread,
  });
  // A streamed reply starts without metadata; its final edit carries the cost.
  const streamed = await sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Thinking...',
    'io.mindroom.stream_status': 'streaming',
    'm.relates_to': inThread,
  });
  await sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: '* Then tag it.',
    'm.new_content': {
      msgtype: 'm.text',
      body: 'Then tag it.',
      'io.mindroom.stream_status': 'completed',
      'io.mindroom.ai_run': aiRun('0.0051'),
    },
    'm.relates_to': { rel_type: 'm.replace', event_id: streamed },
  });
  await sendRoomMessage(homeserver!, viewer.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Ship it?',
    'm.relates_to': inThread,
  });
  await sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Done, v2.4 is tagged.',
    'io.mindroom.ai_run': aiRun('0.0026'),
    'm.relates_to': inThread,
  });
  // Anyone can write the same keys; only MindRoom's own accounts count.
  await sendRoomMessage(homeserver!, viewer.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Sounds good',
    'io.mindroom.ai_run': aiRun('100'),
    'm.relates_to': inThread,
  });

  await routeConfig(context);
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginWithPassword(page, { homeserver: homeserver!, username, password });
  await page.goto(
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
  );
  await expect(page.getByText('Then tag it.', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Catching up/)).toHaveCount(0);

  // Costs stay in the reply details; the timeline and thread banner show none.
  await expect(page.getByText(/^\$\d/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('desktop-light.png') });

  const detailsOf = (body: string) =>
    page
      .locator('[data-message-id]')
      .filter({ hasText: body })
      .getByRole('button', { name: 'Reply details', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Reply details' });
  const costCard = dialog.getByRole('region', { name: 'Cost', exact: true });
  const section = (heading: string) =>
    dialog
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: heading, exact: true }) });

  await detailsOf('Then tag it.').click();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await expect(costCard).toContainText('This reply$0.0051');
  await expect(costCard).toContainText('Conversation so far$0.0085');
  await expect(costCard).toContainText('2 replies');
  const history = costCard.getByRole('list', { name: 'Cost of each reply in this conversation' });
  await expect(history.getByRole('listitem')).toHaveCount(3);
  await expect(history.getByRole('listitem').nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(history.getByRole('listitem').nth(1)).toHaveText('Reply 2: $0.0051');
  await expect(costCard).toContainText('This reply · 2 of 3');
  // A short thread's bars run from edge to edge of the chart and stay narrow.
  const layout = await history.evaluate((list) => {
    const box = list.getBoundingClientRect();
    const bars = [...list.children].map((bar) => bar.getBoundingClientRect());
    return {
      start: bars[0].left - box.left,
      end: box.right - bars[bars.length - 1].right,
      widest: Math.max(...bars.map((bar) => bar.width)),
    };
  });
  expect(layout.start).toBeLessThan(1);
  expect(layout.end).toBeLessThan(1);
  expect(layout.widest).toBeLessThanOrEqual(32);
  // Pointing at a bar names its reply in the caption; pointing at a token part gives its share.
  // Each bar's hidden label already reads "Reply N: $…", so check the ring and the caption.
  await history.getByRole('listitem').first().hover();
  await expect(history.getByRole('listitem').first()).toHaveAttribute('data-pointed', 'true');
  await expect(costCard).not.toContainText('This reply · 2 of 3');
  await section('Tokens').locator('[aria-hidden] > span').first().hover();
  await expect(page.getByText('1,408 · 82.6%', { exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(costCard).toContainText('This reply · 2 of 3');
  await expect(section('Tokens')).toContainText('Tokens1,705');
  await expect(section('Tokens')).toContainText('From cache 1,408');
  await expect(section('Tokens')).toContainText('New input 266');
  await expect(section('Context window')).toContainText('51,663 of 258,000 · 20.0%');
  await expect(dialog).toContainText('2 tool calls');
  await expect(dialog).toContainText('First token 412 ms');
  await page.screenshot({ path: testInfo.outputPath('desktop-dialog-light.png') });
  // High-contrast modes replace backgrounds, so the chart keeps its own colors there.
  await page.emulateMedia({ forcedColors: 'active' });
  const barColors = await history
    .getByRole('listitem')
    .evaluateAll((bars) => bars.map((bar) => getComputedStyle(bar).backgroundColor));
  expect(new Set(barColors).size).toBe(3);
  await page.emulateMedia({ forcedColors: 'none' });
  await dialog.getByText('Technical details', { exact: true }).click();
  await expect(
    dialog.getByText('6f1c2b0e-93d4-4c3a-8e57-2d9a1f4b7c60', { exact: true })
  ).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: testInfo.outputPath('desktop-dialog-dark.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // The viewer's own message wrote the keys too, but its details show no cost.
  await detailsOf('Sounds good').click();
  await expect(section('Tokens')).toBeVisible();
  await expect(costCard).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  // A phone has no hover, so the details open from the keyboard here.
  await detailsOf('Cut the branch first.').focus();
  await page.keyboard.press('Enter');
  await expect(costCard).toContainText('Conversation so far$0.0034');
  await expect(costCard).toContainText('This reply · 1 of 3');
  await page.screenshot({ path: testInfo.outputPath('phone-dialog-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: testInfo.outputPath('phone-dialog-light.png') });

  // Long currency formats such as "0,0051 US$" must stay inside the card on a phone.
  const es = JSON.parse(
    readFileSync(new URL('../src/app/locales/es.json', import.meta.url), 'utf8')
  ) as { mindroomUi: { messages: Record<string, Record<string, string>> } };
  const esReplyDetails = es.mindroomUi.messages.mindroomMessageControls.replyDetails;
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 360, height: 780 });
  await page.evaluate(() => localStorage.setItem('i18nextLng', 'es'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await page
    .locator('[data-message-id]')
    .filter({ hasText: 'Then tag it.' })
    .getByRole('button', { name: esReplyDetails, exact: true })
    .focus();
  await page.keyboard.press('Enter');
  const esCostCard = page
    .getByRole('dialog', { name: esReplyDetails })
    .getByRole('region', { name: es.mindroomUi.messages.mindroomReplyDetails.cost, exact: true });
  await expect(esCostCard).toContainText('US$');
  // Every element stays inside its parent, so no figure spills into its neighbour or past the card.
  const outside = await esCostCard.evaluate((card) =>
    [card, ...card.querySelectorAll('*')]
      .filter((element) => element !== card || card.parentElement)
      .flatMap((element) => {
        const parent = element === card ? card.parentElement! : element.parentElement!;
        const rect = element.getBoundingClientRect();
        const box = parent.getBoundingClientRect();
        return rect.width > 0 && (rect.right > box.right + 1 || rect.left < box.left - 1)
          ? [`${element.tagName} ${element.textContent?.slice(0, 24)}`]
          : [];
      })
  );
  expect(outside).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('phone-dialog-es.png') });
});
