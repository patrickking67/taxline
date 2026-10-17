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
  /** Year-by-year schedule (depreciation only), so later years are quoted, not recomputed. */
  schedule?: { year: number; ratePct: number; section179: number; bonus: number; macrs: number; total: number; endingBasis: number }[];
  /** Scope note the workpaper must carry so a reviewer knows what was not modeled. */
  limits: string;
}

const STATUSES = new Set<string>(FILING_STATUSES.map((s) => s.key));
const CLASSES = new Set<string>(RECOVERY_CLASSES.map((c) => c.key));
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// Runtime contract per calculation. The model's arguments are untrusted: every
// supplied key must be known and of the right type before anything is computed.
type Kind = 'number' | 'boolean' | 'string';
const SPEC: Record<TaxCalcInput['calculation'], Record<string, Kind>> = {
  return: {
    status: 'string', wages: 'number', seOwnerSsWages: 'number', medicareWages: 'number', federalWithholding: 'number',
    interest: 'number', ordinaryDividends: 'number', qualifiedDividends: 'number', shortTermGain: 'number', longTermGain: 'number',
    selfEmploymentProfit: 'number', passThroughIncome: 'number', otherIncome: 'number', adjustments: 'number', itemized: 'number',
    children: 'number', estimatedPayments: 'number', qbiW2Wages: 'number', qbiUbia: 'number', sstb: 'boolean',
  },
  estimated: { status: 'string', currentYearTax: 'number', withholding: 'number', priorYearTax: 'number', priorYearAgi: 'number', priorYearFull: 'boolean' },
  depreciation: {
    cost: 'number', recoveryClass: 'string', month: 'number', businessUsePct: 'number', listedProperty: 'boolean', total179Property: 'number',
    section179: 'number', bonusPct: 'number', businessIncome: 'number',
  },
};

/** Unknown keys and wrong types, as messages. recoveryClass may arrive as a number. */
function contractErrors(calc: TaxCalcInput['calculation'], i: Record<string, unknown>): string[] {
  const spec = SPEC[calc];
  const out: string[] = [];
  for (const [k, v] of Object.entries(i)) {
    if (v === null || v === undefined) continue;
    const kind = spec[k];
    if (!kind) out.push(`unknown input "${k}"`);
    else if (kind === 'number' && !(typeof v === 'number' && Number.isFinite(v))) out.push(`${k} must be a finite number`);
    else if (kind === 'boolean' && typeof v !== 'boolean') out.push(`${k} must be true or false`);
    else if (kind === 'string' && typeof v !== 'string' && !(k === 'recoveryClass' && typeof v === 'number')) out.push(`${k} must be a string`);
  }
  return out;
}

/** Keys the caller passed as null: unknown facts must be omitted or supplied, never treated as 0. */
const nullKeys = (o: Record<string, unknown>) => Object.entries(o).filter(([, v]) => v === null).map(([k]) => k);

export const taxCalc: Tool<TaxCalcInput, TaxCalcOutput> = {
  name: 'compute_tax',
  description:
    'Compute a tax-year-2026 federal figure deterministically and return a line-by-line trace ' +
    '(value, formula with operands, form line, IRS authority). Use for ANY arithmetic a workpaper ' +
    'needs instead of calculating yourself. calculation="return": Form 1040 estimate from wages, ' +
    'interest, dividends, capital gains, Schedule C profit, adjustments, itemized deductions, children, ' +
    'withholding. Never pass null: omit a fact that is not in evidence, and a required fact that is missing is a validation error. calculation="estimated": §6654 safe-harbor estimates and the four 1040-ES installments. ' +
    'calculation="depreciation": §179, bonus, and MACRS schedule for one asset. Pass only values ' +
    'taken from extracted fields; omit anything not in evidence rather than guessing.',
  inputSchema: {
    type: 'object',
    properties: {
      calculation: { type: 'string', enum: ['return', 'estimated', 'depreciation'] },
      inputs: {
        type: 'object',
        description:
          'return: status (single|mfj|mfs|hoh), wages, seOwnerSsWages (Schedule C owner\'s own W-2 box 3), medicareWages (box 5), federalWithholding, interest, ordinaryDividends, ' +
          'qualifiedDividends, shortTermGain, longTermGain, selfEmploymentProfit, otherIncome, adjustments, ' +
          'itemized, children, estimatedPayments, qbiW2Wages, qbiUbia, sstb. estimated: status, currentYearTax, withholding, and — only together — ' +
          'priorYearTax, priorYearAgi, priorYearFull. depreciation: cost, recoveryClass (3|5|7|10|15|20|27.5|39), month, ' +
          'businessUsePct (0-1), listedProperty, section179 (requires businessIncome), total179Property (all §179 property placed in service this year; drives the phase-out), bonusPct (0-1), businessIncome.',
      },
    },
    required: ['calculation', 'inputs'],
  },
  run(input) {
    const i = input?.inputs ?? {};
    const nulls = nullKeys(i);
    if (nulls.length) return fail('validation', `Unknown values passed as null: ${nulls.join(', ')}. Omit them or supply evidence.`);
    if (input?.calculation && input.calculation in SPEC) {
      const errs = contractErrors(input.calculation, i);
      if (errs.length) return fail('validation', `compute_tax ${input.calculation}: ${errs.join('; ')}.`);
    }
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
          // The prior-year test needs all three facts; its percentage depends on AGI.
          const hasPrior = i.priorYearTax !== undefined;
          if (hasPrior && (num(i.priorYearTax) == null || num(i.priorYearAgi) == null || typeof i.priorYearFull !== 'boolean')) {
            return fail('validation', 'The prior-year safe harbor needs priorYearTax, priorYearAgi, and priorYearFull together; omit all three to use the current-year test.');
          }
          const r = estimatedTax({
            status: i.status as FilingStatus,
            currentYearTax: tax,
            withholding: num(i.withholding) ?? 0,
            priorYearTax: hasPrior ? num(i.priorYearTax)! : null,
            priorYearAgi: num(i.priorYearAgi),
            priorYearFull: hasPrior ? i.priorYearFull === true : false,
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
          if ((num(i.section179) ?? 0) > 0 && num(i.businessIncome) == null) {
            return fail('validation', '§179 is limited to taxable business income; supply businessIncome with a section179 election.');
          }
          const r = depreciate({
            cost,
            recoveryClass: String(i.recoveryClass) as RecoveryClass,
            month: num(i.month),
            businessUsePct: num(i.businessUsePct),
            listedProperty: i.listedProperty === true,
            total179Property: num(i.total179Property),
            section179: num(i.section179),
            bonusPct: num(i.bonusPct),
            businessIncome: num(i.businessIncome) ?? null,
          });
          return ok({
            calculation: 'depreciation',
            taxYear: 2026,
            summary: { basis: r.basis, section179: r.section179, carryforward: r.carryforward, bonus: r.bonus, firstYear: r.firstYear, years: r.rows.length },
            trace: r.trace,
            schedule: r.rows.map((x) => ({ year: x.year, ratePct: x.rate, section179: x.section179, bonus: x.bonus, macrs: x.macrs, total: x.total, endingBasis: x.endingBasis })),
            limits: 'GDS half-year (personal), mid-month (real), or ADS straight line for listed property at 50% or less business use; the mid-quarter convention, other ADS cases, and luxury-auto caps are not modeled.',
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
