import { expect, test } from '@playwright/test';

// The fixture's inviters, in card order: a plain name, an Arabic name, two
// names whose bidi controls would move or reverse the real ID, and a name whose
// paragraph separators would end the isolates around it.
const realIds = [
  '@maya:matrix.localhost',
  '@maya:matrix.localhost',
  '@mallory:evil.example',
  '@mallory:evil.example',
  '@mallory:evil.example',
];

for (const lang of ['en', 'ar']) {
  test(`invite cards show the real inviter ID left to right, after the name (${lang})`, async ({
    page,
  }) => {
    await page.goto(`/e2e/fixtures/invite-cards.html?lang=${lang}`);
    const senders = page.locator('b[title]');
    await expect(senders).toHaveCount(realIds.length);

    for (const [index, realId] of realIds.entries()) {
      const layout = await senders.nth(index).evaluate((sender, id) => {
        const text = sender.firstChild as Text;
        const start = text.data.lastIndexOf(id);
        const box = (offset: number) => {
          const range = document.createRange();
          range.setStart(text, offset);
          range.setEnd(text, offset + 1);
          return range.getBoundingClientRect();
        };
        return {
          idLefts: Array.from(id, (_, offset) => box(start + offset).left),
          beforeRights: Array.from(text.data.slice(0, start), (_, offset) => box(offset))
            .filter((rect) => rect.width > 0)
            .map((rect) => rect.right),
        };
      }, realId);

      const card = `${lang} card ${index}`;
      expect(layout.idLefts, `${card}: ID reads left to right`).toEqual(
        [...layout.idLefts].sort((a, b) => a - b)
      );
      expect(Math.max(...layout.beforeRights), `${card}: ID comes after the name`).toBeLessThan(
        layout.idLefts[0] + 1
      );
    }
  });
}
