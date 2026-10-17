// Firm economics for adopting the fleet: hours returned, payback, NPV, IRR.
//
//   hours saved / yr  = returns · hours per return · reduction
//   labor value / yr  = hours saved · loaded hourly cost
//   subscription / yr = seats · price per seat · 12
//   net benefit / yr  = labor value − subscription
//   NPV               = −onboarding + Σₜ₌₁ⁿ net / (1 + r)ᵗ
//   IRR               = r such that NPV(r) = 0 (bisection)
//   payback (months)  = onboarding / (net / 12)
//   capacity          = hours saved / (hours per return · (1 − reduction))  extra returns
//
// Benefits ramp linearly over the first `rampMonths` while the team adopts.

import { round2 } from './money.js';

export interface RoiInput {
  returnsPerYear: number;
  hoursPerReturn: number;
  /** Share of hours the fleet removes, 0–1. */
  reduction: number;
  loadedHourlyCost: number;
  seats: number;
  pricePerSeatMonth: number;
  onboardingCost: number;
  discountRate: number;
  years: number;
  rampMonths?: number;
  /** Average fee per return, for the capacity-as-revenue view. */
  feePerReturn?: number;
}

export interface RoiResult {
  hoursSaved: number;
  laborValue: number;
  subscription: number;
  netAnnual: number;
  npv: number;
  irr: number | null;
  roi: number;
  paybackMonths: number | null;
  capacityReturns: number;
  capacityRevenue: number;
  /** Cumulative net cash position at the end of each month (month 0 = onboarding). */
  cumulative: number[];
}

/** Longest horizon the model will build monthly flows for. */
export const MAX_YEARS = 30;

export function npv(rate: number, flows: number[]): number {
  return flows.reduce((s, f, t) => s + f / Math.pow(1 + rate, t), 0);
}

/**
 * IRR by bisection on [−99%, 1000%]. Null when the flows never change sign;
 * Infinity when the root lies above 1000% (payback inside the first period).
 */
export function irr(flows: number[]): number | null {
  const hasNeg = flows.some((f) => f < 0);
  const hasPos = flows.some((f) => f > 0);
  if (!hasNeg || !hasPos) return null;
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(lo, flows);
  const fHi = npv(hi, flows);
  if (fLo * fHi > 0) return fHi > 0 ? Infinity : null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid, flows);
    if (Math.abs(fm) < 1e-7) return mid;
    if (fLo * fm < 0) hi = mid;
    else {
      lo = mid;
      fLo = fm;
    }
  }
  return (lo + hi) / 2;
}

export function firmRoi(i: RoiInput): RoiResult {
  const reduction = Math.min(0.95, Math.max(0, i.reduction));
  const hoursSaved = Math.max(0, i.returnsPerYear) * Math.max(0, i.hoursPerReturn) * reduction;
  const laborValue = hoursSaved * Math.max(0, i.loadedHourlyCost);
  const subscription = Math.max(0, i.seats) * Math.max(0, i.pricePerSeatMonth) * 12;
  const netAnnual = laborValue - subscription;
  // Bounded here, not only in the UI: flows are allocated per month.
  const years = Number.isFinite(i.years) ? Math.min(MAX_YEARS, Math.max(1, Math.round(i.years))) : 1;
  const ramp = Number.isFinite(i.rampMonths ?? 0) ? Math.min(years * 12, Math.max(0, Math.round(i.rampMonths ?? 0))) : 0;

  // Monthly flows with an adoption ramp; subscription is paid from month 1.
  const monthly: number[] = [-Math.max(0, i.onboardingCost)];
  for (let m = 1; m <= years * 12; m++) {
    const adoption = ramp === 0 ? 1 : Math.min(1, m / ramp);
    monthly.push((laborValue * adoption - subscription) / 12);
  }
  const cumulative: number[] = [];
  let run = 0;
  for (const f of monthly) cumulative.push(round2((run += f)));

  // Annual flows for NPV/IRR (sum of each year's months).
  const annual: number[] = [monthly[0]!];
  for (let yr = 0; yr < years; yr++) annual.push(monthly.slice(1 + yr * 12, 13 + yr * 12).reduce((a, b) => a + b, 0));

  const paybackIdx = cumulative.findIndex((c, m) => m > 0 && c >= 0);
  let paybackMonths: number | null = null;
  if (paybackIdx > 0) {
    // Interpolate inside the crossing month.
    const prev = cumulative[paybackIdx - 1]!;
    const cur = cumulative[paybackIdx]!;
    paybackMonths = round2(paybackIdx - 1 + (cur === prev ? 0 : -prev / (cur - prev)));
  } else if (paybackIdx === 0) paybackMonths = 0;

  const totalCost = Math.max(0, i.onboardingCost) + subscription * years;
  const totalBenefit = annual.slice(1).reduce((a, b) => a + b, 0) + subscription * years;
  const remainingHours = Math.max(0, i.hoursPerReturn) * (1 - reduction);
  const capacityReturns = remainingHours > 0 ? Math.floor(hoursSaved / remainingHours) : 0;

  return {
    hoursSaved: round2(hoursSaved),
    laborValue: round2(laborValue),
    subscription: round2(subscription),
    netAnnual: round2(netAnnual),
    npv: round2(npv(Math.max(0, i.discountRate), annual)),
    irr: irr(annual),
    roi: totalCost > 0 ? (totalBenefit - totalCost) / totalCost : 0,
    paybackMonths,
    capacityReturns,
    capacityRevenue: round2(capacityReturns * Math.max(0, i.feePerReturn ?? 0)),
    cumulative,
  };
}
