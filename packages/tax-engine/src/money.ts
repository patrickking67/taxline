// Rounding and formatting. All engine math runs in dollars; results are rounded
// to the cent at each published line, the way a preparer carries them.

/**
 * Round half away from zero to the cent.
 *
 * Two kinds of binary drift are removed first. A chain of float operations can
 * leave a true half-cent tie a few ulps short (43,230.95 × 0.9 arrives as
 * 38,907.85499999999, not 38,907.855), so the value is snapped to 15
 * significant digits, which is exact for any amount under a billion dollars
 * with up to six decimals. Then the shift by two places is done on the decimal
 * string ("10.075e2" → 1007.5), because 10.075 * 100 comes out as 1007.4999….
 */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return n;
  const s = Math.sign(n) || 1;
  const abs = Math.abs(n);
  const a = abs < 1e9 ? Number(abs.toPrecision(15)) : abs;
  const shifted = String(a).includes('e') ? a * 100 : Number(`${a}e2`);
  return (s * Math.round(shifted)) / 100;
}

/** Whole-dollar rounding, as the IRS permits on a return. */
export function roundDollar(n: number): number {
  const s = Math.sign(n) || 1;
  return s * Math.round(Math.abs(n));
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Coerce user input to a finite, non-negative amount. Bad input becomes 0, never NaN. */
export function amount(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const usd2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const num0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const fmtUsd = (n: number, cents = false) => (cents ? usd2 : usd0).format(n);
export const fmtNum = (n: number) => num0.format(n);
export const fmtPct = (r: number, digits = 1) => `${(r * 100).toFixed(digits)}%`;
