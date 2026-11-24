// compareReturns only differences two computeReturn results, so these tests
// check the bookkeeping (deltas, changed lines) and add no tax figures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareReturns, computeReturn, type ReturnInput } from '../src/index.js';

const single: ReturnInput = { status: 'single', wages: 100_000 };

test('identical returns show no change', () => {
  const c = compareReturns(single, { ...single });
  assert.ok(c.metrics.every((m) => m.delta === 0));
  assert.equal(c.changedLines.length, 0);
  assert.equal(c.effectiveRateDelta, 0);
});

test('extra wages raise income and AGI by exactly that amount', () => {
  const c = compareReturns(single, { ...single, wages: 112_500 });
  const get = (k: string) => c.metrics.find((m) => m.metric === k)!;
  assert.equal(get('totalIncome').delta, 12_500);
  assert.equal(get('agi').delta, 12_500);
  assert.ok(get('totalTax').delta > 0);
  assert.ok(c.changedLines.length > 0);
});

test('metric deltas equal alt minus base of the two computed returns', () => {
  const alt: ReturnInput = { status: 'mfj', wages: 140_000 };
  const c = compareReturns(single, alt);
  const a = computeReturn(single, undefined, false);
  const b = computeReturn(alt, undefined, false);
  const tax = c.metrics.find((m) => m.metric === 'totalTax')!;
  assert.equal(tax.base, a.totalTax);
  assert.equal(tax.alt, b.totalTax);
  assert.equal(tax.delta, Math.round((b.totalTax - a.totalTax) * 100) / 100);
});

test('changed lines carry the delta and no unchanged line is listed', () => {
  const c = compareReturns(single, { ...single, wages: 90_000 });
  for (const l of c.changedLines) {
    assert.notEqual(l.delta, 0);
    assert.equal(Math.round(((l.alt ?? 0) - (l.base ?? 0)) * 100) / 100, l.delta);
  }
  assert.equal(new Set(c.changedLines.map((l) => l.id)).size, c.changedLines.length);
});
