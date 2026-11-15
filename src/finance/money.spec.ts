import {
  CURRENCIES,
  fromBase,
  fromMinor,
  split,
  subtract,
  toBase,
  toMinor,
} from './money.js';

describe('money', () => {
  describe('minor units', () => {
    it('knows two decimals for AED, SAR and QAR and three for BHD, KWD and OMR', () => {
      expect(CURRENCIES).toEqual({
        AED: 2,
        SAR: 2,
        QAR: 2,
        BHD: 3,
        KWD: 3,
        OMR: 3,
      });
    });

    it('parses and formats without floating point', () => {
      expect(toMinor('1000.00', 'AED')).toBe(100000n);
      expect(toMinor('12.345', 'BHD')).toBe(12345n);
      expect(toMinor('-75.00', 'AED')).toBe(-7500n);
      expect(toMinor('7', 'AED')).toBe(700n);
      expect(fromMinor(100000n, 'AED')).toBe('1000.00');
      expect(fromMinor(-7653n, 'BHD')).toBe('-7.653');
      expect(fromMinor(5n, 'AED')).toBe('0.05');
      expect(fromMinor(0n, 'KWD')).toBe('0.000');
    });

    it('accepts the trailing zeros of numeric(19,4)', () => {
      expect(toMinor('975.0000', 'AED')).toBe(97500n);
      expect(toMinor('-7.6530', 'BHD')).toBe(-7653n);
    });

    it('keeps a number that a double cannot hold exactly', () => {
      expect(fromMinor(toMinor('900719925474099.37', 'AED'), 'AED')).toBe(
        '900719925474099.37',
      );
    });

    it('refuses more decimals than the currency has', () => {
      expect(() => toMinor('12.345', 'AED')).toThrow();
      expect(() => toMinor('12.3456', 'BHD')).toThrow();
    });

    it.each(['', 'abc', '1e3', '1,000.00', '1.', '.5', '--1', ' 1'])(
      'refuses %j as an amount',
      (value) => {
        expect(() => toMinor(value, 'AED')).toThrow();
      },
    );

    it('subtracts', () => {
      expect(subtract('293.70', '294.00', 'AED')).toBe('-0.30');
      expect(subtract('0.00', '-5.00', 'AED')).toBe('5.00');
    });
  });

  describe('splitting an amount', () => {
    it('splits 1,000.00 AED in three with the extra fils on the first part', () => {
      expect(split('1000.00', 'AED', 3)).toEqual([
        '333.34',
        '333.33',
        '333.33',
      ]);
    });

    it('splits 1,000.000 KWD in three with the extra fils on the first part', () => {
      expect(split('1000.000', 'KWD', 3)).toEqual([
        '333.334',
        '333.333',
        '333.333',
      ]);
    });

    it('hands out one minor unit at a time when the remainder is larger', () => {
      expect(split('0.05', 'AED', 3)).toEqual(['0.02', '0.02', '0.01']);
      expect(split('0.02', 'AED', 3)).toEqual(['0.01', '0.01', '0.00']);
    });

    it.each([
      ['1000.00', 'AED', 3],
      ['1000.000', 'KWD', 7],
      ['99999.99', 'SAR', 12],
      ['0.001', 'BHD', 4],
    ] as const)(
      'always sums back to %s %s over %i parts',
      (amount, currency, parts) => {
        const total = split(amount, currency, parts)
          .map((part) => toMinor(part, currency))
          .reduce((sum, part) => sum + part, 0n);
        expect(total).toBe(toMinor(amount, currency));
      },
    );

    it('splits a credit the same way', () => {
      expect(split('-1000.00', 'AED', 3)).toEqual([
        '-333.34',
        '-333.33',
        '-333.33',
      ]);
    });

    it('refuses zero or a fractional number of parts', () => {
      expect(() => split('10.00', 'AED', 0)).toThrow();
      expect(() => split('10.00', 'AED', 1.5)).toThrow();
    });
  });

  describe('conversion', () => {
    it('translates a foreign amount to the base currency at a rate', () => {
      expect(toBase('100.000', 'BHD', 'AED', '9.7500')).toBe('975.00');
      expect(toBase('92.347', 'BHD', 'AED', '9.8000')).toBe('905.00');
      expect(toBase('300.00', 'SAR', 'AED', '0.9790')).toBe('293.70');
    });

    it('translates a base amount to the foreign currency at a rate', () => {
      expect(fromBase('75.00', 'AED', 'BHD', '9.8000')).toBe('7.653');
      expect(fromBase('975.00', 'AED', 'BHD', '9.7500')).toBe('100.000');
    });

    it('rounds half away from zero, for debits and credits', () => {
      expect(toBase('1.00', 'SAR', 'AED', '0.125')).toBe('0.13');
      expect(toBase('-1.00', 'SAR', 'AED', '0.125')).toBe('-0.13');
      expect(toBase('1.00', 'SAR', 'AED', '0.124')).toBe('0.12');
      expect(toBase('-1.00', 'SAR', 'AED', '0.124')).toBe('-0.12');
      expect(fromBase('0.02', 'AED', 'BHD', '8.0000')).toBe('0.003');
      expect(fromBase('-0.02', 'AED', 'BHD', '8.0000')).toBe('-0.003');
      expect(fromBase('0.01', 'AED', 'BHD', '8.0000')).toBe('0.001');
    });

    it('accepts a rate with eight decimals, as the database stores it', () => {
      expect(toBase('100.000', 'BHD', 'AED', '9.75000000')).toBe('975.00');
    });

    it('refuses a rate that is zero, negative or not a number', () => {
      expect(() => toBase('1.00', 'SAR', 'AED', '0')).toThrow();
      expect(() => toBase('1.00', 'SAR', 'AED', '-1')).toThrow();
      expect(() => fromBase('1.00', 'AED', 'SAR', 'abc')).toThrow();
    });
  });
});
