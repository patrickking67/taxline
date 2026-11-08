// compute_deadline: the statutory rule plus the IRC 7503 weekend and holiday shift.
// Expected dates are the published IRS deadlines for those years, not engine output.

import test from 'node:test';
import assert from 'node:assert/strict';
import { calendar, observedDate } from '../src/tools/calendar.js';

async function due(form: string, args: { taxYear?: number; yearEnd?: string }) {
  const r = await calendar.run({ form, ...args });
  assert.ok(r.ok, JSON.stringify(r));
  return r.data;
}

test('Form 1040 dates for recent years, including the Emancipation Day shifts', async () => {
  // TY2021: April 15, 2022 was a Friday and Emancipation Day was observed that day.
  assert.equal((await due('1040', { taxYear: 2021 })).dueDate, '2022-04-18');
  // TY2022: April 15, 2023 was a Saturday; Emancipation Day was observed Monday the 17th.
  assert.equal((await due('1040', { taxYear: 2022 })).dueDate, '2023-04-18');
  assert.equal((await due('1040', { taxYear: 2023 })).dueDate, '2024-04-15');
  assert.equal((await due('1040', { taxYear: 2024 })).dueDate, '2025-04-15');
  const ty2025 = await due('1040', { taxYear: 2025 });
  assert.equal(ty2025.dueDate, '2026-04-15');
  assert.equal(ty2025.shifted, false);
});

test('business returns shift off a weekend', async () => {
  // March 15, 2025 was a Saturday.
  const s = await due('1120-S', { taxYear: 2024 });
  assert.equal(s.ruleDate, '2025-03-15');
  assert.equal(s.dueDate, '2025-03-17');
  assert.equal(s.shifted, true);
  assert.equal((await due('1065', { taxYear: 2025 })).dueDate, '2026-03-16');
});

test('fiscal year-ends count months from the year-end', async () => {
  assert.equal((await due('1120', { yearEnd: '2025-06-30' })).ruleDate, '2025-10-15');
  assert.equal((await due('990', { yearEnd: '2025-09-30' })).ruleDate, '2026-02-15');
});

test('observed dates move Saturday back and Sunday forward', () => {
  assert.equal(observedDate(2022, 4, 16), '2022-04-15'); // Saturday
  assert.equal(observedDate(2023, 4, 16), '2023-04-17'); // Sunday
  assert.equal(observedDate(2026, 4, 16), '2026-04-16'); // Thursday
  assert.equal(observedDate(2022, 1, 1), '2021-12-31'); // Saturday, observed the year before
});

test('impossible dates and years are validation errors, not rolled-over dates', async () => {
  for (const args of [{ yearEnd: '2025-02-30' }, { yearEnd: '2025-13-01' }, { yearEnd: '12/31/2025' }, { taxYear: 2025.5 }, { taxYear: 25 }]) {
    const r = await calendar.run({ form: '1040', ...args });
    assert.equal(r.ok, false, JSON.stringify(args));
    if (!r.ok) assert.equal(r.errorCategory, 'validation');
  }
  const unknown = await calendar.run({ form: '941', taxYear: 2025 });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.errorCategory, 'business');
});
