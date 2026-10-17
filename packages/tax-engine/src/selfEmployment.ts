// Self-employment tax (Schedule SE) and the employment-tax surcharges that
// ride on the same earnings.
//
//   NE  = 0.9235 · net profit                          (§1402(a)(12) — the
//         "employer half" adjustment; 1 − 0.0765)
//   SS  = 0.124 · min(NE, max(0, wageBase − W-2 SS wages))
//   Med = 0.029 · NE
//   SE  = SS + Med;  deduction = SE / 2               (1040 Sch 1 L15)
//
// No SE tax is due when NE < $400 (§1402(b)).

import type { FilingStatus, Trace } from './types.js';
import { TY2026, cite, type TaxYear } from './years/2026.js';
import { round2, fmtUsd } from './money.js';

export interface SeInput {
  netProfit: number;
  /** Social Security wages from W-2s (box 3); they consume the wage base first. */
  w2SsWages?: number;
}

export interface SeResult {
  netEarnings: number;
  ssTaxable: number;
  socialSecurity: number;
  medicare: number;
  total: number;
  deduction: number;
  trace: Trace;
}

export function selfEmploymentTax(input: SeInput, y: TaxYear = TY2026): SeResult {
  const { ssRate, medicareRate, wageBase, seNetFactor } = y.fica;
  const profit = Math.max(0, input.netProfit);
  const w2 = Math.max(0, input.w2SsWages ?? 0);
  const ne = round2(profit * seNetFactor);
  const floorMet = ne >= 400;
  const room = Math.max(0, wageBase - w2);
  const ssTaxable = floorMet ? Math.min(ne, room) : 0;
  const socialSecurity = round2(ssTaxable * ssRate);
  const medicare = floorMet ? round2(ne * medicareRate) : 0;
  const total = round2(socialSecurity + medicare);
  const deduction = round2(total / 2);

  const trace: Trace = [
    { id: 'se.profit', label: 'Net profit from self-employment', value: profit, ref: 'Sch SE L3' },
    { id: 'se.ne', label: 'Net earnings from self-employment', value: ne, ref: 'Sch SE L6', formula: `${fmtUsd(profit)} × 92.35%`, authority: cite.se },
    { id: 'se.room', label: 'Wage base remaining after W-2 wages', value: room, ref: 'Sch SE L9', formula: `${fmtUsd(wageBase)} − ${fmtUsd(w2)}`, authority: cite.wageBase },
    { id: 'se.ss', label: 'Social Security portion', value: socialSecurity, ref: 'Sch SE L10', formula: `${fmtUsd(ssTaxable)} × 12.4%` },
    { id: 'se.med', label: 'Medicare portion', value: medicare, ref: 'Sch SE L11', formula: `${fmtUsd(floorMet ? ne : 0)} × 2.9%` },
    { id: 'se.total', label: 'Self-employment tax', value: total, ref: 'Sch SE L12', emphasis: 'total' },
    { id: 'se.ded', label: 'Deductible half of SE tax', value: deduction, ref: 'Sch SE L13 → Sch 1 L15', formula: `${fmtUsd(total, true)} ÷ 2` },
  ];
  if (!floorMet && profit > 0) {
    trace.splice(2, 0, { id: 'se.floor', label: 'Under the $400 floor — no SE tax', value: 0, ref: 'Sch SE L4c', authority: cite.se });
  }
  return { netEarnings: ne, ssTaxable, socialSecurity, medicare, total, deduction, trace };
}

/** Form 8959: 0.9% on Medicare wages + SE earnings above the threshold. */
export function additionalMedicare(status: FilingStatus, medicareWages: number, seNetEarnings: number, y: TaxYear = TY2026): number {
  const th = y.addlMedicare.threshold[status];
  const wages = Math.max(0, medicareWages);
  const onWages = Math.max(0, wages - th);
  // SE earnings use whatever threshold the wages left unused (Form 8959 Part II).
  const onSe = Math.max(0, Math.max(0, seNetEarnings) - Math.max(0, th - wages));
  return round2((onWages + onSe) * y.addlMedicare.rate);
}

/** Form 8960: 3.8% × min(net investment income, MAGI − threshold). */
export function netInvestmentIncomeTax(status: FilingStatus, magi: number, nii: number, y: TaxYear = TY2026): number {
  const over = Math.max(0, magi - y.niit.threshold[status]);
  return round2(Math.min(Math.max(0, nii), over) * y.niit.rate);
}
