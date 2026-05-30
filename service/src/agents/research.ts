// Research agent — citation-backed answers via KB retrieval.
//
// Least privilege: kb_search to retrieve, format_citations to present sources.
// This is the canonical defineAgent example from the product docs.
// Handoff: workpaper (research findings can feed a workpaper section).

import { defineAgent } from '../agent.js';
import { MODEL_DEFAULT } from '../config.js';
import { kbSearch } from '../tools/kb-search.js';
import { citation } from '../tools/citation.js';

export const research = defineAgent({
  name: 'research',
  instructions: 'Answer with citations from the knowledge base. Never guess.',
  model: MODEL_DEFAULT,
  tools: [kbSearch, citation],
  handoff: 'workpaper',
});
