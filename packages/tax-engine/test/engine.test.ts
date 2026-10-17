// Every expected value below is worked by hand from the published IRS tables
// (Rev. Proc. 2025-32, Pub 946) — not copied from the engine's own output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TY2026,
  TABLE_A1,
  additionalMedicare,
  baseAmounts,
  computeReturn,
  deriveHalfYearRates,
  depreciate,
  estimatedTax,
  firmRoi,
  irr,
  marginalRate,
  netInvestmentIncomeTax,
  npv,
  qbiDeduction,
  realPropertyRates,
  round2,
  scheduleTax,
  selfEmploymentTax,
  taxShieldPv,
  taxTableTax,
} from '../src/index.js';

const near = (actual: number, expected: number, tol = 0.011) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

test('bracket base amounts match the Rev. Proc. 2025-32 tables', () => {
  assert.deepEqual(baseAmounts(TY2026.brackets.single), [0, 1_240, 5_800, 17_966, 41_024, 58_448, 192_979.25]);
  assert.deepEqual(baseAmounts(TY2026.brackets.mfj), [0, 2_480, 11_600, 35_932, 82_048, 116_896, 206_583.5]);
  assert.deepEqual(baseAmounts(TY2026.brackets.hoh), [0, 1_770, 7_740, 16_155, 39_207, 56_631, 191_171]);
  assert.equal(baseAmounts(TY2026.brackets.mfs).at(-1), 103_291.75);
});

test('rate schedule and marginal rate', () => {
  assert.equal(scheduleTax(100_000, TY2026.brackets.single), 16_712);
  assert.equal(scheduleTax(0, TY2026.brackets.single), 0);
  assert.equal(scheduleTax(-5, TY2026.brackets.single), 0);
  assert.equal(marginalRate(100_000, TY2026.brackets.single), 0.22);
  assert.equal(marginalRate(50_400, TY2026.brackets.single), 0.12);
  assert.equal(marginalRate(50_401, TY2026.brackets.single), 0.22);
  // Top bracket: 192,979.25 + 37% × 359,400
  assert.equal(scheduleTax(1_000_000, TY2026.brackets.single), 325_957.25);
});

test('Tax Table uses the row midpoint below $100,000', () => {
  // Row 50,000–50,050 → 50,025: 1,240 + 12% × 37,625 = 5,755
  assert.equal(taxTableTax(50_020, TY2026.brackets.single), 5_755);
  assert.equal(taxTableTax(3, TY2026.brackets.single), 0);
  assert.equal(taxTableTax(30, TY2026.brackets.single), 4);
  assert.equal(taxTableTax(150_000, TY2026.brackets.single), scheduleTax(150_000, TY2026.brackets.single));
});

test('self-employment tax', () => {
  const a = selfEmploymentTax({ netProfit: 100_000 });
  near(a.netEarnings, 92_350);
  near(a.socialSecurity, 11_451.4);
  near(a.medicare, 2_678.15);
  near(a.total, 14_129.55);
  near(a.deduction, 7_064.78);

  // W-2 wages consume the wage base first: 184,500 − 180,000 = 4,500 left.
  const b = selfEmploymentTax({ netProfit: 50_000, w2SsWages: 180_000 });
  near(b.ssTaxable, 4_500);
  near(b.socialSecurity, 558);
  near(b.medicare, 1_339.08);

  assert.equal(selfEmploymentTax({ netProfit: 400 }).total, 0);
});

test('Additional Medicare and NIIT thresholds', () => {
  near(additionalMedicare('single', 300_000, 0), 900);
  // MFJ: 250k threshold, 200k wages leave 50k for SE earnings of 92,350.
  near(additionalMedicare('mfj', 200_000, 92_350), 0.009 * 42_350);
  near(netInvestmentIncomeTax('single', 350_000, 50_000), 1_900);
  near(netInvestmentIncomeTax('single', 210_000, 50_000), 380);
});

test('1040: single W-2 earner owes a balance', () => {
  const r = computeReturn({ status: 'single', wages: 85_000, federalWithholding: 9_000 });
  assert.equal(r.taxable, 68_900);
  // Row 68,900–68,950 → 68,925: 5,800 + 22% × 18,525 = 9,875.50 → 9,876
  assert.equal(r.incomeTax, 9_876);
  assert.equal(r.balance, -876);
  near(r.marginalRate, 0.22, 1e-9);
  assert.equal(r.lines.find((l) => l.id === 'balance')?.label, 'Amount you owe');
});

test('1040: joint filers with two children', () => {
  const r = computeReturn({ status: 'mfj', wages: 120_000, children: 2 });
  assert.equal(r.taxable, 87_800);
  // 87,825 midpoint: 2,480 + 12% × 63,025 = 10,043; less $4,400 CTC.
  assert.equal(r.incomeTax, 10_043);
  assert.equal(r.totalTax, 5_643);
});

test('1040: long-term gains stack on ordinary income at 0%', () => {
  const r = computeReturn({ status: 'single', wages: 40_000, longTermGain: 20_000 });
  assert.equal(r.taxable, 43_900);
  assert.equal(r.preferential.atZero, 20_000);
  // Ordinary 23,900 → row midpoint 23,925: 1,240 + 12% × 11,525 = 2,623
  assert.equal(r.incomeTax, 2_623);
});

test('1040: capital losses are limited to $3,000', () => {
  const r = computeReturn({ status: 'single', wages: 60_000, shortTermGain: -10_000 });
  assert.equal(r.totalIncome, 57_000);
});

test('1040: high earner pays NIIT and Additional Medicare', () => {
  const r = computeReturn({ status: 'single', wages: 300_000, interest: 50_000 });
  near(r.niit, 1_900);
  near(r.addlMedicare, 900);
});

test('QBI: below threshold, limited to 20% of taxable income', () => {
  const r = computeReturn({ status: 'single', selfEmploymentProfit: 100_000 });
  // AGI = 100,000 − 7,064.78 = 92,935.22; before QBI = 76,835.22
  near(r.agi, 92_935.22);
  near(r.qbi.tentative, 18_587.04);
  near(r.qbi.deduction, 15_367.04);
  assert.equal(r.qbi.regime, 'below-threshold');
});

test('QBI: phase-in and SSTB phase-out', () => {
  // Halfway through the single range (201,750 + 37,500).
  const mid = qbiDeduction({ status: 'single', qbi: 200_000, taxableBeforeQbi: 239_250, w2Wages: 20_000 });
  assert.equal(mid.phaseIn, 0.5);
  // tentative 40,000; wage limit 10,000; 40,000 − 0.5 × 30,000 = 25,000
  assert.equal(mid.deduction, 25_000);
  // Fully phased out above the range: the SSTB's qualifying income is zero, so
  // the OBBBA $400 minimum (which tests income after the exclusion) does not apply.
  const sstb = qbiDeduction({ status: 'single', qbi: 200_000, taxableBeforeQbi: 300_000, sstb: true });
  assert.equal(sstb.deduction, 0);
  assert.equal(sstb.minimumApplied, false);
  // A small non-SSTB business below the threshold still gets the minimum.
  const small = qbiDeduction({ status: 'single', qbi: 1_500, taxableBeforeQbi: 50_000 });
  assert.equal(small.deduction, 400);
});

test('estimated tax safe harbor', () => {
  const a = estimatedTax({ status: 'single', currentYearTax: 20_000, withholding: 5_000, priorYearTax: 15_000, priorYearAgi: 100_000 });
  assert.equal(a.safeHarbor, 15_000);
  assert.equal(a.basis, 'prior-year');
  assert.equal(a.dueFromEstimates, 10_000);
  assert.deepEqual(a.installments.map((x) => x.amount), [2_500, 2_500, 2_500, 2_500]);
  assert.equal(a.installments[3]?.due, '2027-01-15');

  const b = estimatedTax({ status: 'single', currentYearTax: 20_000, withholding: 5_000, priorYearTax: 15_000, priorYearAgi: 200_000 });
  assert.equal(b.priorYearTarget, 16_500);
  assert.equal(b.dueFromEstimates, 11_500);

  const c = estimatedTax({ status: 'single', currentYearTax: 5_500, withholding: 4_800, priorYearTax: 9_000 });
  assert.equal(c.required, false);

  // Prior-year AGI unknown: the conservative 110% test applies.
  const u = estimatedTax({ status: 'single', currentYearTax: 32_000, withholding: 6_000, priorYearTax: 26_000 });
  assert.equal(u.priorYearTarget, 28_600);
  assert.equal(u.safeHarbor, 28_600);

  const d = estimatedTax({ status: 'single', currentYearTax: 10_001, withholding: 0, priorYearFull: false });
  const sum = d.installments.reduce((s, x) => s + x.amount, 0);
  near(sum, 9_000.9, 1e-6);
});

test('MACRS Table A-1 matches first-principles derivation', () => {
  for (const [life, factor] of [[3, 2], [5, 2], [7, 2], [10, 2], [15, 1.5], [20, 1.5]] as const) {
    const derived = deriveHalfYearRates(life, factor);
    const table = TABLE_A1[String(life) as keyof typeof TABLE_A1];
    assert.equal(derived.length, table.length, `${life}-year length`);
    // The published table is rounded and nudged so each column sums to 100.
    derived.forEach((d, k) => near(d, table[k]!, life === 20 ? 0.0011 : 0.011));
    near(table.reduce((a, b) => a + b, 0), 100, 0.002);
  }
});

test('real property mid-month rates', () => {
  near(realPropertyRates(27.5, 1)[0]!, 3.485, 0.001);
  near(realPropertyRates(27.5, 1)[1]!, 3.636, 0.001);
  // Exact mid-month: (11.5 / 12) / 39 = 2.457%. Pub 946 Table A-7a prints 2.461
  // because it steps from December in rounded 0.214 increments; both are accepted.
  near(realPropertyRates(39, 1)[0]!, 2.457, 0.001);
  near(realPropertyRates(39, 12)[0]!, 0.107, 0.001);
  near(realPropertyRates(27.5, 6).reduce((a, b) => a + b, 0), 100, 1e-9);
});

test('depreciation schedule: MACRS, bonus, and §179 phase-out', () => {
  const plain = depreciate({ cost: 10_000, recoveryClass: '5', bonusPct: 0 });
  assert.equal(plain.firstYear, 2_000);
  near(plain.rows.reduce((s, r) => s + r.total, 0), 10_000, 1e-9);
  assert.equal(plain.rows.length, 6);

  assert.equal(depreciate({ cost: 10_000, recoveryClass: '5' }).firstYear, 10_000);

  const phased = depreciate({ cost: 100_000, recoveryClass: '7', section179: 100_000, total179Property: 4_200_000, bonusPct: 0 });
  assert.equal(phased.section179Limit, 2_450_000);
  assert.equal(phased.section179, 100_000);

  // The income limit defers §179; the disallowed $30,000 carries forward and is
  // NOT returned to the MACRS basis.
  const capped = depreciate({ cost: 50_000, recoveryClass: '7', section179: 50_000, businessIncome: 20_000, bonusPct: 0 });
  assert.equal(capped.section179Elected, 50_000);
  assert.equal(capped.section179, 20_000);
  assert.equal(capped.carryforward, 30_000);
  assert.equal(capped.macrsBase, 0);
  assert.equal(capped.firstYear, 20_000);

  const building = depreciate({ cost: 275_000, recoveryClass: '27.5', section179: 50_000 });
  assert.equal(building.section179, 0);
  assert.equal(building.bonus, 0);

  // 40% business use: no §179 (needs >50%), but ordinary property still gets bonus…
  const furniture = depreciate({ cost: 40_000, recoveryClass: '7', businessUsePct: 0.4, section179: 10_000 });
  assert.equal(furniture.basis, 16_000);
  assert.equal(furniture.section179, 0);
  assert.equal(furniture.bonus, 16_000);
  // …while listed property (§280F) gets neither.
  // At ≤50% business use, listed property also moves to ADS straight line:
  // 5-year, half-year → 10% of the $16,000 business basis in year one.
  const car = depreciate({ cost: 40_000, recoveryClass: '5', businessUsePct: 0.4, listedProperty: true });
  assert.equal(car.bonus, 0);
  near(car.firstYear, 1_600);
  assert.equal(car.rows.length, 6);
  near(car.rows.reduce((s, r) => s + r.total, 0), 16_000, 1e-6);
});

test('tax shield PV favors accelerated recovery', () => {
  const fast = taxShieldPv([10_000], 0.24, 0.08);
  const slow = taxShieldPv([2_000, 3_200, 1_920, 1_152, 1_152, 576], 0.24, 0.08);
  near(fast, 2_222.22);
  assert.ok(fast > slow);
});

test('NPV, IRR, and firm ROI', () => {
  near(npv(0.1, [-100, 110]), 0, 1e-9);
  near(irr([-100, 110])!, 0.1, 1e-6);
  assert.equal(irr([100, 100]), null);
  assert.equal(irr([-1, 1_000_000]), Infinity);

  const r = firmRoi({
    returnsPerYear: 600, hoursPerReturn: 6, reduction: 0.4, loadedHourlyCost: 85,
    seats: 5, pricePerSeatMonth: 59, onboardingCost: 5_000, discountRate: 0.1, years: 3,
  });
  assert.equal(r.hoursSaved, 1_440);
  assert.equal(r.laborValue, 122_400);
  assert.equal(r.subscription, 3_540);
  assert.equal(r.netAnnual, 118_860);
  // 5,000 / (118,860 / 12) = 0.5048 months
  near(r.paybackMonths!, 0.5, 1e-9); // 5,000 / (118,860 / 12) = 0.5048, to the cent of a month
  assert.equal(r.capacityReturns, 400);
  assert.equal(r.cumulative.length, 37);
});

test('rounding is half away from zero at every magnitude', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(-1.005), -1.01);
  assert.equal(round2(10.075), 10.08);
  assert.equal(round2(-10.075), -10.08);
  assert.equal(round2(10_000.005), 10_000.01);
  assert.equal(round2(1e-7), 0);
  assert.equal(round2(123_456.785), 123_456.79);
});

test('1040: a Schedule C loss offsets other income', () => {
  const r = computeReturn({ status: 'single', wages: 60_000, selfEmploymentProfit: -10_000 });
  assert.equal(r.totalIncome, 50_000);
  assert.equal(r.seTax, 0);
  assert.equal(r.taxable, 33_900);
});

test('1040: a spouse’s wages do not use up the SE owner’s wage base', () => {
  const joint = computeReturn({ status: 'mfj', wages: 185_000, selfEmploymentProfit: 100_000 });
  near(joint.seTax, 14_129.55);
  const own = computeReturn({ status: 'mfj', wages: 185_000, seOwnerSsWages: 185_000, selfEmploymentProfit: 100_000 });
  near(own.seTax, 2_678.15);
});

test('1040: Additional Medicare uses box 5 wages; NIIT nets the capital loss', () => {
  near(computeReturn({ status: 'single', wages: 200_000, medicareWages: 220_000 }).addlMedicare, 180);
  near(computeReturn({ status: 'single', wages: 300_000, interest: 10_000, shortTermGain: -3_000 }).niit, 266);
});
