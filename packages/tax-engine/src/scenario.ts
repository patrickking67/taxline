// Scenario intake: plain English → structured, confidence-scored return inputs.
//
// Two extractors produce the same shape. The model extractor (service/, Claude
// tool use) handles open-ended phrasing; the offline extractor below is a
// deterministic rule set so the feature works on static hosting with no model.
// Neither one is trusted directly: `validateScenario` re-checks every field in
// code — known key, typed value, and an evidence quote that must appear in the
// user's text and must support the value. A field that fails is not dropped
// silently; its confidence is capped below the review threshold and it carries
// the reason, so a person decides.

import type { FilingStatus } from './types.js';
import type { ReturnInput } from './form1040.js';

export type ScenarioKey =
  | 'status'
  | 'children'
  | 'wages'
  | 'federalWithholding'
  | 'selfEmploymentProfit'
  | 'interest'
  | 'ordinaryDividends'
  | 'qualifiedDividends'
  | 'longTermGain'
  | 'shortTermGain'
  | 'otherIncome'
  | 'adjustments'
  | 'itemized'
  | 'estimatedPayments';

export interface ScenarioSpec {
  key: ScenarioKey;
  label: string;
  kind: 'status' | 'count' | 'money' | 'signed-money';
  /** What the model is told the field means. */
  hint: string;
}

export const SCENARIO_FIELDS: ScenarioSpec[] = [
  { key: 'status', label: 'Filing status', kind: 'status', hint: 'single | mfj | mfs | hoh, only if stated or unambiguous' },
  { key: 'children', label: 'Qualifying children under 17', kind: 'count', hint: 'number of dependent children' },
  { key: 'wages', label: 'W-2 wages', kind: 'money', hint: 'salary or wages from employment, annual' },
  { key: 'federalWithholding', label: 'Federal tax withheld', kind: 'money', hint: 'federal income tax withheld from pay' },
  { key: 'selfEmploymentProfit', label: 'Schedule C net profit', kind: 'money', hint: 'net profit from freelance or business work (after expenses)' },
  { key: 'interest', label: 'Taxable interest', kind: 'money', hint: 'bank or bond interest received' },
  { key: 'ordinaryDividends', label: 'Ordinary dividends', kind: 'money', hint: 'total dividends' },
  { key: 'qualifiedDividends', label: 'Qualified dividends', kind: 'money', hint: 'dividends stated as qualified' },
  { key: 'longTermGain', label: 'Net long-term gain', kind: 'signed-money', hint: 'gains on assets held over a year; negative for a loss' },
  { key: 'shortTermGain', label: 'Net short-term gain', kind: 'signed-money', hint: 'gains on assets held a year or less; negative for a loss' },
  { key: 'otherIncome', label: 'Other ordinary income', kind: 'money', hint: 'other taxable income not covered above' },
  { key: 'adjustments', label: 'Other adjustments', kind: 'money', hint: 'IRA, HSA, or student-loan-interest deductions' },
  { key: 'itemized', label: 'Itemized deductions', kind: 'money', hint: 'total itemized deductions, only if stated as a total' },
  { key: 'estimatedPayments', label: 'Estimated payments', kind: 'money', hint: 'estimated tax already paid this year' },
];

const SPEC = new Map(SCENARIO_FIELDS.map((s) => [s.key, s]));
const STATUSES = new Set<FilingStatus>(['single', 'mfj', 'mfs', 'hoh']);

export interface ScenarioField {
  key: ScenarioKey;
  value: number | FilingStatus | null;
  confidence: number | null;
  /** Exact quote from the input that states the value. */
  evidence: string | null;
  note?: string;
}

export interface ScenarioExtraction {
  extractor: string;
  fields: ScenarioField[];
  /** Amounts the extractor saw but could not place. */
  unplaced: string[];
}

// ---- Amount parsing -------------------------------------------------------------

const AMOUNT = /(-|\bminus\s+|\bloss of\s+)?\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(k\b|m\b|thousand\b|million\b|grand\b)?/gi;

/** "$85k" → 85000, "1.2 million" → 1200000, "85,000" → 85000. Null when absent. */
export function parseAmount(s: string): number | null {
  AMOUNT.lastIndex = 0;
  const m = AMOUNT.exec(s);
  if (!m) return null;
  const base = Number(m[2]!.replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const unit = (m[3] ?? '').toLowerCase();
  const mult = unit === 'k' || unit === 'thousand' || unit === 'grand' ? 1e3 : unit === 'm' || unit === 'million' ? 1e6 : 1;
  return base * mult;
}

const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

// ---- Offline extractor ----------------------------------------------------------

interface Rule {
  key: ScenarioKey;
  test: RegExp;
  confidence: number;
  note?: string;
  negate?: RegExp;
}

// Order matters: the first rule whose pattern appears in an amount's window wins.
const RULES: Rule[] = [
  { key: 'federalWithholding', test: /withh[eo]ld|withholding|taken out for (federal )?tax/i, confidence: 0.92 },
  { key: 'estimatedPayments', test: /estimated (tax )?payments?|quarterly (tax )?payments?|paid .*estimates?/i, confidence: 0.88 },
  { key: 'qualifiedDividends', test: /qualified dividends?/i, confidence: 0.9 },
  { key: 'ordinaryDividends', test: /dividends?/i, confidence: 0.86 },
  { key: 'itemized', test: /itemiz/i, confidence: 0.88 },
  { key: 'itemized', test: /mortgage interest|charit|donat|property tax|\bsalt\b/i, confidence: 0.6, note: 'One itemized item, not a total — the standard deduction may still be larger.' },
  { key: 'interest', test: /interest/i, confidence: 0.88 },
  { key: 'longTermGain', test: /long[- ]term/i, confidence: 0.9 },
  { key: 'shortTermGain', test: /short[- ]term/i, confidence: 0.9 },
  { key: 'longTermGain', test: /capital gains?|sold (stock|shares|crypto|bitcoin)|crypto|stock (sale|gains?)|gain on/i, confidence: 0.62, note: 'Holding period not stated — treated as long-term.' },
  { key: 'adjustments', test: /\bira\b|\bhsa\b|student loan/i, confidence: 0.78, note: 'Assumes the contribution is deductible.' },
  { key: 'selfEmploymentProfit', test: /(net )?profit|after expenses/i, confidence: 0.88, negate: /\bw-?2\b|salary/i },
  { key: 'selfEmploymentProfit', test: /freelanc|self[- ]employ|1099|consult|side (gig|business|hustle)|contractor|my (own )?business|schedule c|clients?/i, confidence: 0.7, note: 'Gross vs. net profit not stated — enter profit after expenses.' },
  { key: 'wages', test: /salary|wages?|\bw-?2\b|paycheck|my job|employer/i, confidence: 0.92 },
  { key: 'wages', test: /\b(make|made|earn|earned|earning|income of|bring home)\b/i, confidence: 0.74, note: 'Source of income not stated — treated as W-2 wages.' },
  { key: 'otherIncome', test: /rental|royalt|prize|gambling|alimony|unemployment/i, confidence: 0.7 },
];

function windows(text: string): { amount: number; window: string; raw: string }[] {
  // Clauses: split on sentence breaks and list separators so "X and Y" stays apart.
  const out: { amount: number; window: string; raw: string }[] = [];
  const clauses = text.split(/(?<=[.;!?\n])\s+|,\s+|\s+(?:and|plus|but)\s+/i);
  for (const clause of clauses) {
    const hits: { start: number; end: number; raw: string }[] = [];
    AMOUNT.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = AMOUNT.exec(clause))) {
      const raw = m[0];
      // Skip bare small integers that are counts or years, not money.
      const looksMoney = /\$|k\b|thousand|million|grand|,\d{3}/i.test(raw) || Number(m[2]!.replace(/,/g, '')) >= 100;
      const isYear = /^(19|20)\d{2}$/.test(m[2]!) && !/\$/.test(raw);
      if (looksMoney && !isYear) hits.push({ start: m.index, end: m.index + raw.length, raw });
    }
    hits.forEach((hit, i) => {
      const from = i === 0 ? 0 : hits[i - 1]!.end;
      const to = i === hits.length - 1 ? clause.length : hits[i + 1]!.start;
      const window = clause.slice(from, to).trim();
      const amt = parseAmount(hit.raw);
      if (amt != null) out.push({ amount: Math.abs(amt), window, raw: hit.raw.trim() });
    });
  }
  return out;
}

function detectStatus(text: string): ScenarioField | null {
  const t = text;
  const quote = (re: RegExp) => (t.match(re)?.[0] ?? null);
  let q: string | null;
  if ((q = quote(/married filing separately|filing separately|\bmfs\b/i))) return { key: 'status', value: 'mfs', confidence: 0.95, evidence: q };
  if ((q = quote(/married filing jointly|file jointly|filing jointly|\bmfj\b/i))) return { key: 'status', value: 'mfj', confidence: 0.96, evidence: q };
  if ((q = quote(/head of household|\bhoh\b/i))) return { key: 'status', value: 'hoh', confidence: 0.95, evidence: q };
  if ((q = quote(/\b(married|my (wife|husband|spouse)|we both)\b/i)))
    return { key: 'status', value: 'mfj', confidence: 0.74, evidence: q, note: 'Married — joint filing assumed, not stated.' };
  if ((q = quote(/single (mom|dad|parent|mother|father)/i)))
    return { key: 'status', value: 'hoh', confidence: 0.72, evidence: q, note: 'Head of household assumed; confirm the household tests.' };
  if ((q = quote(/\b(single|unmarried|not married)\b/i))) return { key: 'status', value: 'single', confidence: 0.92, evidence: q };
  return null;
}

function detectChildren(text: string): ScenarioField | null {
  const m = text.match(/\b(\d+|a|an|one|two|three|four|five|six)\s+(kids?|children|child|dependents?|sons?|daughters?|toddlers?)\b/i);
  if (m) {
    const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : (WORD_NUM[m[1]!.toLowerCase()] ?? null);
    if (n != null) return { key: 'children', value: n, confidence: 0.86, evidence: m[0], note: 'Assumes each child is under 17 and a qualifying child.' };
  }
  const none = text.match(/\bno (kids|children|dependents)\b/i);
  if (none) return { key: 'children', value: 0, confidence: 0.95, evidence: none[0] };
  return null;
}

/** Deterministic, rule-based extraction. No network, no model. */
export function extractScenario(text: string): ScenarioExtraction {
  const fields: ScenarioField[] = [];
  const unplaced: string[] = [];
  const status = detectStatus(text);
  if (status) fields.push(status);
  const kids = detectChildren(text);
  if (kids) fields.push(kids);

  for (const w of windows(text)) {
    const rule = RULES.find((r) => r.test.test(w.window) && !(r.negate && r.negate.test(w.window)));
    if (!rule) {
      unplaced.push(w.window);
      continue;
    }
    const loss = /\bloss|lost\b|-\s?\$|minus/i.test(w.window) && SPEC.get(rule.key)?.kind === 'signed-money';
    fields.push({ key: rule.key, value: loss ? -w.amount : w.amount, confidence: rule.confidence, evidence: w.window, ...(rule.note ? { note: rule.note } : {}) });
  }
  return { extractor: 'offline rules', fields: validateScenario(text, fields), unplaced };
}

// ---- Validation (applied to every extractor) -------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
/** Highest confidence a field may keep when a programmatic check fails. */
export const FAILED_CHECK_CAP = 0.5;

/**
 * Re-check every field in code. Unknown keys are dropped (they cannot be
 * applied anywhere); every other failure caps confidence at 0.5 and records why.
 * When two fields claim the same key, amounts are summed only if their evidence
 * differs (two W-2s); otherwise the higher-confidence one wins.
 */
export function validateScenario(text: string, raw: ScenarioField[]): ScenarioField[] {
  const source = norm(text);
  const out = new Map<ScenarioKey, ScenarioField>();
  for (const f of raw) {
    const spec = SPEC.get(f.key);
    if (!spec) continue;
    const notes: string[] = f.note ? [f.note] : [];
    let conf = typeof f.confidence === 'number' && Number.isFinite(f.confidence) ? Math.min(1, Math.max(0, f.confidence)) : null;
    let value = f.value;
    const fail = (why: string) => {
      notes.push(why);
      conf = Math.min(conf ?? FAILED_CHECK_CAP, FAILED_CHECK_CAP);
    };

    if (value === null) {
      conf = null;
    } else if (spec.kind === 'status') {
      if (typeof value !== 'string' || !STATUSES.has(value as FilingStatus)) {
        value = null;
        fail('Not a recognized filing status.');
      }
    } else {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) {
        value = null;
        fail('Value is not a number.');
      } else if (spec.kind !== 'signed-money' && n < 0) {
        value = Math.abs(n);
        fail('Negative amount for a field that cannot be negative.');
      } else {
        value = spec.kind === 'count' ? Math.round(n) : n;
      }
    }

    const ev = f.evidence?.trim() || null;
    if (value !== null) {
      if (!ev) fail('No evidence quote.');
      else if (!source.includes(norm(ev))) fail('Evidence quote does not appear in the description.');
      else if (spec.kind === 'money' || spec.kind === 'signed-money') {
        const stated = parseAmount(ev);
        if (stated == null || Math.abs(Math.abs(stated) - Math.abs(value as number)) > 0.5) fail('Quoted text does not state this amount.');
      }
    }

    const field: ScenarioField = { key: f.key, value, confidence: conf, evidence: ev, ...(notes.length ? { note: notes.join(' ') } : {}) };
    const prev = out.get(f.key);
    if (!prev) out.set(f.key, field);
    else if ((spec.kind === 'money' || spec.kind === 'signed-money') && typeof prev.value === 'number' && typeof value === 'number' && prev.evidence !== ev) {
      out.set(f.key, {
        key: f.key,
        value: prev.value + value,
        confidence: Math.min(prev.confidence ?? 0, conf ?? 0),
        evidence: [prev.evidence, ev].filter(Boolean).join(' … '),
        note: 'Summed from two mentions.',
      });
    } else if ((conf ?? 0) > (prev.confidence ?? 0)) out.set(f.key, field);
  }
  // Keep the published order so the UI is stable.
  return SCENARIO_FIELDS.map((s) => out.get(s.key)).filter((x): x is ScenarioField => !!x);
}

/** The approved subset as calculator inputs. Null values are never applied. */
export function scenarioToInput(fields: ScenarioField[]): Partial<ReturnInput> {
  const input: Record<string, unknown> = {};
  for (const f of fields) if (f.value !== null) input[f.key] = f.value;
  // Qualified dividends are a subset of ordinary dividends (1099-DIV 1b ⊆ 1a).
  if (typeof input.qualifiedDividends === 'number' && !(typeof input.ordinaryDividends === 'number' && input.ordinaryDividends >= input.qualifiedDividends)) {
    input.ordinaryDividends = input.qualifiedDividends;
  }
  return input as Partial<ReturnInput>;
}

export const scenarioLabel = (k: ScenarioKey) => SPEC.get(k)?.label ?? k;
