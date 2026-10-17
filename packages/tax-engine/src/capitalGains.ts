// Qualified Dividends and Capital Gain Tax Worksheet (1040 instructions, line 16).
//
// Preferential income P = min(qualified dividends + net LTCG, taxable income T)
// stacks on top of ordinary income O = T − P. The slice of P below the 0% cap
// is untaxed, the slice up to the 15% cap is taxed at 15%, the rest at 20%:
//
//   z  = max(0, min(T, cap₀) − O)            (0% band, bounded by P)
//   f  = max(0, min(T, cap₁₅) − O − z)       (15% band, bounded by P − z)
//   tw = P − z − f                           (20% band)
//   tax = ordinaryTax(O) + 0.15·f + 0.20·tw, capped at ordinaryTax(T)

import type { Bracket } from './types.js';
import { scheduleTax } from './brackets.js';
import { round2 } from './money.js';

export interface PreferentialSplit {
  ordinary: number;
  preferential: number;
  atZero: number;
  atFifteen: number;
  atTwenty: number;
  ordinaryTax: number;
  tax: number;
}

export function preferentialTax(
  taxable: number,
  preferentialIncome: number,
  brackets: Bracket[],
  caps: { zeroMax: number; fifteenMax: number },
  ordinaryTaxFn: (t: number, b: Bracket[]) => number = scheduleTax,
): PreferentialSplit {
  const T = Math.max(0, taxable);
  const P = Math.min(Math.max(0, preferentialIncome), T);
  const O = T - P;
  const atZero = Math.min(P, Math.max(0, Math.min(T, caps.zeroMax) - O));
  const atFifteen = Math.min(P - atZero, Math.max(0, Math.min(T, caps.fifteenMax) - O - atZero));
  const atTwenty = P - atZero - atFifteen;
  const ordinaryTax = ordinaryTaxFn(O, brackets);
  const withPref = round2(ordinaryTax + 0.15 * atFifteen + 0.2 * atTwenty);
  const regular = ordinaryTaxFn(T, brackets);
  return { ordinary: O, preferential: P, atZero, atFifteen, atTwenty, ordinaryTax, tax: Math.min(withPref, regular) };
}
