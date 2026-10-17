// Calculator behavior in a real browser: the page shows what the engine computes,
// state lives in the URL, and AI intake only applies what the person approves.
import { test, expect } from '@playwright/test';
import { tools } from '../src/lib/data/tools';

const out = (key: string) => `[data-out="${key}"]`;

test('income tax: single, $100,000 wages', async ({ page }) => {
  await page.goto('tools/income-tax/?status=single&wages=100000');
  // Worked by hand: taxable 100,000 − 16,100 = 83,900; Tax Table row midpoint
  // 83,925 → 1,240 + 4,560 + 22% × 33,525 = 13,175.50 → $13,176.
  await expect(page.locator(out('totalTax')).first()).toHaveText('$13,176');
  await expect(page.locator(out('bracket')).first()).toHaveText('bracket 22%');
});

test('income tax: edits update the URL and survive a reload', async ({ page }) => {
  await page.goto('tools/income-tax/?status=single&wages=100000');
  const wages = page.locator('input[name=wages]');
  await wages.fill('120000');
  await expect(page).toHaveURL(/wages=120000/);
  await page.reload();
  await expect(wages).toHaveValue(/120,?000/);
});

test('intake: low-confidence fields start unchecked; Apply writes only checked ones', async ({ page }) => {
  await page.goto('tools/income-tax/?medWages=300000');
  await page.locator('textarea').first().fill('Married, I earned 90k.');
  await page.locator('[data-intake-run]').click();
  const boxes = page.locator('[data-intake-fields] input[type=checkbox]');
  await expect(boxes.first()).toBeVisible();
  // Both fields were assumed, not stated, so neither is pre-approved.
  for (const b of await boxes.all()) await expect(b).not.toBeChecked();
  await expect(page.locator('[data-intake-apply]')).toBeDisabled();
  await boxes.first().check();
  await page.locator('[data-intake-apply]').click();
  // Applying resets supplemental inputs from the previous calculation.
  await expect(page.locator('input[name=medWages]')).toHaveValue('');
});

for (const t of tools) {
  test(`${t.slug}: renders results with no errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`tools/${t.slug}/`);
    const first = page.locator('[data-out]').first();
    await expect(first).not.toHaveText('—');
    await expect(page.locator('[data-trace] tr').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}
