// Tax year 2026 parameters.
//
// Every inflation-indexed figure is transcribed from Rev. Proc. 2025-32 (IRS,
// 2025-10-09), which reflects the One Big Beautiful Bill Act amendments.
// Statutory constants (FICA rates, NIIT and Additional Medicare thresholds,
// safe-harbor percentages) are fixed in the Code and not indexed.
//
// Add a year by copying this file and changing only the numbers; the engine
// reads nothing else.

import type { Bracket, Citation, FilingStatus } from '../types.js';

const REV_PROC = 'https://www.irs.gov/pub/irs-drop/rp-25-32.pdf';

export const cite = {
  brackets: { label: 'Rev. Proc. 2025-32 §4.01, IRC §1(j)', url: REV_PROC },
  capGains: { label: 'Rev. Proc. 2025-32 §4.03, IRC §1(h)', url: REV_PROC },
  ctc: { label: 'Rev. Proc. 2025-32 §4.05, IRC §24', url: REV_PROC },
  standard: { label: 'Rev. Proc. 2025-32 §4.14, IRC §63(c)', url: REV_PROC },
  sec179: { label: 'Rev. Proc. 2025-32 §4.24, IRC §179(b)', url: REV_PROC },
  qbi: { label: 'Rev. Proc. 2025-32 §4.26, IRC §199A', url: REV_PROC },
  wageBase: { label: 'SSA 2026 contribution and benefit base', url: 'https://www.ssa.gov/oact/cola/cbb.html' },
  se: { label: 'IRC §1401, §1402(a)(12); Schedule SE', url: 'https://www.irs.gov/forms-pubs/about-schedule-se-form-1040' },
  addlMedicare: { label: 'IRC §3101(b)(2), §1401(b)(2); Form 8959', url: 'https://www.irs.gov/forms-pubs/about-form-8959' },
  niit: { label: 'IRC §1411; Form 8960', url: 'https://www.irs.gov/forms-pubs/about-form-8960' },
  estimated: { label: 'IRC §6654(d); Form 1040-ES', url: 'https://www.irs.gov/forms-pubs/about-form-1040-es' },
  macrs: { label: 'IRC §168; Pub 946 Table A-1', url: 'https://www.irs.gov/publications/p946' },
  bonus: { label: 'IRC §168(k) as amended by OBBBA §70301', url: 'https://www.irs.gov/publications/p946' },
  taxTable: { label: '1040 Instructions, Tax Table', url: 'https://www.irs.gov/instructions/i1040gi' },
} satisfies Record<string, Citation>;

const sched = (rows: [number, number][]): Bracket[] => rows.map(([rate, floor]) => ({ rate, floor }));

export interface TaxYear {
  year: number;
  brackets: Record<FilingStatus, Bracket[]>;
  standardDeduction: Record<FilingStatus, number>;
  /** Top of the 0% and 15% preferential-rate bands, by taxable income. */
  capGains: Record<FilingStatus, { zeroMax: number; fifteenMax: number }>;
  ctc: { perChild: number; refundablePerChild: number; earnedFloor: number; refundRate: number; phaseoutStart: Record<FilingStatus, number>; phaseoutPer1000: number };
  qbi: { rate: number; threshold: Record<FilingStatus, number>; phaseInRange: Record<FilingStatus, number>; minimumDeduction: number; minimumQbi: number };
  fica: { ssRate: number; medicareRate: number; wageBase: number; seNetFactor: number };
  addlMedicare: { rate: number; threshold: Record<FilingStatus, number> };
  niit: { rate: number; threshold: Record<FilingStatus, number> };
  estimated: { currentYearPct: number; priorYearPct: number; priorYearHighPct: number; highAgi: Record<FilingStatus, number>; minimumBalanceDue: number; dueDates: string[] };
  sec179: { limit: number; phaseoutStart: number; suvLimit: number };
  /** Bonus percentage for qualified property acquired after 2025-01-19. */
  bonusPct: number;
}

export const TY2026: TaxYear = {
  year: 2026,
  brackets: {
    single: sched([[0.1, 0], [0.12, 12_400], [0.22, 50_400], [0.24, 105_700], [0.32, 201_775], [0.35, 256_225], [0.37, 640_600]]),
    mfj: sched([[0.1, 0], [0.12, 24_800], [0.22, 100_800], [0.24, 211_400], [0.32, 403_550], [0.35, 512_450], [0.37, 768_700]]),
    mfs: sched([[0.1, 0], [0.12, 12_400], [0.22, 50_400], [0.24, 105_700], [0.32, 201_775], [0.35, 256_225], [0.37, 384_350]]),
    hoh: sched([[0.1, 0], [0.12, 17_700], [0.22, 67_450], [0.24, 105_700], [0.32, 201_750], [0.35, 256_200], [0.37, 640_600]]),
  },
  standardDeduction: { single: 16_100, mfj: 32_200, mfs: 16_100, hoh: 24_150 },
  capGains: {
    single: { zeroMax: 49_450, fifteenMax: 545_500 },
    mfj: { zeroMax: 98_900, fifteenMax: 613_700 },
    mfs: { zeroMax: 49_450, fifteenMax: 306_850 },
    hoh: { zeroMax: 66_200, fifteenMax: 579_600 },
  },
  ctc: {
    perChild: 2_200,
    refundablePerChild: 1_700,
    earnedFloor: 2_500,
    refundRate: 0.15,
    // §24(h)(3) — fixed, not indexed.
    phaseoutStart: { single: 200_000, mfj: 400_000, mfs: 200_000, hoh: 200_000 },
    phaseoutPer1000: 50,
  },
  qbi: {
    rate: 0.2,
    threshold: { single: 201_750, mfj: 403_500, mfs: 201_775, hoh: 201_750 },
    phaseInRange: { single: 75_000, mfj: 150_000, mfs: 75_000, hoh: 75_000 },
    minimumDeduction: 400,
    minimumQbi: 1_000,
  },
  fica: { ssRate: 0.124, medicareRate: 0.029, wageBase: 184_500, seNetFactor: 0.9235 },
  addlMedicare: { rate: 0.009, threshold: { single: 200_000, mfj: 250_000, mfs: 125_000, hoh: 200_000 } },
  niit: { rate: 0.038, threshold: { single: 200_000, mfj: 250_000, mfs: 125_000, hoh: 200_000 } },
  estimated: {
    currentYearPct: 0.9,
    priorYearPct: 1.0,
    priorYearHighPct: 1.1,
    highAgi: { single: 150_000, mfj: 150_000, mfs: 75_000, hoh: 150_000 },
    minimumBalanceDue: 1_000,
    dueDates: ['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15'],
  },
  sec179: { limit: 2_560_000, phaseoutStart: 4_090_000, suvLimit: 32_000 },
  bonusPct: 1,
};
