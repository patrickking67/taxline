import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAmount } from '../src/index.js';

test('plain numbers and dollar formats parse with no message', () => {
  assert.deepEqual(checkAmount('85000'), { value: 85_000, message: null });
  assert.deepEqual(checkAmount('$85,000.50'), { value: 85_000.5, message: null });
  assert.deepEqual(checkAmount(' 1 234 '), { value: 1_234, message: null });
});

test('a blank field is not an error', () => {
  assert.deepEqual(checkAmount('   '), { value: undefined, message: null });
});

test('text that is not a number says so and falls back to 0', () => {
  const c = checkAmount('eighty');
  assert.equal(c.value, 0);
  assert.match(c.message ?? '', /Enter a number/);
});

test('values outside the range are clamped and the message names the limit', () => {
  const lo = checkAmount('-5', { min: 0 });
  assert.equal(lo.value, 0);
  assert.match(lo.message ?? '', /lowest value allowed is 0/);
  const hi = checkAmount('50', { min: 0, max: 12 });
  assert.equal(hi.value, 12);
  assert.match(hi.message ?? '', /highest value allowed is 12\. Using 12/);
});

test('negative numbers are fine when no minimum is set', () => {
  assert.deepEqual(checkAmount('-2,500'), { value: -2_500, message: null });
});

test('infinity and exponent overflow are rejected', () => {
  assert.match(checkAmount('Infinity').message ?? '', /Enter a number/);
  assert.match(checkAmount('1e999').message ?? '', /Enter a number/);
});
