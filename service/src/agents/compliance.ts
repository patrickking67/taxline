// Compliance agent — deadlines and follow-up.
//
// Least privilege: compute_deadline for filing dates, kb_search to cite the
// governing rule. It is the end of the typical chain (handoff: null) — its output
// still requires human approval before anything is sent to a client.

import { defineAgent } from '../agent.js';
import { MODEL_DEFAULT } from '../config.js';
import { calendar } from '../tools/calendar.js';
import { kbSearch } from '../tools/kb-search.js';

export const compliance = defineAgent({
  name: 'compliance',
  instructions: [
    'You are the Compliance agent for Taxline. Determine filing deadlines and follow-up actions for the matter.',
    'Use compute_deadline for each relevant form, and kb_search to cite the rule behind each date. Always pass through the tool\'s "verify against the IRS source" note — do not present a date as final without it.',
    'Output the deadlines, what they depend on, and recommended follow-ups. Flag anything you cannot determine for human review.',
  ].join(' '),
  model: MODEL_DEFAULT,
  tools: [calendar, kbSearch],
  handoff: null, // end of the chain
});
