// The rules extractor: a deterministic, offline reader for the text layer of the
// forms in forms.ts. No model, no network, no randomness.
//
// How a field gets its confidence. Each factor is something observed in the
// document, never a number made up for the demo:
//
//   anchor   how closely the caption on the line matches the form's caption
//   format   whether the value fits its pattern as read, or needed repairs
//   noise    how damaged the rest of the document is. Visible damage (a letter
//            where a digit belongs, a misspelled caption) predicts the damage
//            that cannot be seen: one digit read as another.
//   checks   arithmetic that ties boxes together. A value confirmed by a second,
//            independently read box is very unlikely to be wrong; a value that
//            breaks a check goes to a person.
//
// The weights below were set on development seeds and are scored on a different
// seed by python/taxline_quant/evals. See docs/quant/report.md, section 5.

import { FORMS, formByType, type FieldKind, type FieldSpec, type FormSpec } from './forms.js';
import { parseCode, parseId, parseMoney, parseText, type Parsed } from './values.js';

export const WEIGHTS = {
  /** A caption must match at least this well to anchor a field. */
  minAnchor: 0.7,
  /** Confidence multiplier at the weakest accepted anchor; 1.0 at an exact match. */
  anchorFloor: 0.8,
  lookalikeRepair: 0.97,
  ambiguousRepair: 0.66,
  separatorRepair: 0.97,
  /** A value kept although it does not fit its pattern. */
  malformed: 0.4,
  /** Chance per character of an unseen misread in a document with no visible damage. */
  baseSilentRate: 0.0006,
  /** Unseen misreads per visible one, by kind of value. */
  silentPerVisible: { money: 0.35, id: 0.35, code: 0.7, text: 0.8 },
  /** Share of the remaining risk left after a cross-check confirms a value. */
  confirmedRisk: 0.05,
  /** Ceiling for a value that breaks a cross-check. */
  failedCheck: 0.45,
  /** Ceiling for a value outside a bound (withholding above wages). */
  failedBound: 0.3,
  floor: 0.05,
  ceiling: 0.99,
} as const;

export interface RuleField {
  key: string;
  label: string;
  kind: FieldKind;
  value: string | null;
  confidence: number | null;
  /** 1-based line the value was read from, or null when no line matched. */
  line: number | null;
  /** The source line as it appears in the document. */
  source: string | null;
  /** Plain-language evidence behind the confidence. */
  signals: string[];
}

export interface RuleCheck {
  name: string;
  passed: boolean;
  fields: string[];
}

export interface RuleExtraction {
  /** Null when the text matches no known form. */
  docType: string | null;
  fields: RuleField[];
  checks: RuleCheck[];
  /** Visible damage per character over the lines that were read. */
  noise: number;
}

const FOLD: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  i: 'l',
  '5': 's',
  '8': 'b',
  '2': 'z',
  '6': 'g',
  '9': 'g',
  '4': 'a',
  '3': 'e',
  '7': 't',
};

const plain = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Plain form with look-alike characters merged, so `l Wages` matches `1 Wages`. */
const folded = (s: string): string => [...plain(s)].map((ch) => FOLD[ch] ?? ch).join('');

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[b.length]!;
}

interface Match {
  spec: FieldSpec;
  anchor: string;
  score: number;
  /** Visible caption damage: edit distance before look-alikes are merged. */
  damage: number;
  line: number;
  source: string;
  rest: string;
}

/** Best match of one caption against the start of a line. */
function matchAnchor(
  tokens: string[],
  anchor: string,
): { score: number; damage: number; used: number } {
  const want = folded(anchor);
  const wantPlain = plain(anchor);
  const anchorTokens = anchor.split(/\s+/).length;
  let best = { score: 0, damage: wantPlain.length, used: 0 };
  const limit = Math.min(tokens.length, anchorTokens + 2);
  for (let n = 1; n <= limit; n++) {
    const prefix = tokens.slice(0, n).join(' ');
    const score = 1 - editDistance(folded(prefix), want) / Math.max(want.length, 1);
    if (score > best.score) {
      best = { score, damage: editDistance(plain(prefix), wantPlain), used: n };
    }
  }
  return best;
}

function matchLines(lines: string[], form: FormSpec): Map<string, Match> {
  const byField = new Map<string, Match>();
  lines.forEach((source, index) => {
    const tokens = source.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return;
    let top: (Match & { size: number }) | null = null;
    for (const spec of form.fields) {
      for (const anchor of spec.anchors) {
        const m = matchAnchor(tokens, anchor);
        const size = folded(anchor).length;
        if (!top || m.score > top.score || (m.score === top.score && size > top.size)) {
          const rest = tokens
            .slice(m.used)
            .join(' ')
            .replace(/^[:;]\s*/, '');
          top = {
            spec,
            anchor,
            score: m.score,
            damage: m.damage,
            line: index + 1,
            source,
            rest,
            size,
          };
        }
      }
    }
    // A line anchors at most one field: the caption it matches best.
    if (!top || top.score < WEIGHTS.minAnchor) return;
    const held = byField.get(top.spec.key);
    if (!held || top.score > held.score) byField.set(top.spec.key, top);
  });
  return byField;
}

/** Pick the form whose captions the text matches best; the title line breaks ties. */
export function detectForm(
  lines: string[],
): { form: FormSpec; matches: Map<string, Match> } | null {
  const title = folded(lines.slice(0, 2).join(' '));
  let best: { form: FormSpec; matches: Map<string, Match>; rank: number } | null = null;
  for (const form of FORMS) {
    const matches = matchLines(lines, form);
    let rank = 0;
    for (const m of matches.values()) rank += m.score;
    if (form.titleKeys.some((key) => title.includes(folded(key)))) rank += 1.5;
    if (!best || rank > best.rank) best = { form, matches, rank };
  }
  // One caption plus a title, or two captions, is the least that identifies a form.
  return best && best.rank >= 1.7 ? { form: best.form, matches: best.matches } : null;
}

export const PARSERS = {
  money: parseMoney,
  id: parseId,
  code: parseCode,
  text: parseText,
} as const;

interface Read {
  spec: FieldSpec;
  match: Match | null;
  parsed: Parsed | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const cents = (reads: Map<string, Read>, key: string): number | null =>
  reads.get(key)?.parsed?.cents ?? null;
/** Half-up rounding of a product of integer cents and a rate in ten-thousandths. */
const share = (amount: number, tenThousandths: number): number =>
  Math.floor((amount * tenThousandths + 5000) / 10000);

interface Verdicts {
  checks: RuleCheck[];
  confirmed: Map<string, string>;
  failed: Map<string, string>;
  outOfBound: Map<string, string>;
}

function runChecks(docType: string, reads: Map<string, Read>): Verdicts {
  const v: Verdicts = {
    checks: [],
    confirmed: new Map(),
    failed: new Map(),
    outOfBound: new Map(),
  };
  const equal = (
    name: string,
    left: number | null,
    right: number | null,
    fields: string[],
  ): boolean | null => {
    if (left == null || right == null) return null;
    const passed = left === right;
    v.checks.push({ name, passed, fields });
    return passed;
  };
  const bound = (name: string, low: number | null, high: number | null, field: string) => {
    if (low == null || high == null) return;
    const passed = low <= high;
    v.checks.push({ name, passed, fields: [field] });
    if (!passed) v.outOfBound.set(field, name);
  };

  if (docType === 'W-2') {
    const b1 = cents(reads, 'box1');
    const b3 = cents(reads, 'box3');
    const b4 = cents(reads, 'box4');
    const b5 = cents(reads, 'box5');
    const b6 = cents(reads, 'box6');
    const b12 = cents(reads, 'box12d');
    const b16 = cents(reads, 'box16');
    // Social security tax is 6.2% of social security wages (IRC 3101(a)).
    equal('box 4 = 6.2% of box 3', b4, b3 == null ? null : share(b3, 620), ['box3', 'box4']);
    // Medicare tax is 1.45% of Medicare wages (IRC 3101(b)(1)).
    const medicare = equal('box 6 = 1.45% of box 5', b6, b5 == null ? null : share(b5, 145), [
      'box5',
      'box6',
    ]);
    // Elective deferrals are in Medicare wages but not in box 1.
    const name = b12 == null ? 'box 1 = box 5' : 'box 1 + box 12a code D = box 5';
    let wages: boolean | null = null;
    if (b1 != null && b5 != null) {
      if (b12 != null || b1 >= b5) wages = equal(name, b1 + (b12 ?? 0), b5, ['box1', 'box5']);
      // With box 1 below box 5 and no box 12 line read, a deferral may simply be missing.
    }
    const state = equal('box 16 = box 1', b16, b1, ['box1', 'box16']);
    if (state === true) v.confirmed.set('box1', 'box 16 = box 1');
    else if (wages === true && medicare === true)
      v.confirmed.set('box1', `${name}, and box 6 confirms box 5`);
    else if (state === false && wages !== true) v.failed.set('box1', 'box 16 = box 1');
    else if (wages === false) v.failed.set('box1', name);
    bound('box 2 is no more than box 1', cents(reads, 'box2'), b1, 'box2');
    bound('box 17 is no more than state wages', cents(reads, 'box17'), b16 ?? b1, 'box17');
  }

  if (docType === '1099-NEC') {
    const b1 = cents(reads, 'box1');
    const b4 = cents(reads, 'box4');
    if (b1 != null && b4 != null && b4 !== 0) {
      // Backup withholding is 24% of the payment (IRC 3406(a)(1)).
      const name = 'box 4 = 24% of box 1';
      const passed = equal(name, b4, share(b1, 2400), ['box1', 'box4']);
      for (const key of ['box1', 'box4']) (passed ? v.confirmed : v.failed).set(key, name);
    }
  }

  return v;
}

/**
 * Read a document's text. `docType` skips form detection when the caller already
 * knows the form (the intake queue does); a type with no parser returns no fields.
 */
export function extractFields(text: string, docType?: string): RuleExtraction {
  const lines = text.split(/\r?\n/);
  let form: FormSpec | undefined;
  let matches: Map<string, Match>;
  if (docType !== undefined) {
    form = formByType(docType);
    if (!form) return { docType: null, fields: [], checks: [], noise: 0 };
    matches = matchLines(lines, form);
  } else {
    const found = detectForm(lines);
    if (!found) return { docType: null, fields: [], checks: [], noise: 0 };
    form = found.form;
    matches = found.matches;
  }

  const reads = new Map<string, Read>();
  let damage = 0;
  let seen = 0;
  for (const spec of form.fields) {
    const match = matches.get(spec.key) ?? null;
    const parsed = match ? PARSERS[spec.kind](match.rest) : null;
    reads.set(spec.key, { spec, match, parsed });
    if (!match) continue;
    damage += match.damage;
    seen += plain(match.anchor).length + match.rest.replace(/\s/g, '').length;
    if (!parsed || parsed.value == null) damage += 1;
    else
      damage +=
        parsed.lookalike + parsed.ambiguous + parsed.separator + (parsed.wellFormed ? 0 : 1);
  }
  const noise = seen > 0 ? damage / seen : 0;
  const verdicts = runChecks(form.docType, reads);

  const fields: RuleField[] = [];
  for (const { spec, match, parsed } of reads.values()) {
    if (spec.support) continue;
    if (!match) {
      fields.push({
        key: spec.key,
        label: spec.label,
        kind: spec.kind,
        value: null,
        confidence: null,
        line: null,
        source: null,
        signals: ['no line matches the caption'],
      });
      continue;
    }
    const signals = [`caption match ${match.score.toFixed(2)} on line ${match.line}`];
    if (!parsed || parsed.value == null) {
      fields.push({
        key: spec.key,
        label: spec.label,
        kind: spec.kind,
        value: null,
        confidence: null,
        line: match.line,
        source: match.source,
        signals: [...signals, 'value is unreadable or the wrong shape'],
      });
      continue;
    }

    const span = (match.score - WEIGHTS.minAnchor) / (1 - WEIGHTS.minAnchor);
    let confidence = WEIGHTS.anchorFloor + (1 - WEIGHTS.anchorFloor) * span;

    const repairs = parsed.lookalike + parsed.ambiguous + parsed.separator;
    confidence *=
      WEIGHTS.lookalikeRepair ** parsed.lookalike *
      WEIGHTS.ambiguousRepair ** parsed.ambiguous *
      WEIGHTS.separatorRepair ** parsed.separator;
    if (!parsed.wellFormed) {
      confidence *= WEIGHTS.malformed;
      signals.push('value does not fit the expected pattern');
    } else {
      signals.push(
        repairs === 0 ? 'format valid as read' : `format valid after ${repairs} repair(s)`,
      );
    }

    const size = parsed.value.replace(/[^A-Za-z0-9]/g, '').length;
    const rate = WEIGHTS.baseSilentRate + WEIGHTS.silentPerVisible[spec.kind] * noise;
    let risk = 1 - (1 - Math.min(rate, 1)) ** size;
    signals.push(`document damage ${(noise * 100).toFixed(1)}% of characters`);

    const confirmed = verdicts.confirmed.get(spec.key);
    if (confirmed) {
      risk *= WEIGHTS.confirmedRisk;
      signals.push(`confirmed: ${confirmed}`);
    }
    confidence *= 1 - risk;

    const failed = verdicts.failed.get(spec.key);
    if (failed) {
      confidence = Math.min(confidence, WEIGHTS.failedCheck);
      signals.push(`check failed: ${failed}`);
    }
    const outOfBound = verdicts.outOfBound.get(spec.key);
    if (outOfBound) {
      confidence = Math.min(confidence, WEIGHTS.failedBound);
      signals.push(`check failed: ${outOfBound}`);
    }

    fields.push({
      key: spec.key,
      label: spec.label,
      kind: spec.kind,
      value: parsed.value,
      confidence: round2(Math.min(WEIGHTS.ceiling, Math.max(WEIGHTS.floor, confidence))),
      line: match.line,
      source: match.source,
      signals,
    });
  }
  return { docType: form.docType, fields, checks: verdicts.checks, noise };
}
