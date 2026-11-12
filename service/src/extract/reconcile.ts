// Reconcile the rules extractor with a second reader (the model).
//
// The rules result is the baseline. A second reader can only make a field more
// likely to reach a person, never less: agreement leaves the rules confidence
// alone, and any disagreement caps it under the review threshold and adds a review
// item that shows both readings. A label the form does not have is never added as
// a field.

import type { FieldKind } from './forms.js';
import { PARSERS, type RuleField } from './rules.js';

export interface SecondReading {
  label: string;
  value: string | null;
  confidence: number | null;
}

export interface ReconciledField extends RuleField {
  /** How the second reader compared: agreed, disagreed, or absent on one side. */
  crossCheck: 'agreed' | 'disagreed' | 'rules-only' | 'model-only' | 'both-empty';
}

export interface Disagreement {
  reason: string;
  label: string;
  value: string | null;
  confidence: number | null;
}

/** Ceilings applied when the readers do not agree. All sit under the 0.85 review threshold. */
export const CROSS_CHECK = {
  /** Both read a value and the values differ. */
  disagreed: 0.5,
  /** Only the rules extractor read a value. */
  rulesOnly: 0.8,
  /** Only the model read a value; no rule could confirm it. */
  modelOnly: 0.6,
} as const;

function canonical(kind: FieldKind, value: string): string {
  return PARSERS[kind](value).value ?? value.trim().replace(/\s+/g, ' ');
}

export function sameValue(kind: FieldKind, a: string, b: string): boolean {
  return canonical(kind, a).toLowerCase() === canonical(kind, b).toLowerCase();
}

export function reconcile(
  rules: RuleField[],
  model: SecondReading[],
): { fields: ReconciledField[]; review: Disagreement[] } {
  const second = new Map(model.map((m) => [m.label, m]));
  const known = new Set(rules.map((f) => f.label));
  const review: Disagreement[] = [];

  const fields = rules.map((field): ReconciledField => {
    const other = second.get(field.label);
    const theirs = other?.value ?? null;
    if (field.value != null && theirs != null) {
      if (sameValue(field.kind, field.value, theirs)) {
        return {
          ...field,
          crossCheck: 'agreed',
          signals: [...field.signals, 'model read the same value'],
        };
      }
      const confidence = Math.min(field.confidence ?? CROSS_CHECK.disagreed, CROSS_CHECK.disagreed);
      const reason = `model and rules disagree: rules read "${field.value}", model read "${theirs}"`;
      review.push({ reason, label: field.label, value: field.value, confidence });
      return { ...field, confidence, crossCheck: 'disagreed', signals: [...field.signals, reason] };
    }
    if (field.value != null) {
      const confidence = Math.min(field.confidence ?? CROSS_CHECK.rulesOnly, CROSS_CHECK.rulesOnly);
      const reason = 'model did not read a value the rules extractor read';
      review.push({ reason, label: field.label, value: field.value, confidence });
      return {
        ...field,
        confidence,
        crossCheck: 'rules-only',
        signals: [...field.signals, reason],
      };
    }
    if (theirs != null) {
      const stated =
        typeof other?.confidence === 'number' ? other.confidence : CROSS_CHECK.modelOnly;
      const confidence = Math.min(stated, CROSS_CHECK.modelOnly);
      const reason = 'read by the model only; no rule confirms it';
      review.push({ reason, label: field.label, value: theirs, confidence });
      return {
        ...field,
        value: theirs,
        confidence,
        crossCheck: 'model-only',
        signals: [...field.signals, reason],
      };
    }
    return { ...field, crossCheck: 'both-empty' };
  });

  for (const m of model) {
    if (!known.has(m.label) && m.value != null) {
      review.push({
        reason: 'model reported a field this form does not have; not added',
        label: m.label,
        value: m.value,
        confidence: null,
      });
    }
  }
  return { fields, review };
}
