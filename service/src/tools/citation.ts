// Tool: format_citations — normalize provenance into reviewer-ready references.
//
// Keeping citation formatting as its own tool means every agent renders sources
// the same way, and the claim -> source link is preserved verbatim rather than
// being re-summarized (and possibly distorted) by the model.

import { ok, fail, type Tool, type Citation } from '../types.js';

export interface CitationInput {
  citations: Citation[];
}

export interface CitationOutput {
  formatted: string[];
  count: number;
}

export const citation: Tool<CitationInput, CitationOutput> = {
  name: 'format_citations',
  description:
    'Format a list of source references (file + heading) into clean, numbered ' +
    'citation strings for inclusion in an answer or workpaper. Use after gathering ' +
    'sources so provenance is presented consistently.',
  inputSchema: {
    type: 'object',
    properties: {
      citations: {
        type: 'array',
        description: 'Sources to format.',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            heading: { type: ['string', 'null'] },
            snippet: { type: ['string', 'null'] },
          },
          required: ['file'],
        },
      },
    },
    required: ['citations'],
  },
  run(input) {
    if (!input || !Array.isArray(input.citations)) {
      return fail('validation', 'format_citations requires a `citations` array.');
    }
    const formatted = input.citations.map((c, i) => {
      const where = c.heading ? `${c.file} › ${c.heading}` : c.file;
      return `[${i + 1}] ${where}`;
    });
    return ok({ formatted, count: formatted.length });
  },
};
