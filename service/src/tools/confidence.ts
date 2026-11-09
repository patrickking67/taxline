// Tool: assess_confidence — route low-confidence fields to human review.
//
// The threshold is enforced in CODE, not by asking the model to "be careful":
// any field scoring below CONFIDENCE_THRESHOLD is returned in `needsReview` so
// the orchestrator can block it from shipping. (Architecture: confidence -> human.)
//
// The model calls this tool, so its arguments are untrusted. A caller may make the
// threshold stricter but never looser, and a score that is not a number in [0, 1]
// is treated as no score at all.

import {
  ok,
  fail,
  CONFIDENCE_THRESHOLD,
  type Tool,
  type ExtractedField,
  type ReviewItem,
} from '../types.js';

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

/**
 * A confidence score the gate can trust: a finite number in [0, 1], or null.
 * Anything else (NaN, 1.5, "0.9") is not a score.
 */
export function validConfidence(c: unknown): number | null {
  return typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 1 ? c : null;
}

/**
 * The threshold actually applied. An override may only raise the bar; a request
 * to lower it (or a value outside [0, 1]) falls back to CONFIDENCE_THRESHOLD.
 */
export function effectiveThreshold(requested: unknown): number {
  return typeof requested === 'number' &&
    Number.isFinite(requested) &&
    requested <= 1 &&
    requested > CONFIDENCE_THRESHOLD
    ? requested
    : CONFIDENCE_THRESHOLD;
}

/** Why a field must go to a person, or null when it clears the threshold. */
export function reviewReason(
  field: { value?: string | null; confidence?: unknown },
  threshold = CONFIDENCE_THRESHOLD,
): string | null {
  if (field.value == null) return 'missing value';
  if (field.confidence == null) return 'no confidence score';
  const c = validConfidence(field.confidence);
  if (c == null) return 'invalid confidence score';
  // Truncate rather than round, so 0.849 reads "0.84 < 0.85", not "0.85 < 0.85".
  if (c < threshold)
    return `confidence ${(Math.floor(c * 100 + 1e-9) / 100).toFixed(2)} < ${threshold}`;
  return null;
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
      threshold: {
        type: 'number',
        description: 'Optional stricter cutoff (0.85 to 1). Lower values are ignored.',
      },
    },
    required: ['fields'],
  },
  run(input) {
    if (!input || !Array.isArray(input.fields)) {
      return fail('validation', 'assess_confidence requires a `fields` array.');
    }
    const threshold = effectiveThreshold(input.threshold);

    const passed: ExtractedField[] = [];
    const needsReview: ReviewItem[] = [];
    for (const f of input.fields) {
      const reason = reviewReason(f, threshold);
      if (reason) {
        needsReview.push({
          reason,
          label: f.label,
          value: f.value ?? null,
          confidence: validConfidence(f.confidence),
        });
      } else {
        passed.push(f);
      }
    }
    return ok({ threshold, passed, needsReview });
  },
};
