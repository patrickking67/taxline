// Tool: kb_search — retrieval over the living knowledge base.
//
// This is the Research agent's only mechanism for grounding an answer. Its
// description is written so the model reaches for it whenever a claim must be
// backed by a source, never to answer from memory.

import { retrieve } from '../kb/retrieve.js';
import { ok, fail, type Tool, type Citation } from '../types.js';

export interface KbSearchInput {
  query: string;
  k?: number;
}

export interface KbSearchOutput {
  results: { text: string; source: Citation }[];
  /** Distinguishes "searched, found nothing" from a load failure. */
  empty: boolean;
}

export const kbSearch: Tool<KbSearchInput, KbSearchOutput> = {
  name: 'kb_search',
  description:
    'Search the Taxline knowledge base (tax rules, forms, and engineering practices) ' +
    'and return the most relevant passages with their source file and heading. Use this ' +
    'to ground every factual claim in a citation. If it returns no results, say so — ' +
    'do NOT answer from prior knowledge.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language search query.' },
      k: { type: 'integer', description: 'How many passages to return (default 4).' },
    },
    required: ['query'],
  },
  async run(input) {
    if (!input || typeof input.query !== 'string' || input.query.trim() === '') {
      return fail('validation', 'kb_search requires a non-empty `query`.');
    }
    try {
      const k = typeof input.k === 'number' && input.k > 0 ? Math.min(input.k, 10) : 4;
      const hits = await retrieve(input.query, k);
      const results = hits.map((h) => ({
        text: h.text,
        source: { file: h.source.file, heading: h.source.heading, score: h.score, snippet: h.text.slice(0, 280) },
      }));
      // Valid empty result is a success with empty:true, NOT an error.
      return ok({ results, empty: results.length === 0 });
    } catch (err) {
      // A genuine read/parse failure of the KB is transient (disk/IO) — retryable.
      return fail('transient', 'Knowledge base could not be read.', err);
    }
  },
};
