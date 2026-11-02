import { expect, test } from '@playwright/test';

const WEB_URL = 'https://contoso.sharepoint.com/sites/finance/Shared%20Documents/Forecast.xlsx';

for (const theme of ['light', 'dark']) {
  for (const [device, width, height] of [
    ['phone', 390, 844],
    ['desktop', 1280, 900],
  ] as const) {
    test(`Excel range approval shows each changed cell on ${device} in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/e2e/fixtures/excel-range-approval.html?theme=${theme}`);
      const table = page.getByRole('table');
      await expect(page.getByText("'Q3 Forecast'!B2:D4")).toBeVisible();
      await expect(table.getByRole('rowheader')).toHaveText(['C2', 'D2', 'C3', 'C4', 'D4']);
      await expect(table.getByRole('row', { name: /C3/ })).toContainText('Format: @');
      await expect(table.getByRole('row', { name: /D4/ })).toContainText('value kept');
      await expect(table.getByRole('row', { name: /D4/ })).toContainText('Format: 0.0%');
      await expect(page.getByText('Unchanged cells: 4')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open in Excel' })).toHaveAttribute(
        'href',
        `ms-excel:ofe|u|${WEB_URL}`
      );
      await expect(page.getByRole('link', { name: 'Open in browser' })).toHaveAttribute(
        'href',
        WEB_URL
      );
      await expect(page.getByText('contoso.sharepoint.com', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await page.getByTestId('approval').screenshot({
        path: test.info().outputPath(`excel-range-approval-${device}-${theme}.png`),
      });
    });
  }
}
