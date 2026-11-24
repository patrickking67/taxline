// Every line of the Form 1040 workpaper names its authority and links the IRS
// page behind it. No figures are asserted here; those are tested elsewhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReturn } from '../src/index.js';

test('every Form 1040 trace line cites an IRS source with a link', () => {
  const r = computeReturn({
    status: 'single',
    children: 1,
    wages: 90_000,
    selfEmploymentProfit: 40_000,
    interest: 500,
    ordinaryDividends: 2_000,
    qualifiedDividends: 1_500,
    longTermGain: 5_000,
    federalWithholding: 9_000,
    estimatedPayments: 1_000,
  });
  for (const line of r.lines) {
    assert.ok(line.authority, `${line.id} has no authority`);
    assert.match(
      line.authority.url ?? '',
      /^https:\/\/(www\.irs\.gov|www\.federalregister\.gov)\//,
      line.id,
    );
  }
});
