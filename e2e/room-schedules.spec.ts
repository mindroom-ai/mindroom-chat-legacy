import { expect, test } from '@playwright/test';

test.use({ timezoneId: 'America/Los_Angeles' });

test('Escape closes schedules without marking the room read', async ({ page }) => {
  await page.goto('/e2e/fixtures/room-schedules.html');
  await page.getByRole('button', { name: 'Scheduled tasks (3)', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Read receipts sent')).toHaveText('0');
  // Prove the real room shortcut is active once focus leaves the modal.
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Read receipts sent')).toHaveText('1');
});

test('room schedule list shows every destination and follows live state updates', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/room-schedules.html');
  const trigger = page.getByRole('button', { name: 'Scheduled tasks (3)', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Scheduled tasks' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('article')).toHaveCount(3);
  await expect(
    dialog.getByText('Check the inbox.\nSummarize urgent messages.', { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByText('At 09:30, Monday through Friday (America/Los_Angeles)', { exact: true })
  ).toBeVisible();
  await expect(dialog.getByText('30 16 * * 1-5 (UTC)', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Silent', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Awaiting execution', { exact: true })).toBeVisible();
  await expect(dialog.getByText('New thread', { exact: true })).toBeVisible();
  await expect(dialog.locator('time[datetime="2099-01-01T12:00:00.000Z"]')).toHaveText(
    'Jan 1, 2099, 4:00:00 AM PST'
  );
  const creators = dialog.getByRole('link', { name: '@Alice', exact: true });
  await expect(creators).toHaveCount(3);
  await expect(creators.first()).toHaveAttribute('title', '@alice:example.org');
  await expect(dialog.getByText('No history', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Full history', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Recent messages: 12', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Model', { exact: true })).toHaveCount(3);
  await expect(dialog.getByText('cheap', { exact: true })).toBeVisible();
  await expect(
    dialog.getByText('From agent, room, or thread settings', { exact: true })
  ).toHaveCount(2);
  await expect(dialog.getByText('Updated', { exact: true })).toHaveCount(1);
  await expect(dialog.locator('time[datetime="2026-09-16T12:00:00.000Z"]')).toHaveText(
    'Sep 16, 2026, 5:00:00 AM PDT'
  );
  await expect(dialog.getByRole('button', { name: 'Open thread', exact: true })).toHaveCount(1);
  await expect(dialog.getByText('Cancelled reminder', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Completed reminder', { exact: true })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Open thread', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Opened $inbox', { exact: true })).toBeVisible();
  await trigger.click();
  await page.evaluate(() => window.dispatchEvent(new Event('cancel-schedule')));
  await expect(dialog.getByRole('article')).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Scheduled tasks (2)', exact: true })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Scheduled tasks (2)', exact: true })
  ).toBeFocused();
});

test('empty schedules and room changes never show tasks from the previous room', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/room-schedules.html');
  await page.getByRole('button', { name: 'Scheduled tasks (3)', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('switch-room')));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Scheduled tasks (0)', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('No scheduled tasks in this room.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('article')).toHaveCount(0);
});

test('schedule details wrap on phones in light and dark themes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  for (const theme of ['?stress', '?dark&stress', '?rtl&stress']) {
    await page.goto(`/e2e/fixtures/room-schedules.html${theme}`);
    await page.getByRole('button', { name: 'Scheduled tasks (3)', exact: true }).click();
    const dialog = page.getByRole('dialog');
    if (theme.includes('rtl'))
      await page.evaluate(() => {
        document.documentElement.dir = 'rtl';
      });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true
    );
    for (const card of await dialog.getByRole('article').all()) {
      expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true
      );
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
});
