// The confidence gate. These are the rules that decide what a person must look at,
// so they are tested directly rather than through a model.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  confidence,
  effectiveThreshold,
  reviewReason,
  validConfidence,
} from '../src/tools/confidence.js';
import { CONFIDENCE_THRESHOLD, type ToolResult } from '../src/types.js';
import type { ConfidenceOutput } from '../src/tools/confidence.js';

const data = (r: ToolResult<ConfidenceOutput> | Promise<ToolResult<ConfidenceOutput>>) => {
  assert.ok(!(r instanceof Promise));
  assert.equal(r.ok, true);
  return (r as { data: ConfidenceOutput }).data;
};

test('a valid score is a finite number from 0 to 1', () => {
  assert.equal(validConfidence(0), 0);
  assert.equal(validConfidence(0.9), 0.9);
  assert.equal(validConfidence(1), 1);
  for (const bad of [Number.NaN, Infinity, -0.1, 1.5, '0.9', null, undefined]) {
    assert.equal(validConfidence(bad), null, String(bad));
  }
});

test('the threshold can be raised but never lowered', () => {
  assert.equal(effectiveThreshold(undefined), CONFIDENCE_THRESHOLD);
  assert.equal(effectiveThreshold(0), CONFIDENCE_THRESHOLD);
  assert.equal(effectiveThreshold(0.5), CONFIDENCE_THRESHOLD);
  assert.equal(effectiveThreshold(0.95), 0.95);
  assert.equal(effectiveThreshold(1), 1);
  assert.equal(effectiveThreshold(1.2), CONFIDENCE_THRESHOLD);
  assert.equal(effectiveThreshold(Number.NaN), CONFIDENCE_THRESHOLD);
});

test('0.85 clears the gate and anything below it does not', () => {
  assert.equal(reviewReason({ value: '$1.00', confidence: 0.85 }), null);
  assert.equal(reviewReason({ value: '$1.00', confidence: 0.849 }), 'confidence 0.84 < 0.85');
  assert.equal(reviewReason({ value: '$1.00', confidence: 0.29 }), 'confidence 0.29 < 0.85');
  assert.equal(reviewReason({ value: null, confidence: 0.99 }), 'missing value');
  assert.equal(reviewReason({ value: '$1.00', confidence: null }), 'no confidence score');
  assert.equal(reviewReason({ value: '$1.00', confidence: 1.4 }), 'invalid confidence score');
});

test('assess_confidence ignores a request to lower the threshold', () => {
  const out = data(
    confidence.run({
      threshold: 0,
      fields: [
        { label: 'Wages', value: '$100.00', confidence: 0.6, citations: [] },
        { label: 'EIN', value: '00-0000001', confidence: 0.97, citations: [] },
      ],
    }),
  );
  assert.equal(out.threshold, CONFIDENCE_THRESHOLD);
  assert.deepEqual(
    out.passed.map((f) => f.label),
    ['EIN'],
  );
  assert.deepEqual(
    out.needsReview.map((r) => r.label),
    ['Wages'],
  );
});

test('assess_confidence sends malformed scores to review instead of passing them', () => {
  const out = data(
    confidence.run({
      fields: [
        { label: 'NaN', value: 'x', confidence: Number.NaN, citations: [] },
        { label: 'Too high', value: 'x', confidence: 1.5, citations: [] },
        { label: 'String', value: 'x', confidence: '0.99' as unknown as number, citations: [] },
      ],
    }),
  );
  assert.equal(out.passed.length, 0);
  assert.deepEqual(
    out.needsReview.map((r) => [r.label, r.reason, r.confidence]),
    [
      ['NaN', 'invalid confidence score', null],
      ['Too high', 'invalid confidence score', null],
      ['String', 'invalid confidence score', null],
    ],
  );
});

test('a stricter threshold flags fields the default would pass', () => {
  const out = data(
    confidence.run({
      threshold: 0.95,
      fields: [{ label: 'Wages', value: '$1', confidence: 0.91, citations: [] }],
    }),
  );
  assert.equal(out.passed.length, 0);
  assert.equal(out.needsReview[0]?.reason, 'confidence 0.91 < 0.95');
});

test('assess_confidence rejects a call without a fields array', () => {
  const r = confidence.run({} as never);
  assert.ok(!(r instanceof Promise));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errorCategory, 'validation');
});
