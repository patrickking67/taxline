// Intake agent — classify an incoming document and route it.
//
// Least privilege: it can classify, and it can read the KB to disambiguate a
// form it isn't sure about. It cannot extract fields or touch deadlines.
// Handoff: extraction (the usual next step once a doc is typed).

import { defineAgent } from '../agent.js';
import { MODEL_FAST } from '../config.js';
import { classify } from '../tools/classify.js';
import { kbSearch } from '../tools/kb-search.js';

export const intake = defineAgent({
  name: 'intake',
  instructions: [
    'You are the Intake agent for Taxline. Classify the incoming tax document and decide which agent handles it next.',
    'Always call classify_document first. If the type is Unknown or low-confidence, use kb_search against forms-by-document to disambiguate before deciding.',
    'Report the document type, the recommended route, and a confidence score. If you cannot confidently classify, say so and recommend human review — never guess a type.',
  ].join(' '),
  model: MODEL_FAST, // classification is a fast/cheap task
  tools: [classify, kbSearch],
  handoff: 'extraction',
});
