// Sole proprietorship vs. S corporation election, on the same profit.
//
// Sole prop:  profit → Schedule C → SE tax at 15.3% (SS capped) + income tax.
// S corp:     profit pays the owner a salary S (FICA 7.65% employee + 7.65%
//             employer, SS capped), the employer half and payroll costs are
//             deductible, and the rest flows through on a K-1 with no SE tax:
//
//   K-1      = profit − S − employer FICA − payroll cost
//   cost_SC  = income tax(wages + S, K-1) + employee FICA + employer FICA + payroll cost
//   cost_SP  = income tax(Schedule C profit) + SE tax
//   savings  = cost_SP − cost_SC
//
// Salary is not a free variable: the IRS requires reasonable compensation for
// the services the owner performs (Rev. Rul. 74-44; see IRS "S corporation
// compensation and medical insurance issues"). The sweep shows the trade-off;
// it is not a recommendation to pick the cheapest point.

import type { FilingStatus, Trace } from './types.js';
import { TY2026, type TaxYear } from './years/2026.js';
import { computeReturn, type ReturnInput, type ReturnResult } from './form1040.js';
import { fmtUsd, round2 } from './money.js';

export interface EntityInput {
  status: FilingStatus;
  /** Business net profit before any owner compensation. */
  profit: number;
  /** Owner salary paid through S-corp payroll. */
  salary: number;
  /** Annual payroll service, extra return prep, and state entity fees. */
  overhead?: number;
  /** Everything else on the household return (other wages, investments, kids…). */
  household?: Omit<ReturnInput, 'status' | 'selfEmploymentProfit' | 'passThroughIncome'>;
}

export interface FicaSplit {
  employee: number;
  employer: number;
}

export interface EntityResult {
  sole: { ret: ReturnResult; total: number };
  scorp: { ret: ReturnResult; fica: FicaSplit; overhead: number; k1: number; salary: number; total: number };
  savings: number;
  trace: Trace;
}

/** FICA on one employer's wages. The employee side credits SS already paid elsewhere. */
export function payrollFica(salary: number, otherSsWages: number, y: TaxYear = TY2026): FicaSplit {
  const s = Math.max(0, salary);
  const half = y.fica.ssRate / 2;
  const med = y.fica.medicareRate / 2;
  const employer = s ? Math.min(s, y.fica.wageBase) * half + s * med : 0;
  const employeeSsBase = Math.min(s, Math.max(0, y.fica.wageBase - Math.max(0, otherSsWages)));
  const employee = employeeSsBase * half + s * med;
  return { employee: round2(employee), employer: round2(employer) };
}

export function compareEntity(i: EntityInput, y: TaxYear = TY2026): EntityResult {
  const profit = Math.max(0, i.profit);
  const overhead = Math.max(0, i.overhead ?? 0);
  const otherWages = Math.max(0, i.household?.wages ?? 0);
  // Salary cannot exceed what the business can pay after its own FICA and overhead.
  const maxSalary = Math.max(0, (profit - overhead) / (1 + y.fica.ssRate / 2 + y.fica.medicareRate / 2));
  const salary = Math.min(Math.max(0, i.salary), maxSalary);

  const soleRet = computeReturn({ ...i.household, status: i.status, selfEmploymentProfit: profit }, y);
  // Only the owner's own other W-2 Social Security wages share their wage base.
  const ownerOtherSs = i.household?.seOwnerSsWages ?? (i.status === 'mfj' ? 0 : otherWages);
  const fica = payrollFica(salary, ownerOtherSs, y);
  const k1 = round2(Math.max(0, profit - salary - fica.employer - overhead));
  const scorpRet = computeReturn(
    { ...i.household, status: i.status, wages: otherWages + salary, passThroughIncome: k1, qbiW2Wages: salary },
    y,
  );

  const soleTotal = round2(soleRet.netLiability);
  const scorpTotal = round2(scorpRet.netLiability + fica.employee + fica.employer + overhead);
  const savings = round2(soleTotal - scorpTotal);

  const trace: Trace = [
    { id: 'ent.sole.it', label: 'Sole prop · income tax after credits', value: round2(soleRet.netLiability - soleRet.seTax), ref: 'Sch C' },
    { id: 'ent.sole.se', label: 'Sole prop · self-employment tax', value: soleRet.seTax, ref: 'Sch SE', formula: `${fmtUsd(profit)} × 92.35% × 15.3% (SS capped)` },
    { id: 'ent.sole', label: 'Sole prop · total', value: soleTotal, emphasis: 'subtotal' },
    { id: 'ent.sc.salary', label: 'S corp · owner salary (W-2)', value: salary, ref: '1120-S L7' },
    { id: 'ent.sc.er', label: 'S corp · employer FICA', value: fica.employer, ref: '941', formula: `7.65% of ${fmtUsd(salary)} (SS capped)` },
    { id: 'ent.sc.oh', label: 'S corp · payroll and entity overhead', value: overhead, ref: '1120-S L19' },
    { id: 'ent.sc.k1', label: 'S corp · K-1 ordinary income', value: k1, ref: 'K-1 L1', formula: `${fmtUsd(profit)} − ${fmtUsd(salary)} − ${fmtUsd(fica.employer)} − ${fmtUsd(overhead)}` },
    { id: 'ent.sc.it', label: 'S corp · income tax after credits', value: scorpRet.netLiability, ref: '1040 L24', formula: `QBI ${fmtUsd(scorpRet.qbi.deduction)} (20% of K-1, W-2 wage limit)` },
    { id: 'ent.sc.ee', label: 'S corp · employee FICA', value: fica.employee, ref: 'W-2 L4/L6' },
    { id: 'ent.sc', label: 'S corp · total (tax + FICA + overhead)', value: scorpTotal, emphasis: 'subtotal' },
    { id: 'ent.save', label: savings >= 0 ? 'Annual savings with the election' : 'Annual cost of the election', value: Math.abs(savings), formula: `${fmtUsd(soleTotal)} − ${fmtUsd(scorpTotal)}`, emphasis: 'total' },
  ];

  return {
    sole: { ret: soleRet, total: soleTotal },
    scorp: { ret: scorpRet, fica, overhead, k1, salary, total: scorpTotal },
    savings,
    trace,
  };
}

/** Savings across salaries from 0 to the maximum the business can pay. */
export function salarySweep(i: EntityInput, points = 60, y: TaxYear = TY2026): [number, number][] {
  const max = Math.max(0, (Math.max(0, i.profit) - Math.max(0, i.overhead ?? 0)) / (1 + y.fica.ssRate / 2 + y.fica.medicareRate / 2));
  const out: [number, number][] = [];
  for (let k = 0; k <= points; k++) {
    const s = (max * k) / points;
    out.push([round2(s), compareEntity({ ...i, salary: s }, y).savings]);
  }
  return out;
}
