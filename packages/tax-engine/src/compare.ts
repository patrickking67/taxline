// Side-by-side comparison of two returns. Pure arithmetic on `computeReturn`
// output: no tax figure lives here, so every number still traces to its cited
// rule in the year tables.

import { round2 } from './money.js';
import { computeReturn, type ReturnInput, type ReturnResult } from './form1040.js';
import type { TraceLine } from './types.js';
import { TY2026, type TaxYear } from './years/2026.js';

/** Headline figures compared across the two returns. */
export const COMPARED_METRICS = [
  'totalIncome',
  'agi',
  'deduction',
  'taxable',
  'incomeTax',
  'seTax',
  'totalTax',
  'netLiability',
  'balance',
] as const;

export type ComparedMetric = (typeof COMPARED_METRICS)[number];

export interface MetricDelta {
  metric: ComparedMetric;
  base: number;
  alt: number;
  /** `alt - base`, rounded to cents. */
  delta: number;
}

export interface LineDelta {
  id: string;
  label: string;
  ref?: string;
  /** Null when the line exists only in the other return. */
  base: number | null;
  alt: number | null;
  delta: number;
}

export interface ReturnComparison {
  base: ReturnResult;
  alt: ReturnResult;
  metrics: MetricDelta[];
  /** Trace lines whose value differs, in the order they appear in `alt` then `base`. */
  changedLines: LineDelta[];
  /** `alt.effectiveRate - base.effectiveRate`, as a fraction. */
  effectiveRateDelta: number;
}

const byId = (lines: TraceLine[]) => new Map(lines.map((l) => [l.id, l]));

/** Compute both returns and report what moved between them. */
export function compareReturns(
  base: ReturnInput,
  alt: ReturnInput,
  y: TaxYear = TY2026,
): ReturnComparison {
  const a = computeReturn(base, y, false);
  const b = computeReturn(alt, y, false);

  const metrics = COMPARED_METRICS.map((metric) => ({
    metric,
    base: a[metric],
    alt: b[metric],
    delta: round2(b[metric] - a[metric]),
  }));

  const baseLines = byId(a.lines);
  const altLines = byId(b.lines);
  const changedLines: LineDelta[] = [];
  for (const line of [...b.lines, ...a.lines.filter((l) => !altLines.has(l.id))]) {
    if (changedLines.some((c) => c.id === line.id)) continue;
    const before = baseLines.get(line.id);
    const after = altLines.get(line.id);
    const delta = round2((after?.value ?? 0) - (before?.value ?? 0));
    if (delta === 0) continue;
    changedLines.push({
      id: line.id,
      label: line.label,
      ref: line.ref,
      base: before?.value ?? null,
      alt: after?.value ?? null,
      delta,
    });
  }

  return {
    base: a,
    alt: b,
    metrics,
    changedLines,
    effectiveRateDelta: b.effectiveRate - a.effectiveRate,
  };
}
