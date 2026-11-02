/* eslint-disable no-await-in-loop -- Settings pages share one session and must open sequentially. */
import { expect, test, type Locator } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword, setFullInterfaceModeForSession } from '../helpers/auth';
import { expectFloatingNavHeader } from '../helpers/glassVisual';
import { expectInsetScrollbar } from '../helpers/insetScrollbar';
import { createPrivateRoom, loginToMatrix, matrixFetch } from '../helpers/matrix';

for (const themeId of ['dark-theme', 'silver-theme']) {
  test(`settings pages scroll beneath flat headers in ${themeId}`, async ({ page }, testInfo) => {
    // This single workflow visits every personal and room settings page, including screenshots.
    test.setTimeout(180_000);
    test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
    const homeserver = getHomeserver();
    test.skip(
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(homeserver).hostname),
      'Disposable local fixture only'
    );
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    let restoreSettings: (() => Promise<unknown>) | undefined;
    let roomId: string | undefined;
    try {
      restoreSettings = await setFullInterfaceModeForSession(homeserver, session);
      roomId = await createPrivateRoom(homeserver, session.accessToken, {
        name: 'Design studio',
        topic: 'Shared projects and creative ideas',
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript((theme) => {
        localStorage.setItem(
          'settings',
          JSON.stringify({
            ...JSON.parse(localStorage.getItem('settings') ?? '{}'),
            useSystemTheme: false,
            themeId: theme,
            isPeopleDrawer: false,
            dateFormatString: '',
          })
        );
      }, themeId);
      await page.route('**/v1/local-mindroom/connections', (route) =>
        route.fulfill({ json: { connections: [] } })
      );
      await loginWithPassword(page, { homeserver, ...credentials });
      await page.getByRole('button', { name: /Open settings for / }).click();

      const checkHeader = async (header: Locator, name: string) => {
        await expect(header).toBeVisible();
        const enclosingScroll = header.locator('xpath=ancestor::*[@data-y-scrollbar-width][1]');
        const overlaysContent = (await enclosingScroll.count()) === 1;
        // The fallback captures the old clipped layout before the regression assertion.
        const scroll = overlaysContent
          ? enclosingScroll
          : header.locator('xpath=..').locator('[data-y-scrollbar-width]').first();
        await expect(scroll).toBeVisible();
        await scroll.evaluate((element) => {
          element.scrollTop = 220;
        });
        await page.mouse.move(2, 2);
        await page.screenshot({ path: testInfo.outputPath(`${name}.png`), scale: 'css' });
        expect.soft(overlaysContent, `${name}: content must scroll behind the header`).toBe(true);
        if (!overlaysContent) return;
        await expectFloatingNavHeader(header, { inheritsPanelTint: true });
        const bounds = (await header.boundingBox())!;
        // Navigation can leave the enclosing panel's old pointer light behind.
        // Enter the flat title first so the baseline uses its real cleared state.
        await page.mouse.move(bounds.x + 4, bounds.y + 4);
        const waitForPointerPaint = () =>
          page.evaluate(
            () =>
              new Promise<void>((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
              })
          );
        await waitForPointerPaint();
        await expect
          .poll(() =>
            header.evaluate((element) => {
              const lights: string[] = [];
              for (let node: HTMLElement | null = element; node; node = node.parentElement) {
                lights.push(node.style.getPropertyValue('--liquid-glass-light-x'));
                lights.push(node.style.getPropertyValue('--liquid-glass-light-y'));
              }
              return lights.filter(Boolean);
            })
          )
          .toEqual([]);
        await page.mouse.move(2, 2);
        await waitForPointerPaint();
        const idle = await page.screenshot({ clip: bounds, animations: 'disabled' });
        await page.mouse.move(bounds.x + 4, bounds.y + 4);
        await waitForPointerPaint();
        const hovered = await page.screenshot({ clip: bounds, animations: 'disabled' });
        if (!hovered.equals(idle)) {
          await testInfo.attach(`${name}-idle`, { body: idle, contentType: 'image/png' });
          await testInfo.attach(`${name}-hovered`, { body: hovered, contentType: 'image/png' });
        }
        expect(hovered.equals(idle), `${name}: no hover glow`).toBe(true);
        if (name === 'account') {
          expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
          await expectInsetScrollbar(page, scroll, header);
        }
      };

      for (const name of [
        'Account',
        'General',
        'Notifications',
        'Devices',
        'Emojis & Stickers',
        'Developer Tools',
        'About',
      ]) {
        await page.getByRole('button', { name, exact: true }).click();
        const header = page
          .locator('header')
          .filter({ has: page.getByText(name, { exact: true }) });
        await checkHeader(header, name.toLowerCase().replaceAll(/[^a-z]+/g, '-'));
        if (name === 'General') {
          await page.setViewportSize({ width: 390, height: 620 });
          await page
            .locator('form:has(input[name="customDateFormatInput"]) button[aria-pressed]')
            .click();
          const hints = page
            .locator('header')
            .filter({ has: page.getByText('Formatting', { exact: true }) });
          const hintScroll = await expectFloatingNavHeader(hints, { inheritsPanelTint: true });
          await hintScroll.evaluate((element) => {
            element.scrollTop = 180;
          });
          await expectFloatingNavHeader(hints, { inheritsPanelTint: true });
          await page.screenshot({
            path: testInfo.outputPath('date-format-hints.png'),
            scale: 'css',
          });
          await page.keyboard.press('Escape');
          await expect(hints).toBeHidden();
          await page.setViewportSize({ width: 390, height: 844 });
        }

        await header.getByRole('button').last().click();
      }
      // Desktop keeps the navigation alongside the same content header.
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByRole('button', { name: 'Account', exact: true }).click();
      await checkHeader(
        page.locator('header').filter({ has: page.getByText('Account', { exact: true }) }),
        'account-desktop'
      );
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate((id) => {
        window.history.pushState(null, '', `/home/${encodeURIComponent(id)}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, roomId);
      const roomHeader = page.locator('header').filter({ hasText: 'Design studio' });
      await roomHeader.getByRole('button').last().click();
      await page.getByRole('button', { name: 'Room Settings', exact: true }).click();
      for (const name of [
        'General',
        'Permissions',
        'Members',
        'Emojis & Stickers',
        'Developer Tools',
      ]) {
        await page.getByRole('button', { name, exact: true }).click();
        const header = page.locator('header').filter({
          has:
            name === 'Members' ? page.getByText(/1 Member/) : page.getByText(name, { exact: true }),
        });
        await checkHeader(header, `room-${name.toLowerCase().replaceAll(/[^a-z]+/g, '-')}`);
        await header.getByRole('button').last().click();
      }
    } finally {
      const cleanup = await Promise.allSettled([
        restoreSettings?.(),
        (async () => {
          if (!roomId) return;
          await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/leave`, {
            method: 'POST',
            accessToken: session.accessToken,
            body: '{}',
          });
          await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/forget`, {
            method: 'POST',
            accessToken: session.accessToken,
            body: '{}',
          });
        })(),
      ]);
      expect
        .soft(
          cleanup.filter((result) => result.status === 'rejected'),
          'Fixture cleanup'
        )
        .toEqual([]);
    }
  });
}
