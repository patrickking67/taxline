// Tool: compute_deadline — filing-deadline math over a RULES seed.
//
// This computes dates from the documented rule ("15th day of the Nth month after
// year-end") rather than reciting memorized calendar dates. It applies the
// weekend/holiday shift mechanically. IMPORTANT: the federal-holiday set here is a
// SEED for the engine, not an authoritative list — the tool always returns a
// `verify` pointer to the IRS source, matching the KB's "verify against IRS" stance.

import { ok, fail, type Tool } from '../types.js';

export interface DeadlineInput {
  /** Form whose deadline to compute. */
  form: '1040' | '1120' | '1120-S' | '1065' | '990' | '1040-ES' | '4868' | '7004' | string;
  /** Tax year end (YYYY-MM-DD). Defaults to Dec 31 of `taxYear` for calendar filers. */
  yearEnd?: string;
  /** Calendar tax year, used when yearEnd is omitted. */
  taxYear?: number;
}

export interface DeadlineOutput {
  form: string;
  /** Base statutory due date before any weekend/holiday shift (YYYY-MM-DD). */
  ruleDate: string;
  /** Due date after shifting off weekends/observed holidays (YYYY-MM-DD). */
  dueDate: string;
  shifted: boolean;
  rule: string;
  /** Always present: the live source to confirm against. */
  verify: string;
}

// Rule = how many months after year-end, and which day of that month.
// Extensions (4868/7004) and estimates (1040-ES Q1) keyed to the primary return.
const RULES: Record<string, { monthsAfter: number; day: number; rule: string }> = {
  '1040': { monthsAfter: 4, day: 15, rule: '15th day of the 4th month after year-end' },
  '1040-ES': {
    monthsAfter: 4,
    day: 15,
    rule: 'Q1 estimate: 15th day of the 4th month after year-end',
  },
  '4868': { monthsAfter: 4, day: 15, rule: 'Individual extension request: same date as the 1040' },
  '1120': { monthsAfter: 4, day: 15, rule: 'C-corp: 15th day of the 4th month after year-end' },
  '1120-S': { monthsAfter: 3, day: 15, rule: 'S-corp: 15th day of the 3rd month after year-end' },
  '1065': {
    monthsAfter: 3,
    day: 15,
    rule: 'Partnership: 15th day of the 3rd month after year-end',
  },
  '7004': { monthsAfter: 3, day: 15, rule: 'Business extension: keyed to the underlying return' },
  '990': { monthsAfter: 5, day: 15, rule: 'Exempt org: 15th day of the 5th month after year-end' },
};

const VERIFY_SOURCE =
  'Verify against the current IRS source (see tax/filing-deadlines.md → "IRS source"). ' +
  'Dates shift for weekends and federal/DC holidays (e.g. Emancipation Day).';

// SEED ONLY: fixed-date federal holidays plus DC Emancipation Day (April 16), the
// ones that can land on or next to a filing date. Not exhaustive; the verify
// pointer covers the rest. Each is checked on its OBSERVED date: a holiday on a
// Saturday is observed the Friday before, on a Sunday the Monday after
// (5 U.S.C. 6103(b); D.C. Code 1-612.02 for Emancipation Day). That is what moved
// the 2022 deadline from Friday April 15 to Monday April 18, and the 2023 one
// past Monday April 17 to Tuesday April 18.
const SEED_HOLIDAYS: { month: number; day: number }[] = [
  { month: 1, day: 1 },
  { month: 4, day: 16 },
  { month: 6, day: 19 },
  { month: 7, day: 4 },
  { month: 12, day: 25 },
];

function isoToParts(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const parts = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  // Reject dates that Date.UTC would silently roll over (2024-02-30, 2024-13-01).
  const check = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  if (
    check.getUTCFullYear() !== parts.y ||
    check.getUTCMonth() !== parts.m - 1 ||
    check.getUTCDate() !== parts.d
  )
    return null;
  return parts;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** The date a fixed holiday is observed in year `y`: Saturday moves back a day, Sunday forward. */
export function observedDate(y: number, month: number, day: number): string {
  const d = new Date(Date.UTC(y, month - 1, day));
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
  if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
  return toIso(d);
}

function isHoliday(d: Date): boolean {
  const iso = toIso(d);
  const y = d.getUTCFullYear();
  // New Year's Day on a Saturday is observed on December 31 of the year before.
  return [y, y + 1].some((year) =>
    SEED_HOLIDAYS.some((h) => observedDate(year, h.month, h.day) === iso),
  );
}

/**
 * Roll forward to the next day that is not a Saturday, Sunday, or observed
 * holiday (IRC 7503).
 */
function nextBusinessDay(d: Date): Date {
  const out = new Date(d.getTime());
  while (isWeekend(out) || isHoliday(out)) {
    out.setUTCDate(out.getUTCDate() + 1);
  }
  return out;
}

export const calendar: Tool<DeadlineInput, DeadlineOutput> = {
  name: 'compute_deadline',
  description:
    'Compute a filing deadline for a given form (1040, 1120, 1120-S, 1065, 990, ' +
    '1040-ES, 4868, 7004) from the statutory rule and the tax year-end, applying the ' +
    'weekend/holiday shift. Returns both the rule date and the shifted due date plus a ' +
    'pointer to verify against the IRS. Use for compliance deadlines and reminders.',
  inputSchema: {
    type: 'object',
    properties: {
      form: { type: 'string', description: 'Form id, e.g. "1040", "1120-S", "1065".' },
      yearEnd: { type: 'string', description: 'Fiscal year-end YYYY-MM-DD (optional).' },
      taxYear: { type: 'integer', description: 'Calendar tax year (used if yearEnd omitted).' },
    },
    required: ['form'],
  },
  run(input) {
    if (!input || typeof input.form !== 'string') {
      return fail('validation', 'compute_deadline requires a `form`.');
    }
    const rule = RULES[input.form];
    if (!rule) {
      // Business-rule failure: we don't have a rule for this form. Not retryable —
      // the caller must supply a supported form or extend the ruleset.
      return fail(
        'business',
        `No deadline rule seeded for form "${input.form}". Supported: ${Object.keys(RULES).join(', ')}.`,
      );
    }

    // Resolve year-end. Default to Dec 31 of taxYear (calendar-year filer).
    let yEnd: { y: number; m: number; d: number } | null;
    if (input.yearEnd) {
      yEnd = isoToParts(input.yearEnd);
      if (!yEnd) return fail('validation', '`yearEnd` must be a real date in YYYY-MM-DD form.');
    } else if (typeof input.taxYear === 'number') {
      if (!Number.isInteger(input.taxYear) || input.taxYear < 1900 || input.taxYear > 2200) {
        return fail('validation', '`taxYear` must be a four-digit year.');
      }
      yEnd = { y: input.taxYear, m: 12, d: 31 };
    } else {
      return fail('validation', 'Provide either `yearEnd` or `taxYear`.');
    }

    // Base date = day-of `rule.day` in the month `rule.monthsAfter` after year-end.
    // Year-end month is `yEnd.m`; add monthsAfter (1-indexed months) via Date math.
    const base = new Date(Date.UTC(yEnd.y, yEnd.m - 1 + rule.monthsAfter, rule.day));
    const ruleDate = toIso(base);
    const shiftedDate = nextBusinessDay(base);
    const dueDate = toIso(shiftedDate);

    return ok({
      form: input.form,
      ruleDate,
      dueDate,
      shifted: dueDate !== ruleDate,
      rule: rule.rule,
      verify: VERIFY_SOURCE,
    });
  },
};
