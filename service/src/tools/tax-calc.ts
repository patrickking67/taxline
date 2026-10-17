// Tool: compute_tax — deterministic federal tax math for workpapers.
//
// The model never does arithmetic in a prompt. When a workpaper needs a tax
// figure (taxable income, SE tax, safe-harbor estimates, a depreciation
// schedule) the agent calls this tool, which runs @taxline/tax-engine: pure,
// unit-tested functions that return every line with its formula, form line, and
// primary-source citation. The agent quotes the trace; it does not recompute it.

import { ok, fail, type Tool } from '../types.js';
import {
  FILING_STATUSES,
  RECOVERY_CLASSES,
  computeReturn,
  depreciate,
  estimatedTax,
  type FilingStatus,
  type RecoveryClass,
  type Trace,
} from '../../../packages/tax-engine/src/index.js';

export interface TaxCalcInput {
  calculation: 'return' | 'estimated' | 'depreciation';
  inputs: Record<string, unknown>;
}

export interface TaxCalcOutput {
  calculation: TaxCalcInput['calculation'];
  taxYear: number;
  summary: Record<string, number | string | null>;
  trace: Trace;
  /** Scope note the workpaper must carry so a reviewer knows what was not modeled. */
  limits: string;
}

const STATUSES = new Set<string>(FILING_STATUSES.map((s) => s.key));
const CLASSES = new Set<string>(RECOVERY_CLASSES.map((c) => c.key));
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export const taxCalc: Tool<TaxCalcInput, TaxCalcOutput> = {
  name: 'compute_tax',
  description:
    'Compute a tax-year-2026 federal figure deterministically and return a line-by-line trace ' +
    '(value, formula with operands, form line, IRS authority). Use for ANY arithmetic a workpaper ' +
    'needs instead of calculating yourself. calculation="return": Form 1040 estimate from wages, ' +
    'interest, dividends, capital gains, Schedule C profit, adjustments, itemized deductions, children, ' +
    'withholding. calculation="estimated": §6654 safe-harbor estimates and the four 1040-ES installments. ' +
    'calculation="depreciation": §179, bonus, and MACRS schedule for one asset. Pass only values ' +
    'taken from extracted fields; omit anything not in evidence rather than guessing.',
  inputSchema: {
    type: 'object',
    properties: {
      calculation: { type: 'string', enum: ['return', 'estimated', 'depreciation'] },
      inputs: {
        type: 'object',
        description:
          'return: status (single|mfj|mfs|hoh), wages, federalWithholding, interest, ordinaryDividends, ' +
          'qualifiedDividends, shortTermGain, longTermGain, selfEmploymentProfit, otherIncome, adjustments, ' +
          'itemized, children, estimatedPayments. estimated: status, currentYearTax, withholding, priorYearTax, ' +
          'priorYearAgi, priorYearFull. depreciation: cost, recoveryClass (3|5|7|10|15|20|27.5|39), month, ' +
          'businessUsePct (0-1), section179, bonusPct (0-1), businessIncome.',
      },
    },
    required: ['calculation', 'inputs'],
  },
  run(input) {
    const i = input?.inputs ?? {};
    try {
      switch (input?.calculation) {
        case 'return': {
          if (!STATUSES.has(String(i.status))) return fail('validation', 'compute_tax return needs status: single | mfj | mfs | hoh.');
          const r = computeReturn({ ...(i as object), status: i.status as FilingStatus });
          return ok({
            calculation: 'return',
            taxYear: 2026,
            summary: { agi: r.agi, taxable: r.taxable, totalTax: r.totalTax, balance: r.balance, effectiveRate: r.effectiveRate, marginalRate: r.marginalRate },
            trace: r.lines,
            limits: 'Federal only. Not modeled: AMT, EITC, education and energy credits, senior deduction, state tax, multiple Schedule C activities.',
          });
        }
        case 'estimated': {
          if (!STATUSES.has(String(i.status))) return fail('validation', 'compute_tax estimated needs status.');
          const tax = num(i.currentYearTax);
          if (tax == null) return fail('validation', 'compute_tax estimated needs currentYearTax (number).');
          const r = estimatedTax({
            status: i.status as FilingStatus,
            currentYearTax: tax,
            withholding: num(i.withholding) ?? 0,
            priorYearTax: num(i.priorYearTax) ?? null,
            priorYearAgi: num(i.priorYearAgi),
            priorYearFull: i.priorYearFull !== false,
          });
          return ok({
            calculation: 'estimated',
            taxYear: 2026,
            summary: { required: String(r.required), reason: r.reason, safeHarbor: r.safeHarbor, dueFromEstimates: r.dueFromEstimates, perInstallment: r.installments[0]?.amount ?? 0 },
            trace: r.trace,
            limits: 'Equal installments only; the annualized income method (Form 2210 Sch AI) is not modeled.',
          });
        }
        case 'depreciation': {
          const cost = num(i.cost);
          if (cost == null || cost <= 0) return fail('validation', 'compute_tax depreciation needs a positive cost.');
          if (!CLASSES.has(String(i.recoveryClass))) return fail('validation', 'recoveryClass must be one of 3, 5, 7, 10, 15, 20, 27.5, 39.');
          const r = depreciate({
            cost,
            recoveryClass: String(i.recoveryClass) as RecoveryClass,
            month: num(i.month),
            businessUsePct: num(i.businessUsePct),
            section179: num(i.section179),
            bonusPct: num(i.bonusPct),
            businessIncome: num(i.businessIncome) ?? null,
          });
          return ok({
            calculation: 'depreciation',
            taxYear: 2026,
            summary: { basis: r.basis, section179: r.section179, bonus: r.bonus, firstYear: r.firstYear, years: r.rows.length },
            trace: r.trace,
            limits: 'GDS half-year (personal) or mid-month (real) only; mid-quarter convention, ADS, and luxury-auto caps are not modeled.',
          });
        }
        default:
          return fail('validation', 'calculation must be "return", "estimated", or "depreciation".');
      }
    } catch (err) {
      return fail('business', 'compute_tax could not complete the calculation.', String(err));
    }
  },
};
