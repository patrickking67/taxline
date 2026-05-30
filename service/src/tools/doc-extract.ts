// Tool: extract_fields — pull structured fields from a document.
//
// STUB: a production build wires this to a vision/OCR + extraction model. Here it
// returns a deterministic, structured result so the fleet is runnable end to end.
// The shape is the point:
//   - values are NULLABLE — a real extractor returns null instead of guessing;
//   - every field carries a confidence and a citation (page/source);
//   - the output preserves provenance so downstream review can trace each claim.

import { ok, fail, type Tool, type ExtractedField } from '../types.js';
import { docById } from '../seed/queue.js';

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
}

export const docExtract: Tool<ExtractInput, ExtractOutput> = {
  name: 'extract_fields',
  description:
    'Extract structured fields (label, value, confidence, citation) from a document ' +
    'identified by its intake-queue id. Values may be null when a field cannot be read ' +
    'confidently — never fabricate. Use this to pull data before review or workpaper ' +
    'assembly.',
  inputSchema: {
    type: 'object',
    properties: {
      docId: { type: 'string', description: 'Document id from the intake queue.' },
    },
    required: ['docId'],
  },
  run(input) {
    if (!input || typeof input.docId !== 'string' || input.docId.trim() === '') {
      return fail('validation', 'extract_fields requires a `docId`.');
    }
    const doc = docById(input.docId);
    if (!doc) {
      // Access failure (no such document) — distinct from a doc that simply has no
      // extractable fields. Not retryable: the id must change.
      return fail('business', `No document with id "${input.docId}" in the queue.`);
    }

    // Map the seed doc's fields into the provenance-bearing extraction shape.
    // A real extractor would read the file; the nullable contract is identical.
    const fields: ExtractedField[] = doc.fields.map((f) => ({
      label: f.label,
      value: f.value ?? null,
      confidence: f.confidence,
      citations: [
        {
          file: doc.name,
          heading: `p.1 of ${doc.pages}`,
          snippet: f.value ?? null,
        },
      ],
    }));

    return ok({ docId: doc.id, docType: doc.type, fields, empty: fields.length === 0 });
  },
};
