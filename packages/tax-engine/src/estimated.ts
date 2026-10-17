// Required estimated tax and the §6654(d) safe harbor.
//
//   current  = 90% · this year's total tax
//   prior    = 100% · last year's tax  (110% when prior-year AGI > $150,000, $75,000 MFS)
//   required = min(current, prior)     (prior only if last year was a full 12-month return)
//   due      = max(0, required − withholding), paid in four equal installments
//
// No estimates are required when this year's tax less withholding is under $1,000,
// or when last year's tax was zero for a full-year return.

import type { FilingStatus, Trace } from './types.js';
import { TY2026, cite, type TaxYear } from './years/2026.js';
import { fmtUsd, round2 } from './money.js';

export interface EstimatedInput {
  status: FilingStatus;
  currentYearTax: number;
  withholding: number;
  priorYearTax?: number | null;
  priorYearAgi?: number;
  /** False when there was no prior-year return or it covered under 12 months. */
  priorYearFull?: boolean;
  /** Estimates already paid this year, applied to installments in order. */
  paidToDate?: number;
}

export interface Installment {
  n: number;
  due: string;
  amount: number;
  paid: number;
  remaining: number;
}

export interface EstimatedResult {
  required: boolean;
  reason: string;
  basis: 'current-year' | 'prior-year' | 'none';
  currentYearTarget: number;
  priorYearTarget: number | null;
  safeHarbor: number;
  dueFromEstimates: number;
  installments: Installment[];
  trace: Trace;
}

export function estimatedTax(i: EstimatedInput, y: TaxYear = TY2026): EstimatedResult {
  const e = y.estimated;
  const tax = Math.max(0, i.currentYearTax);
  const wh = Math.max(0, i.withholding);
  const currentYearTarget = round2(tax * e.currentYearPct);
  const hasPrior = i.priorYearFull !== false && i.priorYearTax != null;
  const highIncome = (i.priorYearAgi ?? 0) > e.highAgi[i.status];
  const priorPct = highIncome ? e.priorYearHighPct : e.priorYearPct;
  const priorYearTarget = hasPrior ? round2(Math.max(0, i.priorYearTax ?? 0) * priorPct) : null;

  const safeHarbor = priorYearTarget == null ? currentYearTarget : Math.min(currentYearTarget, priorYearTarget);
  const basis: EstimatedResult['basis'] = priorYearTarget != null && priorYearTarget < currentYearTarget ? 'prior-year' : 'current-year';

  let required = true;
  let reason = 'Withholding does not cover the safe harbor.';
  if (tax - wh < e.minimumBalanceDue) {
    required = false;
    reason = `Tax after withholding is under ${fmtUsd(e.minimumBalanceDue)}.`;
  } else if (hasPrior && (i.priorYearTax ?? 0) === 0) {
    required = false;
    reason = 'Prior-year tax was zero on a full-year return.';
  } else if (wh >= safeHarbor) {
    required = false;
    reason = 'Withholding already meets the safe harbor.';
  }

  const dueFromEstimates = required ? round2(Math.max(0, safeHarbor - wh)) : 0;
  const per = round2(dueFromEstimates / 4);
  let credit = Math.max(0, i.paidToDate ?? 0);
  const installments: Installment[] = e.dueDates.map((due, k) => {
    // The last installment absorbs rounding so the four sum exactly.
    const amt = k === 3 ? round2(dueFromEstimates - per * 3) : per;
    const paid = Math.min(credit, amt);
    credit -= paid;
    return { n: k + 1, due, amount: amt, paid: round2(paid), remaining: round2(amt - paid) };
  });

  const trace: Trace = [
    { id: 'est.tax', label: 'Expected total tax this year', value: tax, ref: '1040-ES L10' },
    { id: 'est.cur', label: '90% of this year’s tax', value: currentYearTarget, ref: '1040-ES L12a', formula: `${fmtUsd(tax)} × 90%`, authority: cite.estimated },
    ...(priorYearTarget != null
      ? [{ id: 'est.prior', label: `${Math.round(priorPct * 100)}% of last year’s tax`, value: priorYearTarget, ref: '1040-ES L12b', formula: `${fmtUsd(i.priorYearTax ?? 0)} × ${Math.round(priorPct * 100)}%${highIncome ? ' (AGI over threshold)' : ''}`, authority: cite.estimated }]
      : []),
    { id: 'est.safe', label: 'Required annual payment (safe harbor)', value: safeHarbor, ref: '1040-ES L12c', formula: priorYearTarget == null ? 'current-year test only' : `min(${fmtUsd(currentYearTarget)}, ${fmtUsd(priorYearTarget)})`, emphasis: 'subtotal' },
    { id: 'est.wh', label: 'Expected withholding', value: wh, ref: '1040-ES L13' },
    { id: 'est.due', label: 'Due through estimates', value: dueFromEstimates, ref: '1040-ES L14a', formula: required ? `${fmtUsd(safeHarbor)} − ${fmtUsd(wh)}` : reason, emphasis: 'total' },
  ];

  return { required, reason, basis: required ? basis : 'none', currentYearTarget, priorYearTarget, safeHarbor, dueFromEstimates, installments, trace };
}
