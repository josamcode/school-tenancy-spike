// Amounts are decimal strings on the outside and BigInt minor units on the
// inside. Nothing here uses floating point.

// Must match the rows of the currencies table. A test compares the two.
export const CURRENCIES = {
  AED: 2,
  SAR: 2,
  QAR: 2,
  BHD: 3,
  KWD: 3,
  OMR: 3,
} as const;

export type Currency = keyof typeof CURRENCIES;

export function isCurrency(value: string): value is Currency {
  return Object.hasOwn(CURRENCIES, value);
}

const RATE_SCALE = 8;
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

// Parses a decimal string to an integer scaled by 10^scale. Digits beyond the
// scale are allowed only when they are zeros, as in numeric(19,4).
function parse(value: string, scale: number, what: string): bigint {
  const match = DECIMAL.exec(value);
  if (!match) throw new Error(`"${value}" is not ${what}`);
  const [, sign, whole, fraction = ''] = match;
  if (/[1-9]/.test(fraction.slice(scale))) {
    throw new Error(`"${value}" has more than ${scale} decimals`);
  }
  const digits = whole + fraction.slice(0, scale).padEnd(scale, '0');
  return sign === '-' ? -BigInt(digits) : BigInt(digits);
}

// Half away from zero: the commercial rule, and what PostgreSQL's round() does.
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (2n * n + d) / (2n * d);
  return negative ? -quotient : quotient;
}

export function toMinor(amount: string, currency: Currency): bigint {
  return parse(amount, CURRENCIES[currency], `an amount in ${currency}`);
}

export function fromMinor(minor: bigint, currency: Currency): string {
  const scale = CURRENCIES[currency];
  const digits = (minor < 0n ? -minor : minor)
    .toString()
    .padStart(scale + 1, '0');
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale);
  return `${minor < 0n ? '-' : ''}${whole}.${fraction}`;
}

export function subtract(a: string, b: string, currency: Currency): string {
  return fromMinor(toMinor(a, currency) - toMinor(b, currency), currency);
}

export function negate(amount: string, currency: Currency): string {
  return fromMinor(-toMinor(amount, currency), currency);
}

// Splits an amount into parts that always sum back to it. The remainder is
// handed out one minor unit at a time, starting with the first part.
export function split(
  amount: string,
  currency: Currency,
  parts: number,
): string[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new Error('parts must be a positive whole number');
  }
  const total = toMinor(amount, currency);
  const sign = total < 0n ? -1n : 1n;
  const absolute = total * sign;
  const count = BigInt(parts);
  const share = absolute / count;
  const remainder = absolute % count;
  return Array.from({ length: parts }, (_, index) =>
    fromMinor(sign * (share + (BigInt(index) < remainder ? 1n : 0n)), currency),
  );
}

function parseRate(rate: string): bigint {
  const scaled = parse(rate, RATE_SCALE, 'a rate');
  if (scaled <= 0n) throw new Error(`"${rate}" is not a positive rate`);
  return scaled;
}

// One unit of the foreign currency is worth `rate` units of the base currency.
export function toBase(
  foreignAmount: string,
  foreign: Currency,
  base: Currency,
  rate: string,
): string {
  const numerator =
    toMinor(foreignAmount, foreign) *
    parseRate(rate) *
    10n ** BigInt(CURRENCIES[base]);
  const denominator = 10n ** BigInt(CURRENCIES[foreign] + RATE_SCALE);
  return fromMinor(divideRounded(numerator, denominator), base);
}

export function fromBase(
  baseAmount: string,
  base: Currency,
  foreign: Currency,
  rate: string,
): string {
  const numerator =
    toMinor(baseAmount, base) * 10n ** BigInt(RATE_SCALE + CURRENCIES[foreign]);
  const denominator = parseRate(rate) * 10n ** BigInt(CURRENCIES[base]);
  return fromMinor(divideRounded(numerator, denominator), foreign);
}
