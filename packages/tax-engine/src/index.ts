// @taxline/tax-engine — deterministic federal tax math.
//
// The fleet's agents never do arithmetic in a prompt. They call these
// functions, which are pure, typed, unit-tested, and cite every figure.

export * from './types.js';
export * from './money.js';
export * from './brackets.js';
export * from './capitalGains.js';
export * from './selfEmployment.js';
export * from './qbi.js';
export * from './credits.js';
export * from './form1040.js';
export * from './estimated.js';
export * from './depreciation.js';
export * from './roi.js';
export { TY2026, cite, type TaxYear } from './years/2026.js';
