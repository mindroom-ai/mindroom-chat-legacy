import { expect, Page, test } from '@playwright/test';

// The banners render above every screen, so the sign-in page shows them without a homeserver.
const LONG_URL = `https://status.example.org/incidents/2026-10-24/${'tuwunel-migration-'.repeat(
  6
)}`;
const NOTICES = [
  {
    id: 'info',
    level: 'info',
    text: 'MindRoom moves to new servers tonight between 00:50 and 02:00 PDT.',
    linkUrl: 'https://status.example.org',
    linkText: 'Status',
  },
  {
    id: 'warning',
    level: 'warning',
    icon: '🔧',
    text: '**Chat and agents are down** for up to an hour. Messages you send now _may not arrive_; see [the plan](https://example.org/plan) or run `notice list`.',
  },
  {
    id: 'success',
    level: 'success',
    text: `~~Down~~ Back online. Details: [incident](${LONG_URL}), or paste ${LONG_URL}`,
  },
  {
    id: 'critical',
    level: 'critical',
    dismissible: false,
    text: 'Sign-in is unavailable. Do not reset your password. <b>raw html stays text</b>',
  },
];

const mockHomeserver = async (page: Page) => {
  await page.route('https://mindroom.chat/.well-known/matrix/client', (route) =>
    route.fulfill({ json: { 'm.homeserver': { base_url: 'https://mindroom.chat' } } })
  );
  await page.route('https://mindroom.chat/_matrix/client/versions', (route) =>
    route.fulfill({ json: { versions: ['v1.11'] } })
  );
  await page.route('https://mindroom.chat/_matrix/client/v3/login', (route) =>
    route.fulfill({ json: { flows: [{ type: 'm.login.password' }] } })
  );
};

const serveNotices = async (page: Page, notices: unknown) => {
  await page.unroute('**/notices.json');
  await page.route('**/notices.json', (route) =>
    route.fulfill({ json: notices, headers: { 'Cache-Control': 'no-store' } })
  );
};

const banners = (page: Page) => page.getByRole('status').locator('[data-notice-level]');

for (const theme of ['light', 'dark'] as const) {
  test(`notice banners at phone width in ${theme} mode`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 390, height: 844 });
    await mockHomeserver(page);
    await serveNotices(page, NOTICES.slice(0, 3));
    await page.goto('/');

    await expect(banners(page)).toHaveCount(3);
    const status = page.getByRole('status').first();
    await expect(status.getByRole('link', { name: 'Status' })).toHaveAttribute(
      'href',
      'https://status.example.org/'
    );
    await expect(status.getByRole('link', { name: 'incident' })).toHaveAttribute(
      'rel',
      'noopener noreferrer'
    );

    // Long URLs wrap instead of widening the page, and the page below keeps its own height.
    const layout = await page.evaluate(() => {
      const stack = document.querySelector('[role="status"]')!.getBoundingClientRect();
      const content = document.querySelector('[role="status"] + div')!.getBoundingClientRect();
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        stackBottom: stack.bottom,
        contentTop: content.top,
        contentBottom: content.bottom,
        viewportHeight: window.innerHeight,
      };
    });
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.contentTop).toBeGreaterThanOrEqual(layout.stackBottom - 1);
    expect(layout.contentBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);

    await page.screenshot({ path: testInfo.outputPath(`notices-phone-${theme}.png`) });

    // With the keyboard open, iOS shrinks #root through --app-height while dvh stays large.
    // Expanded notices still leave the app at least half of #root.
    await status.getByRole('button', { name: 'Show more' }).click();
    await expect(status.getByRole('button', { name: 'Show less' })).toBeVisible();
    await page.evaluate(() => document.documentElement.style.setProperty('--app-height', '320px'));
    const keyboardLayout = await page.evaluate(() => {
      const root = document.getElementById('root')!.getBoundingClientRect();
      const stack = document.querySelector('[role="status"]')!.getBoundingClientRect();
      const content = document.querySelector('[role="status"] + div')!.getBoundingClientRect();
      const stackElement = document.querySelector<HTMLElement>('[role="status"]')!;
      const rows = [...stackElement.querySelectorAll<HTMLElement>('[data-notice-level]')];
      return {
        root,
        stack,
        content,
        stackScrolls: stackElement.scrollHeight > stackElement.clientHeight,
        // Rows keep their content height instead of shrinking into each other.
        rowsContained: rows.every((row) => row.scrollHeight <= row.clientHeight + 1),
      };
    });
    expect(keyboardLayout.root.height).toBe(320);
    expect(keyboardLayout.stack.height).toBeLessThanOrEqual(160.5);
    expect(keyboardLayout.content.height).toBeGreaterThanOrEqual(159.5);
    expect(keyboardLayout.content.bottom).toBeLessThanOrEqual(keyboardLayout.root.bottom + 0.5);
    expect(keyboardLayout.stackScrolls).toBe(true);
    expect(keyboardLayout.rowsContained).toBe(true);
    await page.evaluate(() => document.documentElement.style.removeProperty('--app-height'));

    // An unbroken link label wraps too.
    await serveNotices(page, [{ ...NOTICES[0], linkText: 'x'.repeat(200) }]);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(banners(page)).toHaveCount(1);
    await expect(status.getByRole('link', { name: 'x'.repeat(200) })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390
    );
    const linkBox = await status.getByRole('link', { name: 'x'.repeat(200) }).boundingBox();
    expect((linkBox?.x ?? 0) + (linkBox?.width ?? 0)).toBeLessThanOrEqual(390);

    await serveNotices(page, NOTICES.slice(3));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(banners(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Dismiss notice' })).toHaveCount(0);
    await expect(banners(page)).toContainText('<b>raw html stays text</b>');
    await page.screenshot({
      path: testInfo.outputPath(`notices-phone-${theme}-critical.png`),
      clip: { x: 0, y: 0, width: 390, height: 160 },
    });
  });
}

test('notice banners at desktop width, with dismissal and removal', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockHomeserver(page);
  await serveNotices(page, NOTICES);
  await page.goto('/');

  await expect(banners(page)).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('notices-desktop-light.png') });

  await banners(page).first().getByRole('button', { name: 'Dismiss notice' }).click();
  await expect(banners(page)).toHaveCount(3);
  await expect(banners(page).first()).toHaveAttribute('data-notice-level', 'warning');

  await page.reload();
  await expect(banners(page)).toHaveCount(3);
  await expect(banners(page).first()).toHaveAttribute('data-notice-level', 'warning');

  await serveNotices(page, []);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(banners(page)).toHaveCount(0);
});
