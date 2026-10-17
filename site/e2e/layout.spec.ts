// No page scrolls sideways, at desktop or phone width.
import { test, expect } from '@playwright/test';

const paths = ['', 'product/', 'pricing/', 'tools/', 'tools/income-tax/', 'tools/s-corp/', 'tools/roi/', 'methodology/', 'insights/', 'app/'];

for (const p of paths) {
  test(`no horizontal overflow: /${p}`, async ({ page }) => {
    await page.goto(p);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
