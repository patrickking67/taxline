// Progressive rate schedules.
//
// Tax on taxable income T under brackets b₀…bₙ (floor fᵢ, rate rᵢ, f₀ = 0):
//
//   tax(T) = Σᵢ rᵢ · max(0, min(T, fᵢ₊₁) − fᵢ)
//
// The IRS publishes the same schedule as "base + rate × excess"; the two forms
// are identical, and the tests assert they agree with the Rev. Proc. tables.

import type { Bracket } from './types.js';
import { round2 } from './money.js';

export interface BracketSlice {
  rate: number;
  floor: number;
  /** Upper edge of the band, or null for the top band. */
  ceiling: number | null;
  /** Income that falls inside this band. */
  amount: number;
  tax: number;
}

/** Split taxable income across bands. Every band is returned, including empty ones. */
export function sliceBrackets(taxable: number, brackets: Bracket[]): BracketSlice[] {
  const t = Math.max(0, taxable);
  return brackets.map((b, i) => {
    const ceiling = brackets[i + 1]?.floor ?? null;
    const top = ceiling == null ? t : Math.min(t, ceiling);
    const amount = Math.max(0, top - b.floor);
    return { rate: b.rate, floor: b.floor, ceiling, amount, tax: amount * b.rate };
  });
}

/** Exact rate-schedule tax, to the cent. */
export function scheduleTax(taxable: number, brackets: Bracket[]): number {
  return round2(sliceBrackets(taxable, brackets).reduce((s, x) => s + x.tax, 0));
}

/** "Base plus rate on the excess" — the published form of the same schedule. */
export function baseAmounts(brackets: Bracket[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < brackets.length; i++) {
    const prev = brackets[i - 1]!;
    const cur = brackets[i]!;
    out.push(round2(out[i - 1]! + (cur.floor - prev.floor) * prev.rate));
  }
  return out;
}

/** Rate on the next dollar of taxable income. */
export function marginalRate(taxable: number, brackets: Bracket[]): number {
  let rate = brackets[0]?.rate ?? 0;
  // Income above a floor is taxed at that band's rate, so at exactly the floor
  // the next dollar already falls in it.
  for (const b of brackets) if (taxable >= b.floor) rate = b.rate;
  return rate;
}

/**
 * Tax Table lookup (1040 instructions). Below $100,000 the IRS taxes the
 * midpoint of a $50 row ($25 rows under $3,000; $5/$10 rows at the very
 * bottom) and rounds to whole dollars. Above that, the rate schedule applies.
 */
export function taxTableTax(taxable: number, brackets: Bracket[]): number {
  const t = Math.max(0, taxable);
  if (t >= 100_000) return scheduleTax(t, brackets);
  if (t < 5) return 0;
  let mid: number;
  if (t < 15) mid = 10;
  else if (t < 25) mid = 20;
  else if (t < 3_000) {
    const lo = Math.floor(t / 25) * 25;
    mid = lo + 12.5;
  } else {
    const lo = Math.floor(t / 50) * 50;
    mid = lo + 25;
  }
  return Math.round(scheduleTax(mid, brackets));
}
