// Intake queue + document seed.
//
// Mirrors the product app's AppDoc shape (site/src/lib/api/types.ts) so the
// service's /queue and /doc/:id endpoints are drop-in for the static site's
// adapter. In production this comes from a datastore; here it is in-memory seed.
//
// A document with a `text` layer is read by the rules extractor when this module
// loads, so its fields and confidences are what the extractor produces, not typed
// in. The other documents keep seeded values for the queue views only;
// extract_fields has no parser for them and says so.

import { extractFields } from '../extract/rules.js';

export type DocStatus = 'new' | 'review' | 'approved' | 'archived';

export interface SeedField {
  label: string;
  value: string;
  /** 0..1 confidence; null = not yet extracted. */
  confidence: number | null;
}

export interface SeedEvidence {
  icon: string;
  label: string;
  strong?: string;
}

export interface SeedDoc {
  id: string;
  name: string;
  client: string;
  type: string; // W-2, 1099-NEC, K-1, Schedule, Expense
  lastAgent: string; // Intake | Extraction | Research | Workpaper | Compliance
  status: DocStatus;
  confidence: number | null;
  pages: number;
  docTitle?: string;
  /** The scan's text layer, when the document has one the extractor can read. */
  text?: string;
  fields: SeedField[];
  evidence: SeedEvidence[];
}

// Synthetic text layers. The W-2 has two damaged lines on purpose: box 17 has a
// letter where a digit belongs and box 20 ends in an unreadable mark.
const ACME_W2_TEXT = [
  'Form W-2 Wage and Tax Statement 2024',
  'b Employer identification number (EIN)  00-0000001',
  "c Employer's name, address, and ZIP code  Acme Studios LLC",
  '1 Wages, tips, other compensation  128,400.00',
  '2 Federal income tax withheld  24,310.00',
  '3 Social security wages  128,400.00',
  '4 Social security tax withheld  7,960.80',
  '5 Medicare wages and tips  128,400.00',
  '6 Medicare tax withheld  1,861.80',
  '16 State wages, tips, etc.  128,400.00',
  '17 State income tax  6,1B0.00',
  '20 Locality name  PHL-RE~',
].join('\n');

const MEADOW_NEC_TEXT = [
  '1099-NEC Nonemployee Compensation summary 2024',
  'Payer: Meadow LP',
  'Payer TlN: 00-0000002',
  'Box 1 Nonemployee compensation: $42,000.00',
  'Box 4 Federal tax withheld: $0.00',
].join('\n');

/** Read a seeded text layer: the fields the queue shows and their mean confidence. */
function read(text: string, type: string): Pick<SeedDoc, 'text' | 'fields' | 'confidence'> {
  const fields = extractFields(text, type).fields.map((f) => ({
    label: f.label,
    value: f.value ?? '',
    confidence: f.confidence,
  }));
  const scores = fields.map((f) => f.confidence).filter((c): c is number => c != null);
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  return { text, fields, confidence: mean == null ? null : Math.round(mean * 100) / 100 };
}

export const queue: SeedDoc[] = [
  {
    id: 'acme_w2_2024',
    name: 'acme_w2_2024.pdf',
    client: 'Acme Studios LLC',
    type: 'W-2',
    lastAgent: 'Extraction',
    status: 'review',
    pages: 1,
    docTitle: 'Form W-2 · Wage and Tax Statement · 2024',
    ...read(ACME_W2_TEXT, 'W-2'),
    evidence: [
      { icon: 'lucide:file-text', label: 'W-2 scan', strong: 'p.1' },
      { icon: 'lucide:book-open', label: 'IRS Pub 15-T', strong: '' },
    ],
  },
  {
    id: '1099_nec_batch',
    name: '1099-nec_batch.pdf',
    client: 'Meadow LP',
    type: '1099-NEC',
    lastAgent: 'Intake',
    status: 'new',
    pages: 4,
    docTitle: 'Form 1099-NEC · Nonemployee Compensation · 2024',
    ...read(MEADOW_NEC_TEXT, '1099-NEC'),
    evidence: [{ icon: 'lucide:file-text', label: '1099-NEC', strong: 'p.1' }],
  },
  {
    id: 'k1_meadow_lp',
    name: 'k1_meadow_lp.pdf',
    client: 'Meadow LP',
    type: 'K-1',
    lastAgent: 'Intake',
    status: 'new',
    confidence: null,
    pages: 2,
    docTitle: 'Schedule K-1 (Form 1065) · 2024',
    fields: [],
    evidence: [],
  },
  {
    id: 'depr_schedule',
    name: 'depr_schedule.xlsx',
    client: 'Acme Studios LLC',
    type: 'Schedule',
    lastAgent: 'Workpaper',
    status: 'approved',
    confidence: 0.99,
    pages: 1,
    docTitle: 'Depreciation schedule · §168 MACRS · 2024',
    fields: [
      { label: 'Total basis', value: '$310,500.00', confidence: 0.99 },
      { label: 'Current-year depr', value: '$44,360.00', confidence: 0.98 },
      { label: '§179 election', value: '$0.00', confidence: 0.99 },
    ],
    evidence: [{ icon: 'lucide:file-stack', label: 'Workpaper', strong: 'WP-3' }],
  },
  {
    id: 'vendor_invoices_q1',
    name: 'vendor_invoices_q1.pdf',
    client: 'Northgate Co',
    type: 'Expense',
    lastAgent: 'Extraction',
    status: 'review',
    confidence: 0.71,
    pages: 9,
    docTitle: 'Vendor invoices · Q1 · expense batch',
    fields: [
      { label: 'Invoices', value: '23', confidence: 0.96 },
      { label: 'Total', value: '$18,442.10', confidence: 0.71 },
      { label: 'Deductible (est.)', value: '$17,900.00', confidence: 0.58 },
    ],
    evidence: [
      { icon: 'lucide:file-text', label: 'batch', strong: '23 docs' },
      { icon: 'lucide:book-open', label: 'IRC', strong: '§162(a)' },
    ],
  },
];

export const docById = (id: string): SeedDoc | undefined => queue.find((d) => d.id === id);

/** Public queue summary (omits heavy field/evidence detail). */
export function queueSummary() {
  return queue.map((d) => ({
    id: d.id,
    name: d.name,
    client: d.client,
    type: d.type,
    lastAgent: d.lastAgent,
    status: d.status,
    confidence: d.confidence,
    pages: d.pages,
  }));
}
