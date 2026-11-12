// Value parsers for the rules extractor.
//
// Each parser returns the value in its canonical form together with the repairs
// it needed. A value that reads cleanly needs none. A repair is evidence that the
// text layer is damaged, so it lowers the field's confidence; a value that cannot
// be repaired without guessing is returned as null and goes to a person.

export interface Parsed {
  /** Canonical value, or null when the text cannot be read without guessing. */
  value: string | null;
  /** Characters swapped for the only digit or letter they resemble (O for 0). */
  lookalike: number;
  /** Characters that resemble more than one digit (B for 8 or 3). */
  ambiguous: number;
  /** Separators that were missing or of the wrong kind. */
  separator: number;
  /** False when the value was kept but does not fit the field's pattern. */
  wellFormed: boolean;
  /** Integer cents for money values. */
  cents?: number;
}

const none = (value: string | null, wellFormed = true): Parsed => ({
  value,
  lookalike: 0,
  ambiguous: 0,
  separator: 0,
  wellFormed,
});

/** Letters an OCR pass produces in place of a digit. `sure: false` marks a letter two digits share. */
const DIGIT_FOR: Record<string, { digit: string; sure: boolean }> = {
  O: { digit: '0', sure: true },
  o: { digit: '0', sure: true },
  l: { digit: '1', sure: true },
  I: { digit: '1', sure: true },
  S: { digit: '5', sure: true },
  G: { digit: '6', sure: true },
  g: { digit: '9', sure: true },
  A: { digit: '4', sure: true },
  E: { digit: '3', sure: true },
  T: { digit: '7', sure: true },
  B: { digit: '8', sure: false },
  Z: { digit: '2', sure: false },
};

/** Digits an OCR pass produces in place of a letter, as [uppercase, lowercase]. */
const LETTER_FOR: Record<string, [string, string]> = {
  '0': ['O', 'o'],
  '1': ['I', 'l'],
  '2': ['Z', 'z'],
  '3': ['E', 'e'],
  '4': ['A', 'a'],
  '5': ['S', 's'],
  '6': ['G', 'g'],
  '7': ['T', 't'],
  '8': ['B', 'b'],
  '9': ['g', 'g'],
};

function digitsFromLookalikes(raw: string): { text: string; lookalike: number; ambiguous: number } {
  let text = '';
  let lookalike = 0;
  let ambiguous = 0;
  for (const ch of raw) {
    const hit = DIGIT_FOR[ch];
    if (hit) {
      text += hit.digit;
      if (hit.sure) lookalike += 1;
      else ambiguous += 1;
    } else {
      text += ch;
    }
  }
  return { text, lookalike, ambiguous };
}

export function formatCents(cents: number): string {
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, '0');
  return `$${whole.toLocaleString('en-US')}.${frac}`;
}

/**
 * Money: `$128,400.00` or `128,400.00`. Thousands groups must have three digits
 * and the cents two, so a dropped digit is usually caught here. A value with the
 * wrong shape is not guessed at.
 */
export function parseMoney(raw: string): Parsed {
  const token = raw.trim().replace(/^\$/, '');
  if (token === '' || /\s/.test(token)) return none(null);
  const fixed = digitsFromLookalikes(token);
  if (!/^[0-9.,]+$/.test(fixed.text)) return none(null);
  const groups = fixed.text.split(/[.,]/);
  const seps = fixed.text.replace(/[0-9]/g, '');
  if (groups.length < 2) return none(null);
  const cents = groups[groups.length - 1]!;
  const whole = groups.slice(0, -1);
  if (cents.length !== 2) return none(null);
  let separator = seps[seps.length - 1] === '.' ? 0 : 1;
  if (whole.length === 1) {
    if (!/^\d+$/.test(whole[0]!)) return none(null);
    // No thousands separator at all: fine under 1,000, a dropped comma above it.
    if (whole[0]!.length > 3) separator += 1;
  } else {
    if (!/^\d{1,3}$/.test(whole[0]!)) return none(null);
    for (let i = 1; i < whole.length; i++) {
      if (!/^\d{3}$/.test(whole[i]!)) return none(null);
      if (seps[i - 1] !== ',') separator += 1;
    }
  }
  const digits = whole.join('');
  if (digits.length > 1 && digits.startsWith('0')) return none(null);
  const amount = Number(digits) * 100 + Number(cents);
  if (!Number.isSafeInteger(amount)) return none(null);
  return {
    value: formatCents(amount),
    lookalike: fixed.lookalike,
    ambiguous: fixed.ambiguous,
    separator,
    wellFormed: true,
    cents: amount,
  };
}

/**
 * Taxpayer ID in the EIN shape, two digits, a hyphen, seven digits. EINs carry no
 * check digit, so the shape is the only validity test there is.
 */
export function parseId(raw: string): Parsed {
  const token = raw.trim();
  if (token === '') return none(null);
  const fixed = digitsFromLookalikes(token);
  const m = /^(\d{2})([-–. ]?)(\d{7})$/.exec(fixed.text);
  if (!m) return none(null);
  return {
    value: `${m[1]}-${m[3]}`,
    lookalike: fixed.lookalike,
    ambiguous: fixed.ambiguous,
    separator: m[2] === '-' ? 0 : 1,
    wellFormed: true,
  };
}

function lettersFromLookalikes(raw: string): { text: string; lookalike: number } {
  let lookalike = 0;
  const text = raw
    .split(' ')
    .map((word) => {
      if (!/[0-9]/.test(word) || !/[A-Za-z]/.test(word)) return word;
      const letters = word.replace(/[^A-Za-z]/g, '');
      const upper = letters === letters.toUpperCase();
      return [...word]
        .map((ch, i) => {
          const pair = LETTER_FOR[ch];
          if (!pair) return ch;
          lookalike += 1;
          return upper || i === 0 ? pair[0] : pair[1];
        })
        .join('');
    })
    .join(' ');
  return { text, lookalike };
}

/** Locality code, three letters and a residency suffix: `PHL-RES`, `COL-NR`. */
export function parseCode(raw: string): Parsed {
  const token = raw.trim();
  if (token === '') return none(null);
  let lookalike = 0;
  const text = [...token]
    .map((ch) => {
      const pair = LETTER_FOR[ch];
      if (!pair) return ch;
      lookalike += 1;
      return pair[0];
    })
    .join('');
  const m = /^([A-Z]{3})(-?)(RES|NR)$/.exec(text);
  if (!m) return { ...none(token, false), value: token };
  return {
    value: `${m[1]}-${m[3]}`,
    lookalike,
    ambiguous: 0,
    separator: m[2] === '-' ? 0 : 1,
    wellFormed: true,
  };
}

/** A name. There is nothing to validate against, so only visible damage is counted. */
export function parseText(raw: string): Parsed {
  const token = raw.trim().replace(/\s+/g, ' ');
  if (token === '') return none(null);
  const fixed = lettersFromLookalikes(token);
  // Anything left that a name would not contain means part of it is unreadable.
  if (!/^[A-Za-z0-9 .,&'-]+$/.test(fixed.text)) return none(null);
  return {
    value: fixed.text,
    lookalike: fixed.lookalike,
    ambiguous: 0,
    separator: 0,
    wellFormed: true,
  };
}
