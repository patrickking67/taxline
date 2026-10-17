// Child tax credit (§24), with the refundable additional CTC.
//
//   gross     = $2,200 · children
//   reduction = $50 · ⌈max(0, MAGI − start) / 1,000⌉
//   allowed   = max(0, gross − reduction)
//   nonref    = min(allowed, tax before credits)
//   ACTC      = min(allowed − nonref, $1,700 · children, 15% · max(0, earned − 2,500))
//
// The 3+ children social-security-tax alternative for ACTC is not modeled.

import type { FilingStatus } from './types.js';
import { TY2026, type TaxYear } from './years/2026.js';
import { round2 } from './money.js';

export interface CtcResult {
  gross: number;
  reduction: number;
  allowed: number;
  nonrefundable: number;
  refundable: number;
}

export function childTaxCredit(
  status: FilingStatus,
  children: number,
  magi: number,
  taxBeforeCredits: number,
  earnedIncome: number,
  y: TaxYear = TY2026,
): CtcResult {
  const n = Math.max(0, Math.floor(children));
  const c = y.ctc;
  const gross = c.perChild * n;
  const over = Math.max(0, magi - c.phaseoutStart[status]);
  const reduction = c.phaseoutPer1000 * Math.ceil(over / 1_000);
  const allowed = Math.max(0, gross - reduction);
  const nonrefundable = Math.min(allowed, Math.max(0, taxBeforeCredits));
  const refundable = Math.min(
    allowed - nonrefundable,
    c.refundablePerChild * n,
    c.refundRate * Math.max(0, earnedIncome - c.earnedFloor),
  );
  return { gross, reduction, allowed, nonrefundable: round2(nonrefundable), refundable: round2(Math.max(0, refundable)) };
}
