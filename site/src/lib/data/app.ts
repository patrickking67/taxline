import type { AppDoc } from '../api/types';

// Seed data for the product app shell + console. Mirrors the design screenshots.
// In production the app reads this shape from the agent backend via the adapter;
// here it is static so the GUI is fully navigable on GitHub Pages with no server.
export const docs: AppDoc[] = [
  {
    id: 'acme_w2_2024',
    name: 'acme_w2_2024.pdf',
    client: 'Acme Studios LLC',
    type: 'W-2',
    lastAgent: 'Extraction',
    status: 'review',
    confidence: 0.83,
    pages: 1,
    docTitle: 'Form W-2 · Wage and Tax Statement · 2024',
    fields: [
      { label: 'Employer', value: 'Acme Studios LLC', confidence: 0.99 },
      { label: 'EIN', value: '84-1739204', confidence: 0.97 },
      { label: 'Wages · box 1', value: '$128,400.00', confidence: 0.97 },
      { label: 'Federal w/h · box 2', value: '$24,310.00', confidence: 0.91 },
      { label: 'State w/h · box 17', value: '$6,180.00', confidence: 0.74 },
      { label: 'Local code · box 20', value: 'PHL-RES', confidence: 0.41 },
    ],
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
    confidence: 0.78,
    pages: 4,
    docTitle: 'Form 1099-NEC · Nonemployee Compensation · 2024',
    fields: [
      { label: 'Payer', value: 'Meadow LP', confidence: 0.95 },
      { label: 'Payer TIN', value: '47-2210043', confidence: 0.88 },
      { label: 'Nonemployee comp · box 1', value: '$42,000.00', confidence: 0.78 },
      { label: 'Federal w/h · box 4', value: '$0.00', confidence: 0.62 },
    ],
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

export const docById = (id: string) => docs.find((d) => d.id === id);

export const sidebarNav = [
  { icon: 'lucide:layout-list', label: 'Intake queue', href: 'app', badge: String(docs.length) },
  { icon: 'lucide:activity', label: 'Agent activity', href: 'app/activity' },
  { icon: 'lucide:search', label: 'Research', href: 'app/research' },
  { icon: 'lucide:file-stack', label: 'Workpapers', href: 'app/workpapers' },
  { icon: 'lucide:calendar-clock', label: 'Compliance', href: 'app/compliance', badge: '3' },
  { icon: 'lucide:users', label: 'Clients', href: 'app/clients' },
];
