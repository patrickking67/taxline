// The free calculators — one source of truth for the hub, nav, footer, and
// cross-links. Each is a thin GUI over @taxline/tax-engine, the same code the
// Workpaper agent calls through compute_tax.
export interface ToolMeta {
  slug: string;
  name: string;
  short: string;
  icon: string;
  blurb: string;
  computes: string[];
}

export const tools: ToolMeta[] = [
  {
    slug: 'income-tax',
    name: 'Federal income tax calculator',
    short: 'Income tax',
    icon: 'lucide:landmark',
    blurb: 'A full Form 1040 estimate: brackets, capital gains, QBI, child tax credit, SE tax, and NIIT, traced line by line.',
    computes: ['1040 L1–L37', 'marginal vs effective', 'bracket fill'],
  },
  {
    slug: 'self-employment-tax',
    name: 'Self-employment tax calculator',
    short: 'Self-employment tax',
    icon: 'lucide:briefcase',
    blurb: 'Schedule SE with the 92.35% adjustment, the $184,500 wage base, W-2 coordination, and Additional Medicare.',
    computes: ['Sch SE L4–L13', 'wage-base cap', 'Form 8959'],
  },
  {
    slug: 'estimated-tax',
    name: 'Estimated tax calculator',
    short: 'Estimated tax',
    icon: 'lucide:calendar-clock',
    blurb: 'The §6654 safe harbor — 90% of this year or 100%/110% of last — and the four 1040-ES installments.',
    computes: ['safe harbor', '4 installments', 'due dates'],
  },
  {
    slug: 's-corp',
    name: 'S corporation election calculator',
    short: 'S-corp election',
    icon: 'lucide:scale',
    blurb: 'Sole proprietor vs. S corp on the same profit: SE tax vs. payroll FICA, QBI, overhead, and a salary sweep.',
    computes: ['SE vs FICA', 'K-1 + QBI', 'salary sweep'],
  },
  {
    slug: 'depreciation',
    name: 'Depreciation calculator',
    short: 'Depreciation',
    icon: 'lucide:layers',
    blurb: '§179, bonus, and MACRS schedules for one asset, with the present value of the tax shield.',
    computes: ['Form 4562', 'Pub 946 Table A-1', 'tax-shield PV'],
  },
  {
    slug: 'roi',
    name: 'Tax practice ROI calculator',
    short: 'Firm ROI',
    icon: 'lucide:trending-up',
    blurb: 'Hours returned, payback month, NPV, and IRR for running your season through the fleet.',
    computes: ['NPV', 'IRR', 'payback'],
  },
];
