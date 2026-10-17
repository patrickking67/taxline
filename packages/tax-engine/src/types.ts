// Shared contracts for the tax engine.
//
// Every computed figure is a `TraceLine`: the value, the formula that produced
// it, the form line it lands on, and the authority behind it. The engine never
// returns a bare number a reviewer cannot trace — the same principle the fleet
// applies to extracted fields.

export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';

export const FILING_STATUSES: { key: FilingStatus; label: string }[] = [
  { key: 'single', label: 'Single' },
  { key: 'mfj', label: 'Married filing jointly' },
  { key: 'mfs', label: 'Married filing separately' },
  { key: 'hoh', label: 'Head of household' },
];

/** One rate band: income above `floor` (and up to the next floor) is taxed at `rate`. */
export interface Bracket {
  rate: number;
  floor: number;
}

/** A figure with provenance. */
export interface Citation {
  /** Short label, e.g. "Rev. Proc. 2025-32 §4.01". */
  label: string;
  /** Primary-source URL. */
  url?: string;
}

export interface TraceLine {
  id: string;
  label: string;
  value: number;
  /** Where it lands, e.g. "1040 L15" or "Sch SE L6". */
  ref?: string;
  /** Human-readable formula with the actual operands, e.g. "142,300 − 16,100". */
  formula?: string;
  authority?: Citation;
  /** Values are dollars unless marked as a plain count. */
  unit?: 'usd' | 'count';
  /** Visual weight in a rendered workpaper. */
  emphasis?: 'subtotal' | 'total';
}

export type Trace = TraceLine[];
