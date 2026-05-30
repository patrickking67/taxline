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
  '1040-ES': { monthsAfter: 4, day: 15, rule: 'Q1 estimate: 15th day of the 4th month after year-end' },
  '4868': { monthsAfter: 4, day: 15, rule: 'Individual extension request: same date as the 1040' },
  '1120': { monthsAfter: 4, day: 15, rule: 'C-corp: 15th day of the 4th month after year-end' },
  '1120-S': { monthsAfter: 3, day: 15, rule: 'S-corp: 15th day of the 3rd month after year-end' },
  '1065': { monthsAfter: 3, day: 15, rule: 'Partnership: 15th day of the 3rd month after year-end' },
  '7004': { monthsAfter: 3, day: 15, rule: 'Business extension: keyed to the underlying return' },
  '990': { monthsAfter: 5, day: 15, rule: 'Exempt org: 15th day of the 5th month after year-end' },
};

const VERIFY_SOURCE =
  'Verify against the current IRS source (see tax/filing-deadlines.md → "IRS source"). ' +
  'Dates shift for weekends and federal/DC holidays (e.g. Emancipation Day).';

// SEED ONLY — fixed-date federal holidays relevant to spring filing season, plus a
// couple commonly-observed ones. Not exhaustive; the engine shifts off these and
// off weekends, and the verify pointer covers the rest.
const SEED_HOLIDAYS_MMDD = new Set(['01-01', '04-16', '06-19', '07-04', '12-25']);

function isoToParts(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function isHoliday(d: Date): boolean {
  const mmdd = toIso(d).slice(5);
  return SEED_HOLIDAYS_MMDD.has(mmdd);
}

/** Roll forward to the next business day that is neither weekend nor seeded holiday. */
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
    let yEnd: { y: number; m: number; d: number } | null = null;
    if (input.yearEnd) {
      yEnd = isoToParts(input.yearEnd);
      if (!yEnd) return fail('validation', '`yearEnd` must be YYYY-MM-DD.');
    } else if (typeof input.taxYear === 'number') {
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
