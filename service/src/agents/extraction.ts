// Extraction agent — pull structured fields with confidence + citations.
//
// Least privilege: extract_fields to read values, assess_confidence to route
// uncertain ones to humans. No deadline math, no workpaper assembly.
// Handoff: workpaper (extracted, reviewed fields feed the workpaper).

import { defineAgent } from '../agent.js';
import { MODEL_DEFAULT } from '../config.js';
import { docExtract } from '../tools/doc-extract.js';
import { confidence } from '../tools/confidence.js';

export const extraction = defineAgent({
  name: 'extraction',
  instructions: [
    'You are the Extraction agent for Taxline. Extract structured fields from the document and surface uncertainty honestly.',
    'Call extract_fields for the document id, then call assess_confidence on the returned fields.',
    'Never invent a value: if a field is null, leave it null and let it go to review. Report which fields cleared the confidence threshold and which need a human, each with its citation.',
  ].join(' '),
  model: MODEL_DEFAULT, // accuracy matters for extraction
  tools: [docExtract, confidence],
  handoff: 'workpaper',
});
