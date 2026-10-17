// Cost recovery: §179 expensing, §168(k) bonus, then MACRS on what remains.
//
//   basis      = cost × business-use %
//   §179       = min(elected, limit − max(0, total §179 property − phase-out start), basis, business income)
//   bonus      = (basis − §179) × bonus %
//   MACRS base = basis − §179 − bonus, recovered at the GDS rate for each year
//
// GDS personal property (3–20 year) uses the half-year convention; 3/5/7/10-year
// at 200% declining balance and 15/20-year at 150%, each switching to straight
// line when SL yields more. Real property (27.5/39) is straight line, mid-month.
// Not modeled: the mid-quarter convention (>40% placed in service in Q4), and
// qualified improvement property, which is 15-year but straight line (§168(b)(3)).
//
// §179 needs >50% business use (Reg. §1.179-1(d)) and is limited to business
// income; the excess is carried forward (Form 4562 L13), never returned to the
// bonus/MACRS basis. Bonus has no business-use floor except for listed property
// (§280F), which must exceed 50% for both.

import type { Trace } from './types.js';
import { TY2026, cite, type TaxYear } from './years/2026.js';
import { fmtPct, fmtUsd, round2 } from './money.js';

export type RecoveryClass = '3' | '5' | '7' | '10' | '15' | '20' | '27.5' | '39';

export const RECOVERY_CLASSES: { key: RecoveryClass; label: string; examples: string }[] = [
  { key: '3', label: '3-year', examples: 'Tractor units, some tools' },
  { key: '5', label: '5-year', examples: 'Computers, vehicles, office equipment' },
  { key: '7', label: '7-year', examples: 'Office furniture, fixtures' },
  { key: '10', label: '10-year', examples: 'Vessels, single-purpose structures' },
  { key: '15', label: '15-year', examples: 'Land improvements (fences, paving)' },
  { key: '20', label: '20-year', examples: 'Farm buildings, utility property' },
  { key: '27.5', label: '27.5-year', examples: 'Residential rental property' },
  { key: '39', label: '39-year', examples: 'Nonresidential real property' },
];

/** Pub 946 Table A-1 — GDS half-year percentages, exactly as published. */
export const TABLE_A1: Record<'3' | '5' | '7' | '10' | '15' | '20', number[]> = {
  '3': [33.33, 44.45, 14.81, 7.41],
  '5': [20.0, 32.0, 19.2, 11.52, 11.52, 5.76],
  '7': [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
  '10': [10.0, 18.0, 14.4, 11.52, 9.22, 7.37, 6.55, 6.55, 6.56, 6.55, 3.28],
  '15': [5.0, 9.5, 8.55, 7.7, 6.93, 6.23, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 2.95],
  '20': [3.75, 7.219, 6.677, 6.177, 5.713, 5.285, 4.888, 4.522, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 2.231],
};

/**
 * Derive half-year MACRS rates from first principles: declining balance at
 * `factor / life`, switching to straight line over the remaining life when that
 * is larger. Used to verify Table A-1 (see tests), not for the schedule itself.
 */
export function deriveHalfYearRates(life: number, factor: number): number[] {
  const rates: number[] = [];
  let remaining = 1;
  for (let k = 1; k <= life + 1; k++) {
    let d: number;
    if (k === 1) {
      d = (factor / life) * 0.5;
    } else if (k === life + 1) {
      d = remaining;
    } else {
      const remainingLife = life - k + 1.5;
      d = Math.max(remaining * (factor / life), remaining / remainingLife);
    }
    d = Math.min(d, remaining);
    rates.push(d * 100);
    remaining -= d;
  }
  return rates;
}

/** Straight-line, mid-month rates for real property placed in service in `month` (1–12). */
export function realPropertyRates(life: 27.5 | 39, month: number): number[] {
  const m = Math.min(12, Math.max(1, Math.round(month)));
  const annual = 100 / life;
  const first = annual * ((12 - m + 0.5) / 12);
  const rates = [first];
  let left = 100 - first;
  while (left > 1e-9) {
    const d = Math.min(annual, left);
    rates.push(d);
    left -= d;
  }
  return rates;
}

/** Straight line over `life` years, half-year convention (ADS for listed property). */
export function straightLineHalfYear(life: number): number[] {
  const annual = 100 / life;
  return [annual / 2, ...Array.from({ length: life - 1 }, () => annual), annual / 2];
}

export function ratesFor(cls: RecoveryClass, month = 1): number[] {
  if (cls === '27.5') return realPropertyRates(27.5, month);
  if (cls === '39') return realPropertyRates(39, month);
  return TABLE_A1[cls];
}

export interface DepreciationInput {
  cost: number;
  recoveryClass: RecoveryClass;
  /** Month placed in service (1–12). Used for real property's mid-month convention. */
  month?: number;
  businessUsePct?: number;
  section179?: number;
  /** Total §179 property placed in service this year (drives the phase-out). Defaults to cost. */
  total179Property?: number;
  /** Listed property (vehicles and similar, §280F): bonus also needs >50% business use. */
  listedProperty?: boolean;
  /** Taxable business income limit on §179; omit to ignore the limit. */
  businessIncome?: number | null;
  /** 0–1. Defaults to the year’s rate for qualified property. */
  bonusPct?: number;
  /** Placed-in-service year for the schedule labels. */
  startYear?: number;
}

export interface DepreciationRow {
  year: number;
  rate: number;
  macrs: number;
  section179: number;
  bonus: number;
  total: number;
  endingBasis: number;
}

export interface DepreciationResult {
  basis: number;
  /** §179 deduction allowed this year (after the business-income limit). */
  section179: number;
  /** §179 elected; removed from bonus/MACRS basis in full. */
  section179Elected: number;
  /** Elected but disallowed by the income limit; deductible in later years. */
  carryforward: number;
  section179Limit: number;
  bonus: number;
  macrsBase: number;
  rows: DepreciationRow[];
  firstYear: number;
  trace: Trace;
}

export function depreciate(i: DepreciationInput, y: TaxYear = TY2026): DepreciationResult {
  const use = Math.min(1, Math.max(0, i.businessUsePct ?? 1));
  const basis = round2(Math.max(0, i.cost) * use);
  const isReal = i.recoveryClass === '27.5' || i.recoveryClass === '39';
  const s179Eligible = !isReal && use > 0.5;
  const bonusEligible = !isReal && (!i.listedProperty || use > 0.5);

  const totalProp = Math.max(i.total179Property ?? i.cost, i.cost);
  const section179Limit = Math.max(0, y.sec179.limit - Math.max(0, totalProp - y.sec179.phaseoutStart));
  const incomeCap = i.businessIncome == null ? Infinity : Math.max(0, i.businessIncome);
  const section179Elected = s179Eligible ? round2(Math.min(Math.max(0, i.section179 ?? 0), section179Limit, basis)) : 0;
  const section179 = round2(Math.min(section179Elected, incomeCap));
  const carryforward = round2(section179Elected - section179);

  const bonusPct = bonusEligible ? Math.min(1, Math.max(0, i.bonusPct ?? y.bonusPct)) : 0;
  const bonus = round2((basis - section179Elected) * bonusPct);
  const macrsBase = round2(basis - section179Elected - bonus);

  // Listed property at 50% business use or less must use ADS straight line
  // (§280F(b)(1)). ADS periods match GDS for vehicles and computers (5 years);
  // other listed property can differ — the trace says which method applied.
  const ads = !isReal && !!i.listedProperty && use <= 0.5;
  const rates = ads ? straightLineHalfYear(Number(i.recoveryClass)) : ratesFor(i.recoveryClass, i.month ?? 1);
  const start = i.startYear ?? y.year;
  // Basis left after the full election (the carryforward is a deferred deduction, not basis).
  let left = round2(basis - section179Elected + section179);
  let assigned = 0;
  const rows: DepreciationRow[] = rates.map((r, k) => {
    const last = k === rates.length - 1;
    // The final year takes the exact remainder so the schedule sums to basis.
    const macrs = last ? round2(macrsBase - assigned) : round2((macrsBase * r) / 100);
    assigned = round2(assigned + macrs);
    const s179 = k === 0 ? section179 : 0;
    const b = k === 0 ? bonus : 0;
    const total = round2(macrs + s179 + b);
    left = round2(left - total);
    return { year: start + k, rate: r, macrs, section179: s179, bonus: b, total, endingBasis: Math.max(0, left) };
  });

  const firstYear = rows[0]?.total ?? 0;
  const trace: Trace = [
    { id: 'dep.basis', label: 'Depreciable basis', value: basis, ref: '4562 L19/L6', formula: `${fmtUsd(i.cost)} × ${fmtPct(use, 0)} business use` },
    { id: 'dep.limit', label: '§179 limit after phase-out', value: section179Limit, ref: '4562 L5', formula: `${fmtUsd(y.sec179.limit)} − max(0, ${fmtUsd(totalProp)} − ${fmtUsd(y.sec179.phaseoutStart)})`, authority: cite.sec179 },
    { id: 'dep.179e', label: '§179 expense elected', value: section179Elected, ref: '4562 L8', formula: s179Eligible ? undefined : isReal ? 'not available for buildings' : 'requires >50% business use', authority: cite.sec179 },
    { id: 'dep.179', label: '§179 deduction allowed', value: section179, ref: '4562 L12', formula: carryforward ? `limited to business income ${fmtUsd(incomeCap)}` : undefined, authority: cite.sec179 },
    ...(carryforward ? [{ id: 'dep.carry', label: '§179 carryforward to next year', value: carryforward, ref: '4562 L13', formula: `${fmtUsd(section179Elected)} − ${fmtUsd(section179)}`, authority: cite.sec179 }] : []),
    { id: 'dep.bonus', label: 'Special (bonus) depreciation', value: bonus, ref: '4562 L14', formula: bonusEligible ? `${fmtUsd(basis - section179Elected)} × ${fmtPct(bonusPct, 0)}` : isReal ? 'not available for buildings' : 'listed property needs >50% business use', authority: cite.bonus },
    { id: 'dep.macrs1', label: 'MACRS deduction, year 1', value: rows[0]?.macrs ?? 0, ref: '4562 L19', formula: `${fmtUsd(macrsBase)} × ${(rows[0]?.rate ?? 0).toFixed(3)}%${ads ? ' (ADS straight line, §280F(b))' : ''}`, authority: cite.macrs },
    { id: 'dep.first', label: 'First-year deduction', value: firstYear, ref: '4562 L22', emphasis: 'total' },
  ];

  return { basis, section179, section179Elected, carryforward, section179Limit, bonus, macrsBase, rows, firstYear, trace };
}

/**
 * Present value of the tax shield: Σ deductionₜ · τ / (1 + r)ᵗ, with the first
 * year discounted one period. Accelerated recovery is worth more than the same
 * total deducted later — this is the number that shows how much.
 */
export function taxShieldPv(deductions: number[], taxRate: number, discountRate: number): number {
  return round2(deductions.reduce((pv, d, t) => pv + (d * taxRate) / Math.pow(1 + discountRate, t + 1), 0));
}
