// Qualified business income deduction (§199A), one trade or business.
//
// Let T = taxable income before QBI, θ = threshold, ρ = phase-in range,
// p = clamp((T − θ) / ρ, 0, 1). Tentative = 20% · QBI.
// Wage limit W = max(50% · W-2 wages, 25% · W-2 wages + 2.5% · UBIA).
//
//   SSTB:      QBI, wages, and UBIA are first scaled by (1 − p).
//   p = 0:     component = tentative
//   0 < p < 1: component = tentative − p · max(0, tentative − W)
//   p = 1:     component = min(tentative, W)
//
// Deduction = min(component, 20% · (T − net capital gain)), floored at the
// OBBBA $400 minimum when QBI ≥ $1,000 (material participation assumed).

import type { FilingStatus } from './types.js';
import { TY2026, type TaxYear } from './years/2026.js';
import { clamp, round2 } from './money.js';

export interface QbiInput {
  status: FilingStatus;
  qbi: number;
  taxableBeforeQbi: number;
  netCapitalGain?: number;
  w2Wages?: number;
  ubia?: number;
  sstb?: boolean;
}

export interface QbiResult {
  deduction: number;
  phaseIn: number;
  tentative: number;
  wageLimit: number;
  incomeLimit: number;
  regime: 'below-threshold' | 'phase-in' | 'above-range';
  minimumApplied: boolean;
}

export function qbiDeduction(i: QbiInput, y: TaxYear = TY2026): QbiResult {
  const { rate, threshold, phaseInRange, minimumDeduction, minimumQbi } = y.qbi;
  const T = Math.max(0, i.taxableBeforeQbi);
  const p = clamp((T - threshold[i.status]) / phaseInRange[i.status], 0, 1);
  const scale = i.sstb ? 1 - p : 1;
  const qbi = Math.max(0, i.qbi) * scale;
  const wages = Math.max(0, i.w2Wages ?? 0) * scale;
  const ubia = Math.max(0, i.ubia ?? 0) * scale;

  const tentative = rate * qbi;
  const wageLimit = Math.max(0.5 * wages, 0.25 * wages + 0.025 * ubia);
  let component: number;
  if (p === 0) component = tentative;
  else if (p < 1) component = tentative - p * Math.max(0, tentative - wageLimit);
  else component = Math.min(tentative, wageLimit);

  const incomeLimit = rate * Math.max(0, T - Math.max(0, i.netCapitalGain ?? 0));
  let deduction = Math.min(component, incomeLimit);
  let minimumApplied = false;
  if (Math.max(0, i.qbi) >= minimumQbi && deduction < minimumDeduction) {
    deduction = Math.min(minimumDeduction, T);
    minimumApplied = deduction > 0;
  }
  return {
    deduction: round2(Math.max(0, deduction)),
    phaseIn: p,
    tentative: round2(tentative),
    wageLimit: round2(wageLimit),
    incomeLimit: round2(incomeLimit),
    regime: p === 0 ? 'below-threshold' : p < 1 ? 'phase-in' : 'above-range',
    minimumApplied,
  };
}
