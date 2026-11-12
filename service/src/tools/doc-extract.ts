// Tool: extract_fields: read structured fields from a document.
//
// The reader is the rules extractor in ../extract: deterministic, offline, and the
// same code the evaluation harness scores. Every field carries a confidence built
// from what was observed (caption match, format, document damage, cross-field
// arithmetic) and a citation to the line it was read from. Values are nullable: a
// value that cannot be read without guessing is null and goes to a person.
//
// When a model reader is configured (an API key is set, or a test injects one) it
// reads the same text and ../extract/reconcile.ts compares the two. The model can
// only lower a confidence or add a review item. It cannot raise a score, and a
// field it alone reports stays under the review threshold.

import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY, hasApiKey } from '../config.js';
import { formByType } from '../extract/forms.js';
import { createModelExtractor, type ModelExtractor } from '../extract/model.js';
import { reconcile } from '../extract/reconcile.js';
import { extractFields, type RuleField } from '../extract/rules.js';
import { docById } from '../seed/queue.js';
import { ok, fail, type Tool, type ExtractedField, type ReviewItem } from '../types.js';

export interface ExtractInput {
  /** Document id from the intake queue. */
  docId: string;
}

export interface ExtractOutput {
  docId: string;
  docType: string;
  fields: ExtractedField[];
  /** True when no fields could be read (valid empty result, not an error). */
  empty: boolean;
  /** Which readers produced the fields. */
  extractor: 'rules' | 'rules+model';
  /** Outcome of the model cross-check, when one was configured. */
  crossCheck: 'not-configured' | 'agreed' | 'disagreed' | 'unavailable';
  /** Disagreements between the readers; the orchestrator adds these to the review list. */
  needsReview: ReviewItem[];
}

export interface DocExtractOptions {
  /** A second reader to cross-check the rules result. Omit for rules only. */
  modelExtract?: ModelExtractor;
}

function toExtracted(field: RuleField, file: string): ExtractedField {
  return {
    label: field.label,
    value: field.value,
    confidence: field.confidence,
    citations:
      field.line == null
        ? []
        : [{ file, heading: `line ${field.line}`, snippet: field.source ?? undefined }],
    signals: field.signals,
  };
}

export function createDocExtract(
  options: DocExtractOptions = {},
): Tool<ExtractInput, ExtractOutput> {
  return {
    name: 'extract_fields',
    description:
      'Extract structured fields (label, value, confidence, citation) from a document ' +
      'identified by its intake-queue id. Values may be null when a field cannot be read ' +
      'confidently; never fabricate. Use this to pull data before review or workpaper ' +
      'assembly.',
    inputSchema: {
      type: 'object',
      properties: {
        docId: { type: 'string', description: 'Document id from the intake queue.' },
      },
      required: ['docId'],
    },
    async run(input) {
      if (!input || typeof input.docId !== 'string' || input.docId.trim() === '') {
        return fail('validation', 'extract_fields requires a `docId`.');
      }
      const doc = docById(input.docId);
      if (!doc) {
        // Access failure (no such document), distinct from a doc that simply has no
        // extractable fields. Not retryable: the id must change.
        return fail('business', `No document with id "${input.docId}" in the queue.`);
      }
      const form = formByType(doc.type);
      if (!form || doc.text === undefined) {
        // No parser, or no text layer to read. Reported, not papered over with seed values.
        return fail(
          'business',
          `No extractor for document "${doc.id}" (type ${doc.type}); a person has to read it.`,
        );
      }

      const rules = extractFields(doc.text, doc.type);
      const base = { docId: doc.id, docType: doc.type };
      if (!options.modelExtract) {
        const fields = rules.fields.map((f) => toExtracted(f, doc.name));
        return ok({
          ...base,
          fields,
          empty: fields.every((f) => f.value == null),
          extractor: 'rules',
          crossCheck: 'not-configured',
          needsReview: [],
        });
      }

      const labels = rules.fields.map((f) => f.label);
      const reading = await options.modelExtract({ docType: doc.type, text: doc.text, labels });
      if (!reading.ok) {
        const fields = rules.fields.map((f) => toExtracted(f, doc.name));
        return ok({
          ...base,
          fields,
          empty: fields.every((f) => f.value == null),
          extractor: 'rules',
          crossCheck: 'unavailable',
          needsReview: [{ reason: `model cross-check did not run: ${reading.reason}` }],
        });
      }
      const merged = reconcile(rules.fields, reading.fields);
      const fields = merged.fields.map((f) => toExtracted(f, doc.name));
      return ok({
        ...base,
        fields,
        empty: fields.every((f) => f.value == null),
        extractor: 'rules+model',
        crossCheck: merged.review.length === 0 ? 'agreed' : 'disagreed',
        needsReview: merged.review,
      });
    },
  };
}

let shared: Anthropic | null = null;
/** The live model reader. The client is created on first use, never at import. */
const liveModelExtract: ModelExtractor = (request) => {
  shared ??= new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return createModelExtractor(shared)(request);
};

/** Rules only without a key; rules cross-checked by the model with one. */
export const docExtract = createDocExtract(hasApiKey ? { modelExtract: liveModelExtract } : {});
