// Form 1040 estimate — the full federal path from income to refund or balance due.
//
//   total income  = wages + interest + dividends + capital gain/loss + business + other
//   AGI           = total income − ½ SE tax − other adjustments
//   taxable (L15) = max(0, AGI − max(standard, itemized) − QBI deduction)
//   income tax    = rate schedule on ordinary income + 0/15/20% on preferential income
//   total tax     = income tax − nonrefundable credits + SE tax + 0.9% Medicare + 3.8% NIIT
//   result        = payments + refundable credits − total tax
//
// Every line is returned as a TraceLine so the UI (and the Workpaper agent) can
// show the operands, the form line, and the authority — not just the number.

import type { FilingStatus, Trace } from './types.js';
import { TY2026, cite, type TaxYear } from './years/2026.js';
import { marginalRate, scheduleTax, sliceBrackets, taxTableTax, type BracketSlice } from './brackets.js';
import { preferentialTax, type PreferentialSplit } from './capitalGains.js';
import { additionalMedicare, netInvestmentIncomeTax, selfEmploymentTax } from './selfEmployment.js';
import { qbiDeduction, type QbiResult } from './qbi.js';
import { childTaxCredit } from './credits.js';
import { amount, fmtPct, fmtUsd, round2 } from './money.js';

export interface ReturnInput {
  status: FilingStatus;
  wages?: number;
  federalWithholding?: number;
  interest?: number;
  /** Total ordinary dividends (1099-DIV box 1a), including qualified. */
  ordinaryDividends?: number;
  /** Qualified dividends (box 1b) — a subset of ordinary dividends. */
  qualifiedDividends?: number;
  shortTermGain?: number;
  longTermGain?: number;
  selfEmploymentProfit?: number;
  otherIncome?: number;
  adjustments?: number;
  itemized?: number;
  children?: number;
  estimatedPayments?: number;
  /** §199A inputs for the self-employment activity. */
  qbiW2Wages?: number;
  qbiUbia?: number;
  sstb?: boolean;
  /** Use the IRS Tax Table below $100k (default true). */
  useTaxTable?: boolean;
}

export interface ReturnResult {
  lines: Trace;
  totalIncome: number;
  agi: number;
  deduction: number;
  deductionKind: 'standard' | 'itemized';
  qbi: QbiResult;
  taxable: number;
  incomeTax: number;
  credits: number;
  seTax: number;
  addlMedicare: number;
  niit: number;
  totalTax: number;
  /** Total tax less refundable credits. */
  netLiability: number;
  payments: number;
  /** Positive: refund. Negative: balance due. */
  balance: number;
  effectiveRate: number;
  bracketRate: number;
  /** True marginal rate on the next $100 of ordinary income, all interactions included. */
  marginalRate: number;
  slices: BracketSlice[];
  preferential: PreferentialSplit;
}

/** Signed amount (capital gains may be negative). */
const signed = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function computeReturn(input: ReturnInput, y: TaxYear = TY2026, withMarginal = true): ReturnResult {
  const s = input.status;
  const wages = amount(input.wages);
  const interest = amount(input.interest);
  const ordDiv = amount(input.ordinaryDividends);
  const qualDiv = Math.min(amount(input.qualifiedDividends), ordDiv);
  const st = signed(input.shortTermGain);
  const lt = signed(input.longTermGain);
  const seProfit = amount(input.selfEmploymentProfit);
  const other = amount(input.otherIncome);
  const useTable = input.useTaxTable ?? true;

  // Capital gain/loss (Sch D L16, L21). Net losses deduct up to $3,000 ($1,500 MFS).
  const netCap = st + lt;
  const lossCap = s === 'mfs' ? 1_500 : 3_000;
  const capLine = netCap >= 0 ? netCap : Math.max(netCap, -lossCap);
  const netLtcgForPref = Math.max(0, Math.min(lt, netCap));

  const se = selfEmploymentTax({ netProfit: seProfit, w2SsWages: wages }, y);
  const totalIncome = round2(wages + interest + ordDiv + capLine + seProfit + other);
  const adjustments = round2(se.deduction + amount(input.adjustments));
  const agi = round2(Math.max(0, totalIncome - adjustments));

  const standard = y.standardDeduction[s];
  const itemized = amount(input.itemized);
  const deductionKind = itemized > standard ? 'itemized' : 'standard';
  const deduction = Math.max(standard, itemized);
  const beforeQbi = Math.max(0, agi - deduction);

  const qbiIncome = Math.max(0, seProfit - se.deduction);
  const qbi = qbiDeduction({
    status: s,
    qbi: qbiIncome,
    taxableBeforeQbi: beforeQbi,
    netCapitalGain: netLtcgForPref + qualDiv,
    w2Wages: amount(input.qbiW2Wages),
    ubia: amount(input.qbiUbia),
    sstb: input.sstb,
  }, y);
  const taxable = round2(Math.max(0, beforeQbi - qbi.deduction));

  const ordinaryFn = useTable ? taxTableTax : scheduleTax;
  const preferential = preferentialTax(taxable, netLtcgForPref + qualDiv, y.brackets[s], y.capGains[s], ordinaryFn);
  const incomeTax = preferential.tax;

  const earned = wages + Math.max(0, seProfit - se.deduction);
  const ctc = childTaxCredit(s, input.children ?? 0, agi, incomeTax, earned, y);
  const addlMed = additionalMedicare(s, wages, se.netEarnings, y);
  const nii = interest + ordDiv + Math.max(0, capLine);
  const niit = netInvestmentIncomeTax(s, agi, nii, y);
  const otherTaxes = round2(se.total + addlMed + niit);
  const totalTax = round2(Math.max(0, incomeTax - ctc.nonrefundable) + otherTaxes);

  const withholding = amount(input.federalWithholding);
  const estimates = amount(input.estimatedPayments);
  const payments = round2(withholding + estimates + ctc.refundable);
  const balance = round2(payments - totalTax);

  const slices = sliceBrackets(preferential.ordinary, y.brackets[s]);
  const bracketRate = marginalRate(preferential.ordinary, y.brackets[s]);

  // Finite difference on net liability (tax − refundable credits), on the exact
  // rate schedule so Tax Table row steps do not distort it.
  let marginal = bracketRate;
  if (withMarginal) {
    const base = computeReturn({ ...input, useTaxTable: false }, y, false);
    const bumped = computeReturn({ ...input, useTaxTable: false, otherIncome: other + 100 }, y, false);
    marginal = round2(bumped.netLiability - base.netLiability) / 100;
  }

  const L = (id: string, label: string, value: number, ref?: string, formula?: string, extra: Partial<Trace[number]> = {}) =>
    ({ id, label, value, ref, formula, ...extra });

  const lines: Trace = [
    L('wages', 'Wages, salaries, tips', wages, '1040 L1z'),
    L('interest', 'Taxable interest', interest, '1040 L2b'),
    L('dividends', 'Ordinary dividends', ordDiv, '1040 L3b', qualDiv ? `includes ${fmtUsd(qualDiv)} qualified` : undefined),
    L('capgain', 'Capital gain or (loss)', capLine, '1040 L7', netCap < 0 && capLine !== netCap ? `loss limited to ${fmtUsd(-lossCap)}` : `${fmtUsd(st)} ST + ${fmtUsd(lt)} LT`),
    L('business', 'Business income (Schedule C)', seProfit, 'Sch 1 L3'),
    L('other', 'Other income', other, 'Sch 1 L8z'),
    L('total', 'Total income', totalIncome, '1040 L9', undefined, { emphasis: 'subtotal' }),
    L('adj', 'Adjustments to income', adjustments, '1040 L10', `${fmtUsd(se.deduction, true)} ½ SE tax + ${fmtUsd(amount(input.adjustments))} other`),
    L('agi', 'Adjusted gross income', agi, '1040 L11', `${fmtUsd(totalIncome)} − ${fmtUsd(adjustments)}`, { emphasis: 'subtotal' }),
    L('deduction', deductionKind === 'standard' ? 'Standard deduction' : 'Itemized deductions', deduction, '1040 L12', deductionKind === 'standard' ? `itemized ${fmtUsd(itemized)} < standard` : `exceeds standard ${fmtUsd(standard)}`, { authority: cite.standard }),
    L('qbi', 'Qualified business income deduction', qbi.deduction, '1040 L13', qbiIncome > 0 ? `${qbi.regime.replace(/-/g, ' ')} · 20% × ${fmtUsd(qbiIncome)} QBI${qbi.minimumApplied ? ' · $400 minimum' : ''}` : undefined, { authority: cite.qbi }),
    L('taxable', 'Taxable income', taxable, '1040 L15', `${fmtUsd(agi)} − ${fmtUsd(deduction)} − ${fmtUsd(qbi.deduction)}`, { emphasis: 'subtotal' }),
    L('tax', 'Income tax', incomeTax, '1040 L16', preferential.preferential > 0 ? `ordinary ${fmtUsd(preferential.ordinaryTax)} + 15% × ${fmtUsd(preferential.atFifteen)} + 20% × ${fmtUsd(preferential.atTwenty)}` : useTable && taxable < 100_000 ? 'Tax Table (row midpoint)' : `rate schedule · top bracket ${fmtPct(bracketRate, 0)}`, { authority: preferential.preferential > 0 ? cite.capGains : useTable && taxable < 100_000 ? cite.taxTable : cite.brackets }),
    L('ctc', 'Child tax credit (nonrefundable)', -ctc.nonrefundable, '1040 L19', ctc.gross ? `${fmtUsd(ctc.gross)} − ${fmtUsd(ctc.reduction)} phase-out` : undefined, { authority: cite.ctc }),
    L('setax', 'Self-employment tax', se.total, 'Sch 2 L4', se.total ? `${fmtUsd(se.netEarnings)} NE × 15.3% (SS capped)` : undefined, { authority: cite.se }),
    L('addlmed', 'Additional Medicare tax', addlMed, 'Sch 2 L11', addlMed ? `0.9% over ${fmtUsd(y.addlMedicare.threshold[s])}` : undefined, { authority: cite.addlMedicare }),
    L('niit', 'Net investment income tax', niit, 'Sch 2 L12', niit ? `3.8% × min(NII ${fmtUsd(nii)}, MAGI over ${fmtUsd(y.niit.threshold[s])})` : undefined, { authority: cite.niit }),
    L('totaltax', 'Total tax', totalTax, '1040 L24', undefined, { emphasis: 'subtotal' }),
    L('withholding', 'Federal income tax withheld', withholding, '1040 L25d'),
    L('estimates', 'Estimated tax payments', estimates, '1040 L26'),
    L('actc', 'Additional child tax credit (refundable)', ctc.refundable, '1040 L28', ctc.refundable ? `15% × (earned − $2,500), cap $1,700/child` : undefined, { authority: cite.ctc }),
    L('payments', 'Total payments', payments, '1040 L33', undefined, { emphasis: 'subtotal' }),
    L('balance', balance >= 0 ? 'Refund' : 'Amount you owe', Math.abs(balance), balance >= 0 ? '1040 L34' : '1040 L37', `${fmtUsd(payments)} − ${fmtUsd(totalTax)}`, { emphasis: 'total' }),
  ];

  return {
    lines,
    totalIncome,
    agi,
    deduction,
    deductionKind,
    qbi,
    taxable,
    incomeTax,
    credits: ctc.nonrefundable + ctc.refundable,
    seTax: se.total,
    addlMedicare: addlMed,
    niit,
    totalTax,
    netLiability: round2(totalTax - ctc.refundable),
    payments,
    balance,
    effectiveRate: totalIncome > 0 ? totalTax / totalIncome : 0,
    bracketRate,
    marginalRate: marginal,
    slices,
    preferential,
  };
}
