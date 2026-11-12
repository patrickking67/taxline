// Run the rules extractor over a corpus and print the result as JSON.
//
//   tsx service/eval/extract-corpus.ts corpus.json
//
// The corpus is a JSON list of { docId, text }. The output is a list of
// { docId, docType, fields: [{ label, value, confidence }] }, the shape
// python/taxline_quant/evals/recorded.py reads. The extractor is not told the
// document type. Nothing here imports the service's dependencies or calls a model.

import { readFileSync } from 'node:fs';
import { extractFields } from '../src/extract/rules.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: extract-corpus.ts <corpus.json>');
  process.exit(2);
}
const corpus = JSON.parse(readFileSync(path, 'utf8')) as { docId: string; text: string }[];
const out = corpus.map((doc) => {
  const result = extractFields(doc.text);
  return {
    docId: doc.docId,
    docType: result.docType ?? 'unknown',
    noise: result.noise,
    fields: result.fields.map((f) => ({
      label: f.label,
      value: f.value,
      confidence: f.confidence,
    })),
  };
});
process.stdout.write(JSON.stringify(out));
