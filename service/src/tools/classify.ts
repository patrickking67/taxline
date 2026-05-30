// Tool: classify_document — first-pass document type + routing hint.
//
// Used by the Intake agent. Deterministic keyword matching over a small ruleset
// gives a fast, explainable classification; the model uses the result to decide
// routing. Confidence is reported so genuinely ambiguous docs can be flagged.

import { ok, fail, type Tool } from '../types.js';

export interface ClassifyInput {
  /** Filename and/or any extracted text snippet to classify. */
  text: string;
}

export interface ClassifyOutput {
  docType: string;
  /** Which agent should handle this next. */
  routeTo: 'extraction' | 'research' | 'workpaper' | 'compliance';
  confidence: number;
  /** Matched signals, for transparency. */
  signals: string[];
}

interface Rule {
  docType: string;
  routeTo: ClassifyOutput['routeTo'];
  patterns: RegExp[];
}

// Ordered most-specific first. These mirror the forms in the KB's forms-by-document.
const RULES: Rule[] = [
  { docType: '1099-NEC', routeTo: 'extraction', patterns: [/1099[\s_-]?nec/i, /nonemployee comp/i] },
  { docType: '1099-MISC', routeTo: 'extraction', patterns: [/1099[\s_-]?misc/i] },
  { docType: '1099-INT', routeTo: 'extraction', patterns: [/1099[\s_-]?int/i, /interest income/i] },
  { docType: '1099-DIV', routeTo: 'extraction', patterns: [/1099[\s_-]?div/i, /dividends/i] },
  { docType: '1099-B', routeTo: 'extraction', patterns: [/1099[\s_-]?b\b/i, /proceeds from broker/i] },
  { docType: 'W-2', routeTo: 'extraction', patterns: [/\bw[\s_-]?2\b/i, /wage and tax/i] },
  { docType: 'K-1', routeTo: 'extraction', patterns: [/\bk[\s_-]?1\b/i, /schedule k-1/i] },
  { docType: '1098', routeTo: 'extraction', patterns: [/\b1098\b/i, /mortgage interest/i] },
  { docType: 'Brokerage composite', routeTo: 'extraction', patterns: [/composite/i, /consolidated 1099/i] },
  { docType: 'Expense batch', routeTo: 'extraction', patterns: [/invoice/i, /receipt/i, /expense/i] },
  { docType: 'Depreciation schedule', routeTo: 'workpaper', patterns: [/deprec/i, /macrs/i, /§?\s?168/i, /§?\s?179/i] },
];

export const classify: Tool<ClassifyInput, ClassifyOutput> = {
  name: 'classify_document',
  description:
    'Classify an incoming tax document by its filename and/or a text snippet, and ' +
    'recommend which agent should handle it next. Returns the document type, a route ' +
    'target, and a confidence score. Use as the first step when triaging intake.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Filename and/or extracted text to classify.' },
    },
    required: ['text'],
  },
  run(input) {
    if (!input || typeof input.text !== 'string' || input.text.trim() === '') {
      return fail('validation', 'classify_document requires non-empty `text`.');
    }
    const signals: string[] = [];
    for (const rule of RULES) {
      const hits = rule.patterns.filter((p) => p.test(input.text));
      if (hits.length > 0) {
        for (const h of hits) signals.push(h.source);
        // More matched patterns => higher confidence, capped below 1.0 so a human
        // can still be looped in; a single weak signal stays in review range.
        const confidence = Math.min(0.6 + 0.2 * hits.length, 0.97);
        return ok({ docType: rule.docType, routeTo: rule.routeTo, confidence, signals });
      }
    }
    // No rule matched: a valid result, but low confidence -> Intake should ask a human.
    return ok({ docType: 'Unknown', routeTo: 'extraction', confidence: 0.3, signals: [] });
  },
};
