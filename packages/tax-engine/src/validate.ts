// Plain-language checks for typed amounts. The calculators clamp to a field's
// range so a bad value never reaches the engine; this says what happened.

export interface AmountCheck {
  /** The number to compute with, or undefined when the field is blank. */
  value: number | undefined;
  /** What to tell the person, or null when the input was fine. */
  message: string | null;
}

export interface AmountBounds {
  min?: number;
  max?: number;
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Parse "$85,000", "85000" or "1 234.50"; explain anything else. */
export function checkAmount(raw: string, { min, max }: AmountBounds = {}): AmountCheck {
  const text = raw.trim();
  if (text === '') return { value: undefined, message: null };
  const n = Number(text.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) {
    return { value: 0, message: 'Enter a number, such as 85,000. Using 0 for now.' };
  }
  if (min !== undefined && n < min) {
    return { value: min, message: `The lowest value allowed is ${fmt(min)}. Using ${fmt(min)}.` };
  }
  if (max !== undefined && n > max) {
    return { value: max, message: `The highest value allowed is ${fmt(max)}. Using ${fmt(max)}.` };
  }
  return { value: n, message: null };
}
