// Parity harness, TypeScript side.
//
// Reads a JSON file of cases (see cases.json for the shape) and prints what
// this engine computes for each one. python/tests/test_parity.py runs the same
// cases through the Python model and fails on any difference, so the two
// implementations check each other. Run it by hand with:
//
//   npx tsx packages/tax-engine/parity/dump.ts packages/tax-engine/parity/cases.json

import { readFileSync } from 'node:fs';
import {
  TY2026,
  baseAmounts,
  computeReturn,
  estimatedTax,
  selfEmploymentTax,
  type FilingStatus,
  type ReturnInput,
} from '../src/index.js';

/** The inputs both implementations accept. Anything else is rejected. */
const INPUT_KEYS = new Set([
  'status',
  'wages',
  'selfEmploymentProfit',
  'otherIncome',
  'adjustments',
  'itemized',
  'federalWithholding',
  'estimatedPayments',
  'seOwnerSsWages',
  'medicareWages',
  'qbiW2Wages',
  'qbiUbia',
  'sstb',
  'useTaxTable',
]);

interface Case {
  id: string;
  input: ReturnInput;
  prior?: { tax: number; agi?: number };
}

function runCase(c: Case) {
  for (const key of Object.keys(c.input)) {
    if (!INPUT_KEYS.has(key)) throw new Error(`case ${c.id}: unsupported input "${key}"`);
  }
  const r = computeReturn(c.input);
  const ownerSs = c.input.seOwnerSsWages ?? (c.input.status === 'mfj' ? 0 : (c.input.wages ?? 0));
  const se = selfEmploymentTax({
    netProfit: c.input.selfEmploymentProfit ?? 0,
    w2SsWages: ownerSs,
  });
  const est = estimatedTax({
    status: c.input.status,
    currentYearTax: r.totalTax,
    withholding: c.input.federalWithholding ?? 0,
    priorYearTax: c.prior?.tax ?? null,
    priorYearAgi: c.prior?.agi,
  });
  return {
    id: c.id,
    totalIncome: r.totalIncome,
    agi: r.agi,
    deduction: r.deduction,
    deductionKind: r.deductionKind,
    qbi: {
      deduction: r.qbi.deduction,
      tentative: r.qbi.tentative,
      wageLimit: r.qbi.wageLimit,
      incomeLimit: r.qbi.incomeLimit,
      regime: r.qbi.regime,
      minimumApplied: r.qbi.minimumApplied,
    },
    taxable: r.taxable,
    incomeTax: r.incomeTax,
    se: {
      netEarnings: se.netEarnings,
      ssTaxable: se.ssTaxable,
      socialSecurity: se.socialSecurity,
      medicare: se.medicare,
      total: se.total,
      deduction: se.deduction,
    },
    seTax: r.seTax,
    addlMedicare: r.addlMedicare,
    totalTax: r.totalTax,
    payments: r.payments,
    balance: r.balance,
    bracketRate: r.bracketRate,
    marginalRate: r.marginalRate,
    effectiveRate: r.effectiveRate,
    estimated: {
      required: est.required,
      basis: est.basis,
      currentYearTarget: est.currentYearTarget,
      priorYearTarget: est.priorYearTarget,
      safeHarbor: est.safeHarbor,
      dueFromEstimates: est.dueFromEstimates,
      installments: est.installments.map((i) => i.amount),
    },
  };
}

/** The TY2026 figures both sides must agree on. */
function constants() {
  const statuses = Object.keys(TY2026.brackets) as FilingStatus[];
  return {
    year: TY2026.year,
    brackets: Object.fromEntries(
      statuses.map((s) => [s, TY2026.brackets[s].map((b) => [b.rate, b.floor])]),
    ),
    baseAmounts: Object.fromEntries(statuses.map((s) => [s, baseAmounts(TY2026.brackets[s])])),
    standardDeduction: TY2026.standardDeduction,
    qbi: TY2026.qbi,
    fica: TY2026.fica,
    addlMedicare: TY2026.addlMedicare,
    estimated: TY2026.estimated,
  };
}

const file = process.argv[2];
if (!file) {
  console.error('usage: tsx parity/dump.ts <cases.json>');
  process.exit(2);
}
const cases = JSON.parse(readFileSync(file, 'utf8')) as Case[];
console.log(JSON.stringify({ constants: constants(), results: cases.map(runCase) }));
