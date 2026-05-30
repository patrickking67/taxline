// Tool: assess_confidence — route low-confidence fields to human review.
//
// The threshold is enforced in CODE, not by asking the model to "be careful":
// any field scoring below CONFIDENCE_THRESHOLD is returned in `needsReview` so
// the orchestrator can block it from shipping. (Architecture: confidence -> human.)

import { ok, fail, CONFIDENCE_THRESHOLD, type Tool, type ExtractedField, type ReviewItem } from '../types.js';

export interface ConfidenceInput {
  fields: ExtractedField[];
  /** Optional override; defaults to the global 0.85 threshold. */
  threshold?: number;
}

export interface ConfidenceOutput {
  threshold: number;
  passed: ExtractedField[];
  needsReview: ReviewItem[];
}

export const confidence: Tool<ConfidenceInput, ConfidenceOutput> = {
  name: 'assess_confidence',
  description:
    'Split extracted fields into those that clear the confidence threshold and ' +
    'those that must go to human review. A field is flagged when its confidence is ' +
    'below 0.85, is null, or its value is missing. Use before presenting results so ' +
    'uncertain values are never shipped unchecked.',
  inputSchema: {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        description: 'Fields to assess.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            value: { type: ['string', 'null'] },
            confidence: { type: ['number', 'null'] },
          },
          required: ['label'],
        },
      },
      threshold: { type: 'number', description: 'Optional confidence cutoff (0..1).' },
    },
    required: ['fields'],
  },
  run(input) {
    if (!input || !Array.isArray(input.fields)) {
      return fail('validation', 'assess_confidence requires a `fields` array.');
    }
    const threshold =
      typeof input.threshold === 'number' && input.threshold >= 0 && input.threshold <= 1
        ? input.threshold
        : CONFIDENCE_THRESHOLD;

    const passed: ExtractedField[] = [];
    const needsReview: ReviewItem[] = [];
    for (const f of input.fields) {
      const c = f.confidence;
      if (f.value == null) {
        needsReview.push({ reason: 'missing value', label: f.label, value: null, confidence: c ?? null });
      } else if (c == null) {
        needsReview.push({ reason: 'no confidence score', label: f.label, value: f.value, confidence: null });
      } else if (c < threshold) {
        needsReview.push({ reason: `confidence ${c.toFixed(2)} < ${threshold}`, label: f.label, value: f.value, confidence: c });
      } else {
        passed.push(f);
      }
    }
    return ok({ threshold, passed, needsReview });
  },
};
