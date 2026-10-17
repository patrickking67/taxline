import type {
  AppDoc,
  FleetService,
  FleetHealth,
  RunInput,
  RunResult,
  FleetCitation,
  FleetField,
  FleetReviewItem,
  FleetStep,
  MemoryHit,
} from './types';
import { docs, docById } from '../data/app';
import { fleet as roster, orchestratorName } from '../data/fleet';
import { extractScenario, type ScenarioExtraction } from '@taxline/tax-engine';

// Mock fleet — implements the full FleetService contract entirely in the browser.
// It mirrors the real orchestrator's observable behavior (keyword routing, a
// handoff trace, confidence→review routing, and the PROGRAMMATIC human-approval
// gate) so the product app is fully navigable and demoable on static hosting with
// no backend. It is a faithful simulation, never a silent stand-in: health() reports
// liveAgents:false so the UI can say "offline mock".

const THRESHOLD = 0.85;

/** A tiny citable corpus mirroring knowledge-base/ — powers research + memory search. */
const MOCK_KB: { file: string; heading: string; text: string; terms: string[] }[] = [
  {
    file: 'tax/deductions-and-credits.md',
    heading: 'Ordinary and necessary',
    text: 'A business expense is deductible when it is ordinary and necessary under IRC §162(a) — ordinary in the trade, and helpful/appropriate for it. Capital outlays are recovered through depreciation, not expensed at once.',
    terms: [
      'deduct',
      'deduction',
      'expense',
      'business',
      '162',
      'ordinary',
      'necessary',
      'deductible',
    ],
  },
  {
    file: 'tax/depreciation.md',
    heading: 'MACRS and §179',
    text: 'Tangible business property is recovered over a class life under MACRS (§168). §179 lets a taxpayer elect to expense qualifying property up to an annual limit; bonus depreciation may also apply. Verify current-year limits against the IRS source.',
    terms: [
      'depreciation',
      'depreciate',
      'macrs',
      '168',
      '179',
      'bonus',
      'basis',
      'asset',
      'schedule',
    ],
  },
  {
    file: 'tax/filing-deadlines.md',
    heading: 'The base rule',
    text: 'Most federal returns are due on the 15th day of the Nth month after year-end (N=3 for 1065/1120-S, N=4 for 1040/1120, N=5 for 990). A due date on a weekend or holiday shifts to the next business day. Verify exact dates against IRS Pub 509.',
    terms: [
      'deadline',
      'due',
      'date',
      'file',
      'filing',
      'extension',
      'when',
      'calendar',
      '4868',
      '7004',
    ],
  },
  {
    file: 'tax/entities-and-returns.md',
    heading: 'Entities and their returns',
    text: 'Sole proprietor → Schedule C with the 1040. Partnership → Form 1065 (partners get K-1). S-corp → Form 1120-S (shareholders get K-1). C-corp → Form 1120. Confirm entity elections before assuming a form.',
    terms: [
      'entity',
      'partnership',
      '1065',
      '1120',
      's-corp',
      'c-corp',
      'k-1',
      'k1',
      'llc',
      'return',
      'sole',
    ],
  },
  {
    file: 'tax/forms-by-document.md',
    heading: 'Forms by document type',
    text: 'W-2 feeds the wage line of the 1040; 1099-NEC feeds self-employment income (Schedule C); 1099-INT/DIV feed Schedule B; 1099-B feeds Form 8949/Schedule D. A consolidated 1099 should be split into its component forms before extraction.',
    terms: [
      'w-2',
      'w2',
      '1099',
      'nec',
      'int',
      'div',
      'form',
      'document',
      'wage',
      'broker',
      'schedule',
    ],
  },
  {
    file: 'tax/estimated-tax.md',
    heading: 'Estimated tax and safe harbor',
    text: 'Taxpayers expecting to owe pay quarterly estimates. A safe harbor (paying a set percentage of the prior-year or current-year liability) generally avoids the underpayment penalty. Verify the current safe-harbor percentages against the IRS source.',
    terms: [
      'estimated',
      'estimate',
      '1040-es',
      'quarterly',
      'safe',
      'harbor',
      'penalty',
      'underpayment',
      'withholding',
    ],
  },
];

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'is',
  'are',
  'what',
  'how',
  'do',
  'does',
  'my',
  'i',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9§-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Score the mock corpus against a query by term overlap; return the top-k. */
function searchKb(query: string, k: number): MemoryHit[] {
  const q = tokenize(query);
  if (q.length === 0) return [];
  const scored = MOCK_KB.map((c) => {
    let score = 0;
    for (const t of q) {
      if (c.terms.includes(t)) score += 1;
      if (c.heading.toLowerCase().includes(t)) score += 0.5;
    }
    return {
      hit: { text: c.text, file: c.file, heading: c.heading, score: Number(score.toFixed(2)) },
      score,
    };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.hit);
}

const CODE: Record<string, string> = {
  intake: 'Relay',
  extraction: 'Lens',
  research: 'Atlas',
  workpaper: 'Ledger',
  compliance: 'Sentry',
};

/** The withheld-draft wrapper — mirrors service requireHumanApproval(). */
function gate(result: RunResult, approved: boolean): RunResult {
  if (approved) return { ...result, approved: true };
  return {
    ...result,
    approved: false,
    output:
      'HUMAN APPROVAL REQUIRED — output withheld.\n\n' +
      'Nothing ships from the Taxline fleet until a human approves. The draft below is ready for review.\n\n' +
      '----- DRAFT (not yet shipped) -----\n' +
      result.output,
    needsHumanReview: [
      { reason: 'human approval required before shipping' },
      ...result.needsHumanReview,
    ],
  };
}

/** Build the draft for an extraction/workpaper run over a known document. */
function runOnDoc(doc: AppDoc, task: string): RunResult {
  const review: FleetReviewItem[] = [];
  const fields: FleetField[] = doc.fields.map((f) => {
    const citations: FleetCitation[] = [
      { file: doc.name, heading: `p.1 of ${doc.pages}`, snippet: f.value },
    ];
    if (f.value == null) {
      review.push({
        reason: 'missing value',
        label: f.label,
        value: null,
        confidence: f.confidence,
      });
    } else if (f.confidence == null) {
      review.push({
        reason: 'no confidence score',
        label: f.label,
        value: f.value,
        confidence: null,
      });
    } else if (f.confidence < THRESHOLD) {
      review.push({
        reason: `confidence ${f.confidence.toFixed(2)} < ${THRESHOLD}`,
        label: f.label,
        value: f.value,
        confidence: f.confidence,
      });
    }
    return { label: f.label, value: f.value, confidence: f.confidence, citations };
  });

  const citations: FleetCitation[] = doc.evidence.map((e) => ({
    file: e.label + (e.strong ? ` ${e.strong}` : ''),
    snippet: null,
  }));
  // Attach a supporting KB citation for the document type.
  citations.push(
    ...searchKb(`${doc.type} ${doc.docTitle ?? ''}`, 1).map((h) => ({
      file: h.file,
      heading: h.heading,
      snippet: h.text,
    })),
  );

  const passed = fields.length - review.length;
  const trace: FleetStep[] = [
    {
      agent: 'intake',
      toolCalls: [{ name: 'classify_document', ok: true }],
      handoffTo: 'extraction',
    },
    {
      agent: 'extraction',
      toolCalls: [
        { name: 'extract_fields', ok: true },
        { name: 'assess_confidence', ok: true },
      ],
      handoffTo: 'workpaper',
    },
    {
      agent: 'workpaper',
      toolCalls: [
        { name: 'kb_search', ok: true },
        { name: 'format_citations', ok: true },
      ],
      handoffTo: null,
    },
  ];

  const output =
    `## Extraction · ${doc.name}\n` +
    `Classified as **${doc.type}** (${doc.docTitle ?? 'document'}). Pulled ${fields.length} field(s); ` +
    `${passed} cleared the ${THRESHOLD} confidence bar, ${review.length} routed to review.\n\n` +
    `## Workpaper (draft)\n` +
    `Lead schedule assembled from the cleared fields; each line traces to its source page. ` +
    `Task: “${task}”.`;

  return gate(
    { output, citations, fields, needsHumanReview: review, trace, approved: false },
    false,
  );
}

/** Build the draft for a citation-backed research run. */
function runResearch(task: string): RunResult {
  const hits = searchKb(task, 3);
  const citations: FleetCitation[] = hits.map((h) => ({
    file: h.file,
    heading: h.heading,
    snippet: h.text,
    score: h.score,
  }));
  const trace: FleetStep[] = [
    {
      agent: 'research',
      toolCalls: [
        { name: 'kb_search', ok: true },
        { name: 'format_citations', ok: true },
      ],
      handoffTo: null,
    },
  ];
  const body = hits.length
    ? hits.map((h, i) => `[${i + 1}] ${h.heading} — ${h.text}`).join('\n\n')
    : 'No matching passage in the knowledge base. The Research agent does not answer from prior knowledge — it would flag this for a human rather than guess.';
  const review: FleetReviewItem[] = hits.length
    ? []
    : [{ reason: 'no supporting source found — do not answer from memory' }];
  const output = `## Research · ${CODE.research}\n${body}\n\nEvery claim above carries its source. No source, no answer.`;
  return gate(
    { output, citations, fields: undefined, needsHumanReview: review, trace, approved: false },
    false,
  );
}

export const mockFleet: FleetService = {
  name: 'mock',

  health(): Promise<FleetHealth> {
    return Promise.resolve({
      ok: true,
      liveAgents: false,
      provider: 'local',
      records: MOCK_KB.length,
      agents: roster.map((a) => a.key),
      models: { default: 'claude-opus-4-8', fast: 'claude-haiku-4-5' },
      note: `Offline mock — ${orchestratorName} routes between ${roster.length} agents. A human approves before output ships.`,
    });
  },

  queue(): Promise<AppDoc[]> {
    return Promise.resolve(docs);
  },

  doc(id: string): Promise<AppDoc | null> {
    return Promise.resolve(docById(id) ?? null);
  },

  run(input: RunInput): Promise<RunResult> {
    const doc = input.docId ? docById(input.docId) : undefined;
    // Doc present → extraction/workpaper draft; otherwise a citation-backed research draft.
    const base = doc ? runOnDoc(doc, input.task) : runResearch(input.task);
    // base is withheld by default; re-gate with the caller's approval.
    return Promise.resolve(
      gate(
        {
          ...base,
          output: stripWithholding(base.output),
          needsHumanReview: base.needsHumanReview.filter(
            (r) => r.reason !== 'human approval required before shipping',
          ),
        },
        input.approved === true,
      ),
    );
  },

  memorySearch(query: string, k = 5): Promise<MemoryHit[]> {
    return Promise.resolve(searchKb(query, k));
  },

  // Same validator as the service; the rule-based extractor stands in for the model.
  scenario(text: string): Promise<ScenarioExtraction> {
    return Promise.resolve(extractScenario(text.slice(0, 4_000)));
  },
};

/** Remove the withheld-draft preamble so we can re-gate cleanly on approval. */
function stripWithholding(output: string): string {
  const marker = '----- DRAFT (not yet shipped) -----\n';
  const i = output.indexOf(marker);
  return i >= 0 ? output.slice(i + marker.length) : output;
}
