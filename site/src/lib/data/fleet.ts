// The named agent fleet — one source of truth for the marketing site, the
// console hero, and the agents page. Codenames make the workforce feel real.
export interface FleetAgent {
  key: string;
  codename: string;
  role: string;
  icon: string; // lucide name
  blurb: string;
  tools: string[];
}

export const fleet: FleetAgent[] = [
  { key: 'intake', codename: 'Relay', role: 'Intake', icon: 'lucide:inbox', blurb: 'Triages every inbound document by form and entity, then routes it to the right agent.', tools: ['classify', 'route'] },
  { key: 'extraction', codename: 'Lens', role: 'Extraction', icon: 'lucide:scan-line', blurb: 'Reads each document and pulls every field with a confidence score and a citation to the source page.', tools: ['doc-extract', 'confidence'] },
  { key: 'research', codename: 'Atlas', role: 'Research', icon: 'lucide:search', blurb: 'Answers tax questions by retrieval over a living knowledge base. Sources, never guesses.', tools: ['kb-search'] },
  { key: 'workpaper', codename: 'Ledger', role: 'Workpaper', icon: 'lucide:file-stack', blurb: 'Assembles reviewer-ready workpapers where every number traces back to a source.', tools: ['assemble', 'cite'] },
  { key: 'compliance', codename: 'Sentry', role: 'Compliance', icon: 'lucide:calendar-clock', blurb: 'Tracks deadlines across entities and drafts the client follow-up for you to send.', tools: ['calendar', 'notify'] },
];

export const orchestratorName = 'Conductor';
