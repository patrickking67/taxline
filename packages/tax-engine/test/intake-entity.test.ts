// Scenario intake (offline extractor + validation) and the S-corp comparison.
// Entity expectations are worked by hand from the 2026 schedules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAILED_CHECK_CAP,
  compareEntity,
  computeReturn,
  extractScenario,
  parseAmount,
  firmRoi,
  maxSalary,
  payrollFica,
  salarySweep,
  scenarioToInput,
  validateScenario,
} from '../src/index.js';

const near = (actual: number, expected: number, tol = 0.02) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);
const val = (r: ReturnType<typeof extractScenario>, key: string) => r.fields.find((f) => f.key === key)?.value;

test('parseAmount reads the ways people write money', () => {
  assert.equal(parseAmount('$85k'), 85_000);
  assert.equal(parseAmount('85,000'), 85_000);
  assert.equal(parseAmount('1.2 million'), 1_200_000);
  assert.equal(parseAmount('about 40 grand'), 40_000);
  assert.equal(parseAmount('no amount here'), null);
});

test('offline extractor: joint filers with W-2, freelance, and investments', () => {
  const r = extractScenario(
    "I'm married filing jointly with two kids. I make $142k salary with $16,500 withheld, and my wife freelances — about $38,000 profit after expenses. We got $4,000 in qualified dividends and $1,200 of interest.",
  );
  assert.equal(val(r, 'status'), 'mfj');
  assert.equal(val(r, 'children'), 2);
  assert.equal(val(r, 'wages'), 142_000);
  assert.equal(val(r, 'federalWithholding'), 16_500);
  assert.equal(val(r, 'selfEmploymentProfit'), 38_000);
  assert.equal(val(r, 'qualifiedDividends'), 4_000);
  assert.equal(val(r, 'interest'), 1_200);
  // Every field quotes text that is actually in the input.
  for (const f of r.fields) assert.ok(f.evidence && f.confidence! > FAILED_CHECK_CAP, f.key);
});

test('offline extractor: losses keep their sign, assumptions route to review', () => {
  const r = extractScenario('Single. Sold stock for a $12,000 long-term gain and a short-term loss of $3,000.');
  assert.equal(val(r, 'longTermGain'), 12_000);
  assert.equal(val(r, 'shortTermGain'), -3_000);

  const m = extractScenario('Married, I earned 90k.');
  const status = m.fields.find((f) => f.key === 'status')!;
  assert.equal(status.value, 'mfj');
  assert.ok(status.confidence! < 0.85, 'joint filing was assumed, not stated');
  assert.ok(m.fields.find((f) => f.key === 'wages')!.confidence! < 0.85, 'income source was not stated');
});

test('offline extractor returns nothing it cannot ground', () => {
  const r = extractScenario('I need help with my taxes this year.');
  assert.equal(r.fields.length, 0);
});

test('validation caps a field whose quote is not in the text, or does not state the value', () => {
  const text = 'I made $85,000 in salary.';
  const out = validateScenario(text, [
    { key: 'wages', value: 95_000, confidence: 0.99, evidence: 'I made $85,000 in salary' },
    { key: 'federalWithholding', value: 9_000, confidence: 0.99, evidence: '$9,000 withheld' },
    { key: 'status', value: 'married' as never, confidence: 0.9, evidence: 'I made' },
  ]);
  const wages = out.find((f) => f.key === 'wages')!;
  assert.equal(wages.confidence, FAILED_CHECK_CAP);
  assert.match(wages.note!, /does not state this amount/);
  const wh = out.find((f) => f.key === 'federalWithholding')!;
  assert.equal(wh.confidence, FAILED_CHECK_CAP);
  assert.match(wh.note!, /does not appear/);
  assert.equal(out.find((f) => f.key === 'status')!.value, null);
});

test('validation drops unknown keys and keeps nulls as nulls', () => {
  const out = validateScenario('hello', [
    { key: 'ssn' as never, value: 1, confidence: 1, evidence: 'hello' },
    { key: 'wages', value: null, confidence: 0.9, evidence: null },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.confidence, null);
  assert.deepEqual(scenarioToInput(out), {});
});

test('scenarioToInput keeps qualified dividends inside ordinary dividends', () => {
  const input = scenarioToInput([{ key: 'qualifiedDividends', value: 4_000, confidence: 0.9, evidence: 'x' }]);
  assert.equal(input.ordinaryDividends, 4_000);
});

test('payroll FICA splits evenly and caps Social Security per employer', () => {
  assert.deepEqual(payrollFica(60_000, 0), { employee: 4_590, employer: 4_590 });
  // Employee side credits SS already paid at another job; employer side does not.
  const f = payrollFica(60_000, 180_000);
  near(f.employee, 4_500 * 0.062 + 60_000 * 0.0145);
  near(f.employer, 4_590);
});

test('S corp vs sole prop at $150,000 profit, $60,000 salary, $2,000 overhead', () => {
  const r = compareEntity({ status: 'single', profit: 150_000, salary: 60_000, overhead: 2_000 });
  // K-1 = 150,000 − 60,000 − 4,590 − 2,000
  near(r.scorp.k1, 83_410);
  // Sole prop: SE 21,194.33; taxable 98,642.26 → Tax Table 16,410
  near(r.sole.ret.seTax, 21_194.33);
  near(r.sole.ret.taxable, 98_642.26);
  near(r.sole.total, 37_604.33);
  // S corp: taxable 110,628 → 17,966 + 24% × 4,928 = 19,148.72; + FICA 9,180 + 2,000
  near(r.scorp.ret.taxable, 110_628);
  near(r.scorp.total, 30_328.72);
  near(r.savings, 7_275.61);
  assert.equal(r.sole.total, computeReturn({ status: 'single', selfEmploymentProfit: 150_000 }).netLiability);
});

test('salary is capped at what the business can pay, and the sweep is ordered', () => {
  const r = compareEntity({ status: 'single', profit: 50_000, salary: 1_000_000 });
  near(r.scorp.k1, 0, 0.05);
  const sweep = salarySweep({ status: 'single', profit: 120_000, salary: 0, overhead: 1_500 }, 10);
  assert.equal(sweep.length, 11);
  assert.ok(sweep.every((p, i) => i === 0 || p[0] > sweep[i - 1]![0]));
  // Paying the whole profit as salary saves less than a partial salary.
  assert.ok(sweep[10]![1] < sweep[5]![1]);
});

test('salary ceiling stops employer Social Security at the wage base', () => {
  // Below the base: S × 1.0765 = available.
  near(maxSalary(100_000, 0), 100_000 / 1.0765);
  // Above it: (500,000 − 6.2% × 184,500) / 1.0145
  near(maxSalary(500_000, 0), 481_578.12);
});

test('ROI horizon is bounded in the engine, not only the UI', () => {
  const r = firmRoi({
    returnsPerYear: 100, hoursPerReturn: 5, reduction: 0.3, loadedHourlyCost: 80,
    seats: 1, pricePerSeatMonth: 59, onboardingCost: 0, discountRate: 0.1, years: 1e9, rampMonths: 1e9,
  });
  assert.equal(r.cumulative.length, 30 * 12 + 1);
});

test('S-corp salary adds to existing Medicare and QBI wage bases', () => {
  const r = compareEntity({
    status: 'single', profit: 150_000, salary: 60_000,
    household: { wages: 200_000, medicareWages: 200_000, qbiW2Wages: 100_000 },
  });
  // (200,000 + 60,000 − 200,000) × 0.9%
  near(r.scorp.ret.addlMedicare, 540);
  assert.ok(r.scorp.ret.qbi.wageLimit >= 80_000, `wage limit ${r.scorp.ret.qbi.wageLimit}`);
});
