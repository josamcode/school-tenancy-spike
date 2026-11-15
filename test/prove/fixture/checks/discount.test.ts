import { describe, expect, it } from 'vitest';
import { discounted, label } from '../src/discount.js';

describe('a discount', () => {
  it('is taken off the amount', () => {
    expect(discounted(100, 30)).toBe(70);
  });

  it('is refused when it exceeds the amount', () => {
    expect(() => discounted(100, 130)).toThrow('cannot exceed the amount');
  });
});

describe('a label', () => {
  it('shows two decimals', () => {
    expect(label(70)).toBe('70.00 AED');
  });
});
